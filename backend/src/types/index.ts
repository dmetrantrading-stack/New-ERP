export interface User {
  id: string;
  username: string;
  email?: string;
  full_name: string;
  role_id: number;
  role_name?: string;
  phone?: string;
  is_active: boolean;
  last_login?: Date;
  permissions?: string[];
}

export interface Product {
  id: string;
  sku: string;
  barcode?: string;
  name: string;
  category_id?: number;
  brand_id?: number;
  unit_of_measure: string;
  cost: number;
  retail_price: number;
  wholesale_price: number;
  distributor_price: number;
  reorder_level: number;
  tax_type: string;
  image_url?: string;
  is_active: boolean;
  category_name?: string;
  brand_name?: string;
}

export interface Inventory {
  id: string;
  product_id: string;
  location_id: number;
  product_name?: string;
  sku?: string;
  location_name?: string;
  quantity: number;
  reserved_quantity: number;
  available_quantity: number;
  unit_cost: number;
}

export interface Batch {
  id: string;
  product_id: string;
  location_id: number;
  batch_number: string;
  supplier_batch?: string;
  manufacturing_date?: Date;
  expiry_date?: Date;
  quantity: number;
  unit_cost: number;
}

export interface Customer {
  id: number;
  customer_code: string;
  customer_name: string;
  contact_person?: string;
  address?: string;
  phone?: string;
  email?: string;
  customer_type: string;
  credit_limit: number;
  payment_terms?: string;
  tax_type: string;
  tin?: string;
  balance: number;
}

export interface Supplier {
  id: number;
  supplier_code: string;
  supplier_name: string;
  entity_type?: 'Corporation' | 'Sole Proprietorship';
  contact_person?: string;
  address?: string;
  phone?: string;
  email?: string;
  payment_terms?: string;
  tin?: string;
  balance: number;
}

export interface SaleInvoice {
  id: string;
  invoice_number: string;
  customer_id?: number;
  customer_name?: string;
  price_mode: string;
  invoice_date: Date;
  due_date?: Date;
  status: string;
  subtotal: number;
  discount: number;
  tax: number;
  tax_type: string;
  total: number;
  amount_paid: number;
  balance: number;
  cashier_id?: string;
  items?: SaleItem[];
}

export interface SaleItem {
  id: string;
  invoice_id: string;
  product_id: string;
  variant_id?: string;
  description?: string;
  quantity: number;
  unit_price: number;
  discount: number;
  tax: number;
  total: number;
  cost: number;
}

export interface JournalEntry {
  id: string;
  entry_number: string;
  entry_date: Date;
  reference_type?: string;
  reference_id?: string;
  description?: string;
  total_debit: number;
  total_credit: number;
  status: string;
  lines?: JournalLine[];
}

export interface JournalLine {
  id: string;
  entry_id: string;
  account_id: number;
  account_name?: string;
  account_code?: string;
  description?: string;
  debit: number;
  credit: number;
}

export interface PaginationParams {
  page: number;
  limit: number;
  search?: string;
  sort_by?: string;
  sort_order?: 'ASC' | 'DESC';
}

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  total_pages: number;
}
