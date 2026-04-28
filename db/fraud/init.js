import pkg from 'pg'
import 'dotenv/config'
 
const { Pool } = pkg
const pool = new Pool({
  connectionString: process.env.DATABASE_URL ||
    'postgres://user:pass@frauddb:5432/frauddb'
})
 
const createTables = async () => {
  const client = await pool.connect()
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS fraud_flags (
        id            SERIAL PRIMARY KEY,
        purchase_id   INT NOT NULL UNIQUE,
        event         TEXT NOT NULL,
        seat          TEXT NOT NULL,
        amount        NUMERIC(10,2) NOT NULL,
        transaction_ref TEXT,
        idempotency_key TEXT NOT NULL,
        reason        TEXT NOT NULL,
        flagged_at    TIMESTAMP DEFAULT NOW()
      );
    `)
 
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_fraud_flags_amount
        ON fraud_flags (amount);
    `)
 
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_fraud_flags_transaction_ref
        ON fraud_flags (transaction_ref);
    `)
 
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_fraud_flags_flagged_at
        ON fraud_flags (flagged_at);
    `)
 
    console.log('Fraud tables created successfully')
  } finally {
    client.release()
  }
}
 
const init = async () => {
  try {
    await createTables()
  } catch (err) {
    console.error('Fraud DB init error:', err.message)
    process.exit(1)
  } finally {
    await pool.end()
  }
}
 
await init()