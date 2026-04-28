import { eventPool, storeEvent } from "./event-catalog.js";

const init = async () => {
  const client = await eventPool.connect();

  const eventTable = `CREATE TABLE IF NOT EXISTS events (
  event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  start_time TIMESTAMP NOT NULL,
  end_time TIMESTAMP,
  venue_name TEXT NOT NULL,
  venue_address TEXT,
  created_at TIMESTAMP DEFAULT NOW());`;

  const seatTable = `CREATE TABLE IF NOT EXISTS seats (
  seat_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID REFERENCES events(event_id) ON DELETE CASCADE,
  seat_number TEXT NOT NULL,
  section TEXT,
  price NUMERIC(10,2) NOT NULL,
  status TEXT DEFAULT 'available');`;

  try {
    await client.query("BEGIN");
    await client.query(eventTable);
    await client.query(seatTable);
    await client.query(`
  INSERT INTO events (event_id, name, start_time, end_time, venue_name, venue_address)
  VALUES ('a0000000-0000-0000-0000-000000000001', 'Concert', '2026-04-11T14:30:00Z', '2026-04-11T16:00:00Z', 'MSG', 'NYC')
  ON CONFLICT (event_id) DO NOTHING
`);
    await client.query(`
  INSERT INTO seats (seat_id, event_id, seat_number, section, price, status)
  VALUES ('b0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', '1E', 'E', 12.22, 'available')
  ON CONFLICT (seat_id) DO NOTHING
`);
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

//create tables
await init();

//add event
const event = {
  name: "Concert",
  startTime: "2026-04-11T14:30:00Z",
  endTime: "2026-04-11T16:00:00Z",
  venueName: "MSG",
  venueAddress: "NYC",
};

const seat = {
  number: "1E",
  section: "E",
  price: 12.22,
  status: "available",
};

const id = await storeEvent(event, seat);
console.log(id);
