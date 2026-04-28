// fraud-worker.js
// Subscribes to purchases:confirmed pub/sub channel.
// Checks for suspicious patterns and flags fraud.
// Writes flagged purchases to frauddb and publishes fraud:flagged event.
 
import redis from 'redis'
import pkg from 'pg'
import express from 'express'
 
const { Pool } = pkg
const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const REDIS_URL = process.env.REDIS_URL || 'redis://redis:6379'
const HEALTH_PORT = process.env.HEALTH_PORT || 4002
const DLQ = process.env.DLQ_NAME || 'fraud-dlq'
const CHANNEL = process.env.PURCHASE_CONFIRMED_CHANNEL || 'purchases:confirmed'
 
// ── Time window for fraud detection (ms) ─────────────────────────────────────
const FRAUD_WINDOW_MS = 60 * 1000       // 60 seconds
const RAPID_PURCHASE_THRESHOLD = 3      // 3+ purchases in window = suspicious
const TOKEN_REUSE_THRESHOLD = 2         // same token across 2+ events = suspicious
 
const app = express()
let lastFlaggedAt = null
let totalProcessed = 0
let totalFlagged = 0
 
// ── Redis clients ─────────────────────────────────────────────────────────────
const subClient    = redis.createClient({ url: REDIS_URL })
const pubClient    = redis.createClient({ url: REDIS_URL })
const healthClient = redis.createClient({ url: REDIS_URL })
const dlqClient    = redis.createClient({ url: REDIS_URL })
 
subClient.on('error',    err => console.error('Sub Redis error:', err.message))
pubClient.on('error',    err => console.error('Pub Redis error:', err.message))
healthClient.on('error', err => console.error('Health Redis error:', err.message))
dlqClient.on('error',    err => console.error('DLQ Redis error:', err.message))
 
// ── Push to DLQ ───────────────────────────────────────────────────────────────
async function pushToDLQ(message, reason) {
  try {
    await dlqClient.rPush(DLQ, JSON.stringify({
      message,
      reason,
      failedAt: new Date().toISOString()
    }))
    console.error(`Pushed to DLQ: ${reason}`)
  } catch (err) {
    console.error('Failed to push to DLQ:', err.message)
  }
}
 
// ── Fraud check: rapid purchases from same user ───────────────────────────────
// Uses idempotency_key prefix as user proxy since there's no userId field
async function checkRapidPurchases(idempotencyKey, amount) {
  try {
    const windowStart = new Date(Date.now() - FRAUD_WINDOW_MS).toISOString()
    const result = await pool.query(
      `SELECT COUNT(*) FROM fraud_flags 
       WHERE amount = $1 AND flagged_at > $2`,
      [amount, windowStart]
    )
    return parseInt(result.rows[0].count) >= RAPID_PURCHASE_THRESHOLD
  } catch (err) {
    console.error('Rapid purchase check error:', err.message)
    return false
  }
}
 
// ── Fraud check: same transaction_ref used across multiple events ──────────────
async function checkTokenReuse(transactionRef, event) {
  if (!transactionRef) return false
  try {
    const result = await pool.query(
      `SELECT COUNT(DISTINCT event) FROM fraud_flags 
       WHERE transaction_ref = $1`,
      [transactionRef]
    )
    return parseInt(result.rows[0].count) >= TOKEN_REUSE_THRESHOLD
  } catch (err) {
    console.error('Token reuse check error:', err.message)
    return false
  }
}
 
