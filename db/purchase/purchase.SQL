CREATE TABLE purchases (
  purchase_id SERIAL PRIMARY KEY,
  user_id INT NOT NULL,
  amount NUMERIC(10,2) NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE reservations (
  reservation_id SERIAL PRIMARY KEY,
  purchase_id INT NOT NULL REFERENCES purchases(purchase_id) ON DELETE CASCADE,
  event_id INT NOT NULL,
  seat_id INT NOT NULL,
  start_time TIMESTAMP NOT NULL,
  end_time TIMESTAMP NOT NULL
);
