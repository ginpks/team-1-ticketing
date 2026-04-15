CREATE TABLE IF NOT EXISTS analytics (
  id SERIAL PRIMARY KEY,
  event TEXT NOT NULL,
  tickets_sold INT NOT NULL,
  peak_hour TIMESTAMP NOT NULL,
  revenue DECIMAL(10,2) NOT NULL
);
