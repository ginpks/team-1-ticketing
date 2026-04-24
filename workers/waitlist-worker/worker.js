import { createClient } from "redis";
import { Pool } from "pg";

const url = process.env.PURCHASE_DATABASE_URL;

export const purchasePool = new Pool({
  connectionString: url,
});

const client = createClient({
  url: process.env.REDIS_URL || "redis://redis:6379",
});
await client.connect();

const WAITLIST_QUEUE = "waitlist-queue";
const DLQ = "waitlist:dlq";

function validateJob(job) {
  const errors = [];

  if (job.event == null) errors.push("missing event");
  if (!job.seat || typeof job.seat !== "string")
    errors.push("missing/invalid seat");
  if (!job.idempotency_key || typeof job.idempotency_key !== "string")
    errors.push("missing/invalid idempotencyKey");
  if (job.amount == null || isNaN(Number(job.amount)))
    errors.push("missing/invalid amount");

  // FIX 4: Validate job.id when status is cancel or failed
  if ((job.status === "cancel" || job.status === "failed") && job.id == null) {
    errors.push("missing id for cancel/failed job");
  }

  return errors;
}

async function promoteNextUser({ event, seat, startTime, endTime }) {
  const queueKey = `waitlist:${event}`;
  console.log(event);

  const nextRaw = await client.blPop(queueKey, 0);
  if (!nextRaw) return null;

  let nextUser;
  try {
    // FIX 1: destructure .element from blPop result
    nextUser = JSON.parse(nextRaw.element);
  } catch {
    let env = JSON.stringify({
      raw: nextRaw.element,
      reason: "invalid JSON",
      failedAt: new Date().toISOString(),
    });
    await client.lPush(DLQ, env);
    return null;
  }

  const db = await purchasePool.connect();

  try {
    await db.query("BEGIN");

    const purchaseRes = await db.query(
      `INSERT INTO purchases (amount, status, idempotency_key)
       VALUES ($1, 'pending', $2)
       RETURNING id`,
      // FIX 2: use camelCase idempotencyKey to match validated field
      [nextUser.amount ?? 0, nextUser.idempotency_key],
    );

    const purchaseId = purchaseRes.rows[0].id;

    const reservationRes = await db.query(
      `INSERT INTO reservations (purchase_id, event, seat, start_time, end_time)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (event, seat) DO NOTHING
       RETURNING *`,
      [purchaseId, event, seat, startTime, endTime],
    );

    if (reservationRes.rowCount === 0) {
      await db.query("ROLLBACK");
      return null;
    }

    await db.query("COMMIT");

    await client.lPush(
      "ticket-purchase-queue",
      JSON.stringify({
        purchaseId,
        amount: nextUser.amount,
        event: event,
        seat: seat,
        idempotency_key: nextUser.idempotency_key,
      }),
    );

    await client.publish(
      "purchase-events",
      JSON.stringify({
        action: "purchase_created_from_waitlist",
        purchaseId,
        event,
        seat,
        status: "pending",
        createdAt: new Date().toISOString(),
      }),
    );

    console.log(`promote user ${purchaseId}`);

    return purchaseId;
  } catch (err) {
    await db.query("ROLLBACK");
    await client.lPush(queueKey, nextRaw.element);
    throw err;
  } finally {
    db.release();
  }
}

while (true) {
  const result = await client.blPop(WAITLIST_QUEUE, 0);
  if (!result) continue;
  const raw = result.element;

  let job;

  try {
    job = JSON.parse(raw);
  } catch (err) {
    let env = JSON.stringify({
      raw,
      reason: "invalid JSON",
      failedAt: new Date().toISOString(),
    });
    await client.lPush(DLQ, env);
    continue;
  }

  const errors = validateJob(job);
  if (errors.length > 0) {
    let env = JSON.stringify({
      job,
      reason: "missing field or wrong data type",
      failedAt: new Date().toISOString(),
    });
    await client.lPush(DLQ, env);
    continue;
  }
  const db = await purchasePool.connect();
  const pu = await db.query(`SELECT * FROM purchases WHERE id = $1`, [
    job.purchaseId,
  ]);
  const re = await db.query(
    `SELECT * FROM reservations WHERE purchase_id = $1`,
    [job.purchaseId],
  );

  const purchase = pu.rows[0];
  const reservation = re.rows[0];
  const status = purchase.status;
  const startTime = reservation.start_time;
  const endTime = reservation.end_time;

  if (status === "cancel" || status === "failed") {
    // FIX 3: delete reservation first so the seat is actually freed,
    // then delete the purchase — both in one transaction
    try {
      await db.query("BEGIN");
      await db.query(`DELETE FROM reservations WHERE purchase_id = $1`, [
        job.purchaseId,
      ]);

      const pur = await db.query(
        `DELETE FROM purchases WHERE id = $1 RETURNING *`,
        [job.purchaseId],
      );
      if (pur.rowCount === 0) {
        await db.query("ROLLBACK");
        await client.lPush(
          DLQ,
          JSON.stringify({
            job,
            reason: "purchase not found",
            failedAt: new Date().toISOString(),
          }),
        );
        continue;
      }
      await db.query("COMMIT");
      await promoteNextUser({
        event: job.event,
        seat: job.seat,
        startTime: startTime,
        endTime: endTime,
      });
    } catch (err) {
      await db.query("ROLLBACK");
      throw err;
    } finally {
      db.release();
    }
  }
}
