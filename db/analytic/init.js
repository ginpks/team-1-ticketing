import "dotenv/config";
import { analyticPool } from "./analytic.js";

const init = async () => {
  try {
    await analyticPool.query(`CREATE TABLE IF NOT EXISTS analytics (
  id SERIAL PRIMARY KEY,
  event TEXT NOT NULL,
  tickets_sold INT NOT NULL,
  peak_hour TIMESTAMP NOT NULL,
  revenue DECIMAL(10,2) NOT NULL
);`);
    console.log("analytics table created");
  } catch (err) {
    throw err;
  }
};

await init();
