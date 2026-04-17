import express from 'express'
import pkg from 'pg'
import redis from 'redis'

const { Pool } = pkg

const channelName = process.env.PURCHASE_CONFIRMED_CHANNEL || 'purchases:confirmed'
const healthPort = process.env.HEALTH_PORT || 4001
const redisUrl = process.env.REDIS_URL || 'redis://redis:6379'
const pool = new Pool({ connectionString: process.env.ANALYTIC_DATABASE_URL })
const subscriber = redis.createClient({ url: redisUrl })
const healthRedis = redis.createClient({ url: redisUrl })
const app = express()

let lastProcessedAt = null
let lastError = null
let processedCount = 0

const ensureAnalyticsTable = async () => {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS analytics (
      id SERIAL PRIMARY KEY,
      event TEXT NOT NULL UNIQUE,
      tickets_sold INT NOT NULL DEFAULT 0,
      peak_hour TIMESTAMP NOT NULL,
      browsed_count INT DEFAULT 0,
      revenue DECIMAL(10,2) NOT NULL DEFAULT 0
    )`
  )

  await pool.query(
    `CREATE TABLE IF NOT EXISTS processed_purchase_confirmations (
      purchase_id TEXT PRIMARY KEY,
      event TEXT NOT NULL,
      confirmed_at TIMESTAMP NOT NULL DEFAULT NOW()
    )`
  )

  await pool.query(
    `WITH event_totals AS (
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
     WHERE analytics.id = event_totals.keep_id`
  )

  await pool.query(
    `DELETE FROM analytics duplicate
     USING analytics kept
     WHERE duplicate.event = kept.event
       AND duplicate.id > kept.id`
  )

  await pool.query(
    `DO $$
     BEGIN
       IF NOT EXISTS (
         SELECT 1
         FROM pg_constraint
         WHERE conname = 'analytics_event_key'
       ) THEN
         ALTER TABLE analytics ADD CONSTRAINT analytics_event_key UNIQUE (event);
       END IF;
     END $$;`
  )
}

subscriber.on('error', err => {
  lastError = err.message
  console.error('Analytics subscriber Redis error:', err.message)
})

healthRedis.on('error', err => {
  lastError = err.message
  console.error('Analytics health Redis error:', err.message)
})

const recordPurchaseConfirmed = async (purchase) => {
  const confirmedAt = purchase.confirmed_at ? new Date(purchase.confirmed_at) : new Date()
  const amount = Number(purchase.amount)

  if (!purchase.event) {
    throw new Error('purchase event is required')
  }

  if (!purchase.purchase_id) {
    throw new Error('purchase_id is required')
  }

  if (Number.isNaN(confirmedAt.getTime())) {
    throw new Error('confirmed_at must be a valid timestamp')
  }

  if (!Number.isFinite(amount)) {
    throw new Error('amount must be a valid number')
  }

  const client = await pool.connect()

  try {
    await client.query('BEGIN')

    const processed = await client.query(
      `INSERT INTO processed_purchase_confirmations (purchase_id, event, confirmed_at)
       VALUES ($1, $2, $3)
       ON CONFLICT (purchase_id) DO NOTHING
       RETURNING purchase_id`,
      [String(purchase.purchase_id), purchase.event, confirmedAt.toISOString()]
    )

    if (processed.rowCount === 0) {
      await client.query('COMMIT')
      return false
    }

    await client.query(
      `INSERT INTO analytics (event, tickets_sold, peak_hour, revenue)
       VALUES ($1, 1, date_trunc('hour', $2::timestamp), $3)
       ON CONFLICT (event)
       DO UPDATE SET
         tickets_sold = analytics.tickets_sold + 1,
         peak_hour = date_trunc('hour', $2::timestamp),
         revenue = analytics.revenue + $3`,
      [purchase.event, confirmedAt.toISOString(), amount]
    )

    await client.query('COMMIT')
    return true
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

const handlePurchaseConfirmed = async (message) => {
  let purchase

  try {
    purchase = JSON.parse(message)
  } catch (err) {
    lastError = `Invalid JSON: ${err.message}`
    console.error('Invalid purchase confirmation message:', err.message)
    return
  }

  try {
    const updated = await recordPurchaseConfirmed(purchase)
    if (!updated) {
      console.log(`Skipped duplicate analytics update for purchase ${purchase.purchase_id}`)
      return
    }

    processedCount += 1
    lastProcessedAt = new Date().toISOString()
    lastError = null
    console.log(`Updated analytics for purchase ${purchase.purchase_id} (${purchase.event})`)
  } catch (err) {
    lastError = err.message
    console.error(`Failed to update analytics for purchase ${purchase.purchase_id || 'unknown'}:`, err.message)
  }
}

app.get('/health', async (_req, res) => {
  const checks = {}
  let healthy = true

  try {
    await pool.query('SELECT 1')
    checks.database = { status: 'healthy' }
  } catch (err) {
    healthy = false
    checks.database = { status: 'unhealthy', error: err.message }
  }

  try {
    await healthRedis.ping()
    checks.redis = { status: 'healthy' }
  } catch (err) {
    healthy = false
    checks.redis = { status: 'unhealthy', error: err.message }
  }

  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'healthy' : 'unhealthy',
    service: 'analytics-worker',
    channelName,
    processedCount,
    lastProcessedAt,
    lastError,
    timestamp: new Date().toISOString(),
    checks
  })
})

const startWorker = async () => {
  try {
    await ensureAnalyticsTable()
    await subscriber.connect()
    await healthRedis.connect()

    await subscriber.subscribe(channelName, handlePurchaseConfirmed)
    console.log(`Analytics worker subscribed to ${channelName}`)

    app.listen(healthPort, () => {
      console.log(`Analytics worker health endpoint running on port ${healthPort}`)
    })
  } catch (err) {
    console.error('Analytics worker startup failure:', err.message)
    process.exit(1)
  }
}

startWorker()
