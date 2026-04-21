CREATE TABLE IF NOT EXISTS analytics (
  id SERIAL PRIMARY KEY,
  event TEXT NOT NULL UNIQUE,
  tickets_sold INT NOT NULL DEFAULT 0,
  peak_hour TIMESTAMP NOT NULL,
  browsed_count INT DEFAULT 0,
  revenue DECIMAL(10,2) NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS processed_purchase_confirmations (
  purchase_id TEXT PRIMARY KEY,
  event TEXT NOT NULL,
  confirmed_at TIMESTAMP NOT NULL DEFAULT NOW()
);
