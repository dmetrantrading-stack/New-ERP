import type { PoolClient } from 'pg';
import { getClient } from '../config/database';

/** POS returns tables + line-item return qty columns (safe to run on every startup). */
export async function migratePosReturnSchema(client: PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS pos_returns (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      return_number VARCHAR(50) UNIQUE NOT NULL,
      pos_transaction_id UUID REFERENCES pos_transactions(id),
      shift_id UUID REFERENCES pos_shifts(id),
      total DECIMAL(15,2) DEFAULT 0,
      refund_method VARCHAR(50),
      reason TEXT,
      created_by UUID REFERENCES users(id),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS pos_return_items (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      return_id UUID REFERENCES pos_returns(id) ON DELETE CASCADE,
      pos_transaction_item_id UUID REFERENCES pos_transaction_items(id),
      product_id UUID REFERENCES products(id),
      entered_qty DECIMAL(15,2) NOT NULL,
      base_qty DECIMAL(15,2) NOT NULL,
      unit_price DECIMAL(15,2) NOT NULL,
      discount DECIMAL(15,2) DEFAULT 0,
      total DECIMAL(15,2) NOT NULL,
      cost DECIMAL(15,2) DEFAULT 0,
      location_id INTEGER,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await client.query(`ALTER TABLE pos_transaction_items ADD COLUMN IF NOT EXISTS returned_entered_qty DECIMAL(15,2) DEFAULT 0`);
  await client.query(`ALTER TABLE pos_transaction_items ADD COLUMN IF NOT EXISTS returned_base_qty DECIMAL(15,2) DEFAULT 0`);
}

export async function ensurePosReturnSchema(): Promise<void> {
  const client = await getClient();
  try {
    await migratePosReturnSchema(client);
  } finally {
    client.release();
  }
}
