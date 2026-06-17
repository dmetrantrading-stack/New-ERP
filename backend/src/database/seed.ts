import { query, getClient } from '../config/database';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';

const seed = async () => {
  const client = await getClient();
  try {
    await client.query('BEGIN');

    // Seed Roles
    const roles = ['Admin', 'Owner', 'Cashier', 'Accountant', 'AR Officer', 'AP Officer', 'Purchaser', 'Warehouse Staff', 'Inventory Manager', 'Auditor', 'Petty Cash Custodian'];
    for (const role of roles) {
      await client.query('INSERT INTO roles (name) VALUES ($1) ON CONFLICT (name) DO NOTHING', [role]);
    }

    // Seed Admin User
    const adminPassword = await bcrypt.hash('admin123', 10);
    const adminId = uuidv4();
    await client.query(
      'INSERT INTO users (id, username, password_hash, email, full_name, role_id) VALUES ($1, $2, $3, $4, $5, (SELECT id FROM roles WHERE name = $6)) ON CONFLICT (username) DO NOTHING',
      [adminId, 'admin', adminPassword, 'admin@dmetran.com', 'System Administrator', 'Admin']
    );

    // Seed Locations
    const locations = [
      { name: 'Main Store', type: 'Store' },
      { name: 'Main Warehouse', type: 'Warehouse' },
    ];
    for (const loc of locations) {
      await client.query('INSERT INTO locations (name, type) VALUES ($1, $2) ON CONFLICT DO NOTHING', [loc.name, loc.type]);
    }

    // Seed Default Chart of Accounts
    const accounts = [
      // Assets
      { code: '1000', name: 'Cash on Hand', type: 'Asset' },
      { code: '1010', name: 'Cash in Bank', type: 'Asset' },
      { code: '1100', name: 'Accounts Receivable', type: 'Asset' },
      { code: '1105', name: 'Withholding Tax Receivable', type: 'Asset' },
      { code: '1110', name: 'Employee Cash Advance Receivable', type: 'Asset' },
      { code: '1120', name: 'Employee Grocery Receivable', type: 'Asset' },
      { code: '1200', name: 'Inventory', type: 'Asset' },
      { code: '1300', name: 'Advances to Supplier', type: 'Asset' },
      { code: '1400', name: 'Fixed Assets', type: 'Asset' },
      // Liabilities
      { code: '2000', name: 'Accounts Payable', type: 'Liability' },
      { code: '2100', name: 'VAT Payable', type: 'Liability' },
      { code: '2110', name: 'LGU Final VAT Payable', type: 'Liability' },
      { code: '2200', name: 'Loans Payable', type: 'Liability' },
      { code: '2300', name: 'Payroll Payable', type: 'Liability' },
      { code: '2310', name: 'SSS Payable', type: 'Liability' },
      // Equity
      { code: '3000', name: "Owner's Capital", type: 'Equity' },
      { code: '3010', name: "Owner's Drawings", type: 'Equity' },
      { code: '3020', name: 'Retained Earnings', type: 'Equity' },
      // Income
      { code: '4000', name: 'Sales Revenue', type: 'Income' },
      { code: '4100', name: 'Service Income', type: 'Income' },
      { code: '4200', name: 'Other Income', type: 'Income' },
      { code: '4500', name: 'Employee Sales', type: 'Income' },
      // Cost of Goods Sold
      { code: '5000', name: 'Cost of Sales', type: 'Cost of Goods Sold' },
      { code: '5010', name: 'Purchase Discounts', type: 'Cost of Goods Sold' },
      { code: '5020', name: 'Inventory Adjustments', type: 'Cost of Goods Sold' },
      // Expenses
      { code: '6000', name: 'Salaries and Wages', type: 'Expense' },
      { code: '6010', name: 'Fuel', type: 'Expense' },
      { code: '6020', name: 'Transportation', type: 'Expense' },
      { code: '6030', name: 'Pantry Supplies', type: 'Expense' },
      { code: '6040', name: 'Utilities', type: 'Expense' },
      { code: '6050', name: 'Rent', type: 'Expense' },
      { code: '6060', name: 'Office Supplies', type: 'Expense' },
      { code: '6070', name: 'Repairs and Maintenance', type: 'Expense' },
      { code: '6080', name: 'Miscellaneous Expense', type: 'Expense' },
      { code: '6090', name: 'SSS Employer Expense', type: 'Expense' },
    ];
    for (const acc of accounts) {
      await client.query(
        'INSERT INTO chart_of_accounts (account_code, account_name, account_type) VALUES ($1, $2, $3) ON CONFLICT (account_code) DO NOTHING',
        [acc.code, acc.name, acc.type]
      );
    }

    // Seed Expense Categories
    const expenseCategories: [string, string][] = [
      ['Salaries', '6000'], ['Utilities', '6040'], ['Repairs', '6070'], ['Miscellaneous', '6080'],
    ];
    for (const [name, accountCode] of expenseCategories) {
      const exists = await client.query('SELECT id FROM expense_categories WHERE name = $1', [name]);
      if (exists.rows.length === 0) {
        await client.query('INSERT INTO expense_categories (name, account_code) VALUES ($1, $2)', [name, accountCode]);
      } else {
        await client.query('UPDATE expense_categories SET account_code = $1 WHERE name = $2', [accountCode, name]);
      }
    }

    // Seed Sample Categories
    const sampleCategories = ['Beverages', 'Canned Goods', 'Rice & Grains', 'Cooking Oil', 'Condiments', 'Snacks', 'Dairy', 'Frozen', 'Personal Care', 'Cleaning'];
    for (const cat of sampleCategories) {
      const exists = await client.query('SELECT id FROM categories WHERE name = $1', [cat]);
      if (exists.rows.length === 0) {
        await client.query('INSERT INTO categories (name) VALUES ($1)', [cat]);
      }
    }

    // Seed System Settings
    const settings = [
      { key: 'company_name', value: 'D METRAN TRADING' },
      { key: 'company_address', value: 'Philippines' },
      { key: 'company_tin', value: '000-000-000-000' },
      { key: 'receipt_footer', value: 'Thank you for your patronage!' },
      { key: 'pos_default_mode', value: 'Retail' },
      { key: 'enable_negative_inventory', value: 'false' },
    ];
    for (const s of settings) {
      await client.query(
        'INSERT INTO system_settings (setting_key, setting_value) VALUES ($1, $2) ON CONFLICT (setting_key) DO UPDATE SET setting_value = $2',
        [s.key, s.value]
      );
    }

    await client.query('COMMIT');
    console.log('Seed completed successfully');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Seed failed:', error);
    throw error;
  } finally {
    client.release();
  }
};

seed()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
