import { Pool } from "pg";
import "dotenv/config";

export const eventPool = new Pool({
  connectionString: process.env.EVENT_DATABASE_URL,
});

export const storeEvent = async (event, seat) => {
  const client = await eventPool.connect();

  try {
    await client.query("BEGIN");
    const eventResult = await client.query(
      `INSERT INTO events (name, start_time, end_time, venue_name, venue_address) VALUES ($1, $2, $3, $4, $5) RETURNING event_id`,
      [
        event.name,
        event.startTime,
        event.endTime,
        event.venueName,
        event.venueAddress,
      ],
    );

    const eventId = eventResult.rows[0].event_id;

    await client.query(
      `INSERT INTO seats (event_id,seat_number, section, price, status) VALUES ($1, $2, $3, $4, $5)`,
      [eventId, seat.number, seat.section, seat.price, seat.status],
    );
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    throw err;
  } finally {
    client.release();
  }
};
