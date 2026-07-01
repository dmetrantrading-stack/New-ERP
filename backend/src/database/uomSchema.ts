import type { PoolClient } from 'pg';

/** Multi-UOM schema: one inventory ledger in base UOM (Phase A). */
export async function migrateUomSchema(client: PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS uoms (
      id SERIAL PRIMARY KEY,
      code VARCHAR(20) UNIQUE NOT NULL,
      name VARCHAR(100) NOT NULL,
      is_active BOOLEAN DEFAULT true,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await client.query(`ALTER TABLE uoms ADD COLUMN IF NOT EXISTS code VARCHAR(20)`);
  await client.query(`ALTER TABLE uoms ADD COLUMN IF NOT EXISTS name VARCHAR(100)`);
  await client.query(`ALTER TABLE uoms ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true`);
  await client.query(`ALTER TABLE uoms ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP`);

  await client.query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'uoms' AND column_name = 'uom_code'
      ) THEN
        UPDATE uoms SET code = LOWER(TRIM(uom_code))
        WHERE (code IS NULL OR TRIM(code) = '') AND uom_code IS NOT NULL AND TRIM(uom_code) != '';
      END IF;
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'uoms' AND column_name = 'abbreviation'
      ) THEN
        UPDATE uoms SET code = LOWER(TRIM(abbreviation))
        WHERE (code IS NULL OR TRIM(code) = '') AND abbreviation IS NOT NULL AND TRIM(abbreviation) != '';
        UPDATE uoms SET abbreviation = UPPER(TRIM(code))
        WHERE (abbreviation IS NULL OR TRIM(abbreviation) = '') AND code IS NOT NULL AND TRIM(code) != '';
      END IF;
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'uoms' AND column_name = 'uom_name'
      ) THEN
        UPDATE uoms SET name = uom_name
        WHERE (name IS NULL OR TRIM(name) = '') AND uom_name IS NOT NULL;
      END IF;
      UPDATE uoms SET code = 'pc'
      WHERE (code IS NULL OR TRIM(code) = '')
        AND LOWER(TRIM(name)) IN ('piece', 'pieces', 'pc');
    END $$;
  `);

  const hasAbbrev = await client.query(`
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'uoms' AND column_name = 'abbreviation'
    LIMIT 1
  `);
  const legacyUoms = hasAbbrev.rows.length > 0;

  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS ux_uoms_code_lower
    ON uoms (LOWER(TRIM(code)))
    WHERE code IS NOT NULL AND TRIM(code) != ''
  `);

  const defaultUoms: [string, string][] = [
    ['pc', 'Piece'],
    ['box', 'Box'],
    ['case', 'Case'],
    ['pack', 'Pack'],
    ['dozen', 'Dozen'],
    ['sack', 'Sack'],
    ['kg', 'Kilogram'],
    ['g', 'Gram'],
    ['250g', '250 Gram'],
    ['500g', '500 Gram'],
    ['l', 'Liter'],
  ];
  for (const [code, name] of defaultUoms) {
    if (legacyUoms) {
      await client.query(
        `INSERT INTO uoms (code, name, abbreviation, is_active)
         SELECT $1::varchar, $2::varchar, UPPER($1::varchar), true
         WHERE NOT EXISTS (
           SELECT 1 FROM uoms
           WHERE LOWER(TRIM(COALESCE(code, ''))) = LOWER($1)
              OR UPPER(TRIM(COALESCE(abbreviation, ''))) = UPPER($1)
         )`,
        [code, name],
      );
    } else {
      await client.query(
        `INSERT INTO uoms (code, name, is_active)
         SELECT $1::varchar, $2::varchar, true
         WHERE NOT EXISTS (
           SELECT 1 FROM uoms WHERE LOWER(TRIM(COALESCE(code, ''))) = LOWER($1)
         )`,
        [code, name],
      );
    }
  }

  await client.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS base_uom_id INTEGER REFERENCES uoms(id)`);
  await client.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS default_purchase_uom_id INTEGER REFERENCES uoms(id)`);
  await client.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS default_sales_uom_id INTEGER REFERENCES uoms(id)`);
  await client.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS allow_multiple_uom BOOLEAN DEFAULT false`);
  await client.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS track_batch BOOLEAN DEFAULT false`);
  await client.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS track_expiry BOOLEAN DEFAULT false`);

  await client.query(`
    CREATE TABLE IF NOT EXISTS product_uom_conversions (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      uom_id INTEGER NOT NULL REFERENCES uoms(id),
      conversion_to_base DECIMAL(15,4) NOT NULL DEFAULT 1,
      barcode VARCHAR(100),
      purchase_price DECIMAL(15,4) DEFAULT 0,
      retail_price DECIMAL(15,4) DEFAULT 0,
      wholesale_price DECIMAL(15,4) DEFAULT 0,
      distributor_price DECIMAL(15,4) DEFAULT 0,
      is_default_purchase BOOLEAN DEFAULT false,
      is_default_sales BOOLEAN DEFAULT false,
      is_active BOOLEAN DEFAULT true,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(product_id, uom_id)
    )
  `);

  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS ux_product_uom_barcode_active
    ON product_uom_conversions (LOWER(TRIM(barcode)))
    WHERE barcode IS NOT NULL AND TRIM(barcode) != '' AND is_active = true
  `);

  await client.query(`ALTER TABLE inventory ADD COLUMN IF NOT EXISTS reserved_quantity DECIMAL(15,2) DEFAULT 0`);
  await client.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'inventory' AND column_name = 'available_quantity'
      ) THEN
        ALTER TABLE inventory
          ADD COLUMN available_quantity DECIMAL(15,2)
          GENERATED ALWAYS AS (quantity - COALESCE(reserved_quantity, 0)) STORED;
      END IF;
    END $$;
  `);

  const lineItemUomCols = `
    ADD COLUMN IF NOT EXISTS uom_id INTEGER REFERENCES uoms(id),
    ADD COLUMN IF NOT EXISTS entered_qty DECIMAL(15,4),
    ADD COLUMN IF NOT EXISTS conversion_to_base DECIMAL(15,4) DEFAULT 1,
    ADD COLUMN IF NOT EXISTS base_qty DECIMAL(15,4)
  `;
  await client.query(`ALTER TABLE goods_receipt_items ${lineItemUomCols}`);
  await client.query(`ALTER TABLE pos_transaction_items ${lineItemUomCols}`);
  await client.query(`ALTER TABLE purchase_order_items ${lineItemUomCols}`);
  await client.query(`ALTER TABLE sales_invoice_items ${lineItemUomCols}`);
  await client.query(`ALTER TABLE sales_quotation_items ${lineItemUomCols}`);
  await client.query(`ALTER TABLE sales_order_items ${lineItemUomCols}`);
  await client.query(`ALTER TABLE delivery_note_items ${lineItemUomCols}`);
  await client.query(`ALTER TABLE purchase_requisition_items ${lineItemUomCols}`);

  await client.query(`
    UPDATE purchase_order_items
    SET entered_qty = quantity, conversion_to_base = 1, base_qty = quantity
    WHERE entered_qty IS NULL AND quantity IS NOT NULL
  `);
  await client.query(`
    UPDATE sales_invoice_items
    SET entered_qty = quantity, conversion_to_base = 1, base_qty = quantity
    WHERE entered_qty IS NULL AND quantity IS NOT NULL
  `);
  await client.query(`
    UPDATE sales_quotation_items
    SET entered_qty = quantity, conversion_to_base = 1, base_qty = quantity
    WHERE entered_qty IS NULL AND quantity IS NOT NULL
  `);
  await client.query(`
    UPDATE sales_order_items
    SET entered_qty = ordered_qty, conversion_to_base = 1, base_qty = ordered_qty
    WHERE entered_qty IS NULL AND ordered_qty IS NOT NULL
  `);
  await client.query(`
    UPDATE delivery_note_items
    SET entered_qty = quantity, conversion_to_base = 1, base_qty = quantity
    WHERE entered_qty IS NULL AND quantity IS NOT NULL
  `);
  await client.query(`
    UPDATE purchase_requisition_items
    SET entered_qty = quantity, conversion_to_base = 1, base_qty = quantity
    WHERE entered_qty IS NULL AND quantity IS NOT NULL
  `);

  const pcUom = await client.query(`SELECT id FROM uoms WHERE LOWER(TRIM(code)) = 'pc' LIMIT 1`);
  let pcId = pcUom.rows[0]?.id as number | undefined;
  if (!pcId) {
    const anyUom = await client.query(`SELECT id FROM uoms WHERE code IS NOT NULL ORDER BY id LIMIT 1`);
    pcId = anyUom.rows[0]?.id as number | undefined;
  }

  await client.query(
    `UPDATE products SET base_uom_id = $1 WHERE base_uom_id IS NULL`,
    [pcId],
  );

  const baseUomBackfill = await client.query(
    `SELECT 1 FROM system_settings WHERE setting_key = 'products_base_uom_pc_backfill_v1' LIMIT 1`,
  );
  if (baseUomBackfill.rows.length === 0 && pcId) {
    await client.query(
      `UPDATE products SET
        base_uom_id = $1,
        default_purchase_uom_id = $1,
        default_sales_uom_id = $1,
        unit_of_measure = 'pc',
        updated_at = CURRENT_TIMESTAMP`,
      [pcId],
    );
    await client.query(
      `UPDATE product_uom_conversions c
       SET uom_id = $1,
           is_default_purchase = true,
           is_default_sales = true,
           updated_at = CURRENT_TIMESTAMP
       FROM uoms u
       WHERE c.uom_id = u.id
         AND LOWER(TRIM(u.code)) <> 'pc'
         AND c.conversion_to_base = 1
         AND c.is_active = true
         AND NOT EXISTS (
           SELECT 1 FROM product_uom_conversions c2
           WHERE c2.product_id = c.product_id AND c2.uom_id = $1 AND c2.is_active = true
         )`,
      [pcId],
    );
    await client.query(
      `INSERT INTO product_uom_conversions (
        id, product_id, uom_id, conversion_to_base, barcode,
        purchase_price, retail_price, wholesale_price, distributor_price,
        is_default_purchase, is_default_sales, is_active
      )
      SELECT uuid_generate_v4(), p.id, $1, 1, NULL,
        p.cost, p.retail_price, p.wholesale_price, p.distributor_price,
        true, true, true
      FROM products p
      WHERE NOT EXISTS (
        SELECT 1 FROM product_uom_conversions c
        WHERE c.product_id = p.id AND c.uom_id = $1 AND c.is_active = true
      )`,
      [pcId],
    );
    await client.query(
      `UPDATE product_uom_conversions c
       SET conversion_to_base = 1,
           purchase_price = p.cost,
           retail_price = p.retail_price,
           wholesale_price = p.wholesale_price,
           distributor_price = p.distributor_price,
           is_default_purchase = true,
           is_default_sales = true,
           is_active = true,
           updated_at = CURRENT_TIMESTAMP
       FROM products p
       WHERE c.product_id = p.id AND c.uom_id = $1`,
      [pcId],
    );
    await client.query(
      `UPDATE product_uom_conversions c
       SET conversion_to_base = 12,
           is_default_purchase = false,
           is_default_sales = false,
           updated_at = CURRENT_TIMESTAMP
       FROM uoms u
       WHERE c.uom_id = u.id
         AND LOWER(TRIM(u.code)) <> 'pc'
         AND c.conversion_to_base = 1
         AND c.is_active = true`,
    );
    await client.query(
      `INSERT INTO system_settings (setting_key, setting_value)
       VALUES ('products_base_uom_pc_backfill_v1', 'done')`,
    );
  }

  if (pcId) {

    await client.query(`
      INSERT INTO product_uom_conversions (
        product_id, uom_id, conversion_to_base, barcode,
        purchase_price, retail_price, wholesale_price, distributor_price,
        is_default_purchase, is_default_sales, is_active
      )
      SELECT p.id, $1, 1, NULLIF(TRIM(p.barcode), ''),
        p.cost, p.retail_price, p.wholesale_price, p.distributor_price,
        true, true, true
      FROM products p
      WHERE NOT EXISTS (
        SELECT 1 FROM product_uom_conversions c
        WHERE c.product_id = p.id AND c.uom_id = $1
      )
    `, [pcId]);

    await client.query(`
      UPDATE products p SET
        default_purchase_uom_id = COALESCE(default_purchase_uom_id, base_uom_id),
        default_sales_uom_id = COALESCE(default_sales_uom_id, base_uom_id)
      WHERE base_uom_id IS NOT NULL
    `);
  }

  const backfillFlag = await client.query(
    `SELECT 1 FROM system_settings WHERE setting_key = 'products_tracking_flags_backfill_v1' LIMIT 1`,
  );
  if (backfillFlag.rows.length === 0) {
    await client.query(`
      UPDATE products SET
        allow_multiple_uom = true,
        track_batch = true,
        track_expiry = true
    `);
    await client.query(
      `INSERT INTO system_settings (setting_key, setting_value) VALUES ('products_tracking_flags_backfill_v1', 'done')`,
    );
  }
}
