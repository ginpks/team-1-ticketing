CREATE TABLE IF NOT EXISTS events (
  id UUID PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  start_time TIMESTAMP NOT NULL,
  end_time TIMESTAMP,
  venue_name TEXT NOT NULL,
  venue_address TEXT,
  popularity_score INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW()
);


CREATE TABLE IF NOT EXISTS seats (
  id UUID PRIMARY KEY,
  event_id UUID REFERENCES events(id) ON DELETE CASCADE,
  seat_number TEXT NOT NULL,
  section TEXT,
  price NUMERIC(10,2) NOT NULL,
  status TEXT DEFAULT 'available'
);
