import express from 'express'
import pkg from 'pg'
import redis from 'redis'

const { Pool } = pkg

const channelName = process.env.PURCHASE_CONFIRMED_CHANNEL || 'purchases:confirmed'
const eventBrowseQueueName = process.env.EVENT_BROWSE_ANALYTICS_QUEUE || 'event-catalog:browsed'
const eventBrowseDlqName = process.env.EVENT_BROWSE_ANALYTICS_DLQ || 'event-catalog:browsed:dlq'
const healthPort = process.env.HEALTH_PORT || 4001
const redisUrl = process.env.REDIS_URL || 'redis://redis:6379'
const pool = new Pool({ connectionString: process.env.ANALYTIC_DATABASE_URL })
const subscriber = redis.createClient({ url: redisUrl })
const browseQueue = redis.createClient({ url: redisUrl })
const healthRedis = redis.createClient({ url: redisUrl })
const app = express()

let lastProcessedAt = null
let lastBrowseProcessedAt = null
let lastError = null
let processedCount = 0
let browsedProcessedCount = 0

// Keep startup self-contained so the worker can run against a fresh analytics DB
// or an older local volume that was created before the unique event constraint.
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

browseQueue.on('error', err => {
  lastError = err.message
  console.error('Analytics browse queue Redis error:', err.message)
})

// Apply one confirmed purchase to analytics. The processed_purchase_confirmations
// insert is the idempotency guard: if the same purchase_id arrives twice, the
// second message commits without touching tickets_sold or revenue.
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

    // Create the event's analytics row on the first purchase, then increment the
    // aggregate counters for each later confirmed purchase for the same event.
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

// Temporary adapter for the future event-catalog queue payload.
// Replace this once event-catalog owns a real queue contract. Expected shape for now:
// {
//   "event": "Concert A",
//   "peak_hour_browsed": "2026-04-27T18:00:00.000Z",
//   "browsed_count": 12
// }
// If event-catalog ultimately publishes event_id instead of event name, map it to the
// same analytics.event value used by purchases before writing to the analytics DB.
const parseEventBrowseAnalytics = (rawMessage) => {
  const payload = JSON.parse(rawMessage)
  const event = payload.event ?? payload.event_name ?? payload.event_id
  const browsedCount = Number(payload.browsed_count ?? payload.browse_count ?? payload.count)
  const peakHourBrowsed = new Date(payload.peak_hour_browsed ?? payload.peak_hour ?? payload.browsed_at)

  if (!event) {
    throw new Error('event is required')
  }

  if (!Number.isInteger(browsedCount) || browsedCount < 0) {
    throw new Error('browsed_count must be a non-negative integer')
  }

  if (Number.isNaN(peakHourBrowsed.getTime())) {
    throw new Error('peak_hour_browsed must be a valid timestamp')
  }

  return {
    event: String(event),
    browsedCount,
    peakHourBrowsed
  }
}

const pushBrowseMessageToDlq = async (rawMessage, reason) => {
  try {
    await browseQueue.rPush(eventBrowseDlqName, JSON.stringify({
      rawMessage,
      reason,
      failedAt: new Date().toISOString()
    }))
  } catch (err) {
    lastError = err.message
    console.error('Failed to push event browse analytics message to DLQ:', err.message)
  }
}

// Applies browse analytics from the future event-catalog queue. This currently
// treats browsed_count as the latest aggregate for an event/hour. If the producer
// later sends deltas instead, replace the SET below with an increment.
const recordEventBrowseAnalytics = async ({ event, browsedCount, peakHourBrowsed }) => {
  await pool.query(
    `INSERT INTO analytics (event, peak_hour, browsed_count)
     VALUES ($1, date_trunc('hour', $2::timestamp), $3)
     ON CONFLICT (event)
     DO UPDATE SET
       peak_hour = date_trunc('hour', $2::timestamp),
       browsed_count = $3`,
    [event, peakHourBrowsed.toISOString(), browsedCount]
  )
}

const handleEventBrowseAnalytics = async (rawMessage) => {
  let analyticsEvent

  try {
    analyticsEvent = parseEventBrowseAnalytics(rawMessage)
  } catch (err) {
    lastError = err.message
    console.error('Invalid event browse analytics message:', err.message)
    await pushBrowseMessageToDlq(rawMessage, err.message)
    return
  }

  try {
    await recordEventBrowseAnalytics(analyticsEvent)
    browsedProcessedCount += 1
    lastBrowseProcessedAt = new Date().toISOString()
    lastError = null
    console.log(`Updated browse analytics for event ${analyticsEvent.event}`)
  } catch (err) {
    lastError = err.message
    console.error(`Failed to update browse analytics for event ${analyticsEvent.event}:`, err.message)
    await pushBrowseMessageToDlq(rawMessage, err.message)
  }
}

const startEventBrowseQueueConsumer = async () => {
  console.log(`Analytics worker listening on event browse queue ${eventBrowseQueueName}`)

  while (true) {
    try {
      const result = await browseQueue.brPop(eventBrowseQueueName, 0)
      if (result) {
        await handleEventBrowseAnalytics(result.element)
      }
    } catch (err) {
      lastError = err.message
      console.error('Event browse analytics queue loop error:', err.message)
      await new Promise(resolve => setTimeout(resolve, 1000))
    }
  }
}

// Redis pub/sub delivers message bodies as strings, so this handler parses the
// purchase confirmation and delegates the transactional DB update above.
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
  let eventBrowseQueueDepth = null
  let eventBrowseDlqDepth = null

  try {
    await pool.query('SELECT 1')
    checks.database = { status: 'healthy' }
  } catch (err) {
    healthy = false
    checks.database = { status: 'unhealthy', error: err.message }
  }

  try {
    await healthRedis.ping()
    eventBrowseQueueDepth = await healthRedis.lLen(eventBrowseQueueName)
    eventBrowseDlqDepth = await healthRedis.lLen(eventBrowseDlqName)
    checks.redis = { status: 'healthy' }
  } catch (err) {
    healthy = false
    checks.redis = { status: 'unhealthy', error: err.message }
  }

  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'healthy' : 'unhealthy',
    service: 'analytics-worker',
    channelName,
    eventBrowseQueueName,
    eventBrowseQueueDepth,
    eventBrowseDlqName,
    eventBrowseDlqDepth,
    processedCount,
    browsedProcessedCount,
    lastProcessedAt,
    lastBrowseProcessedAt,
    lastError,
    timestamp: new Date().toISOString(),
    checks
  })
})

// Boot sequence: prepare tables, connect Redis clients, subscribe to the purchase
// confirmation channel, then expose a health endpoint for Compose.
const startWorker = async () => {
  try {
    await ensureAnalyticsTable()
    await subscriber.connect()
    await browseQueue.connect()
    await healthRedis.connect()

    await subscriber.subscribe(channelName, handlePurchaseConfirmed)
    console.log(`Analytics worker subscribed to ${channelName}`)
    startEventBrowseQueueConsumer()

    app.listen(healthPort, () => {
      console.log(`Analytics worker health endpoint running on port ${healthPort}`)
    })
  } catch (err) {
    console.error('Analytics worker startup failure:', err.message)
    process.exit(1)
  }
}

startWorker()
