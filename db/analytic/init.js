import "dotenv/config";
import { analyticPool, addAnalytic } from "./analytic.js";

const init = async () => {
  try {
    await analyticPool.query(`CREATE TABLE IF NOT EXISTS analytics (
  id SERIAL PRIMARY KEY,
  event TEXT NOT NULL,
  tickets_sold INT NOT NULL DEFAULT 0,
  peak_hour TIMESTAMP NOT NULL,
  browsed_count INT DEFAULT 0,
  revenue DECIMAL(10,2) NOT NULL DEFAULT 0
);`);
    console.log("analytics table created");
  } catch (err) {
    throw err;
  }
};

await init();

// how to use the function

// let data = {
//   event: "movie",
//   ticketsSold: 1,
//   peakHour: "2026-04-15 14:32:10.123456",
//   browsedCount: 1,
//   revenue: 12.34,
// };
// await addAnalytic(data);
