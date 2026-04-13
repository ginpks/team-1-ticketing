import express from 'express'
import redis from 'redis'
import pkg from 'pg'

const PAYMENT_SERVICE_URL = process.env.PAYMENT_SERVICE_URL || 'http://payment-service:3000'
const app = express()
const { Pool } = pkg
const app = express()
const pool = new Pool({ connectionString: process.env.DATABASE_URL })
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
        const start = Date.now()
        await client.ping()
        checks.redis = { status: 'healthy', latency_ms: Date.now() - start }
      } catch (err) {
        healthy = false
        checks.redis = { status: 'unhealthy', error: err.message }
      }
    })(),
    (async () => {
      try {
        const start = Date.now()
        await pool.query('SELECT 1')
        checks.database = { status: 'healthy', latency_ms: Date.now() - start }
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
    // Check for duplicate
    const existing = await pool.query(
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

    // Call Payment Service
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

    // Store everything in a single transaction
    const dbClient = await pool.connect()
    let purchaseId
    try {
      await dbClient.query('BEGIN')

      const purchaseData = await dbClient.query(
        `INSERT INTO purchases (amount, status, idempotency_key) VALUES ($1, $2, $3) RETURNING id`,
        [amount, finalStatus, idempotency_key]
      )
      purchaseId = purchaseData.rows[0].id

      await dbClient.query(
        `INSERT INTO reservations (purchase_id, event, seat, start_time, end_time) VALUES ($1, $2, $3, $4, $5)`,
        [purchaseId, event, seat, start_time, end_time]
      )

      await dbClient.query(
        `INSERT INTO payments (purchase_id, status, amount, transaction_ref) VALUES ($1, $2, $3, $4)`,
        [purchaseId, paymentStatus, amount, transactionRef]
      )

      await dbClient.query('COMMIT')
    } catch (err) {
      await dbClient.query('ROLLBACK')
      throw err
    } finally {
      dbClient.release()
    }

    // Publish to Redis or push to waitlist
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

app.post('/purchases', async (req, res) => {
  const { amount, idempotencyKey, event, seat, startTime, endTime } = req.body

  if (!amount || !idempotencyKey || !event || !seat || !startTime || !endTime) {
    return res.status(400).json({
      error: 'amount, idempotencyKey, event, seat, startTime, and endTime are required'
    })
  }

  if (Number(amount) <= 0) {
    return res.status(400).json({ error: 'amount must be greater than 0' })
  }

  // Idempotency check — same key returns existing purchase, no double charge
  try {
    const existing = await pool.query(
      'SELECT id, status FROM purchases WHERE idempotency_key = $1',
      [idempotencyKey]
    )
    if (existing.rows.length > 0) {
      return res.status(200).json({
        purchaseId: existing.rows[0].id,
        status: existing.rows[0].status,
        replayed: true
      })
    }
  } catch (err) {
    console.error('Idempotency check error:', err.message)
    return res.status(500).json({ error: 'Failed to process purchase' })
  }

  // Call payment service first (per your group's agreed flow)
  let paymentStatus, transactionRef
  try {
    const paymentRes = await fetch(`${PAYMENT_SERVICE_URL}/pay`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount })
    })
    const paymentData = await paymentRes.json()
    paymentStatus = paymentData.status
    transactionRef = paymentData.transaction_ref
  } catch (err) {
    console.error('Payment service call failed:', err.message)
    return res.status(502).json({ error: 'Payment service unreachable' })
  }

  const finalStatus = paymentStatus === 'success' ? 'confirmed' : 'failed'

  // Store everything in one transaction
  const dbClient = await pool.connect()
  try {
    await dbClient.query('BEGIN')

    const purchaseResult = await dbClient.query(
      `INSERT INTO purchases (amount, status, idempotency_key)
       VALUES ($1, $2, $3) RETURNING id`,
      [amount, finalStatus, idempotencyKey]
    )
    const purchaseId = purchaseResult.rows[0].id

    await dbClient.query(
      `INSERT INTO reservations (purchase_id, event, seat, start_time, end_time)
       VALUES ($1, $2, $3, $4, $5)`,
      [purchaseId, event, seat, startTime, endTime]
    )

    await dbClient.query(
      `INSERT INTO payments (purchase_id, status, amount, transaction_ref)
       VALUES ($1, $2, $3, $4)`,
      [purchaseId, paymentStatus, amount, transactionRef]
    )

    await dbClient.query('COMMIT')

    if (finalStatus === 'confirmed') {
      await publishPurchaseConfirmed({ purchaseId, event, seat, amount, transactionRef })
    }

    return res.status(finalStatus === 'confirmed' ? 201 : 402).json({
      purchaseId,
      status: finalStatus,
      transactionRef
    })
  } catch (err) {
    await dbClient.query('ROLLBACK')
    console.error('Purchase transaction error:', err.message)
    return res.status(500).json({ error: 'Failed to store purchase' })
  } finally {
    dbClient.release()
  }
})

app.listen(port, async () => {
  console.log(`Ticket Purchase Service listening on port ${port}`);
// ── GET /purchases/:id ───────────────────────────────────────────────────────
app.get('/purchases/:id', async (req, res) => {
  const purchaseId = Number(req.params.id)

  if (!Number.isInteger(purchaseId) || purchaseId <= 0) {
    return res.status(400).json({ error: 'Invalid purchase ID' })
  }

  try {
    const result = await pool.query(
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