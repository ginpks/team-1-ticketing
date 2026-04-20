import { createClient } from "redis";
import { purchasePool } from "../../db/purchase/purchase.js";

const client = createClient();
await client.connect();

const WAITLIST_QUEUE = "waitlist-queue";
const DLQ = "waitlist:dlq";

function validateJob(job) {
  const errors = [];

  if (job.event == null) errors.push("missing event");
  if (!job.seat || typeof job.seat !== "string")
    errors.push("missing/invalid seat");
  if (!job.idempotencyKey || typeof job.idempotencyKey !== "string")
    errors.push("missing/invalid idempotencyKey");
  if (job.amount == null || isNaN(Number(job.amount)))
    errors.push("missing/invalid amount");
  if (!job.startTime) errors.push("missing startTime");
  if (!job.endTime) errors.push("missing endTime");

  return errors;
}

//this function take the free up seat from the event and give it to the waitlist customer
async function promoteNextUser({ event, seat, startTime, endTime }) {
  const queueKey = `waitlist:${event}`;

  const nextRaw = await client.lPop(queueKey);
  if (!nextRaw) return null;

  let nextUser;
  try {
    nextUser = JSON.parse(nextRaw);
  } catch {
    let env = JSON.stringify({
      nextRaw,
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
      [nextUser.amount ?? 0, nextUser.idempotencyKey],
    );

    const purchaseId = purchaseRes.rows[0].id;

    await db.query(
      `INSERT INTO reservations (purchase_id, event, seat, start_time, end_time)
       VALUES ($1, $2, $3, $4, $5)`,
      [purchaseId, event, seat, startTime, endTime],
    );

    await db.query("COMMIT");

    await client.lPush(
      "ticket-purchase-queue",
      JSON.stringify({
        purchaseId,
        amount: nextUser.amount,
        event: event,
        seat: seat,
        idempotency_key: nextUser.idempotencyKey,
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

    return purchaseId;
  } catch (err) {
    await db.query("ROLLBACK");
    await client.lPush(queueKey, nextRaw);
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

  //JSON check
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

  //data check
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

  //status check
  if (job.status === "cancel" || job.status === "failed") {
    const res = await purchasePool.query(
      `DELETE FROM purchases WHERE id = $1 RETURNING *`,
      [job.id],
    );

    if (res.rowCount === 0) {
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
    continue;
  }

  await promoteNextUser({
    event: job.event,
    seat: job.seat,
    startTime: job.startTime,
    endTime: job.endTime,
  });
}
