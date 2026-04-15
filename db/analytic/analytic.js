import { Pool } from "pg";

export const analyticPool = new Pool({
  connectionString: process.env.ANALYTIC_DATABASE_URL,
});

export const addAnalytic = async (analytic) => {
  await analyticPool.query(
    `INSERT INTO analytics (event, tickets_sold, peak_hour, browsed_count, revenue) VALUES ($1, $2, $3, $4, $5)`,
    [
      analytic.event,
      analytic.ticketsSold,
      analytic.peakHour,
      analytic.browsedCount,
      analytic.revenue,
    ],
  );
};
