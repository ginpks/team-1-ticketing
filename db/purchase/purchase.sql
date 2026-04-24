CREATE TABLE purchases (
  id SERIAL PRIMARY KEY,
  amount NUMERIC(10,2) NOT NULL,
  status TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(idempotency_key)

);

CREATE TABLE reservations (
  reservation_id SERIAL PRIMARY KEY,
  purchase_id INT NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
  event TEXT NOT NULL,
  seat TEXT NOT NULL,
  start_time TIMESTAMP NOT NULL,
  end_time TIMESTAMP NOT NULL,
  UNIQUE(event, seat)
);

CREATE TABLE payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_id INT NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  amount NUMERIC(10,2) NOT NULL,
  transaction_ref TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
