-- Reporting currency (ISO 4217) for org-scoped money formatting in UI and analytics

ALTER TABLE app_settings
  ADD COLUMN IF NOT EXISTS currency_code text NOT NULL DEFAULT 'USD';

COMMENT ON COLUMN app_settings.currency_code IS 'ISO 4217 code (USD, EUR, …) for Intl.NumberFormat';
