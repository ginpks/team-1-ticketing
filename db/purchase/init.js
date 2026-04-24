import { purchasePool, storePurchase } from "./purchase.js";
import "dotenv/config";

const createTable = async () => {
  const client = await purchasePool.connect();
  await client.query(`CREATE TABLE IF NOT EXISTS purchases (
  id SERIAL PRIMARY KEY,
  amount NUMERIC(10,2) NOT NULL,
  status TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(idempotency_key)
);`);

  await client.query(`CREATE TABLE IF NOT EXISTS reservations (
  reservation_id SERIAL PRIMARY KEY,
  purchase_id INT NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
  event TEXT NOT NULL,
  seat TEXT NOT NULL,
  start_time TIMESTAMP NOT NULL,
  end_time TIMESTAMP NOT NULL,
  UNIQUE(event, seat)
);`);

  await client.query(`CREATE TABLE IF NOT EXISTS payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_id INT NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  amount NUMERIC(10,2) NOT NULL,
  transaction_ref TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);`);
};

const init = async () => {
  try {
    await createTable();
    console.log("table created");
    const purchase = {
      amount: 22.12,
      status: "PENDING",
      idempotencyKey: "1223EEq2",
    };
    const reservation = {
      event: "MOVIE",
      seat: "EE1",
      startTime: "2026-04-11 18:00:00",
      endTime: "2026-04-11 20:00:00",
    };
    const payment = {
      status: "PENDING",
      amount: 22.12,
      transactionRef: "qqe213",
    };
    const purchaseId = await storePurchase(purchase, reservation, payment);
    console.log(purchaseId);
  } catch (err) {
    console.error(err);
  }
};

const id = await init(); //create purchase and reservation table
console.log(id);
