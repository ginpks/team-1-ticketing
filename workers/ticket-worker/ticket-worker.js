// ticket-worker.js
// Runs alongside ticket-purchase.js in the same container.
// Continuously reads from the Redis queue, calls payment-service,
// and updates the purchase + payment rows with the final status.
 
import redis from 'redis'
import pkg from 'pg'
import express from 'express'
 
const { Pool } = pkg
const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const PAYMENT_SERVICE_URL = process.env.PAYMENT_SERVICE_URL || 'http://payment-service:3000'
const queueName = process.env.QUEUE_NAME || 'ticket-purchase-queue'
const maxRetries = parseInt(process.env.MAX_RETRIES) || 3
const dlqName = process.env.DLQ_NAME || 'ticket-purchase-dlq'
const app = express()
const healthPort = process.env.HEALTH_PORT || 4000
let lastSuccessAt = null 
// ── Three Redis clients — one for queue, one for pub/sub, one for health ────────────────────────
const queueClient = redis.createClient({ url: process.env.REDIS_URL || 'redis://redis:6379' })
const pubClient   = redis.createClient({ url: process.env.REDIS_URL || 'redis://redis:6379' })
const healthClient = redis.createClient({ url: process.env.REDIS_URL || 'redis://redis:6379' })
 
queueClient.on('error', err => console.error('Worker Redis error:', err.message))
pubClient.on('error',   err => console.error('Worker pub Redis error:', err.message))
healthClient.on('error', err => console.error('Worker health Redis error:', err.message))

const withTimeout = (promise, ms = 500) => {
  return Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), ms))])
}

// ── Health check endpoint ───────────────────────────────────────────────────
app.get('/health', async (req, res) => {
  try {
    const [ queueDepth, dlqDepth ] = await Promise.all([
      withTimeout(healthClient.lLen(queueName)),
      withTimeout(healthClient.lLen(dlqName))
    ])
    res.json({
      status: 'ok',
      queueDepth,
      dlqDepth,
      lastSuccessAt,
      timestamp: new Date().toISOString()
    })
  } catch (err) {
    console.error('Health check error:', err.message)
    res.status(500).json({ status: 'error', message: 'Health check failed' })
  }
})

 
// ── Process a single payment job ──────────────────────────────────────────────
async function processJob(job) {
  const attempts = job.attempts || 0
  const { purchaseId, amount, event, seat, idempotency_key } = job
 
  console.log(`Processing payment job for purchaseId ${purchaseId}`)
 
  // ── Call payment-service ───────────────────────────────────────────────────
  let paymentStatus = 'failure'
  let transactionRef = null
 
  try {
    const paymentResponse = await fetch(`${PAYMENT_SERVICE_URL}/pay`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount })
    })
    const paymentData = await paymentResponse.json()
    if (paymentResponse.ok && paymentData.status === 'success') {
      paymentStatus = 'success'
      transactionRef = paymentData.transaction_ref || null
    }
  } catch (err) {
    console.error(`Payment service unreachable for purchaseId ${purchaseId}:`, err.message)
  }
 
  const finalStatus = paymentStatus === 'success' ? 'confirmed' : 'failed'
 
  // ── Update purchase + payment rows ────────────────────────────────────────
  try {
    await pool.query(
      `UPDATE purchases SET status = $1, updated_at = NOW() WHERE id = $2`,
      [finalStatus, purchaseId]
    )
 
    await pool.query(
      `UPDATE payments SET status = $1, transaction_ref = $2, updated_at = NOW() WHERE purchase_id = $3`,
      [paymentStatus, transactionRef, purchaseId]
    )
 
    console.log(`purchaseId ${purchaseId} → ${finalStatus} (${transactionRef})`)
  } catch (err) {
    console.error(`DB update failed for purchaseId ${purchaseId}:`, err.message)
    return
  }
 
  // ── Publish result to Redis pub/sub ───────────────────────────────────────
  try {
    if (finalStatus === 'confirmed') {
      await pubClient.publish('purchases:confirmed', JSON.stringify({
        purchase_id: purchaseId,
        event,
        seat,
        amount,
        idempotency_key,
        transaction_ref: transactionRef,
        confirmed_at: new Date().toISOString()
      }))
      lastSuccessAt = new Date().toISOString()
      console.log(`Published confirmation for purchaseId ${purchaseId}`)
      return
    }
    const newAttempts = attempts + 1
    if (newAttempts >= maxRetries) {
      await queueClient.rPush(dlqName, JSON.stringify({ ...job, attempts: newAttempts, failed_at: new Date().toISOString(), error: 'Max retries reached' }))
      console.warn(`Moved purchaseId ${purchaseId} to DLQ after ${newAttempts} attempts`)
    } else {
      const updatedJob = { ...job, attempts: newAttempts}
      console.warn(`Payment failed for purchaseId ${purchaseId}, retrying (attempt ${newAttempts}/${maxRetries})`)
      await new Promise(r => setTimeout(r, 500 * 2 ** newAttempts))
      await queueClient.rPush(queueName, JSON.stringify(updatedJob))
    }
  } catch (err) {
    console.error(`Pub/sub failed for purchaseId ${purchaseId}:`, err.message)
  }
}
 
// ── Worker loop — blocking pop from Redis queue ───────────────────────────────
async function startWorker() {
  try {
    await pool.query('SELECT 1')
    console.log('Worker connected to Postgres')
 
    await queueClient.connect()
    await pubClient.connect()
    await healthClient.connect()
    console.log('Worker connected to Redis')
    console.log(`Worker listening on queue: ${queueName}`)

    app.listen(healthPort, () => {
      console.log(`Health check endpoint running on port ${healthPort}`)
    })
 
    // brPop blocks until a job is available — timeout 0 = wait forever
    while (true) {
      try {
        const result = await queueClient.brPop(queueName, 0)
        if (result) {
          const job = JSON.parse(result.element)
          await processJob(job)
        }
      } catch (err) {
        console.error('Worker loop error:', err.message)
        // wait 1s before retrying to avoid tight error loop
        await new Promise(r => setTimeout(r, 1000))
      }
    }
  } catch (err) {
    console.error('Worker startup failure:', err.message)
    process.exit(1)
  }
}
 
startWorker()
