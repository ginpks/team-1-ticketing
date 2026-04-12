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