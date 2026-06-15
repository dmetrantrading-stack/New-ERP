export interface User {
  id: string;
  username: string;
  full_name: string;
  email?: string;
  role_id: number;
  role_name: string;
  permissions: string[];
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
  has_variants?: boolean;
  store_stock?: number;
  warehouse_stock?: number;
}

export interface ProductVariant {
  id: string;
  product_id: string;
  name: string;
  retail_price: number;
  additional_cost: number;
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
  reorder_level?: number;
}

export interface Batch {
  id: string;
  product_id: string;
  location_id: number;
  batch_number: string;
  supplier_batch?: string;
  manufacturing_date?: string;
  expiry_date?: string;
  quantity: number;
  unit_cost: number;
  location_name?: string;
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
  is_active: boolean;
}

export interface Supplier {
  id: number;
  supplier_code: string;
  supplier_name: string;
  contact_person?: string;
  address?: string;
  phone?: string;
  email?: string;
  payment_terms?: string;
  tin?: string;
  balance: number;
  is_active: boolean;
}

export interface POSItem {
  product_id: string;
  variant_id?: string;
  name: string;
  sku: string;
  quantity: number;
  unit_price: number;
  discount: number;
  total: number;
  cost?: number;
}

export interface POSShift {
  id: string;
  user_id: string;
  shift_number: string;
  opening_date: string;
  opening_cash: number;
  cash_sales: number;
  total_sales: number;
  status: string;
}

export interface Notification {
  type: string;
  title: string;
  message: string;
  reference_type?: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  total_pages?: number;
}

export interface Category {
  id: number;
  name: string;
  description?: string;
  parent_id?: number;
  product_count?: number;
  is_active: boolean;
}

export interface Brand {
  id: number;
  name: string;
  description?: string;
  is_active: boolean;
}

export interface Location {
  id: number;
  name: string;
  type: string;
  is_active: boolean;
}

export interface JournalEntry {
  id: string;
  entry_number: string;
  entry_date: string;
  description?: string;
  total_debit: number;
  total_credit: number;
  status: string;
  lines?: JournalLine[];
}

export interface JournalLine {
  id: string;
  account_id: number;
  account_code?: string;
  account_name?: string;
  description?: string;
  debit: number;
  credit: number;
}

export interface Account {
  id: number;
  account_code: string;
  account_name: string;
  account_type: string;
  parent_id?: number;
  balance?: number;
  is_active: boolean;
}
