import express from 'express'
import redis from 'redis'
import pkg from 'pg'

const app = express()
const { Pool } = pkg
const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const port = Number(process.env.PORT) || 3000
const queueName = process.env.QUEUE_NAME || 'ticket-purchase-queue'
const client = redis.createClient({ url: 'redis://redis:6379' })

app.use(express.json())

client.on('error', err => {
  console.error('Redis error:', err.message)
})

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set')
}

const publishPurchaseConfirmed = async (message) => {
  try {
    await client.publish('purchases:confirmed', JSON.stringify(message))
    console.log('Published purchase confirmation')
  } catch (err) {
    console.error('Failed to publish purchase confirmation:', err.message)
  }
}

app.get('/health', async (_req, res) => {
    const checks = {}
    let healthy = true

    await Promise.all([
        // Check Redis connection
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

        // Check DB connection
        (async () => {
            try {
                const start_time = Date.now()
                await pool.query('SELECT 1')
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

app.post('/purchases', async (req, res) => {
  const { idempotency_key, event, seat, start_time, end_time, amount } = req.body

  // Validate required fields
  if (!idempotency_key || !event || !seat || !start_time || !end_time || !amount) {
    return res.status(400).json({ error: 'Missing required fields: idempotency_key, event, seat, start_time, end_time, amount' })
  }

  try {
    // Step 1: Check for duplicate — same idempotency_key means same request
    const existing = await pool.query(
      'SELECT id, status, amount FROM purchases WHERE idempotency_key = $1',
      [idempotency_key]
    )

    if (existing.rows.length > 0) {
      // Already seen this request — return existing purchase, do NOT charge again
      return res.status(200).json({
        message: 'Duplicate request — returning existing purchase',
        duplicate: true,
        purchase: existing.rows[0]
      })
    }

    // Step 2: Create the purchase record with status 'pending'
    const purchaseResult = await pool.query(
      `INSERT INTO purchases (amount, status, idempotency_key)
       VALUES ($1, 'pending', $2)
       RETURNING id, amount, status, idempotency_key, created_at`,
      [amount, idempotency_key]
    )
    const purchase = purchaseResult.rows[0]

    // Step 3: Create the reservation record (the actual seat booking)
    await pool.query(
      `INSERT INTO reservations (purchase_id, event, seat, start_time, end_time)
       VALUES ($1, $2, $3, $4, $5)`,
      [purchase.id, event, seat, start_time, end_time]
    )

    // Step 4: Call the Payment Service synchronously
    let paymentStatus = 'failed'
    let transactionRef = null

    try {
      const paymentResponse = await fetch('http://payment-service:3002/payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          purchase_id: purchase.id,
          amount,
          idempotency_key
        })
      })

      const paymentData = await paymentResponse.json()

      if (paymentResponse.ok && paymentData.status === 'success') {
        paymentStatus = 'success'
        transactionRef = paymentData.transaction_ref || null
      }
    } catch (paymentErr) {
      // Payment service unreachable — treat as failed
      console.error('Payment service error:', paymentErr.message)
    }

    // Step 5: Record the payment result
    await pool.query(
      `INSERT INTO payments (purchase_id, status, amount, transaction_ref)
       VALUES ($1, $2, $3, $4)`,
      [purchase.id, paymentStatus, amount, transactionRef]
    )

    // Step 6: Update purchase status based on payment outcome
    const finalStatus = paymentStatus === 'success' ? 'confirmed' : 'failed'
    await pool.query(
      `UPDATE purchases SET status = $1, updated_at = NOW() WHERE id = $2`,
      [finalStatus, purchase.id]
    )

    // Step 7: Publish to Redis if confirmed, push to waitlist queue if failed
    if (finalStatus === 'confirmed') {
      await publishPurchaseConfirmed({
        purchase_id: purchase.id,
        event,
        seat,
        amount,
        idempotency_key,
        confirmed_at: new Date().toISOString()
      })
    } else {
      // Push to waitlist queue so next person can get the seat
      await client.lPush('waitlist-queue', JSON.stringify({
        event,
        seat,
        released_at: new Date().toISOString()
      }))
    }

    // Step 8: Return the result
    return res.status(201).json({
      duplicate: false,
      purchase: {
        id: purchase.id,
        status: finalStatus,
        amount: purchase.amount,
        idempotency_key: purchase.idempotency_key,
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

app.get('/purchases/:id', async (req, res) => {
    const purchaseId = Number(req.params.id)

    if (!Number.isInteger(purchaseId) || purchaseId <= 0) {
        return res.status(400).json({ error: 'Invalid purchase ID' })
    }

    try {
        const result = await pool.query('SELECT status FROM purchases WHERE id = $1', [purchaseId])
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Purchase not found.' })
        }
        return res.json({
            id: purchaseId,
            status: result.rows[0].status
        })
    } catch (err) {
        console.error('Error fetching purchase status:', err.message)
        return res.status(500).json({ error: 'Failed to fetch purchase status.' })
    }
})

app.listen(port, async () => {
  console.log(`Ticket Purchase Service listening on port ${port}`);

  try {
    await client.connect()
    console.log('Connected to Redis successfully')
  } catch (err) {
    console.error('Failed to connect to Redis:', err.message)
  }
});