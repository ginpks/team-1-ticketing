import express from 'express'
import redis from 'redis'

const app = express()
const port = Number(process.env.PORT) || 3000
const queueName = process.env.QUEUE_NAME || 'ticket-purchase-queue'
const client = redis.createClient({ url: 'redis://redis:6379' })

app.use(express.json())

client.on('error', err => {
  console.error('Redis error:', err.message)
})

app.get('/healthz', async (_req, res) => {
  try {
    await client.ping()
    res.status(200).json({ status: 'ok', 
                           service: 'ticket-purchase',
                           timeStamp: new Date().toISOString(),
                           queueName })
  } catch (err) {
    res.status(503).json({ status: 'not-ready',
                           service: 'ticket-purchase',
                           timeStamp: new Date().toISOString(),
                           queueName,
                           error: err.message })
  } 
})

app.listen(port, () => {
  console.log(`Ticket Purchase Service listening on port ${port}`);
});