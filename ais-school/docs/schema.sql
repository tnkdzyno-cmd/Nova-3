-- Ridgeview AIS — production reference schema (PostgreSQL 15+)
--
-- This is the target schema for "Path to production" in README.md. The
-- running MVP uses an in-memory/JSON store instead (see backend/src/store.ts)
-- so it needs zero setup for review and demo purposes. Every table below
-- maps directly onto a TypeScript type in backend/src/types.ts, so porting
-- the store.ts repository layer to query this schema is a mechanical change
-- — no route or service code needs to change.
--
-- Money is stored in integer cents (BIGINT) throughout, matching the app
-- layer, to avoid floating-point drift in financial calculations.

CREATE EXTENSION IF NOT EXISTS "pgcrypto"; -- for gen_random_uuid()

CREATE TYPE account_type AS ENUM ('asset', 'liability', 'equity', 'income', 'expense');
CREATE TYPE control_account_type AS ENUM ('AR', 'AP', 'BANK', 'CASH', 'RETAINED_EARNINGS');
CREATE TYPE period_status AS ENUM ('open', 'closed');
CREATE TYPE journal_status AS ENUM ('posted', 'reversed');
CREATE TYPE journal_source AS ENUM ('manual', 'AR_INVOICE', 'AR_PAYMENT', 'AP_INVOICE', 'AP_PAYMENT', 'REVERSAL', 'YEAR_END_CLOSE');
CREATE TYPE user_role AS ENUM ('admin', 'vice_chancellor', 'accounts_officer', 'bursar', 'auditor', 'it_admin', 'budget_officer');
CREATE TYPE budget_status AS ENUM ('draft', 'submitted', 'reviewed', 'approved', 'locked');
CREATE TYPE invoice_kind AS ENUM ('AR', 'AP');
CREATE TYPE invoice_status AS ENUM ('open', 'partial', 'paid', 'void');
CREATE TYPE payment_method AS ENUM ('cash', 'bank', 'card');

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role user_role NOT NULL,
  full_name TEXT NOT NULL,
  last_login TIMESTAMPTZ,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  mfa_secret TEXT -- production: required (encrypted) for admin/vice_chancellor roles
);

CREATE TABLE cost_centers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL
);

CREATE TABLE accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  type account_type NOT NULL,
  parent_id UUID REFERENCES accounts(id),
  cost_center_flag BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  is_control_account control_account_type
);
CREATE INDEX idx_accounts_type ON accounts(type);

CREATE TABLE periods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT UNIQUE NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  status period_status NOT NULL DEFAULT 'open',
  CHECK (end_date >= start_date)
);

CREATE TABLE journal_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date DATE NOT NULL,
  description TEXT NOT NULL,
  period_id UUID NOT NULL REFERENCES periods(id),
  status journal_status NOT NULL DEFAULT 'posted',
  source journal_source NOT NULL DEFAULT 'manual',
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reversal_of_id UUID REFERENCES journal_entries(id),
  reversed_by_id UUID REFERENCES journal_entries(id)
);
CREATE INDEX idx_journal_entries_period ON journal_entries(period_id);
CREATE INDEX idx_journal_entries_date ON journal_entries(date);

CREATE TABLE journal_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  journal_entry_id UUID NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES accounts(id),
  debit BIGINT NOT NULL DEFAULT 0 CHECK (debit >= 0),
  credit BIGINT NOT NULL DEFAULT 0 CHECK (credit >= 0),
  cost_center_id UUID REFERENCES cost_centers(id),
  tag TEXT,
  description TEXT,
  CHECK (NOT (debit > 0 AND credit > 0)),
  CHECK (debit > 0 OR credit > 0)
);
CREATE INDEX idx_journal_lines_entry ON journal_lines(journal_entry_id);
CREATE INDEX idx_journal_lines_account ON journal_lines(account_id);

CREATE TABLE students (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_number TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  program TEXT,
  guardian_contact TEXT -- production: encrypt at rest (personal identifier)
);

CREATE TABLE suppliers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  contact TEXT
);

