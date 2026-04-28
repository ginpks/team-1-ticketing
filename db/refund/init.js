import { refundPool, storeRefund } from "./refund.js";
import "dotenv/config";

const createTable = async () => {
    const client = await refundPool.connect();
    try {
        await client.query(`CREATE TABLE IF NOT EXISTS refunds (
        id SERIAL PRIMARY KEY,
        purchase_id INTEGER NOT NULL,
        amount NUMERIC(10,2) NOT NULL,
        status TEXT CHECK(status IN ('pending', 'completed', 'failed')) NOT NULL,
        idempotency_key TEXT NOT NULL UNIQUE,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
        );`)
    } catch(err) {
        console.error('Error during creation of refund table: ', err.message);
    } finally {
        client.release();
    }
}

const init = async () => {
    try {
        await createTable();
        console.log('Table Created!')
        const refund = {
            purchaseId: 1,
            amount: 16.5,
            status: 'pending',
            idempotencyKey: "1231ere4"
        }
        const refundId = await storeRefund(refund);
        console.log(refundId);
        return refundId
    } catch (err) {
        console.error(err);
    }
}

const id = await init();
console.log(id);