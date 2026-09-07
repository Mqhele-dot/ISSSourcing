-- PO commercial currency (ISO 4217), aligned with Master Data currencies.
ALTER TABLE purchase_orders
ADD COLUMN IF NOT EXISTS currency_code text NOT NULL DEFAULT 'USD';
