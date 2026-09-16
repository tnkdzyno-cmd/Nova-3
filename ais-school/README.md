# Nova — School Finance & Administration Platform

*(built on the Ridgeview AIS codebase — see `docs/NOVA_ROADMAP.md` for the
full rebrand story, brand guide, information architecture, and the
detailed design for what's next)*

A working accounting and administration system for a school bursary:
chart of accounts, general ledger, student billing (AR), supplier payables
(AP), a 6-role RBAC framework with admin-granted auditor scoping, an immutable audit trail with IP/module
capture, CSV/PDF/Excel export, automatic payment receipts, and a modern
Nova-branded UI with dashboard navigation cards, bulk-billing filters, and
dark mode.

## Quick start

Requires Node.js 18+.

```bash
cd backend
npm install
npm run seed     # loads chart of accounts, demo users, students, sample transactions
npm start        # http://localhost:4000 — serves both the API and the web UI
```

Open **http://localhost:4000** and sign in with one of the demo accounts
(also shown on the login screen):

| Username        | Password        | Role                        | Can do |
|-----------------|-----------------|------------------------------|--------|
| `admin`         | `Admin123!`     | System Administrator        | Everything |
| `vc`            | `Chancellor123!`| Vice-Chancellor              | Everything except user administration; reverses journals, closes periods, approves AP payments/budgets, payroll import, sees Management Accounts (KPIs + approvals queue). Consolidates the former Finance Manager and Principal roles. |
| `officer`       | `Officer123!`   | Accounts Officer             | Posts transactions day-to-day; **cannot** reverse journals, close periods, or reach payroll admin |
| `bursar`        | `Bursar123!`    | Bursar                       | Student billing and receipting only |
| `auditor`       | `Audit123!`     | Auditor                      | Read-only, and **only in the data domains a System Administrator has granted** — not automatic by role |
| `itadmin`       | `ITAdmin123!`   | IT Administrator             | User directory, audit log, and grants/revokes auditor access |
| `budgetofficer` | `Budget123!`    | Budget Officer               | Creates/submits budgets. Cannot approve its own submissions — the Vice-Chancellor reviews and approves. |

Run `npm run seed` again any time to reset to a clean demo state — it's
idempotent (wipes and reloads), and refuses to run at all against
`NODE_ENV=production` unless you also pass `--force`.

Run the automated test suite:

```bash
npm test          # 59 tests: ledger integrity, AR workflow, RBAC over real HTTP,
                   # refNo generation, pagination, CSV/PDF/XLSX export, seed-guard subprocess test,
                   # budget workflow, period-end closing
npm run typecheck
```

## What's implemented

- **Chart of Accounts** — a modernized, multi-campus-ready structure:
  current/non-current assets (including land, buildings, vehicles,
  equipment, library assets, accumulated depreciation), current/long-term
  liabilities, retained earnings & capital funds, a full income breakdown
  (tuition, registration, accommodation, library, examination fees, grants,
  donations), and utilities split into six separate expense accounts.
- **General Ledger** — strict double-entry posting, reversal, trial
  balance, idempotency-key support.
- **Accounts Receivable** — student master data (now with campus, intake,
  academic year, and enrolment status), single and bulk invoicing,
  receipting, aged receivables. Every invoice/payment raises its own GL
  entry automatically.
- **Accounts Payable** — supplier master data, invoice capture, two-step
  payment approval above a configurable threshold.
- **6-role RBAC** — System Administrator, Vice-Chancellor (consolidates
  the former Finance Manager and Principal roles), Accounts Officer,
  Bursar, Auditor, IT Administrator, Budget Officer, enforced as Express
  middleware on every route (not just hidden in the UI). An auditor's
  actual access is further scoped per-account by an administrator — see
  "Admin-granted auditor access" below. Full matrix in
  `docs/NOVA_ROADMAP.md` §4.
- **Admin-granted auditor access** — an auditor's role permission is a
  ceiling, not a grant: a System Administrator or IT Administrator picks
  which specific data domains (accounts, journal, students, billing,
  suppliers, reports, audit, users) each auditor account can read, checked
  live on every request so a revoked scope takes effect immediately.
- **Management Accounts** — a KPI + approvals-queue view for the
  Vice-Chancellor (cash position, net surplus, AR/AP outstanding, overdue
  receivables, trial balance status, budgets awaiting review/approval,
  AP payments awaiting a second signature) — distinct from the plain
  dashboard, which still shows no financial figures.
- **Audit trail** — every financial mutation writes an append-only record
  with before/after values, user, timestamp, **IP address**, and **module**
  (derived automatically from the entity type — no per-call-site changes
  needed). Still no edit/delete route for the log, anywhere.
- **Bulk billing, redesigned** — filter the student list by campus, status
  (active/deferred/suspended/graduated), intake, academic year, and billing
  status (paid/partial/unpaid), then **select all filtered**, **select all
  students**, or **clear selection** — selection persists across filter
  changes. See `docs/NOVA_ROADMAP.md` §3 for the flow diagram.
- **Reporting** — trial balance, income statement, balance sheet, aged
  receivables. Trial balance lives in Reports only, never on the dashboard.
- **Human-readable reference numbers** everywhere (`INV-2026-0001`,
  `JE-2026-0007`...) — UUIDs stay internal.
- **Search, date-range filters, and opt-in pagination** on journal
  entries, invoices, students, and the audit log.
- **CSV / PDF / Excel (.xlsx) export** — genuine workbooks via `xlsx`
  (SheetJS), not CSV-renamed. Every export reflects the current filters,
  not just the visible page.
- **Payment receipts** — auto-generated PDF on every AR payment,
  auto-emailed via `nodemailer` if SMTP is configured and the student has
  a guardian e-mail on file. No config → receipt still generates, e-mail
  step just no-ops.
- **Notifications** — a real bell in the header (overdue receivables,
  AP payments awaiting approval) built from live data, not a decorative
  placeholder.
- **Budget management** — full draft → submitted → reviewed → approved →
  locked workflow with separation of duties (Budget Officer creates/
  submits, Vice-Chancellor reviews and approves), a reject-to-draft path,
  and a Budget vs. Actual report computed from real posted GL activity.
- **Period-end closing** — a pre-flight checklist (trial balance balanced,
  earlier periods closed, no AP payments pending approval, period actually
  ended) and a one-click year-end closing entry that zeros income/expense
  into Retained Earnings and closes the period.
- **Dark mode** — a genuine light/dark theme toggle (Settings page and
  every page header), persisted per browser, applied before first paint.
- **Nova rebrand** — new palette, Inter typography, logo mark, dashboard
  redesigned to navigation cards only (no financial widgets), collapsible
  sidebar. See `docs/NOVA_ROADMAP.md` §1–2.
- **Seeding safeguard** — `npm run seed` refuses to run against
  `NODE_ENV=production` without `--force`.

## What's deferred

- **Bank reconciliation** — designed in full in `docs/NOVA_ROADMAP.md` §6.3
  (data model, import, auto-match, endpoints) but not built yet.
- **Full Excel import framework** (templates, validation, preview,
  duplicate detection across 7 entity types) — export is real `.xlsx`
  today; import is Phase 3, see `docs/NOVA_ROADMAP.md` §7.
- **Database**: in-memory store snapshotted to a JSON file (path
  configurable via `DATA_FILE` in `.env`) instead of PostgreSQL — zero
  setup to review. `docs/schema.sql` is the target production schema.
- **MFA, OAuth2/OIDC, school-SSO** — not implemented; `docs/schema.sql`
  reserves an `mfa_secret` column.
- **Fixed assets & depreciation** — schema reserved, no application logic.
- **Deep multi-campus hierarchy** — `Student.program`/`campus` are
  free-text fields today, not normalized Faculty/Department/Course
  entities. See `docs/NOVA_ROADMAP.md` §7.
- **User administration UI** — the API lists users; creating/deactivating
  accounts or resetting passwords isn't in the UI yet.
- **Containerization/CI/CD/K8s** — not set up; this is a local-first build.

None of this changes the shape of the system going forward — it's
addition, not rework, thanks to the audit-first, control-account-based
design and the RBAC permissions already being declared ahead of the
modules that will use them.

## Architecture

```
backend/
  src/
    types.ts            domain model (shared by store, services, routes)
    store.ts             the ONLY file that touches storage
    rbac-policy.ts        role -> permission matrix (single source of truth)
    middleware/           auth (JWT + IP capture), rbac (permission guard), audit (log writer)
    services/
      ledger.ts            double-entry validation, posting, reversal, trial balance
      ar.ts                student invoicing & receipting (posts to ledger.ts)
      ap.ts                supplier invoicing & payment (posts to ledger.ts)
      pdf.ts               PDF generation (pdfkit) — reports and receipts
      email.ts             SMTP receipt delivery (nodemailer, no-ops if unconfigured)
    routes/                one file per REST resource; thin — validation and
                            business rules live in services/, not here
    seed.ts               demo dataset (production-safeguarded)
  tests/                 node:test — ledger integrity, AR workflow, RBAC over HTTP,
                          export formats, seed guard, pagination/filter utilities
frontend/                 static HTML/CSS/vanilla JS, no build step — dashboard,
                          accounts, journal, students, suppliers, reports, audit,
                          users, settings — served by Express on the same port
docs/
  NOVA_ROADMAP.md         brand guide, IA, user flows, RBAC matrix, Phase 2/3 design,
                          migration strategy — the main design deliverable
  schema.sql             production Postgres schema
  API.md                 endpoint reference
  USER_GUIDE.md           quick-reference cards for day-to-day tasks
```

**Why every invoice/payment posts its own GL entry immediately**: the
AR/AP subledgers and the general ledger are generated from the same
transaction at the same moment, so a trial balance is always a true
reflection of the subledgers — no separate "sync" step to drift.

**Why money is integer cents everywhere**: avoids floating-point rounding
drift. The frontend converts to/from decimal display only at the edges
(`api.js`: `money()` / `toCents()`).

## Verifying it works

- **Trial balance**: Reports → Trial balance. Debits and credits match
  exactly.
- **Bulk billing**: Students & Billing → filter by campus/status → Select
  all filtered → add a fee line → Bill selected students.
- **Payment → receipt**: record a payment, then download its receipt PDF
  from the student's "Payments received" table.
- **Permission test**: log in as `officer` and try Journal → Reverse, or
  hit `POST /api/payroll/import-journal` — both 403. Covered by
  `backend/tests/rbac.test.ts` over real HTTP.
- **Audit trail**: Audit Log → any entry → Details shows before/after,
  IP address, and module.
- **Dark mode**: Settings → Appearance, or the toggle in any page header.

## Roadmap

See `docs/NOVA_ROADMAP.md` §6–9 for the detailed Phase 2 (budgeting,
period-end closing, bank reconciliation) and Phase 3 (full Excel import,
MFA, deep multi-campus hierarchy) design and priority order.
