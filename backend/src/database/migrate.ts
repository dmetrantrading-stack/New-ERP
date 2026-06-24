import { query, getClient } from '../config/database';
import { ensureCategoryGlAccounts } from '../utils/chartOfAccountsBalance';

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

    // ==================== EMPLOYEES (before sales_invoices FK) ====================
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
    await client.query(`ALTER TABLE goods_receipts ADD COLUMN IF NOT EXISTS supplier_invoice_number VARCHAR(100)`);

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
    await client.query(`ALTER TABLE goods_receipt_items ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS attachments (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        reference_type VARCHAR(50) NOT NULL,
        reference_id UUID NOT NULL,
        original_name VARCHAR(255) NOT NULL,
        stored_name VARCHAR(255) NOT NULL,
        mime_type VARCHAR(100),
        file_size INTEGER DEFAULT 0,
        file_path TEXT NOT NULL,
        uploaded_by UUID REFERENCES users(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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
    await client.query(`ALTER TABLE sales_invoices ADD COLUMN IF NOT EXISTS ewt_rate DECIMAL(5,2) DEFAULT 0`);

    // Update status constraint to include 'Deducted' (for payroll/employee deductions)
    await client.query(`ALTER TABLE sales_invoices DROP CONSTRAINT IF EXISTS sales_invoices_status_check`);
    await client.query(`ALTER TABLE sales_invoices ADD CONSTRAINT sales_invoices_status_check CHECK (status IN ('Draft', 'Posted', 'Paid', 'Partial', 'Overdue', 'Void', 'Cancelled', 'Deducted'))`);

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
      CREATE TABLE IF NOT EXISTS production_orders (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        po_number VARCHAR(50) UNIQUE NOT NULL,
        po_date DATE NOT NULL DEFAULT CURRENT_DATE,
        source_location_id INTEGER,
        destination_location_id INTEGER,
        status VARCHAR(50) DEFAULT 'Draft' CHECK (status IN ('Draft', 'Completed', 'Cancelled')),
        notes TEXT,
        total_input_cost DECIMAL(15,2) DEFAULT 0,
        total_output_qty DECIMAL(15,2) DEFAULT 0,
        output_unit_cost DECIMAL(15,2) DEFAULT 0,
        created_by UUID REFERENCES users(id),
        completed_by UUID REFERENCES users(id),
        completed_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS production_order_inputs (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        po_id UUID REFERENCES production_orders(id) ON DELETE CASCADE,
        product_id UUID REFERENCES products(id),
        uom VARCHAR(20) DEFAULT 'pcs',
        quantity DECIMAL(15,2) NOT NULL DEFAULT 0,
        unit_cost DECIMAL(15,2) NOT NULL DEFAULT 0,
        total_cost DECIMAL(15,2) NOT NULL DEFAULT 0,
        location_id INTEGER
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS production_order_outputs (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        po_id UUID REFERENCES production_orders(id) ON DELETE CASCADE,
        product_id UUID REFERENCES products(id),
        uom VARCHAR(20) DEFAULT 'pcs',
        quantity DECIMAL(15,2) NOT NULL DEFAULT 0,
        unit_cost DECIMAL(15,2) NOT NULL DEFAULT 0,
        total_cost DECIMAL(15,2) NOT NULL DEFAULT 0,
        location_id INTEGER
      )
    `);
    await client.query(`ALTER TABLE production_order_inputs ADD COLUMN IF NOT EXISTS batch_number VARCHAR(100)`);
    await client.query(`ALTER TABLE production_order_inputs ADD COLUMN IF NOT EXISTS expiry_date DATE`);
    await client.query(`ALTER TABLE production_order_outputs ADD COLUMN IF NOT EXISTS batch_number VARCHAR(100)`);
    await client.query(`ALTER TABLE production_order_outputs ADD COLUMN IF NOT EXISTS expiry_date DATE`);

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

    await client.query(`
      CREATE TABLE IF NOT EXISTS sales_return_items (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        return_id UUID REFERENCES sales_returns(id) ON DELETE CASCADE,
        invoice_item_id UUID REFERENCES sales_invoice_items(id),
        product_id UUID REFERENCES products(id),
        location_id INTEGER REFERENCES locations(id),
        quantity DECIMAL(15,4) NOT NULL,
        unit_price DECIMAL(15,4) DEFAULT 0,
        total DECIMAL(15,2) DEFAULT 0,
        cost DECIMAL(15,4) DEFAULT 0
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS purchase_return_items (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        return_id UUID REFERENCES purchase_returns(id) ON DELETE CASCADE,
        product_id UUID REFERENCES products(id),
        location_id INTEGER REFERENCES locations(id),
        batch_id UUID REFERENCES batches(id),
        quantity DECIMAL(15,4) NOT NULL,
        unit_cost DECIMAL(15,4) DEFAULT 0,
        net_unit_cost DECIMAL(15,4) DEFAULT 0,
        total_cost DECIMAL(15,2) DEFAULT 0
      )
    `);

    await client.query(`ALTER TABLE purchase_returns ADD COLUMN IF NOT EXISTS total DECIMAL(15,2) DEFAULT 0`);

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

    // ==================== BANK ACCOUNTS (before collection_receipts FK) ====================
    await client.query(`
      CREATE TABLE IF NOT EXISTS bank_accounts (
        id SERIAL PRIMARY KEY,
        account_code VARCHAR(50) UNIQUE,
        bank_name VARCHAR(255) NOT NULL,
        account_name VARCHAR(255) NOT NULL,
        account_number VARCHAR(100) NOT NULL,
        account_type VARCHAR(50),
        gl_account_code VARCHAR(10),
        pos_payment_method VARCHAR(50),
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
      CREATE TABLE IF NOT EXISTS ap_vouchers (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        apv_number VARCHAR(50) UNIQUE NOT NULL,
        supplier_id INTEGER REFERENCES suppliers(id),
        po_id UUID REFERENCES purchase_orders(id),
        gr_id UUID REFERENCES goods_receipts(id),
        apv_date DATE NOT NULL DEFAULT CURRENT_DATE,
        due_date DATE,
        payment_terms VARCHAR(100),
        supplier_invoice_number VARCHAR(100),
        supplier_invoice_date DATE,
        status VARCHAR(50) DEFAULT 'Draft' CHECK (status IN ('Draft','Posted','Partially Paid','Fully Paid','Cancelled')),
        notes TEXT,
        gross_amount DECIMAL(15,2) DEFAULT 0,
        discount_amount DECIMAL(15,2) DEFAULT 0,
        vatable_amount DECIMAL(15,2) DEFAULT 0,
        vat_amount DECIMAL(15,2) DEFAULT 0,
        total_amount DECIMAL(15,2) DEFAULT 0,
        amount_paid DECIMAL(15,2) DEFAULT 0,
        balance DECIMAL(15,2) DEFAULT 0,
        posted_by UUID REFERENCES users(id),
        posted_at TIMESTAMP,
        created_by UUID REFERENCES users(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS ap_voucher_items (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        apv_id UUID REFERENCES ap_vouchers(id) ON DELETE CASCADE,
        product_id UUID REFERENCES products(id),
        gr_id UUID REFERENCES goods_receipts(id),
        description TEXT,
        qty DECIMAL(15,2) DEFAULT 1,
        uom VARCHAR(20) DEFAULT 'pcs',
        unit_cost DECIMAL(15,2) DEFAULT 0,
        discount_amount DECIMAL(15,2) DEFAULT 0,
        net_amount DECIMAL(15,2) DEFAULT 0,
        vat_amount DECIMAL(15,2) DEFAULT 0
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS payment_vouchers (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        voucher_number VARCHAR(50) UNIQUE NOT NULL,
        supplier_id INTEGER REFERENCES suppliers(id),
        po_id UUID REFERENCES purchase_orders(id),
        apv_id UUID REFERENCES ap_vouchers(id),
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

    await client.query(`ALTER TABLE payment_vouchers ADD COLUMN IF NOT EXISTS apv_id UUID REFERENCES ap_vouchers(id)`);
    await client.query(`ALTER TABLE payment_vouchers ADD COLUMN IF NOT EXISTS bank_account_id INTEGER`);
    await client.query(`ALTER TABLE payment_vouchers ADD COLUMN IF NOT EXISTS check_date DATE`);
    await client.query(`ALTER TABLE payment_vouchers ADD COLUMN IF NOT EXISTS check_bank VARCHAR(100)`);

    // ==================== SYSTEM SETTINGS ====================
    await client.query(`
      CREATE TABLE IF NOT EXISTS business_details (
        id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
        business_name VARCHAR(255) NOT NULL DEFAULT 'D METRAN TRADING',
        trade_name VARCHAR(255),
        address TEXT NOT NULL DEFAULT '123 Main Street, Cagayan de Oro City',
        barangay VARCHAR(100),
        city VARCHAR(100) DEFAULT 'Cagayan de Oro City',
        province VARCHAR(100) DEFAULT 'Misamis Oriental',
        zip_code VARCHAR(10),
        mobile_number VARCHAR(20),
        telephone_number VARCHAR(20),
        email_address VARCHAR(100),
        website VARCHAR(100),
        tin_number VARCHAR(50) DEFAULT '123-456-789-000',
        vat_type VARCHAR(50) DEFAULT 'VAT Registered' CHECK (vat_type IN ('VAT Registered', 'Non-VAT', 'Zero Rated')),
        vat_rate DECIMAL(5,2) DEFAULT 12,
        prepared_by VARCHAR(100),
        prepared_by_position VARCHAR(100),
        approved_by VARCHAR(100) DEFAULT 'M. METRAN',
        approved_by_position VARCHAR(100) DEFAULT 'Proprietor',
        currency VARCHAR(20) DEFAULT 'PHP',
        date_format VARCHAR(20) DEFAULT 'MM/DD/YYYY',
        logo_url TEXT,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Insert default row if not exists
    await client.query(`INSERT INTO business_details (id) VALUES (1) ON CONFLICT (id) DO NOTHING`);

    await client.query(`ALTER TABLE business_details ADD COLUMN IF NOT EXISTS printer_name VARCHAR(100) DEFAULT 'PT-210'`);
    await client.query(`ALTER TABLE business_details ADD COLUMN IF NOT EXISTS printer_type VARCHAR(50) DEFAULT 'Bluetooth'`);
    await client.query(`ALTER TABLE business_details ADD COLUMN IF NOT EXISTS paper_size INTEGER DEFAULT 58`);
    await client.query(`ALTER TABLE business_details ADD COLUMN IF NOT EXISTS auto_print BOOLEAN DEFAULT false`);
    await client.query(`ALTER TABLE business_details ADD COLUMN IF NOT EXISTS printer_port VARCHAR(20)`);

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
    await client.query(`ALTER TABLE cash_transactions ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'Posted'`);

    // bank_accounts + bank_transactions created before ACCOUNTS RECEIVABLE

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
    await client.query(`ALTER TABLE expense_categories ADD COLUMN IF NOT EXISTS account_code VARCHAR(10) DEFAULT '6080'`);

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
      CREATE TABLE IF NOT EXISTS attendance (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        employee_id INTEGER REFERENCES employees(id),
        date DATE NOT NULL DEFAULT CURRENT_DATE,
        time_in TIMESTAMP,
        time_out TIMESTAMP,
        status VARCHAR(50) DEFAULT 'Present' CHECK (status IN ('Present', 'Absent', 'Late', 'Half-day', 'Leave', 'Rest Day')),
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await client.query(`ALTER TABLE attendance DROP CONSTRAINT IF EXISTS attendance_employee_date_unique`);
    await client.query(`ALTER TABLE attendance ADD CONSTRAINT attendance_employee_date_unique UNIQUE (employee_id, date)`);

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
        payment_voucher_number VARCHAR(50),
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
        employee_amount DECIMAL(15,2) DEFAULT 0,
        total_amount DECIMAL(15,2) DEFAULT 0,
        status VARCHAR(50) DEFAULT 'Draft' CHECK (status IN ('Draft', 'Posted', 'Paid', 'Cancelled')),
        payment_date DATE,
        notes TEXT,
        created_by UUID REFERENCES users(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Add employee_amount to existing sss_contributions
    await client.query(`ALTER TABLE sss_contributions ADD COLUMN IF NOT EXISTS employee_amount DECIMAL(15,2) DEFAULT 0`);

    // Add payment_voucher_number to existing payroll
    await client.query(`ALTER TABLE payroll ADD COLUMN IF NOT EXISTS payment_voucher_number VARCHAR(50)`);

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
    await client.query(`ALTER TABLE collection_receipts ADD COLUMN IF NOT EXISTS check_date DATE`);
    await client.query(`ALTER TABLE collection_receipts ADD COLUMN IF NOT EXISTS check_bank VARCHAR(100)`);
    await client.query(`ALTER TABLE collection_receipts ADD COLUMN IF NOT EXISTS deposited BOOLEAN DEFAULT false`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS collection_receipt_allocations (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        receipt_id UUID REFERENCES collection_receipts(id) ON DELETE CASCADE,
        invoice_id UUID REFERENCES sales_invoices(id),
        applied_amount DECIMAL(15,2) NOT NULL,
        ewt_amount DECIMAL(15,2) DEFAULT 0,
        lgu_amount DECIMAL(15,2) DEFAULT 0
      )
    `);
    // Backfill allocation rows for legacy single-invoice receipts (EWT/LGU from posted journal entries)
    await client.query(`
      INSERT INTO collection_receipt_allocations (id, receipt_id, invoice_id, applied_amount, ewt_amount, lgu_amount)
      SELECT uuid_generate_v4(), cr.id, cr.invoice_id, cr.amount,
        COALESCE((
          SELECT SUM(jel.debit)
          FROM journal_entries je
          JOIN journal_entry_lines jel ON jel.entry_id = je.id
          JOIN chart_of_accounts coa ON coa.id = jel.account_id
          WHERE je.reference_type = 'Collection' AND je.reference_id = cr.id AND coa.account_code = '1105'
        ), 0),
        COALESCE((
          SELECT SUM(jel.debit)
          FROM journal_entries je
          JOIN journal_entry_lines jel ON jel.entry_id = je.id
          JOIN chart_of_accounts coa ON coa.id = jel.account_id
          WHERE je.reference_type = 'Collection' AND je.reference_id = cr.id AND coa.account_code = '2110'
        ), 0)
      FROM collection_receipts cr
      WHERE cr.invoice_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM collection_receipt_allocations x WHERE x.receipt_id = cr.id)
    `);
    await client.query(`ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS discount_type VARCHAR(10) DEFAULT '%'`);
    await client.query(`ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS discount_value DECIMAL(15,2) DEFAULT 0`);
    await client.query(`ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS discount_amount DECIMAL(15,2) DEFAULT 0`);
    await client.query(`ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS net_unit_cost DECIMAL(15,2) DEFAULT 0`);
    await client.query(`ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS net_total DECIMAL(15,2) DEFAULT 0`);
    await client.query(`ALTER TABLE purchase_requisition_items ADD COLUMN IF NOT EXISTS tax_type VARCHAR(50) DEFAULT 'VAT'`);
    await client.query(`ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS tax_type VARCHAR(50) DEFAULT 'VAT'`);
    await client.query(`ALTER TABLE ap_voucher_items ADD COLUMN IF NOT EXISTS tax_type VARCHAR(50) DEFAULT 'VAT'`);
    await client.query(`ALTER TABLE goods_receipt_items ADD COLUMN IF NOT EXISTS discount_amount DECIMAL(15,2) DEFAULT 0`);
    await client.query(`ALTER TABLE goods_receipt_items ADD COLUMN IF NOT EXISTS net_unit_cost DECIMAL(15,2) NOT NULL DEFAULT 0`);
    await client.query(`ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS default_discount_percent DECIMAL(5,2) DEFAULT 0`);

    // HR / Payroll additions for existing databases
    await client.query(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS hire_date DATE`);
    await client.query(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS cash_advance_balance DECIMAL(15,2) DEFAULT 0`);
    await client.query(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS grocery_credit_balance DECIMAL(15,2) DEFAULT 0`);
    await client.query(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS credit_limit DECIMAL(15,2) DEFAULT 0`);
    await client.query(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS sss_default_amount DECIMAL(15,2) DEFAULT 0`);
    await client.query(`ALTER TABLE roles ADD COLUMN IF NOT EXISTS approval_limit DECIMAL(15,2) DEFAULT 0`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS location_id INTEGER REFERENCES locations(id)`);
    await client.query(`ALTER TABLE payroll ADD COLUMN IF NOT EXISTS cash_advance_deduction DECIMAL(15,2) DEFAULT 0`);
    await client.query(`ALTER TABLE payroll ADD COLUMN IF NOT EXISTS grocery_credit_deduction DECIMAL(15,2) DEFAULT 0`);
    await client.query(`ALTER TABLE payroll ADD COLUMN IF NOT EXISTS other_deductions DECIMAL(15,2) DEFAULT 0`);
    await client.query(`ALTER TABLE payroll ADD COLUMN IF NOT EXISTS payment_account_type VARCHAR(50)`);
    await client.query(`ALTER TABLE payroll ADD COLUMN IF NOT EXISTS payment_account_id INTEGER`);
    await client.query(`ALTER TABLE payroll ADD COLUMN IF NOT EXISTS payment_ref VARCHAR(100)`);
    await client.query(`ALTER TABLE cash_advances ADD COLUMN IF NOT EXISTS payment_account_type VARCHAR(50)`);
    await client.query(`ALTER TABLE cash_advances ADD COLUMN IF NOT EXISTS payment_account_id INTEGER`);
    await client.query(`ALTER TABLE cash_advances ADD COLUMN IF NOT EXISTS installment_amount DECIMAL(15,2) DEFAULT 0`);
    await client.query(`ALTER TABLE cash_advances ADD COLUMN IF NOT EXISTS installment_count INTEGER DEFAULT 0`);
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
    await client.query(`ALTER TABLE bank_accounts ADD COLUMN IF NOT EXISTS gl_account_code VARCHAR(10)`);
    await client.query(`ALTER TABLE bank_accounts ADD COLUMN IF NOT EXISTS pos_payment_method VARCHAR(50)`);
    await client.query(`ALTER TABLE sales_quotations ADD COLUMN IF NOT EXISTS terms_conditions TEXT`);
    await client.query(`ALTER TABLE sales_quotations ADD COLUMN IF NOT EXISTS payment_terms VARCHAR(100)`);

    await client.query(`ALTER TABLE expenses ADD COLUMN IF NOT EXISTS bank_account_id INTEGER REFERENCES bank_accounts(id)`);
    await client.query(`ALTER TABLE expenses ADD COLUMN IF NOT EXISTS payment_date DATE`);
    await client.query(`
      DO $$
      DECLARE cname text;
      BEGIN
        SELECT conname INTO cname FROM pg_constraint
        WHERE conrelid = 'expenses'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%status%';
        IF cname IS NOT NULL THEN
          EXECUTE 'ALTER TABLE expenses DROP CONSTRAINT ' || quote_ident(cname);
        END IF;
        ALTER TABLE expenses ADD CONSTRAINT expenses_status_check
          CHECK (status IN ('Draft', 'Posted', 'Void', 'Cancelled'));
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `);

    // Reconcile journal entry header totals with actual line sums (e.g. SI from DR with skip_inventory)
    await client.query(`
      UPDATE journal_entries je
      SET total_debit = agg.line_total, total_credit = agg.line_total
      FROM (
        SELECT entry_id, ROUND(SUM(debit)::numeric, 2) AS line_total
        FROM journal_entry_lines
        GROUP BY entry_id
      ) agg
      WHERE je.id = agg.entry_id
        AND je.total_debit IS DISTINCT FROM agg.line_total
    `);

    // Ensure unique GL account codes for e-wallet / payment accounts
    const ewalletCoas: [string, string, string][] = [
      ['1011', 'GCash E-Wallet', 'Asset'],
      ['1012', 'Maya E-Wallet', 'Asset'],
      ['1013', 'Credit Card Settlement', 'Asset'],
      ['1014', 'Bank Transfer Settlement', 'Asset'],
    ];
    for (const [code, name, type] of ewalletCoas) {
      await client.query(
        'INSERT INTO chart_of_accounts (account_code, account_name, account_type) VALUES ($1,$2,$3) ON CONFLICT (account_code) DO NOTHING',
        [code, name, type]
      );
    }
    await client.query(`UPDATE bank_accounts SET gl_account_code = '1011' WHERE pos_payment_method = 'GCash' AND (gl_account_code IS NULL OR gl_account_code = '1010')`);
    await client.query(`UPDATE bank_accounts SET gl_account_code = '1012' WHERE pos_payment_method = 'Maya' AND (gl_account_code IS NULL OR gl_account_code = '1010')`);
    await client.query(`UPDATE bank_accounts SET gl_account_code = '1013' WHERE pos_payment_method = 'Credit Card' AND (gl_account_code IS NULL OR gl_account_code = '1010')`);
    await client.query(`UPDATE bank_accounts SET gl_account_code = '1014' WHERE pos_payment_method = 'Bank Transfer' AND (gl_account_code IS NULL OR gl_account_code = '1010')`);

    await client.query(
      "INSERT INTO chart_of_accounts (account_code, account_name, account_type) VALUES ('1015','Checks on Hand / Undeposited','Asset') ON CONFLICT (account_code) DO NOTHING"
    );
    await client.query(
      "INSERT INTO chart_of_accounts (account_code, account_name, account_type) VALUES ('1016','Petty Cash Fund','Asset') ON CONFLICT (account_code) DO NOTHING"
    );
    // Petty cash expense categories
    const pcvCategories: [string, string][] = [
      ['6083','Meals & Snacks Expense'], ['6084','Janitorial & Cleaning Expense'],
      ['6086','Representation Expense'], ['6088','Postage & Courier Expense'],
    ];
    for (const [code, name] of pcvCategories) {
      await client.query(
        "INSERT INTO chart_of_accounts (account_code, account_name, account_type) VALUES ($1,$2,'Expense') ON CONFLICT (account_code) DO NOTHING",
        [code, name]
      );
    }
    await client.query(
      `INSERT INTO bank_accounts (bank_name, account_name, account_number, account_type, gl_account_code, balance, is_active)
       SELECT 'Checks on Hand', 'Undeposited Checks', 'N/A', 'Checks on Hand', '1015', 0, true
       WHERE NOT EXISTS (SELECT 1 FROM bank_accounts WHERE account_type = 'Checks on Hand')`
    );
    await client.query(
      "INSERT INTO chart_of_accounts (account_code, account_name, account_type) VALUES ('1106','Input VAT','Asset') ON CONFLICT (account_code) DO NOTHING"
    );
    await client.query(`ALTER TABLE bank_accounts ADD COLUMN IF NOT EXISTS starting_balance DECIMAL(15,2) DEFAULT 0`);
    await client.query(`ALTER TABLE bank_accounts ADD COLUMN IF NOT EXISTS starting_balance_ref_id UUID`);
    await client.query(`ALTER TABLE bank_accounts ADD COLUMN IF NOT EXISTS starting_balance_set_at TIMESTAMP`);

    // ==================== SUPPLIER PRICE HISTORY ====================
    await client.query(`
      CREATE TABLE IF NOT EXISTS supplier_price_history (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
        product_name VARCHAR(255) NOT NULL,
        supplier_name VARCHAR(255) NOT NULL,
        po_id UUID REFERENCES purchase_orders(id),
        po_number VARCHAR(50),
        gr_id UUID REFERENCES goods_receipts(id),
        gr_number VARCHAR(50),
        gr_item_id UUID,
        received_date DATE NOT NULL DEFAULT CURRENT_DATE,
        unit_cost DECIMAL(15,2) NOT NULL,
        previous_cost DECIMAL(15,2) DEFAULT 0,
        price_difference DECIMAL(15,2) DEFAULT 0,
        quantity_received DECIMAL(15,2) DEFAULT 0,
        uom VARCHAR(50) DEFAULT 'pc',
        location_id INTEGER REFERENCES locations(id),
        location_name VARCHAR(255),
        batch_number VARCHAR(100),
        expiry_date DATE,
        remarks TEXT,
        created_by UUID REFERENCES users(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(product_id, supplier_id, gr_id, gr_item_id)
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_sph_product ON supplier_price_history(product_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_sph_supplier ON supplier_price_history(supplier_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_sph_product_supplier ON supplier_price_history(product_id, supplier_id)`);

    // Setting: auto-update product cost from receiving report
    await client.query(`
      INSERT INTO system_settings (setting_key, setting_value)
      VALUES ('auto_update_cost_from_rr', 'false')
      ON CONFLICT (setting_key) DO NOTHING
    `);

    await client.query(`
      INSERT INTO system_settings (setting_key, setting_value)
      VALUES ('auto_reprice_on_gr', 'false')
      ON CONFLICT (setting_key) DO NOTHING
    `);

    await client.query(`
      INSERT INTO system_settings (setting_key, setting_value)
      VALUES ('invoice_copy_mode', 'delivered')
      ON CONFLICT (setting_key) DO NOTHING
    `);

    // ==================== PETTY CASH VOUCHERS ====================
    await client.query(`
      CREATE TABLE IF NOT EXISTS petty_cash_vouchers (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        pcv_number VARCHAR(50) UNIQUE NOT NULL,
        voucher_date DATE NOT NULL DEFAULT CURRENT_DATE,
        payee VARCHAR(255) NOT NULL,
        amount DECIMAL(15,2) NOT NULL,
        category VARCHAR(100),
        description TEXT,
        status VARCHAR(50) DEFAULT 'Unreplenished' CHECK (status IN ('Unreplenished', 'Replenished', 'Cancelled')),
        replenished_at TIMESTAMP,
        replenished_by UUID REFERENCES users(id),
        created_by UUID REFERENCES users(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await client.query(
      `INSERT INTO bank_accounts (bank_name, account_name, account_number, account_type, gl_account_code, balance, is_active)
       SELECT 'Petty Cash Fund', 'Office Petty Cash', 'PCF-001', 'Petty Cash Fund', '1016', 0, true
       WHERE NOT EXISTS (SELECT 1 FROM bank_accounts WHERE account_type = 'Petty Cash Fund')`
    );

    // ==================== USER PERMISSIONS ====================
    await client.query(`
      CREATE TABLE IF NOT EXISTS user_permissions (
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        permission_key VARCHAR(100) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, permission_key)
      )
    `);

    await client.query('COMMIT');
    console.log('Migration completed — applying structural changes...');

    await client.query(`ALTER TABLE bank_accounts ADD COLUMN IF NOT EXISTS starting_balance DECIMAL(15,2) DEFAULT 0`);
    await client.query(`ALTER TABLE bank_accounts ADD COLUMN IF NOT EXISTS starting_balance_ref_id UUID`);
    await client.query(`ALTER TABLE bank_accounts ADD COLUMN IF NOT EXISTS starting_balance_set_at TIMESTAMP`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS supplier_catalog_items (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        supplier_id INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
        product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        order_qty_multiplier DECIMAL(5,2) DEFAULT 2,
        fixed_order_qty DECIMAL(15,2),
        sort_order INTEGER DEFAULT 0,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(supplier_id, product_id)
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_supplier_catalog_supplier ON supplier_catalog_items(supplier_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_supplier_catalog_product ON supplier_catalog_items(product_id)`);

    // ==================== SALES ORDER ITEMS ====================
    await client.query(`
      CREATE TABLE IF NOT EXISTS sales_order_items (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        order_id UUID REFERENCES sales_orders(id) ON DELETE CASCADE,
        product_id UUID REFERENCES products(id),
        variant_id UUID REFERENCES product_variants(id),
        description TEXT,
        ordered_qty DECIMAL(15,2) NOT NULL DEFAULT 0,
        delivered_qty DECIMAL(15,2) DEFAULT 0,
        reserved_qty DECIMAL(15,2) DEFAULT 0,
        unit_price DECIMAL(15,2) NOT NULL DEFAULT 0,
        discount DECIMAL(15,2) DEFAULT 0,
        tax_type VARCHAR(50) DEFAULT 'VAT',
        vat_amount DECIMAL(15,2) DEFAULT 0,
        total DECIMAL(15,2) NOT NULL DEFAULT 0
      )
    `);

    // ==================== DELIVERY NOTE ITEMS ====================
    await client.query(`
      CREATE TABLE IF NOT EXISTS delivery_note_items (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        note_id UUID REFERENCES delivery_notes(id) ON DELETE CASCADE,
        order_item_id UUID REFERENCES sales_order_items(id),
        product_id UUID REFERENCES products(id),
        description TEXT,
        quantity DECIMAL(15,2) NOT NULL DEFAULT 0,
        unit_price DECIMAL(15,2) DEFAULT 0,
        total DECIMAL(15,2) DEFAULT 0
      )
    `);

    // ==================== ALTER sales_orders ====================
    await client.query(`ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS total_ordered_qty DECIMAL(15,2) DEFAULT 0`);
    await client.query(`ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS total_delivered_qty DECIMAL(15,2) DEFAULT 0`);
    await client.query(`ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS total_remaining_qty DECIMAL(15,2) DEFAULT 0`);
    await client.query(`ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS total_reserved_qty DECIMAL(15,2) DEFAULT 0`);
    await client.query(`ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS terms_conditions TEXT`);
    // terms_conditions on all sales & purchase document headers
    const termsTables = [
      'delivery_notes',
      'sales_invoices',
      'sales_returns',
      'collection_receipts',
      'purchase_requisitions',
      'purchase_orders',
      'goods_receipts',
      'purchase_returns',
      'ap_vouchers',
      'payment_vouchers',
    ];
    for (const tbl of termsTables) {
      await client.query(`ALTER TABLE ${tbl} ADD COLUMN IF NOT EXISTS terms_conditions TEXT`);
    }
    // Update status CHECK to include new statuses
    await client.query(`ALTER TABLE sales_orders DROP CONSTRAINT IF EXISTS sales_orders_status_check`);
    await client.query(`ALTER TABLE sales_orders ADD CONSTRAINT sales_orders_status_check CHECK (status IN ('Draft','Confirmed','Open','Partially Delivered','Fully Delivered','Invoiced','Closed','Cancelled'))`);

    // ==================== ALTER delivery_notes ====================
    await client.query(`ALTER TABLE delivery_notes ADD COLUMN IF NOT EXISTS dr_number VARCHAR(50) UNIQUE`);
    await client.query(`ALTER TABLE delivery_notes ADD COLUMN IF NOT EXISTS total_qty DECIMAL(15,2) DEFAULT 0`);
    await client.query(`ALTER TABLE delivery_notes ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP`);
    await client.query(`ALTER TABLE delivery_notes DROP CONSTRAINT IF EXISTS delivery_notes_status_check`);
    await client.query(`ALTER TABLE delivery_notes ADD CONSTRAINT delivery_notes_status_check CHECK (status IN ('Draft','Posted','Cancelled'))`);

    // ==================== SALES QUOTATION ITEMS ====================
    await client.query(`
      CREATE TABLE IF NOT EXISTS sales_quotation_items (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        quotation_id UUID REFERENCES sales_quotations(id) ON DELETE CASCADE,
        product_id UUID REFERENCES products(id),
        variant_id UUID REFERENCES product_variants(id),
        description TEXT,
        quantity DECIMAL(15,2) NOT NULL DEFAULT 0,
        unit_price DECIMAL(15,2) NOT NULL DEFAULT 0,
        discount DECIMAL(15,2) DEFAULT 0,
        tax_type VARCHAR(50) DEFAULT 'VAT',
        vat_amount DECIMAL(15,2) DEFAULT 0,
        total DECIMAL(15,2) NOT NULL DEFAULT 0
      )
    `);

    console.log('Structural changes applied');

    // ==================== PHASE 1: Employee returns, reconciliation, signatures, period lock ====================
    await client.query(`ALTER TABLE sales_returns ADD COLUMN IF NOT EXISTS employee_id INTEGER REFERENCES employees(id)`);
    await client.query(`ALTER TABLE bank_transactions ADD COLUMN IF NOT EXISTS is_cleared BOOLEAN DEFAULT false`);
    await client.query(`ALTER TABLE bank_transactions ADD COLUMN IF NOT EXISTS cleared_at TIMESTAMP`);
    await client.query(`ALTER TABLE bank_transactions ADD COLUMN IF NOT EXISTS cleared_by UUID REFERENCES users(id)`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS signature_url VARCHAR(500)`);
    await client.query(`ALTER TABLE business_details ADD COLUMN IF NOT EXISTS prepared_by_signature_url VARCHAR(500)`);
    await client.query(`ALTER TABLE business_details ADD COLUMN IF NOT EXISTS approved_by_signature_url VARCHAR(500)`);
    await client.query(`
      INSERT INTO system_settings (setting_key, setting_value)
      VALUES ('accounting_lock_date', '')
      ON CONFLICT (setting_key) DO NOTHING
    `);

    // ==================== PHASE 2: Memos, BOM, customer prices, BIR 2307 ====================
    await client.query(`
      CREATE TABLE IF NOT EXISTS sales_memos (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        memo_number VARCHAR(50) UNIQUE NOT NULL,
        memo_type VARCHAR(10) NOT NULL CHECK (memo_type IN ('Credit', 'Debit')),
        customer_id INTEGER REFERENCES customers(id),
        invoice_id UUID REFERENCES sales_invoices(id),
        memo_date DATE NOT NULL DEFAULT CURRENT_DATE,
        amount DECIMAL(15,2) NOT NULL CHECK (amount > 0),
        reason TEXT,
        notes TEXT,
        status VARCHAR(20) DEFAULT 'Posted',
        created_by UUID REFERENCES users(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS purchase_memos (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        memo_number VARCHAR(50) UNIQUE NOT NULL,
        memo_type VARCHAR(10) NOT NULL CHECK (memo_type IN ('Credit', 'Debit')),
        supplier_id INTEGER REFERENCES suppliers(id),
        apv_id UUID,
        memo_date DATE NOT NULL DEFAULT CURRENT_DATE,
        amount DECIMAL(15,2) NOT NULL CHECK (amount > 0),
        reason TEXT,
        notes TEXT,
        status VARCHAR(20) DEFAULT 'Posted',
        created_by UUID REFERENCES users(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS production_boms (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        bom_code VARCHAR(50) UNIQUE NOT NULL,
        name VARCHAR(255) NOT NULL,
        output_product_id UUID REFERENCES products(id),
        output_qty DECIMAL(15,4) NOT NULL DEFAULT 1,
        notes TEXT,
        is_active BOOLEAN DEFAULT true,
        created_by UUID REFERENCES users(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS production_bom_lines (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        bom_id UUID REFERENCES production_boms(id) ON DELETE CASCADE,
        line_type VARCHAR(10) NOT NULL CHECK (line_type IN ('Input', 'Output')),
        product_id UUID REFERENCES products(id),
        quantity DECIMAL(15,4) NOT NULL DEFAULT 1,
        uom VARCHAR(50)
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS customer_product_prices (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
        product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        unit_price DECIMAL(15,4) NOT NULL,
        effective_from DATE,
        effective_to DATE,
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(customer_id, product_id)
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS bir_2307_certificates (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        certificate_number VARCHAR(50) UNIQUE NOT NULL,
        supplier_id INTEGER REFERENCES suppliers(id),
        payee_name VARCHAR(255) NOT NULL,
        payee_tin VARCHAR(50),
        period_from DATE NOT NULL,
        period_to DATE NOT NULL,
        income_payment DECIMAL(15,2) NOT NULL DEFAULT 0,
        tax_withheld DECIMAL(15,2) NOT NULL DEFAULT 0,
        atc_code VARCHAR(20),
        payment_voucher_id UUID,
        apv_id UUID,
        notes TEXT,
        created_by UUID REFERENCES users(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS payroll_deduction_allocations (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        payroll_id UUID NOT NULL REFERENCES payroll(id) ON DELETE CASCADE,
        allocation_type VARCHAR(50) NOT NULL CHECK (allocation_type IN ('Cash Advance', 'Grocery Credit')),
        cash_advance_id UUID REFERENCES cash_advances(id),
        sales_invoice_id UUID REFERENCES sales_invoices(id),
        amount DECIMAL(15,2) NOT NULL CHECK (amount > 0),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        CHECK (
          (allocation_type = 'Cash Advance' AND cash_advance_id IS NOT NULL AND sales_invoice_id IS NULL)
          OR (allocation_type = 'Grocery Credit' AND sales_invoice_id IS NOT NULL AND cash_advance_id IS NULL)
        )
      )
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_payroll_deduction_alloc_payroll
      ON payroll_deduction_allocations (payroll_id)
    `);

    await client.query(`
      INSERT INTO user_permissions (user_id, permission_key)
      SELECT user_id, REPLACE(permission_key, 'purchases.dv.', 'purchases.payment-voucher.')
      FROM user_permissions
      WHERE permission_key LIKE 'purchases.dv.%'
      ON CONFLICT (user_id, permission_key) DO NOTHING
    `);

    await client.query(`
      INSERT INTO user_permissions (user_id, permission_key)
      SELECT user_id, REPLACE(permission_key, 'hr.payslip.', 'hr.payroll.')
      FROM user_permissions
      WHERE permission_key LIKE 'hr.payslip.%'
      ON CONFLICT (user_id, permission_key) DO NOTHING
    `);

    await client.query(`
      INSERT INTO user_permissions (user_id, permission_key)
      SELECT DISTINCT user_id, 'hr.employees.export'
      FROM user_permissions
      WHERE permission_key IN ('hr.employees.create', 'hr.employees.edit')
      ON CONFLICT (user_id, permission_key) DO NOTHING
    `);
    await client.query(`
      INSERT INTO user_permissions (user_id, permission_key)
      SELECT DISTINCT user_id, 'hr.employees.import'
      FROM user_permissions
      WHERE permission_key IN ('hr.employees.create', 'hr.employees.edit')
      ON CONFLICT (user_id, permission_key) DO NOTHING
    `);

    const expenseCategorySeeds: [string, string][] = [
      ['6110', 'Christmas Bonus'],
      ['6111', 'Purchaser Commissions'],
      ['6112', 'Store/Office Equipment'],
      ['6113', 'Subscription Expense'],
      ['6114', 'Tax, Permits & Licenses'],
      ['6115', 'Advertising and Marketing Expense'],
      ['6116', 'Bank Charges'],
      ['6117', 'Donations'],
      ['6118', 'General and Administrative Expense'],
      ['6119', 'Internet Fee'],
      ['6120', 'Legal Fees'],
      ['6121', 'Motor Vehicle Expense'],
      ['6122', 'Food Allowance Expense'],
      ['6010', 'Fuel Expense'],
      ['6030', 'Pantry Supply Expense'],
    ];
    // Category GL account mapping (Sales Revenue + COGS per product category)
    await client.query(`ALTER TABLE categories ADD COLUMN IF NOT EXISTS revenue_account_code VARCHAR(10) DEFAULT '4000'`);
    await client.query(`ALTER TABLE categories ADD COLUMN IF NOT EXISTS cogs_account_code VARCHAR(10) DEFAULT '5000'`);

    await ensureCategoryGlAccounts(client);

    // ==================== PHASE 2 OPERATIONS: FEFO dispatch, customer price mode ====================
    await client.query(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS default_price_mode VARCHAR(50)`);
    await client.query(`ALTER TABLE delivery_notes ADD COLUMN IF NOT EXISTS driver_name VARCHAR(255)`);
    await client.query(`ALTER TABLE delivery_notes ADD COLUMN IF NOT EXISTS vehicle_plate VARCHAR(50)`);
    await client.query(`ALTER TABLE delivery_notes ADD COLUMN IF NOT EXISTS dispatch_notes TEXT`);

    // ==================== LOANS PAYABLE (borrowed from bank / lender) ====================
    await client.query(`
      INSERT INTO chart_of_accounts (account_code, account_name, account_type)
      VALUES ('6130', 'Interest Expense', 'Expense')
      ON CONFLICT (account_code) DO NOTHING
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS loans_payable (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        loan_number VARCHAR(50) UNIQUE NOT NULL,
        lender_name VARCHAR(255) NOT NULL,
        lender_type VARCHAR(50) DEFAULT 'Bank' CHECK (lender_type IN ('Bank', 'Individual', 'Other')),
        loan_date DATE NOT NULL DEFAULT CURRENT_DATE,
        maturity_date DATE,
        principal_amount DECIMAL(15,2) NOT NULL,
        outstanding_principal DECIMAL(15,2) NOT NULL DEFAULT 0,
        accrued_interest_balance DECIMAL(15,2) NOT NULL DEFAULT 0,
        interest_rate_monthly DECIMAL(8,4) NOT NULL DEFAULT 0,
        last_interest_accrual_date DATE,
        status VARCHAR(50) DEFAULT 'Active' CHECK (status IN ('Active', 'Paid Off', 'Cancelled')),
        deposit_account_type VARCHAR(50) DEFAULT 'bank' CHECK (deposit_account_type IN ('cash', 'bank')),
        deposit_bank_account_id INTEGER REFERENCES bank_accounts(id),
        notes TEXT,
        created_by UUID REFERENCES users(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS loan_payable_transactions (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        loan_id UUID NOT NULL REFERENCES loans_payable(id) ON DELETE CASCADE,
        txn_type VARCHAR(50) NOT NULL CHECK (txn_type IN ('Disbursement', 'Interest Accrual', 'Payment')),
        txn_date DATE NOT NULL DEFAULT CURRENT_DATE,
        amount DECIMAL(15,2) NOT NULL,
        principal_component DECIMAL(15,2) NOT NULL DEFAULT 0,
        interest_component DECIMAL(15,2) NOT NULL DEFAULT 0,
        payment_account_type VARCHAR(50),
        payment_bank_account_id INTEGER REFERENCES bank_accounts(id),
        notes TEXT,
        created_by UUID REFERENCES users(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await client.query(`
      INSERT INTO user_permissions (user_id, permission_key)
      SELECT DISTINCT user_id, 'finance.loans.view'
      FROM user_permissions
      WHERE permission_key IN ('finance.bank-cash.view', 'finance.expenses.view', 'finance.accounting.view')
      ON CONFLICT (user_id, permission_key) DO NOTHING
    `);
    await client.query(`
      INSERT INTO user_permissions (user_id, permission_key)
      SELECT DISTINCT user_id, 'finance.loans.create'
      FROM user_permissions
      WHERE permission_key IN ('finance.bank-cash.create', 'finance.expenses.create')
      ON CONFLICT (user_id, permission_key) DO NOTHING
    `);
    await client.query(`
      INSERT INTO user_permissions (user_id, permission_key)
      SELECT DISTINCT user_id, 'finance.loans.edit'
      FROM user_permissions
      WHERE permission_key IN ('finance.bank-cash.edit', 'finance.expenses.edit')
      ON CONFLICT (user_id, permission_key) DO NOTHING
    `);

    // ==================== SAVED PROFIT & LOSS REPORT CONFIGS ====================
    await client.query(`
      CREATE TABLE IF NOT EXISTS profit_loss_report_configs (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        title VARCHAR(255) NOT NULL DEFAULT 'Profit and Loss Statement',
        description TEXT,
        basis VARCHAR(20) NOT NULL DEFAULT 'accrual' CHECK (basis IN ('accrual', 'cash')),
        columns_json JSONB NOT NULL DEFAULT '[]',
        options_json JSONB NOT NULL DEFAULT '{}',
        created_by UUID REFERENCES users(id),
        updated_by UUID REFERENCES users(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // ==================== PHASE 3: Compliance & scale ====================
    await client.query(`
      INSERT INTO system_settings (setting_key, setting_value)
      VALUES ('enforce_approval_limits', 'true')
      ON CONFLICT (setting_key) DO NOTHING
    `);

    for (const [code, name] of expenseCategorySeeds) {
      await client.query(
        `INSERT INTO chart_of_accounts (account_code, account_name, account_type)
         VALUES ($1, $2, 'Expense') ON CONFLICT (account_code) DO NOTHING`,
        [code, name]
      );
      const exists = await client.query('SELECT id FROM expense_categories WHERE name = $1', [name]);
      if (exists.rows.length === 0) {
        await client.query(
          'INSERT INTO expense_categories (name, account_code) VALUES ($1, $2)',
          [name, code]
        );
      } else {
        await client.query(
          'UPDATE expense_categories SET account_code = $1 WHERE name = $2',
          [code, name]
        );
      }
    }
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
