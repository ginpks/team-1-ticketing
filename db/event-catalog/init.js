import { eventPool } from "./event-catalog";

const init = async () => {
  const client = await eventPool.connect();

  const eventTable = `CREATE TABLE IF NOT EXISTS events (
  event_id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  start_time TIMESTAMP NOT NULL,
  end_time TIMESTAMP,
  venue_name TEXT NOT NULL,
  venue_address TEXT,
  created_at TIMESTAMP DEFAULT NOW());`;

  const seatTable = `CREATE TABLE IF NOT EXISTS seats (
  seat_id UUID PRIMARY KEY,
  event_id UUID REFERENCES events(event_id) ON DELETE CASCADE,
  seat_number TEXT NOT NULL,
  section TEXT,
  price NUMERIC(10,2) NOT NULL,
  status TEXT DEFAULT 'available');`;

  try {
    await client.query("BEGIN");
    await client.query(eventTable);
    await client.query(seatTable);
    await client.query("COMMIT");
    console.log("tables created");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    throw err;
  } finally {
    client.release();
  }
};

await init();
