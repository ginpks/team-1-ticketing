import { Pool } from "pg";
import "dotenv/config";

const url = process.env.PURCHASE_DATABASE_URL;

export const purchasePool = new Pool({
  connectionString: url,
});

export const storePurchase = async (purchase, reservation, payment) => {
  const client = await purchasePool.connect();
  try {
    await client.query("BEGIN");
    const purchaseData = await client.query(
      `INSERT INTO purchases (amount, status, idempotency_key) VALUES ($1, $2, $3) RETURNING id`,
      [purchase.amount, purchase.status, purchase.idempotencyKey],
    );

    const purchaseId = purchaseData.rows[0].id;

    await client.query(
      `INSERT INTO reservations (purchase_id, event, seat, start_time, end_time) VALUES ($1, $2, $3, $4, $5)`,
      [
        purchaseId,
        reservation.event,
        reservation.seat,
        reservation.startTime,
        reservation.endTime,
      ],
    );

    await client.query(
      `INSERT INTO payments (purchase_id, status, amount, transaction_ref) VALUES ($1, $2, $3, $4)`,
      [purchaseId, payment.status, payment.amount, payment.transactionRef],
    );

    await client.query("COMMIT");
    return purchaseId;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
};
