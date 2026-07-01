import type { PoolClient } from 'pg';
import { getClient } from '../config/database';

/** Supplier entity_type column (safe to run on every startup). */
export async function migrateSupplierEntityTypeSchema(client: PoolClient): Promise<void> {
  await client.query(`ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS entity_type VARCHAR(30) DEFAULT 'Corporation'`);
  await client.query(`UPDATE suppliers SET entity_type = 'Corporation' WHERE entity_type IS NULL OR TRIM(entity_type) = ''`);
}

export async function ensureSupplierEntityTypeSchema(): Promise<void> {
  const client = await getClient();
  try {
    await migrateSupplierEntityTypeSchema(client);
  } finally {
    client.release();
  }
}
