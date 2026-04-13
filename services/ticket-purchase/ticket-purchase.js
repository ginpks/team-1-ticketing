import express from 'express'
import redis from 'redis'
import { storePurchase, purchasePool } from '../../db/purchase/purchase.js'

const app = express()
const port = Number(process.env.PORT) || 3001
const queueName = process.env.QUEUE_NAME || 'ticket-purchase-queue'
const client = redis.createClient({ url: process.env.REDIS_URL || 'redis://redis:6379' })

app.use(express.json())

client.on('error', err => {
  console.error('Redis error:', err.message)
})

const publishPurchaseConfirmed = async (message) => {
  try {
    await client.publish('purchases:confirmed', JSON.stringify(message))
    console.log('Published purchase confirmation:', message.purchase_id)
  } catch (err) {
    console.error('Failed to publish purchase confirmation:', err.message)
  }
}

// ── GET /health ──────────────────────────────────────────────────────────────
app.get('/health', async (_req, res) => {
  const checks = {}
  let healthy = true

  await Promise.all([
    (async () => {
      try {
        const start_time = Date.now()
        await client.ping()
        checks.redis = { status: 'healthy', latency_ms: Date.now() - start_time }
      } catch (err) {
        healthy = false
        checks.redis = { status: 'unhealthy', error: err.message }
      }
    })(),
    (async () => {
      try {
        const start_time = Date.now()
        await purchasePool.query('SELECT 1')
        checks.database = { status: 'healthy', latency_ms: Date.now() - start_time }
      } catch (err) {
        healthy = false
        checks.database = { status: 'unhealthy', error: err.message }
      }
    })()
  ])

  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'healthy' : 'unhealthy',
    service: 'ticket-purchase',
    queueName,
    timestamp: new Date().toISOString(),
    uptime_seconds: Math.floor(process.uptime()),
    checks
  })
})

// ── POST /purchases ──────────────────────────────────────────────────────────
app.post('/purchases', async (req, res) => {
  const { idempotency_key, event, seat, start_time, end_time, amount } = req.body

  if (!idempotency_key || !event || !seat || !start_time || !end_time || !amount) {
    return res.status(400).json({
      error: 'Missing required fields: idempotency_key, event, seat, start_time, end_time, amount'
    })
  }

  try {
    // Check for duplicate request
    const existing = await purchasePool.query(
      'SELECT id, status, amount FROM purchases WHERE idempotency_key = $1',
      [idempotency_key]
    )

    if (existing.rows.length > 0) {
      return res.status(200).json({
        message: 'Duplicate request — returning existing purchase',
        duplicate: true,
        purchase: existing.rows[0]
      })
    }

    // Call Payment Service synchronously
    let paymentStatus = 'failed'
    let transactionRef = null

    try {
      const paymentResponse = await fetch('http://payment-service:3002/payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount, idempotency_key })
      })
      const paymentData = await paymentResponse.json()
      if (paymentResponse.ok && paymentData.status === 'success') {
        paymentStatus = 'success'
        transactionRef = paymentData.transaction_ref || null
      }
    } catch (paymentErr) {
      console.error('Payment service unreachable:', paymentErr.message)
    }

    const finalStatus = paymentStatus === 'success' ? 'confirmed' : 'failed'

    // Store purchase, reservation, and payment in a single transaction
    const purchaseId = await storePurchase(
      { amount, status: finalStatus, idempotencyKey: idempotency_key },
      { event, seat, startTime: start_time, endTime: end_time },
      { status: paymentStatus, amount, transactionRef }
    )

    // Publish to Redis on success, push to waitlist on failure
    if (finalStatus === 'confirmed') {
      await publishPurchaseConfirmed({
        purchase_id: purchaseId,
        event,
        seat,
        amount,
        idempotency_key,
        confirmed_at: new Date().toISOString()
      })
    } else {
      await client.lPush('waitlist-queue', JSON.stringify({
        event,
        seat,
        released_at: new Date().toISOString()
      }))
    }

    return res.status(201).json({
      duplicate: false,
      purchase: {
        id: purchaseId,
        status: finalStatus,
        amount,
        idempotency_key,
        event,
        seat,
        payment_status: paymentStatus,
        transaction_ref: transactionRef
      }
    })

  } catch (err) {
    console.error('Error creating purchase:', err.message)
    return res.status(500).json({ error: 'Failed to create purchase' })
  }
})

// ── GET /purchases/:id ───────────────────────────────────────────────────────
app.get('/purchases/:id', async (req, res) => {
  const purchaseId = Number(req.params.id)

  if (!Number.isInteger(purchaseId) || purchaseId <= 0) {
    return res.status(400).json({ error: 'Invalid purchase ID' })
  }

  try {
    const result = await purchasePool.query(
      'SELECT id, status, amount, idempotency_key, created_at FROM purchases WHERE id = $1',
      [purchaseId]
    )
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Purchase not found' })
    }
    return res.status(200).json(result.rows[0])
  } catch (err) {
    console.error('Error fetching purchase:', err.message)
    return res.status(500).json({ error: 'Failed to fetch purchase' })
  }
})

// ── Start server ─────────────────────────────────────────────────────────────
app.listen(port, async () => {
  console.log(`Ticket Purchase Service listening on port ${port}`)
  try {
    await client.connect()
    console.log('Connected to Redis successfully')
  } catch (err) {
    console.error('Failed to connect to Redis:', err.message)
  }
})