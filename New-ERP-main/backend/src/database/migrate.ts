import { query, getClient } from '../config/database';

const migrate = async () => {
  const client = await getClient();
  try {
    await client.query('BEGIN');

    // Extensions
    await client.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);

    // ==================== USERS & AUTH ====================
    await client.query(`
      CREATE TABLE IF NOT EXISTS roles (
        id SERIAL PRIMARY KEY,
        name VARCHAR(50) UNIQUE NOT NULL,
        description TEXT,
        permissions JSONB DEFAULT '[]',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        username VARCHAR(100) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        email VARCHAR(255) UNIQUE,
        full_name VARCHAR(255) NOT NULL,
        role_id INTEGER REFERENCES roles(id),
        phone VARCHAR(50),
        is_active BOOLEAN DEFAULT true,
        last_login TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS sessions (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        token VARCHAR(500) NOT NULL,
        device_info TEXT,
        ip_address VARCHAR(50),
        expires_at TIMESTAMP NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // ==================== PRODUCTS ====================
    await client.query(`
      CREATE TABLE IF NOT EXISTS categories (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE,
        description TEXT,
        parent_id INTEGER REFERENCES categories(id),
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS brands (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE,
        description TEXT,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS products (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        sku VARCHAR(50) UNIQUE NOT NULL,
        barcode VARCHAR(100),
        name VARCHAR(255) NOT NULL,
        description TEXT,
        category_id INTEGER REFERENCES categories(id),
        brand_id INTEGER REFERENCES brands(id),
        unit_of_measure VARCHAR(50) NOT NULL DEFAULT 'pc',
        cost DECIMAL(15,2) DEFAULT 0,
        retail_price DECIMAL(15,2) DEFAULT 0,
        wholesale_price DECIMAL(15,2) DEFAULT 0,
        distributor_price DECIMAL(15,2) DEFAULT 0,
        reorder_level DECIMAL(15,2) DEFAULT 0,
        tax_type VARCHAR(50) DEFAULT 'VAT',
        price_type VARCHAR(50) DEFAULT 'VAT Inclusive',
        image_url TEXT,
        is_active BOOLEAN DEFAULT true,
        has_variants BOOLEAN DEFAULT false,
        has_chilled_variant BOOLEAN DEFAULT false,
        chilled_price DECIMAL(15,2) DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS product_variants (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        product_id UUID REFERENCES products(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        retail_price DECIMAL(15,2) DEFAULT 0,
        additional_cost DECIMAL(15,2) DEFAULT 0,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // ==================== INVENTORY ====================
    await client.query(`
      CREATE TABLE IF NOT EXISTS locations (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        type VARCHAR(50) NOT NULL CHECK (type IN ('Store', 'Warehouse', 'Branch')),
        address TEXT,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS inventory (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        product_id UUID REFERENCES products(id) ON DELETE CASCADE,
        location_id INTEGER REFERENCES locations(id),
        quantity DECIMAL(15,2) DEFAULT 0,
        reserved_quantity DECIMAL(15,2) DEFAULT 0,
        available_quantity DECIMAL(15,2) GENERATED ALWAYS AS (quantity - reserved_quantity) STORED,
        cost_method VARCHAR(50) DEFAULT 'moving_average',
        unit_cost DECIMAL(15,2) DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(product_id, location_id)
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS batches (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        product_id UUID REFERENCES products(id) ON DELETE CASCADE,
        location_id INTEGER REFERENCES locations(id),
        batch_number VARCHAR(100) NOT NULL,
        supplier_batch VARCHAR(100),
        manufacturing_date DATE,
        expiry_date DATE,
        quantity DECIMAL(15,2) DEFAULT 0,
        unit_cost DECIMAL(15,2) DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS inventory_ledger (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        product_id UUID REFERENCES products(id),
        location_id INTEGER REFERENCES locations(id),
        batch_id UUID REFERENCES batches(id),
        reference_type VARCHAR(50) NOT NULL,
        reference_id UUID,
        transaction_type VARCHAR(50) NOT NULL CHECK (transaction_type IN ('IN', 'OUT', 'ADJUSTMENT', 'TRANSFER_IN', 'TRANSFER_OUT', 'CONVERSION_IN', 'CONVERSION_OUT')),
        quantity DECIMAL(15,2) NOT NULL,
        running_quantity DECIMAL(15,2),
        unit_cost DECIMAL(15,2),
        total_cost DECIMAL(15,2),
        notes TEXT,
        created_by UUID REFERENCES users(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // ==================== INVENTORY COUNTS ====================
    await client.query(`
      CREATE TABLE IF NOT EXISTS inventory_counts (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        count_number VARCHAR(50) UNIQUE NOT NULL,
        location_id INTEGER REFERENCES locations(id),
        count_date DATE NOT NULL DEFAULT CURRENT_DATE,
        status VARCHAR(50) DEFAULT 'Draft' CHECK (status IN ('Draft', 'Posted')),
        notes TEXT,
        posted_by UUID REFERENCES users(id),
        posted_at TIMESTAMP,
        created_by UUID REFERENCES users(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS inventory_count_items (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        count_id UUID REFERENCES inventory_counts(id) ON DELETE CASCADE,
        product_id UUID REFERENCES products(id),
        system_qty DECIMAL(15,2) DEFAULT 0,
        actual_qty DECIMAL(15,2) DEFAULT 0,
        variance DECIMAL(15,2) DEFAULT 0,
        unit_cost DECIMAL(15,2) DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // ==================== UNIT CONVERSION ====================
    await client.query(`
      CREATE TABLE IF NOT EXISTS unit_conversions (
        id SERIAL PRIMARY KEY,
        product_id UUID REFERENCES products(id) ON DELETE CASCADE,
        from_unit VARCHAR(50) NOT NULL,
        to_unit VARCHAR(50) NOT NULL,
        conversion_factor DECIMAL(15,4) NOT NULL,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // ==================== PURCHASES ====================
    await client.query(`
      CREATE TABLE IF NOT EXISTS purchase_requisitions (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        pr_number VARCHAR(50) UNIQUE NOT NULL,
        status VARCHAR(50) DEFAULT 'Draft' CHECK (status IN ('Draft', 'Pending', 'Approved', 'Cancelled')),
        requested_by UUID REFERENCES users(id),
        approved_by UUID REFERENCES users(id),
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS purchase_requisition_items (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        pr_id UUID REFERENCES purchase_requisitions(id) ON DELETE CASCADE,
        product_id UUID REFERENCES products(id),
        quantity DECIMAL(15,2) NOT NULL,
        estimated_cost DECIMAL(15,2),
        notes TEXT
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS purchase_orders (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        po_number VARCHAR(50) UNIQUE NOT NULL,
        supplier_id INTEGER REFERENCES suppliers(id),
        pr_id UUID REFERENCES purchase_requisitions(id),
        status VARCHAR(50) DEFAULT 'Draft' CHECK (status IN ('Draft', 'Sent', 'Partial', 'Received', 'Paid', 'Cancelled')),
        order_date DATE NOT NULL DEFAULT CURRENT_DATE,
        expected_date DATE,
        payment_terms VARCHAR(100),
        notes TEXT,
        subtotal DECIMAL(15,2) DEFAULT 0,
        discount DECIMAL(15,2) DEFAULT 0,
        tax DECIMAL(15,2) DEFAULT 0,
        vat_mode VARCHAR(50) DEFAULT 'VAT Inclusive',
        vat_amount DECIMAL(15,2) DEFAULT 0,
        vatable_amount DECIMAL(15,2) DEFAULT 0,
        total DECIMAL(15,2) DEFAULT 0,
        created_by UUID REFERENCES users(id),
        approved_by UUID REFERENCES users(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS purchase_order_items (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        po_id UUID REFERENCES purchase_orders(id) ON DELETE CASCADE,
        product_id UUID REFERENCES products(id),
        quantity DECIMAL(15,2) NOT NULL,
        received_quantity DECIMAL(15,2) DEFAULT 0,
        unit_cost DECIMAL(15,2) DEFAULT 0,
        discount_type VARCHAR(10) DEFAULT '%',
        discount_value DECIMAL(15,2) DEFAULT 0,
        discount_amount DECIMAL(15,2) DEFAULT 0,
        net_unit_cost DECIMAL(15,2) DEFAULT 0,
        net_total DECIMAL(15,2) DEFAULT 0,
        total_cost DECIMAL(15,2) DEFAULT 0,
        notes TEXT
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS goods_receipts (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        gr_number VARCHAR(50) UNIQUE NOT NULL,
        po_id UUID REFERENCES purchase_orders(id),
        supplier_id INTEGER,
        location_id INTEGER REFERENCES locations(id),
        reference_number VARCHAR(100),
        received_date DATE NOT NULL DEFAULT CURRENT_DATE,
        status VARCHAR(50) DEFAULT 'Draft' CHECK (status IN ('Draft', 'Completed', 'Cancelled')),
        notes TEXT,
        created_by UUID REFERENCES users(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS goods_receipt_items (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        gr_id UUID REFERENCES goods_receipts(id) ON DELETE CASCADE,
        po_item_id UUID REFERENCES purchase_order_items(id),
        product_id UUID REFERENCES products(id),
        batch_id UUID REFERENCES batches(id),
        quantity DECIMAL(15,2) NOT NULL,
        unit_cost DECIMAL(15,2) NOT NULL,
        discount_amount DECIMAL(15,2) DEFAULT 0,
        net_unit_cost DECIMAL(15,2) NOT NULL,
        total_cost DECIMAL(15,2) NOT NULL,
        expiry_date DATE,
        batch_number VARCHAR(100),
        notes TEXT
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS purchase_returns (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        pr_number VARCHAR(50) UNIQUE NOT NULL,
        supplier_id INTEGER,
        reference_type VARCHAR(50),
        reference_id UUID,
        return_date DATE NOT NULL DEFAULT CURRENT_DATE,
        status VARCHAR(50) DEFAULT 'Draft' CHECK (status IN ('Draft', 'Completed', 'Cancelled')),
        reason TEXT,
        notes TEXT,
        created_by UUID REFERENCES users(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // ==================== STOCK TRANSFER ====================
    await client.query(`
      CREATE TABLE IF NOT EXISTS stock_transfers (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        transfer_number VARCHAR(50) UNIQUE NOT NULL,
        source_location_id INTEGER REFERENCES locations(id),
        destination_location_id INTEGER REFERENCES locations(id),
        status VARCHAR(50) DEFAULT 'Draft' CHECK (status IN ('Draft', 'Sent', 'Received', 'Cancelled')),
        notes TEXT,
        created_by UUID REFERENCES users(id),
        received_by UUID REFERENCES users(id),
        received_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS stock_transfer_items (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        transfer_id UUID REFERENCES stock_transfers(id) ON DELETE CASCADE,
        product_id UUID REFERENCES products(id),
        batch_id UUID REFERENCES batches(id),
        quantity DECIMAL(15,2) NOT NULL,
        unit_cost DECIMAL(15,2) DEFAULT 0,
        received_quantity DECIMAL(15,2)
      )
    `);

    // ==================== CUSTOMERS ====================
    await client.query(`
      CREATE TABLE IF NOT EXISTS customers (
        id SERIAL PRIMARY KEY,
        customer_code VARCHAR(50) UNIQUE NOT NULL,
        customer_name VARCHAR(255) NOT NULL,
        contact_person VARCHAR(255),
        address TEXT,
        phone VARCHAR(50),
        email VARCHAR(255),
        customer_type VARCHAR(50) CHECK (customer_type IN ('Retail', 'Wholesale', 'LGU', 'Corporate', 'Mining', 'Resort', 'Distributor')),
        credit_limit DECIMAL(15,2) DEFAULT 0,
        payment_terms VARCHAR(100),
        tax_type VARCHAR(50) DEFAULT 'VAT',
        tin VARCHAR(50),
        is_active BOOLEAN DEFAULT true,
        balance DECIMAL(15,2) DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // ==================== SUPPLIERS ====================
    await client.query(`
      CREATE TABLE IF NOT EXISTS suppliers (
        id SERIAL PRIMARY KEY,
        supplier_code VARCHAR(50) UNIQUE NOT NULL,
        supplier_name VARCHAR(255) NOT NULL,
        contact_person VARCHAR(255),
        address TEXT,
        phone VARCHAR(50),
        email VARCHAR(255),
        payment_terms VARCHAR(100),
        tin VARCHAR(50),
        default_discount_percent DECIMAL(5,2) DEFAULT 0,
        balance DECIMAL(15,2) DEFAULT 0,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // ==================== SALES ====================
    await client.query(`
      CREATE TABLE IF NOT EXISTS sales_quotations (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        sq_number VARCHAR(50) UNIQUE NOT NULL,
        customer_id INTEGER REFERENCES customers(id),
        customer_name VARCHAR(255),
        status VARCHAR(50) DEFAULT 'Draft' CHECK (status IN ('Draft', 'Sent', 'Approved', 'Expired', 'Cancelled')),
        valid_until DATE,
        notes TEXT,
        subtotal DECIMAL(15,2) DEFAULT 0,
        discount DECIMAL(15,2) DEFAULT 0,
        tax DECIMAL(15,2) DEFAULT 0,
        total DECIMAL(15,2) DEFAULT 0,
        created_by UUID REFERENCES users(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS sales_orders (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        so_number VARCHAR(50) UNIQUE NOT NULL,
        customer_id INTEGER REFERENCES customers(id),
        sq_id UUID REFERENCES sales_quotations(id),
        customer_name VARCHAR(255),
        delivery_address TEXT,
        status VARCHAR(50) DEFAULT 'Draft' CHECK (status IN ('Draft', 'Confirmed', 'Processing', 'Delivered', 'Invoiced', 'Cancelled')),
        order_date DATE NOT NULL DEFAULT CURRENT_DATE,
        delivery_date DATE,
        payment_terms VARCHAR(100),
        notes TEXT,
        subtotal DECIMAL(15,2) DEFAULT 0,
        discount DECIMAL(15,2) DEFAULT 0,
        tax DECIMAL(15,2) DEFAULT 0,
        total DECIMAL(15,2) DEFAULT 0,
        created_by UUID REFERENCES users(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS delivery_notes (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        dn_number VARCHAR(50) UNIQUE NOT NULL,
        so_id UUID REFERENCES sales_orders(id),
        customer_id INTEGER REFERENCES customers(id),
        delivery_address TEXT,
        status VARCHAR(50) DEFAULT 'Draft' CHECK (status IN ('Draft', 'Delivered', 'Partial', 'Cancelled')),
        delivery_date DATE NOT NULL DEFAULT CURRENT_DATE,
        notes TEXT,
        created_by UUID REFERENCES users(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS sales_invoices (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        invoice_number VARCHAR(50) UNIQUE NOT NULL,
        so_id UUID REFERENCES sales_orders(id),
        dn_id UUID REFERENCES delivery_notes(id),
        customer_id INTEGER REFERENCES customers(id),
        customer_name VARCHAR(255),
        customer_type VARCHAR(50) DEFAULT 'Customer',
        employee_id INTEGER REFERENCES employees(id),
        price_mode VARCHAR(50) DEFAULT 'Retail' CHECK (price_mode IN ('Retail', 'Wholesale', 'Distributor')),
        invoice_date DATE NOT NULL DEFAULT CURRENT_DATE,
        due_date DATE,
        payment_method VARCHAR(50),
        payment_terms VARCHAR(100),
        status VARCHAR(50) DEFAULT 'Draft' CHECK (status IN ('Draft', 'Posted', 'Paid', 'Partial', 'Overdue', 'Void', 'Cancelled', 'Deducted')),
        notes TEXT,
        subtotal DECIMAL(15,2) DEFAULT 0,
        discount DECIMAL(15,2) DEFAULT 0,
        tax DECIMAL(15,2) DEFAULT 0,
        tax_type VARCHAR(50) DEFAULT 'VAT',
        vatable_sales DECIMAL(15,2) DEFAULT 0,
        vat_exempt_sales DECIMAL(15,2) DEFAULT 0,
        zero_rated_sales DECIMAL(15,2) DEFAULT 0,
        vat_amount DECIMAL(15,2) DEFAULT 0,
        lgu_final_tax DECIMAL(15,2) DEFAULT 0,
        withholding_tax DECIMAL(15,2) DEFAULT 0,
        total DECIMAL(15,2) DEFAULT 0,
        amount_paid DECIMAL(15,2) DEFAULT 0,
        balance DECIMAL(15,2) DEFAULT 0,
        cashier_id UUID REFERENCES users(id),
        created_by UUID REFERENCES users(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Add missing tax columns to sales_invoices if they don't already exist
    await client.query(`ALTER TABLE sales_invoices ADD COLUMN IF NOT EXISTS vatable_sales DECIMAL(15,2) DEFAULT 0`);
    await client.query(`ALTER TABLE sales_invoices ADD COLUMN IF NOT EXISTS vat_exempt_sales DECIMAL(15,2) DEFAULT 0`);
    await client.query(`ALTER TABLE sales_invoices ADD COLUMN IF NOT EXISTS zero_rated_sales DECIMAL(15,2) DEFAULT 0`);
    await client.query(`ALTER TABLE sales_invoices ADD COLUMN IF NOT EXISTS vat_amount DECIMAL(15,2) DEFAULT 0`);
    await client.query(`ALTER TABLE sales_invoices ADD COLUMN IF NOT EXISTS lgu_final_tax DECIMAL(15,2) DEFAULT 0`);
    await client.query(`ALTER TABLE sales_invoices ADD COLUMN IF NOT EXISTS withholding_tax DECIMAL(15,2) DEFAULT 0`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS sales_invoice_items (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        invoice_id UUID REFERENCES sales_invoices(id) ON DELETE CASCADE,
        product_id UUID REFERENCES products(id),
        variant_id UUID REFERENCES product_variants(id),
        description TEXT,
        quantity DECIMAL(15,2) NOT NULL,
        unit_price DECIMAL(15,2) NOT NULL,
        discount DECIMAL(15,2) DEFAULT 0,
        tax DECIMAL(15,2) DEFAULT 0,
        total DECIMAL(15,2) NOT NULL,
        cost DECIMAL(15,2) DEFAULT 0,
        selected_variant VARCHAR(50),
        location_id INTEGER,
        tax_type VARCHAR(50),
        vat_amount DECIMAL(15,2) DEFAULT 0
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS sales_returns (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        return_number VARCHAR(50) UNIQUE NOT NULL,
        invoice_id UUID REFERENCES sales_invoices(id),
        customer_id INTEGER REFERENCES customers(id),
        return_date DATE NOT NULL DEFAULT CURRENT_DATE,
        status VARCHAR(50) DEFAULT 'Draft' CHECK (status IN ('Draft', 'Completed', 'Cancelled')),
        reason TEXT,
        notes TEXT,
        total DECIMAL(15,2) DEFAULT 0,
        created_by UUID REFERENCES users(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // ==================== POS ====================
    await client.query(`
      CREATE TABLE IF NOT EXISTS pos_shifts (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        user_id UUID REFERENCES users(id),
        shift_number VARCHAR(50) UNIQUE NOT NULL,
        opening_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        closing_date TIMESTAMP,
        opening_cash DECIMAL(15,2) DEFAULT 0,
        closing_cash DECIMAL(15,2),
        expected_cash DECIMAL(15,2),
        cash_sales DECIMAL(15,2) DEFAULT 0,
        card_sales DECIMAL(15,2) DEFAULT 0,
        gcash_sales DECIMAL(15,2) DEFAULT 0,
        maya_sales DECIMAL(15,2) DEFAULT 0,
        bank_transfer_sales DECIMAL(15,2) DEFAULT 0,
        charge_sales DECIMAL(15,2) DEFAULT 0,
        total_sales DECIMAL(15,2) DEFAULT 0,
        discount_total DECIMAL(15,2) DEFAULT 0,
        return_total DECIMAL(15,2) DEFAULT 0,
        void_total DECIMAL(15,2) DEFAULT 0,
        net_sales DECIMAL(15,2) DEFAULT 0,
        status VARCHAR(50) DEFAULT 'Open' CHECK (status IN ('Open', 'Closed')),
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS pos_transactions (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        transaction_number VARCHAR(50) UNIQUE NOT NULL,
        shift_id UUID REFERENCES pos_shifts(id),
        customer_id INTEGER REFERENCES customers(id),
        customer_name VARCHAR(255),
        price_mode VARCHAR(50) DEFAULT 'Retail',
        subtotal DECIMAL(15,2) DEFAULT 0,
        discount_total DECIMAL(15,2) DEFAULT 0,
        tax_total DECIMAL(15,2) DEFAULT 0,
        total DECIMAL(15,2) DEFAULT 0,
        payment_method VARCHAR(50),
        payment_details JSONB,
        amount_tendered DECIMAL(15,2) DEFAULT 0,
        change_amount DECIMAL(15,2) DEFAULT 0,
        status VARCHAR(50) DEFAULT 'Completed' CHECK (status IN ('Completed', 'Void', 'Suspended', 'Returned')),
        cashier_id UUID REFERENCES users(id),
        void_reason TEXT,
        voided_at TIMESTAMP,
        voided_by UUID REFERENCES users(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS pos_transaction_items (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        transaction_id UUID REFERENCES pos_transactions(id) ON DELETE CASCADE,
        product_id UUID REFERENCES products(id),
        variant_id UUID REFERENCES product_variants(id),
        description TEXT,
        quantity DECIMAL(15,2) NOT NULL,
        unit_price DECIMAL(15,2) NOT NULL,
        discount DECIMAL(15,2) DEFAULT 0,
        total DECIMAL(15,2) NOT NULL,
        cost DECIMAL(15,2) DEFAULT 0,
        selected_variant VARCHAR(50),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS suspended_sales (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        transaction_number VARCHAR(50) UNIQUE NOT NULL,
        shift_id UUID REFERENCES pos_shifts(id),
        customer_id INTEGER REFERENCES customers(id),
        customer_name VARCHAR(255),
        price_mode VARCHAR(50) DEFAULT 'Retail',
        items JSONB NOT NULL,
        subtotal DECIMAL(15,2) DEFAULT 0,
        discount_total DECIMAL(15,2) DEFAULT 0,
        tax_total DECIMAL(15,2) DEFAULT 0,
        total DECIMAL(15,2) DEFAULT 0,
        cashier_id UUID REFERENCES users(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // ==================== ACCOUNTING ====================
    await client.query(`
      CREATE TABLE IF NOT EXISTS chart_of_accounts (
        id SERIAL PRIMARY KEY,
        account_code VARCHAR(50) UNIQUE NOT NULL,
        account_name VARCHAR(255) NOT NULL,
        account_type VARCHAR(50) NOT NULL CHECK (account_type IN ('Asset', 'Liability', 'Equity', 'Income', 'Expense', 'Cost of Goods Sold')),
        parent_id INTEGER REFERENCES chart_of_accounts(id),
        is_active BOOLEAN DEFAULT true,
        is_default BOOLEAN DEFAULT false,
        balance DECIMAL(15,2) DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS journal_entries (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        entry_number VARCHAR(50) UNIQUE NOT NULL,
        entry_date DATE NOT NULL DEFAULT CURRENT_DATE,
        reference_type VARCHAR(50),
        reference_id UUID,
        description TEXT,
        total_debit DECIMAL(15,2) DEFAULT 0,
        total_credit DECIMAL(15,2) DEFAULT 0,
        status VARCHAR(50) DEFAULT 'Posted' CHECK (status IN ('Draft', 'Posted', 'Void')),
        created_by UUID REFERENCES users(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS journal_entry_lines (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        entry_id UUID REFERENCES journal_entries(id) ON DELETE CASCADE,
        account_id INTEGER REFERENCES chart_of_accounts(id),
        description TEXT,
        debit DECIMAL(15,2) DEFAULT 0,
        credit DECIMAL(15,2) DEFAULT 0,
        reference_type VARCHAR(50),
        reference_id UUID
      )
    `);

    // ==================== ACCOUNTS RECEIVABLE ====================
    await client.query(`
      CREATE TABLE IF NOT EXISTS collection_receipts (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        receipt_number VARCHAR(50) UNIQUE NOT NULL,
        customer_id INTEGER REFERENCES customers(id),
        invoice_id UUID REFERENCES sales_invoices(id),
        payment_date DATE NOT NULL DEFAULT CURRENT_DATE,
        payment_method VARCHAR(50),
        reference_number VARCHAR(100),
        bank_account_id INTEGER REFERENCES bank_accounts(id),
        amount DECIMAL(15,2) NOT NULL,
        status VARCHAR(50) DEFAULT 'Posted' CHECK (status IN ('Draft', 'Posted', 'Void')),
        notes TEXT,
        created_by UUID REFERENCES users(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // ==================== ACCOUNTS PAYABLE ====================
    await client.query(`
      CREATE TABLE IF NOT EXISTS payment_vouchers (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        voucher_number VARCHAR(50) UNIQUE NOT NULL,
        supplier_id INTEGER REFERENCES suppliers(id),
        po_id UUID REFERENCES purchase_orders(id),
        payment_date DATE NOT NULL DEFAULT CURRENT_DATE,
        payment_method VARCHAR(50),
        reference_number VARCHAR(100),
        amount DECIMAL(15,2) NOT NULL,
        status VARCHAR(50) DEFAULT 'Draft' CHECK (status IN ('Draft', 'Posted', 'Void')),
        notes TEXT,
        created_by UUID REFERENCES users(id),
        approved_by UUID REFERENCES users(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // ==================== CASH MANAGEMENT ====================
    await client.query(`
      CREATE TABLE IF NOT EXISTS cash_transactions (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        transaction_number VARCHAR(50) UNIQUE NOT NULL,
        transaction_type VARCHAR(50) NOT NULL CHECK (transaction_type IN ('Opening', 'Cash In', 'Cash Out', 'Petty Cash', 'Cash Count', 'Collection', 'Disbursement')),
        amount DECIMAL(15,2) NOT NULL,
        reference_type VARCHAR(50),
        reference_id UUID,
        notes TEXT,
        created_by UUID REFERENCES users(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // ==================== BANK MANAGEMENT ====================
    await client.query(`
      CREATE TABLE IF NOT EXISTS bank_accounts (
        id SERIAL PRIMARY KEY,
        account_code VARCHAR(50) UNIQUE,
        bank_name VARCHAR(255) NOT NULL,
        account_name VARCHAR(255) NOT NULL,
        account_number VARCHAR(100) NOT NULL,
        account_type VARCHAR(50),
        balance DECIMAL(15,2) DEFAULT 0,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS bank_transactions (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        bank_account_id INTEGER REFERENCES bank_accounts(id),
        transaction_type VARCHAR(50) NOT NULL CHECK (transaction_type IN ('Deposit', 'Withdrawal', 'Transfer')),
        amount DECIMAL(15,2) NOT NULL,
        reference_type VARCHAR(50),
        reference_id UUID,
        transaction_date DATE NOT NULL DEFAULT CURRENT_DATE,
        notes TEXT,
        created_by UUID REFERENCES users(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // ==================== EXPENSES ====================
    await client.query(`
      CREATE TABLE IF NOT EXISTS expense_categories (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE,
        description TEXT,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS expenses (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        expense_number VARCHAR(50) UNIQUE NOT NULL,
        category_id INTEGER REFERENCES expense_categories(id),
        description TEXT,
        amount DECIMAL(15,2) NOT NULL,
        expense_date DATE NOT NULL DEFAULT CURRENT_DATE,
        payment_method VARCHAR(50),
        reference_number VARCHAR(100),
        status VARCHAR(50) DEFAULT 'Posted' CHECK (status IN ('Draft', 'Posted', 'Void')),
        notes TEXT,
        created_by UUID REFERENCES users(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // ==================== HR / PAYROLL ====================
    await client.query(`
      CREATE TABLE IF NOT EXISTS employees (
        id SERIAL PRIMARY KEY,
        employee_code VARCHAR(50) UNIQUE NOT NULL,
        first_name VARCHAR(255) NOT NULL,
        last_name VARCHAR(255) NOT NULL,
        middle_name VARCHAR(255),
        address TEXT,
        phone VARCHAR(50),
        email VARCHAR(255),
        position VARCHAR(255),
        department VARCHAR(255),
        daily_rate DECIMAL(15,2) DEFAULT 0,
        monthly_rate DECIMAL(15,2) DEFAULT 0,
        sss VARCHAR(50),
        philhealth VARCHAR(50),
        pagibig VARCHAR(50),
        tin VARCHAR(50),
        employment_type VARCHAR(50) DEFAULT 'Regular' CHECK (employment_type IN ('Regular', 'Contractual', 'Probationary', 'Part-time')),
        hire_date DATE,
        cash_advance_balance DECIMAL(15,2) DEFAULT 0,
        grocery_credit_balance DECIMAL(15,2) DEFAULT 0,
        credit_limit DECIMAL(15,2) DEFAULT 0,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS attendance (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        employee_id INTEGER REFERENCES employees(id),
        date DATE NOT NULL DEFAULT CURRENT_DATE,
        time_in TIMESTAMP,
        time_out TIMESTAMP,
        status VARCHAR(50) DEFAULT 'Present' CHECK (status IN ('Present', 'Absent', 'Late', 'Half-day', 'Leave')),
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS payroll (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        payroll_number VARCHAR(50) UNIQUE NOT NULL,
        employee_id INTEGER REFERENCES employees(id),
        pay_period_start DATE NOT NULL,
        pay_period_end DATE NOT NULL,
        days_worked INTEGER DEFAULT 0,
        gross_pay DECIMAL(15,2) DEFAULT 0,
        cash_advance_deduction DECIMAL(15,2) DEFAULT 0,
        grocery_credit_deduction DECIMAL(15,2) DEFAULT 0,
        other_deductions DECIMAL(15,2) DEFAULT 0,
        deductions_total DECIMAL(15,2) DEFAULT 0,
        net_pay DECIMAL(15,2) DEFAULT 0,
        status VARCHAR(50) DEFAULT 'Draft' CHECK (status IN ('Draft', 'Posted', 'Paid', 'Cancelled')),
        payment_date DATE,
        payment_account_type VARCHAR(50),
        payment_account_id INTEGER,
        payment_ref VARCHAR(100),
        notes TEXT,
        created_by UUID REFERENCES users(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS payroll_deductions (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        payroll_id UUID REFERENCES payroll(id) ON DELETE CASCADE,
        deduction_type VARCHAR(100) NOT NULL,
        amount DECIMAL(15,2) NOT NULL
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS cash_advances (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        employee_id INTEGER REFERENCES employees(id),
        amount DECIMAL(15,2) NOT NULL,
        advance_date DATE NOT NULL DEFAULT CURRENT_DATE,
        deduction_amount DECIMAL(15,2) DEFAULT 0,
        remaining_balance DECIMAL(15,2) DEFAULT 0,
        status VARCHAR(50) DEFAULT 'Active' CHECK (status IN ('Active', 'Fully Paid', 'Cancelled')),
        notes TEXT,
        payment_account_type VARCHAR(50),
        payment_account_id INTEGER,
        created_by UUID REFERENCES users(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // ==================== EMPLOYEE GROCERY CREDITS ====================
    await client.query(`
      CREATE TABLE IF NOT EXISTS employee_grocery_credits (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        credit_number VARCHAR(50) UNIQUE NOT NULL,
        employee_id INTEGER REFERENCES employees(id),
        credit_date DATE NOT NULL DEFAULT CURRENT_DATE,
        location_id INTEGER REFERENCES locations(id),
        subtotal DECIMAL(15,2) DEFAULT 0,
        discount DECIMAL(15,2) DEFAULT 0,
        total DECIMAL(15,2) DEFAULT 0,
        status VARCHAR(50) DEFAULT 'Draft' CHECK (status IN ('Draft', 'Posted', 'Deducted', 'Cancelled')),
        notes TEXT,
        created_by UUID REFERENCES users(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS employee_grocery_credit_items (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        credit_id UUID REFERENCES employee_grocery_credits(id) ON DELETE CASCADE,
        product_id UUID REFERENCES products(id),
        description TEXT,
        quantity DECIMAL(15,2) NOT NULL,
        unit_price DECIMAL(15,2) NOT NULL,
        discount DECIMAL(15,2) DEFAULT 0,
        total DECIMAL(15,2) NOT NULL,
        cost DECIMAL(15,2) DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // ==================== SSS CONTRIBUTIONS ====================
    await client.query(`
      CREATE TABLE IF NOT EXISTS sss_contributions (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        contribution_number VARCHAR(50) UNIQUE NOT NULL,
        employee_id INTEGER REFERENCES employees(id),
        period_start DATE NOT NULL,
        period_end DATE NOT NULL,
        employer_amount DECIMAL(15,2) DEFAULT 0,
        total_amount DECIMAL(15,2) DEFAULT 0,
        status VARCHAR(50) DEFAULT 'Draft' CHECK (status IN ('Draft', 'Posted', 'Paid', 'Cancelled')),
        payment_date DATE,
        notes TEXT,
        created_by UUID REFERENCES users(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // ==================== AUDIT TRAIL ====================
    await client.query(`
      CREATE TABLE IF NOT EXISTS audit_logs (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        user_id UUID REFERENCES users(id),
        username VARCHAR(100),
        action VARCHAR(50) NOT NULL,
        module VARCHAR(50) NOT NULL,
        reference_type VARCHAR(50),
        reference_id UUID,
        old_values JSONB,
        new_values JSONB,
        ip_address VARCHAR(50),
        device_info TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // ==================== NOTIFICATIONS ====================
    await client.query(`
      CREATE TABLE IF NOT EXISTS notifications (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        type VARCHAR(50) NOT NULL,
        title VARCHAR(255) NOT NULL,
        message TEXT,
        reference_type VARCHAR(50),
        reference_id UUID,
        is_read BOOLEAN DEFAULT false,
        user_id UUID REFERENCES users(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // ==================== SYSTEM SETTINGS ====================
    await client.query(`
      CREATE TABLE IF NOT EXISTS system_settings (
        id SERIAL PRIMARY KEY,
        setting_key VARCHAR(100) UNIQUE NOT NULL,
        setting_value TEXT,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Add columns for chilled variant feature (existing databases)
    await client.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS has_chilled_variant BOOLEAN DEFAULT false`);
    await client.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS chilled_price DECIMAL(15,2) DEFAULT 0`);
    await client.query(`ALTER TABLE sales_invoice_items ADD COLUMN IF NOT EXISTS selected_variant VARCHAR(50)`);
    await client.query(`ALTER TABLE sales_invoice_items ADD COLUMN IF NOT EXISTS location_id INTEGER`);
    await client.query(`ALTER TABLE sales_invoice_items ADD COLUMN IF NOT EXISTS tax_type VARCHAR(50)`);
    await client.query(`ALTER TABLE sales_invoice_items ADD COLUMN IF NOT EXISTS vat_amount DECIMAL(15,2) DEFAULT 0`);
    await client.query(`ALTER TABLE pos_transaction_items ADD COLUMN IF NOT EXISTS selected_variant VARCHAR(50)`);
    await client.query(`ALTER TABLE pos_transaction_items ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP`);
    await client.query(`ALTER TABLE collection_receipts ADD COLUMN IF NOT EXISTS bank_account_id INTEGER REFERENCES bank_accounts(id)`);
    await client.query(`ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS discount_type VARCHAR(10) DEFAULT '%'`);
    await client.query(`ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS discount_value DECIMAL(15,2) DEFAULT 0`);
    await client.query(`ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS discount_amount DECIMAL(15,2) DEFAULT 0`);
    await client.query(`ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS net_unit_cost DECIMAL(15,2) DEFAULT 0`);
    await client.query(`ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS net_total DECIMAL(15,2) DEFAULT 0`);
    await client.query(`ALTER TABLE goods_receipt_items ADD COLUMN IF NOT EXISTS discount_amount DECIMAL(15,2) DEFAULT 0`);
    await client.query(`ALTER TABLE goods_receipt_items ADD COLUMN IF NOT EXISTS net_unit_cost DECIMAL(15,2) NOT NULL DEFAULT 0`);
    await client.query(`ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS default_discount_percent DECIMAL(5,2) DEFAULT 0`);

    // HR / Payroll additions for existing databases
    await client.query(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS hire_date DATE`);
    await client.query(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS cash_advance_balance DECIMAL(15,2) DEFAULT 0`);
    await client.query(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS grocery_credit_balance DECIMAL(15,2) DEFAULT 0`);
    await client.query(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS credit_limit DECIMAL(15,2) DEFAULT 0`);
    await client.query(`ALTER TABLE payroll ADD COLUMN IF NOT EXISTS cash_advance_deduction DECIMAL(15,2) DEFAULT 0`);
    await client.query(`ALTER TABLE payroll ADD COLUMN IF NOT EXISTS grocery_credit_deduction DECIMAL(15,2) DEFAULT 0`);
    await client.query(`ALTER TABLE payroll ADD COLUMN IF NOT EXISTS other_deductions DECIMAL(15,2) DEFAULT 0`);
    await client.query(`ALTER TABLE payroll ADD COLUMN IF NOT EXISTS payment_account_type VARCHAR(50)`);
    await client.query(`ALTER TABLE payroll ADD COLUMN IF NOT EXISTS payment_account_id INTEGER`);
    await client.query(`ALTER TABLE payroll ADD COLUMN IF NOT EXISTS payment_ref VARCHAR(100)`);
    await client.query(`ALTER TABLE cash_advances ADD COLUMN IF NOT EXISTS payment_account_type VARCHAR(50)`);
    await client.query(`ALTER TABLE cash_advances ADD COLUMN IF NOT EXISTS payment_account_id INTEGER`);
    await client.query(`ALTER TABLE sales_invoices ADD COLUMN IF NOT EXISTS customer_type VARCHAR(50) DEFAULT 'Customer'`);
    await client.query(`ALTER TABLE sales_invoices ADD COLUMN IF NOT EXISTS employee_id INTEGER REFERENCES employees(id)`);
    await client.query(`ALTER TABLE sales_invoices ADD COLUMN IF NOT EXISTS payment_method VARCHAR(50)`);
    await client.query(`ALTER TABLE sales_invoices ADD COLUMN IF NOT EXISTS payment_terms VARCHAR(100)`);
    await client.query(`ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS vat_mode VARCHAR(50) DEFAULT 'VAT Inclusive'`);
    await client.query(`ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS vat_amount DECIMAL(15,2) DEFAULT 0`);
    await client.query(`ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS vatable_amount DECIMAL(15,2) DEFAULT 0`);
    await client.query(`ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS supplier_id_temp INTEGER`);
    // Add FK constraint to purchase_orders.supplier_id if not exists
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'purchase_orders'::regclass AND conname = 'purchase_orders_supplier_id_fkey') THEN
          ALTER TABLE purchase_orders ADD CONSTRAINT purchase_orders_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES suppliers(id);
        END IF;
      END $$;
    `);

    // Fix purchase_orders status constraint to include 'Paid'
    await client.query(`
      DO $$
      DECLARE
        cname text;
      BEGIN
        SELECT conname INTO cname FROM pg_constraint
        WHERE conrelid = 'purchase_orders'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%status%';
        IF cname IS NOT NULL THEN
          EXECUTE 'ALTER TABLE purchase_orders DROP CONSTRAINT ' || cname;
        END IF;
        ALTER TABLE purchase_orders ADD CONSTRAINT purchase_orders_status_check
          CHECK (status IN ('Draft', 'Sent', 'Partial', 'Received', 'Paid', 'Cancelled'));
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `);
    await client.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS price_type VARCHAR(50) DEFAULT 'VAT Inclusive'`);
    await client.query(`ALTER TABLE bank_accounts ADD COLUMN IF NOT EXISTS account_code VARCHAR(50)`);

    await client.query('COMMIT');
    console.log('Migration completed successfully');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Migration failed:', error);
    throw error;
  } finally {
    client.release();
  }
};

migrate()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