// ── Flag a purchase as fraudulent ─────────────────────────────────────────────
async function flagFraud(purchase, reason) {
  const { purchase_id, event, seat, amount, transaction_ref, idempotency_key } = purchase
 
  try {
    await pool.query(
      `INSERT INTO fraud_flags 
        (purchase_id, event, seat, amount, transaction_ref, idempotency_key, reason)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (purchase_id) DO NOTHING`,
      [purchase_id, event, seat, amount, transaction_ref, idempotency_key, reason]
    )
 
    // ── Publish fraud:flagged event ───────────────────────────────────────────
    await pubClient.publish('fraud:flagged', JSON.stringify({
      purchase_id,
      event,
      amount,
      transaction_ref,
      reason,
      flagged_at: new Date().toISOString()
    }))
 
    lastFlaggedAt = new Date().toISOString()
    totalFlagged++
    console.warn(`Fraud flagged for purchase_id ${purchase_id}: ${reason}`)
  } catch (err) {
    console.error(`Failed to flag fraud for purchase_id ${purchase_id}:`, err.message)
    await pushToDLQ(purchase, `Failed to write fraud flag: ${err.message}`)
  }
}
 
// ── Process a single purchase event ──────────────────────────────────────────
async function processPurchase(message) {
  // ── Validate message shape (poison pill handling) ─────────────────────────
  const required = ['purchase_id', 'event', 'seat', 'amount', 'idempotency_key']
  const missing = required.filter(f => message[f] == null)
  if (missing.length > 0) {
    console.error('Malformed purchase event, missing fields:', missing)
    await pushToDLQ(message, `Missing fields: ${missing.join(', ')}`)
    return
  }
 
  totalProcessed++
  const { purchase_id, event, seat, amount, transaction_ref, idempotency_key } = message
 
  // ── Run fraud checks ──────────────────────────────────────────────────────
  const [isRapid, isTokenReuse] = await Promise.all([
    checkRapidPurchases(idempotency_key, amount),
    checkTokenReuse(transaction_ref, event)
  ])
 
  if (isRapid) {
    await flagFraud(message, 'Rapid sequential purchases detected')
  }
 
  if (isTokenReuse) {
    await flagFraud(message, 'Payment token reused across multiple events')
  }
 
  if (!isRapid && !isTokenReuse) {
    // ── Still record to fraud_flags for pattern tracking ──────────────────
    try {
      await pool.query(
        `INSERT INTO fraud_flags 
          (purchase_id, event, seat, amount, transaction_ref, idempotency_key, reason)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (purchase_id) DO NOTHING`,
        [purchase_id, event, seat, amount, transaction_ref, idempotency_key, 'clean']
      )
    } catch (err) {
      console.error('Failed to record clean purchase:', err.message)
    }
    console.log(`purchase_id ${purchase_id} passed fraud checks`)
  }
}
 
// ── Health endpoint ───────────────────────────────────────────────────────────
app.get('/health', async (_req, res) => {
  try {
    const dlqDepth = await healthClient.lLen(DLQ)
    res.json({
      status: 'ok',
      totalProcessed,
      totalFlagged,
      dlqDepth,
      lastFlaggedAt,
      timestamp: new Date().toISOString()
    })
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message })
  }
})
 
// ── Start ─────────────────────────────────────────────────────────────────────
async function start() {
  try {
    await pool.query('SELECT 1')
    console.log('Fraud worker connected to Postgres')
 
    await subClient.connect()
    await pubClient.connect()
    await healthClient.connect()
    await dlqClient.connect()
    console.log('Fraud worker connected to Redis')
 
    // ── Subscribe to purchases:confirmed ──────────────────────────────────
    await subClient.subscribe(CHANNEL, async (message) => {
      let parsed
      try {
        parsed = JSON.parse(message)
      } catch (err) {
        console.error('Invalid JSON in purchase event:', err.message)
        await pushToDLQ(message, 'Invalid JSON')
        return
      }
      await processPurchase(parsed)
    })
 
    console.log(`Fraud worker subscribed to channel: ${CHANNEL}`)
 
    app.listen(HEALTH_PORT, () => {
      console.log(`Fraud worker health endpoint on port ${HEALTH_PORT}`)
    })
  } catch (err) {
    console.error('Fraud worker startup failure:', err.message)
    process.exit(1)
  }
}
 
start()