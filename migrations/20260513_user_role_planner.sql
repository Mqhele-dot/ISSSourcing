-- Add planner to app user_role enum (aligns with operational PO workflow + shared/purchase-order-status).
-- Safe to run multiple times on PostgreSQL 9.1+.
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'planner';
