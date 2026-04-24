import { Pool } from "pg";
import "dotenv/config";

const url = process.env.REFUND_DATABASE_URL;

export const refundPool = new Pool({
  connectionString: url,
});

export const storeRefund = async ({ purchaseId, amount, status, idempotencyKey }) => {
    const client = await refundPool.connect();
    try {
        const { rows } = await client.query(
            `INSERT INTO refunds (purchase_id, amount, status, idempotency_key)
            VALUES ($1, $2, $3, $4)
            RETURNING id`, [purchaseId, amount, status, idempotencyKey]
        );

        return rows[0].id
    } finally {
        client.release();
    }
}