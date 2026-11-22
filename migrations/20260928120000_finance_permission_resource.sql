-- Keep the persisted permission resource enum aligned with the authoritative
-- server permission catalog. Finance routes use this resource for scoped
-- access checks, including custom and non-administrator roles.
ALTER TYPE resource ADD VALUE IF NOT EXISTS 'finance';
