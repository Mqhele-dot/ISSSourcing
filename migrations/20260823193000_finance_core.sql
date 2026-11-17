CREATE TABLE IF NOT EXISTS finance_accounts (
  id bigserial PRIMARY KEY, organization_id integer NOT NULL REFERENCES organizations(id),
  code text NOT NULL, name text NOT NULL, account_type text NOT NULL CHECK (account_type IN ('asset','liability','equity','revenue','expense')),
  normal_balance text NOT NULL CHECK (normal_balance IN ('debit','credit')), active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(organization_id,code)
);
CREATE TABLE IF NOT EXISTS finance_periods (
  id bigserial PRIMARY KEY, organization_id integer NOT NULL REFERENCES organizations(id), name text NOT NULL,
  start_date date NOT NULL, end_date date NOT NULL, status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','soft_closed','hard_closed')),
  closed_at timestamptz, closed_by integer REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(),
  CHECK(start_date<=end_date), UNIQUE(organization_id,start_date,end_date)
);
ALTER TABLE journal_entries ALTER COLUMN subledger_event_id DROP NOT NULL;
ALTER TABLE journal_entries ADD COLUMN IF NOT EXISTS period_id bigint REFERENCES finance_periods(id);
ALTER TABLE journal_entries ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'posted';
ALTER TABLE journal_entries ADD COLUMN IF NOT EXISTS reversal_of_id bigint REFERENCES journal_entries(id);
ALTER TABLE journal_entries ADD COLUMN IF NOT EXISTS created_by integer REFERENCES users(id);
ALTER TABLE journal_entries ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE journal_lines ADD COLUMN IF NOT EXISTS account_id bigint REFERENCES finance_accounts(id);
ALTER TABLE journal_lines ADD COLUMN IF NOT EXISTS description text;
CREATE UNIQUE INDEX IF NOT EXISTS journal_entries_org_number_uidx ON journal_entries(organization_id,entry_number);
CREATE INDEX IF NOT EXISTS finance_accounts_org_type_idx ON finance_accounts(organization_id,account_type,code);
CREATE INDEX IF NOT EXISTS finance_periods_org_dates_idx ON finance_periods(organization_id,start_date,end_date);
CREATE INDEX IF NOT EXISTS journal_entries_org_date_idx ON journal_entries(organization_id,entry_date,id);
CREATE INDEX IF NOT EXISTS journal_lines_account_idx ON journal_lines(account_id,journal_entry_id);
