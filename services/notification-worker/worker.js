import express from 'express'
import redis from 'redis'

const NOTIFICATION_SERVICE_URL = process.env.NOTIFICATION_SERVICE_URL || 'http://notification-service:3005'
const REDIS_URL = process.env.REDIS_URL || 'redis://redis:6379'
const PORT = Number(process.env.PORT) || 3006
const SERVICE_NAME = 'notification-worker'

const startTime = Date.now()
let lastJobAt = null
let jobsProcessed = 0

// ── Two Redis clients — one for sub, one for health checks ────────────────────
const subClient = redis.createClient({ url: REDIS_URL })
const healthClient = redis.createClient({ url: REDIS_URL })

subClient.on('error', err => console.error('Sub Redis error:', err.message))
healthClient.on('error', err => console.error('Health Redis error:', err.message))

// ── Process a confirmed purchase ──────────────────────────────────────────────
async function handleConfirmedPurchase(message) {
  let job
  try {
    job = JSON.parse(message)
  } catch (err) {
    console.error('Failed to parse message:', message)
    return
  }

  console.log(`Notification worker received confirmation for purchaseId ${job.purchase_id}`)

  try {
    const response = await fetch(`${NOTIFICATION_SERVICE_URL}/notify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        purchase_id: job.purchase_id,
        event: job.event,
        seat: job.seat,
        amount: job.amount,
        idempotency_key: job.idempotency_key,
        confirmed_at: job.confirmed_at
      })
    })

    if (response.ok) {
      lastJobAt = new Date().toISOString()
      jobsProcessed++
      console.log(`Confirmation email sent for purchaseId ${job.purchase_id}`)
    } else {
      console.error(`Notification service returned ${response.status} for purchaseId ${job.purchase_id}`)
    }
  } catch (err) {
    console.error(`Failed to call notification service for purchaseId ${job.purchase_id}:`, err.message)
  }
}

// ── Health endpoint ───────────────────────────────────────────────────────────
const app = express()

app.get('/health', async (_req, res) => {
  let redisHealthy = true
  try {
    await healthClient.ping()
  } catch {
    redisHealthy = false
  }

  res.status(redisHealthy ? 200 : 503).json({
    status: redisHealthy ? 'healthy' : 'unhealthy',
    service: SERVICE_NAME,
    timestamp: new Date().toISOString(),
    uptime_seconds: Math.floor((Date.now() - startTime) / 1000),
    checks: {
      redis: { status: redisHealthy ? 'healthy' : 'unhealthy' }
    },
    worker: {
      last_job_at: lastJobAt ?? 'never',
      jobs_processed: jobsProcessed
    }
  })
})

app.listen(PORT, () => {
  console.log(`${SERVICE_NAME} health endpoint on port ${PORT}`)
})

// ── Start subscriber ──────────────────────────────────────────────────────────
async function startWorker() {
  try {
    await subClient.connect()
    await healthClient.connect()
    console.log('Notification worker connected to Redis')

    await subClient.subscribe('purchases:confirmed', handleConfirmedPurchase)
    console.log('Notification worker subscribed to purchases:confirmed')
  } catch (err) {
    console.error('Notification worker startup failure:', err.message)
    process.exit(1)
  }
}

startWorker()