CREATE TABLE invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind invoice_kind NOT NULL,
  student_id UUID REFERENCES students(id),
  supplier_id UUID REFERENCES suppliers(id),
  date DATE NOT NULL,
  due_date DATE NOT NULL,
  total_amount BIGINT NOT NULL CHECK (total_amount > 0),
  amount_paid BIGINT NOT NULL DEFAULT 0 CHECK (amount_paid >= 0),
  status invoice_status NOT NULL DEFAULT 'open',
  journal_entry_id UUID NOT NULL REFERENCES journal_entries(id),
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((kind = 'AR' AND student_id IS NOT NULL AND supplier_id IS NULL)
      OR (kind = 'AP' AND supplier_id IS NOT NULL AND student_id IS NULL))
);
CREATE INDEX idx_invoices_student ON invoices(student_id);
CREATE INDEX idx_invoices_supplier ON invoices(supplier_id);
CREATE INDEX idx_invoices_status ON invoices(status);

CREATE TABLE invoice_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  account_id UUID NOT NULL REFERENCES accounts(id),
  amount BIGINT NOT NULL CHECK (amount > 0)
);
CREATE INDEX idx_invoice_lines_invoice ON invoice_lines(invoice_id);

CREATE TABLE payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID NOT NULL REFERENCES invoices(id),
  date DATE NOT NULL,
  amount BIGINT NOT NULL CHECK (amount > 0),
  method payment_method NOT NULL,
  bank_txn_ref TEXT,
  journal_entry_id UUID NOT NULL REFERENCES journal_entries(id),
  posted_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  approved_by UUID REFERENCES users(id) -- AP payments above the approval threshold
);
CREATE INDEX idx_payments_invoice ON payments(invoice_id);

-- Append-only by convention: no UPDATE or DELETE grants for application
-- roles on this table in production. Immutability is enforced at the
-- database-permission layer, not just the application layer.
CREATE TABLE audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type TEXT NOT NULL,
  entity_id UUID NOT NULL,
  action TEXT NOT NULL,
  before JSONB,
  after JSONB,
  user_id UUID NOT NULL REFERENCES users(id),
  username TEXT NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_entity ON audit_log(entity_type, entity_id);
CREATE INDEX idx_audit_timestamp ON audit_log(timestamp);


-- Phase 2: budgeting workflow. See docs/NOVA_ROADMAP.md §6.1.
CREATE TABLE budgets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ref_no TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  cost_center_id UUID REFERENCES cost_centers(id),
  account_id UUID NOT NULL REFERENCES accounts(id),
  period_id UUID NOT NULL REFERENCES periods(id),
  amount BIGINT NOT NULL CHECK (amount > 0),
  status budget_status NOT NULL DEFAULT 'draft',
  notes TEXT,
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  submitted_at TIMESTAMPTZ,
  reviewed_by UUID REFERENCES users(id),
  reviewed_at TIMESTAMPTZ,
  approved_by UUID REFERENCES users(id),
  approved_at TIMESTAMPTZ,
  locked_at TIMESTAMPTZ,
  revision_of UUID REFERENCES budgets(id)
);

-- Fixed assets register (spec module not yet wired into the app layer —
-- schema included so the migration doesn't need a follow-up DDL change).
CREATE TABLE fixed_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  description TEXT NOT NULL,
  acquisition_date DATE NOT NULL,
  cost BIGINT NOT NULL CHECK (cost > 0),
  depreciation_method TEXT NOT NULL CHECK (depreciation_method IN ('straight_line', 'reducing_balance')),
  useful_life_months INT NOT NULL CHECK (useful_life_months > 0),
  accumulated_depreciation BIGINT NOT NULL DEFAULT 0,
  disposed_at DATE,
  disposal_proceeds BIGINT
);

-- Row-level security example for a multi-tenant deployment (one DB, many
-- schools) — disabled by default; enable and add policies if needed.
-- ALTER TABLE journal_entries ENABLE ROW LEVEL SECURITY;
