CREATE TABLE IF NOT EXISTS refunds (
  id SERIAL PRIMARY KEY,
  purchase_id INTEGER NOT NULL,
  amount NUMERIC(10,2) NOT NULL,
  status TEXT CHECK(status IN ('pending', 'completed', 'failed')) NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);