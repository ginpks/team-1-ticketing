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
const waitlistQueue = process.env.WAITLIST_QUEUE || 'waitlist-queue'
const dlq = process.env.DLQ_NAME || 'ticket-purchase-dlq'
const healthTimeoutMs = process.env.HEALTH_TIMEOUT_MS || 500
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

const withTimeout = (promise, ms = healthTimeoutMs) => {
  return Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), ms))])
}

async function pushToDLQ(job, reason) {
  try {
    await queueClient.rPush(dlq, JSON.stringify({ job, reason, failedAt: new Date().toISOString() }))
    console.error(`Moved ${job.purchaseId || 'unknown'} job to DLQ due to ${reason}`)
  } catch(err) {
    console.error('Failed to push to dlq: ', err.message)
  }
}

// ── Health check endpoint ───────────────────────────────────────────────────
app.get('/health', async (req, res) => {
  try {
    const [ tpQueueDepth, dlqDepth ] = await Promise.all([
      withTimeout(healthClient.lLen(queueName)),
      withTimeout(healthClient.lLen(dlq))
    ])
    res.json({
      status: 'ok',
      tpQueueDepth,
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
  try {
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
      await pushToDLQ(job, 'DB update failed')
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
      } else {
        console.warn(`Payment failed for purchaseId ${purchaseId}, adding it to the ${waitlistQueue}`)
        await queueClient.rPush(waitlistQueue, JSON.stringify(job))
      }
    } catch (err) {
      console.error(`Pub/sub failed for purchaseId ${purchaseId}:`, err.message)

      if (finalStatus === 'confirmed') {
        try {
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
        } catch(err) {
          console.error(`job with id ${job.purchaseId} failed pub/sub twice. Pushing it to the dlq.`)
          await pushToDLQ(job, 'pub/sub failed twice')
        }
      }
    }
  } catch(err) {
    console.error('Unexpected error in processJob:', err.message)
    await pushToDLQ(job, 'Unexpected processing error')
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
        let job
        if (result) {
          try {
            job = JSON.parse(result.element)
            if (!job.purchaseId || !job.amount || !job.seat || !job.event || !job.idempotency_key) {
              console.error(`Job has missing fields, adding to the dlq`)
              await pushToDLQ(job, 'Missing fields')
              continue
            }
          } catch(err) {
            console.error('Invalid job received:', err.message)
            await pushToDLQ(result.element, 'Invalid JSON or schema')
            continue
          }
          
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
