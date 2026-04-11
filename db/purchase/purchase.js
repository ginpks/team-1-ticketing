import { Pool } from "pg";
import "dotenv/config";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

//call this function to store purchases
export const createPurchase = async (
  userId,
  amount,
  idempotencyKey,
  eventId,
  seatId,
  duration,
) => {
  const client = await pool.connect();

  try {
    await client.query("BEGIN"); //beginning of transaction

    const existing = await client.query(
      `SELECT * FROM purchases WHERE idempotency_key = $1`,
      [idempotencyKey],
    );

    if (existing.rows.length > 0) {
      const purchase = existing.rows[0];

      const reservation = await client.query(
        `SELECT * FROM reservations WHERE purchase_id = $1`,
        [purchase.purchase_id],
      );

      await client.query("COMMIT");

      return {
        purchase,
        reservations: reservation.rows,
      };
    }

    const result = await client.query(
      `INSERT INTO purchases (
        user_id,
        amount,
        status,
        idempotency_key
      )
      VALUES ($1, $2, $3, $4)
      RETURNING *`,
      [userId, amount, "PENDING", idempotencyKey],
    );

    const purchase = result.rows[0];

    const reservation = await addReservation(
      client,
      purchase.purchase_id,
      eventId,
      seatId,
      duration,
    );

    await client.query("COMMIT");

    return {
      purchase,
      reservations: [reservation],
    };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
};
const addReservation = async (
  client,
  purchaseId,
  eventId,
  seatId,
  duration,
) => {
  const startTime = new Date();
  const endTime = new Date(startTime.getTime() + duration * 60 * 1000);
  const result = await client.query(
    `INSERT INTO reservations (purchase_id, event_id, seat_id, start_time, end_time) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [purchaseId, eventId, seatId, startTime, endTime],
  );
  return result.rows[0];
};
