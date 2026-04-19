import "dotenv/config";
import { Pool } from "pg";

const analyticPool = new Pool({
  connectionString: process.env.ANALYTIC_DATABASE_URL,
});

const init = async () => {
  try {
    await analyticPool.query(`CREATE TABLE IF NOT EXISTS analytics (
  id SERIAL PRIMARY KEY,
  event TEXT NOT NULL UNIQUE,
  tickets_sold INT NOT NULL DEFAULT 0,
  peak_hour TIMESTAMP NOT NULL,
  browsed_count INT DEFAULT 0,
  revenue DECIMAL(10,2) NOT NULL DEFAULT 0
);`);
    await analyticPool.query(`CREATE TABLE IF NOT EXISTS processed_purchase_confirmations (
  purchase_id TEXT PRIMARY KEY,
  event TEXT NOT NULL,
  confirmed_at TIMESTAMP NOT NULL DEFAULT NOW()
);`);
    await analyticPool.query(`
      WITH event_totals AS (
        SELECT
          event,
          MIN(id) AS keep_id,
          SUM(tickets_sold) AS tickets_sold,
          MAX(peak_hour) AS peak_hour,
          SUM(COALESCE(browsed_count, 0)) AS browsed_count,
          SUM(revenue) AS revenue
        FROM analytics
        GROUP BY event
      )
      UPDATE analytics
      SET
        tickets_sold = event_totals.tickets_sold,
        peak_hour = event_totals.peak_hour,
        browsed_count = event_totals.browsed_count,
        revenue = event_totals.revenue
      FROM event_totals
      WHERE analytics.id = event_totals.keep_id;
    `);
    await analyticPool.query(`
      DELETE FROM analytics duplicate
      USING analytics kept
      WHERE duplicate.event = kept.event
        AND duplicate.id > kept.id;
    `);
    await analyticPool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conname = 'analytics_event_key'
        ) THEN
          ALTER TABLE analytics ADD CONSTRAINT analytics_event_key UNIQUE (event);
        END IF;
      END $$;
    `);
    console.log("analytics table created");
  } catch (err) {
    throw err;
  }
};

await init();
