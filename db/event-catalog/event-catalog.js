import { Pool } from "pg";
import "dotenv/config";

export const eventPool = new Pool({
  connectionString: process.env.EVENT_DATABASE_URL,
});

export const storeEvent = async (event, seat) => {
  const client = await eventPool.connect();

  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO events (event_id, name, start_time, end_time, venue_name, venue_address) VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        event.eventId,
        event.name,
        event.startTime,
        event.endTime,
        event.venueName,
        event.venueAddress,
      ],
    );
    await client.query(
      `INSERT INTO seats (seat_id, event_id, seat_number, section, price, status) VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        seat.seatId,
        event.eventId,
        seat.seatNumber,
        seat.seatSection,
        seat.seatPrice,
        seat.seatStatus,
      ],
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
