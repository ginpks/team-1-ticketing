CREATE TABLE IF NOT EXISTS analytics (
  id SERIAL PRIMARY KEY,
  event TEXT NOT NULL UNIQUE,
  tickets_sold INT NOT NULL DEFAULT 0,
  ticket_purchase_peak_hour TIMESTAMP,
  browsed_count INT DEFAULT 0,
  browse_peak_hour TIMESTAMP,
  revenue DECIMAL(10,2) NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS processed_purchase_confirmations (
  purchase_id TEXT PRIMARY KEY,
  event TEXT NOT NULL,
  confirmed_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS processed_browse_events (
  id SERIAL PRIMARY KEY,
  event TEXT NOT NULL,
  browsed_at TIMESTAMP NOT NULL
);
