# API reference

Base URL: `http://localhost:4000/api`. All endpoints except `/auth/login`
require `Authorization: Bearer <token>`. All monetary amounts are **integer
cents** (e.g. `4500` = $45.00) in both requests and responses.

Every error follows the same shape:
```json
{ "error": { "code": "UNBALANCED_ENTRY", "message": "Journal entry does not balance: ..." } }
```

Every journal entry, invoice, and payment carries both an internal `id`
(UUID, stable primary key, never shown to users) and a `refNo`
(human-readable, e.g. `INV-2026-0001`) — see README.md for the naming
scheme. All examples below show `refNo` because that's what's actually
displayed and searched on in the UI.

## Search, date filters, and pagination (shared pattern)

Several list endpoints (`journal-entries`, `invoices`, `suppliers/invoices`,
`students`, `audit-log`) accept the same optional query params:

| Param | Effect |
|---|---|
| `search` | Case-insensitive substring match against refNo/description/name-type fields (see each endpoint) |
| `dateFrom`, `dateTo` | Inclusive ISO-date range filter |
| `page`, `pageSize` | **Opt-in** pagination — see note below |

**Pagination is opt-in.** Omit `page` entirely and you get the complete
filtered list back (as `total` items, with no truncation) — this is what
the dashboard's summary stats and the bulk-billing student picker rely on.
Pass `page` (starting at `1`) to get a paginated response instead:
`{ <key>: [...], total, page, pageSize, totalPages }`. `pageSize` defaults
to 20 and is clamped to 500.

## CSV/PDF/Excel export (shared pattern)

`journal-entries`, `reports/trial-balance`, `invoices/aged-receivables`,
and `suppliers/invoices` accept `?format=csv`, `?format=pdf`, or
`?format=xlsx` (genuine Excel workbook via SheetJS, not CSV renamed),
which returns a file download instead of JSON — applying the same
`search`/`dateFrom`/`dateTo`/`status` filters as the JSON response, but
ignoring `page`/`pageSize` (export always includes every matching row).

## Auth

| Method | Path | Permission | Notes |
|---|---|---|---|
| POST | `/auth/login` | — | `{ username, password }` → `{ token, user }`. Token expires in 8h. |
| GET | `/auth/me` | any | Returns the caller's decoded identity. |

## Chart of Accounts

| Method | Path | Permission |
|---|---|---|
| GET | `/accounts` | `accounts:read` |
| POST | `/accounts` | `accounts:write` — `{ code, name, type, parentId?, costCenterFlag?, isControlAccount? }` |
| PATCH | `/accounts/:id` | `accounts:write` — any of `{ name, isActive, parentId, costCenterFlag }` |

## Periods

| Method | Path | Permission |
|---|---|---|
| GET | `/periods` | `journal:read` |
| POST | `/periods` | `period:close` — `{ name, startDate, endDate }` |
| POST | `/periods/:id/close` | `period:close` |
| POST | `/periods/:id/reopen` | `period:close` |

## General ledger

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/journal-entries?periodId=&status=&search=&dateFrom=&dateTo=&page=&pageSize=&format=` | `journal:read` | Each entry includes `createdByName` (resolved from `createdBy`). `format=csv\|pdf\|xlsx` for export. |
| GET | `/journal-entries/:id` | `journal:read` | |
| POST | `/journal-entries` | `journal:post` | `{ date, description, lines: [{accountId, debit?, credit?, costCenterId?, tag?, description?}] }`. Optional `Idempotency-Key` header — repeat calls with the same key return the original entry instead of duplicating it. |
| POST | `/journal-entries/:id/reverse` | `journal:reverse` | Optional `{ date }`, defaults to today. Accounts Officer is denied this route by design. |

Validation enforced server-side regardless of caller: total debits must
equal total credits; every line must be debit-only or credit-only and
non-zero; the entry date must fall inside an **open** period.

## Students & AR

Students now carry `campus`, `intake`, `academicYear` (all free-text,
optional), and a required `status`: `active` | `deferred` | `suspended` |
`graduated`. Every student response also includes a computed
`billingStatus`: `paid` | `partial` | `unpaid`, derived fresh from their
invoices each time (not stored).

| Method | Path | Permission |
|---|---|---|
| GET | `/students?search=&campus=&status=&intake=&academicYear=&billingStatus=&page=&pageSize=` | `student:read` — powers the bulk-billing filters |
| GET | `/students/filter-options` | `student:read` — distinct `campuses`, `intakes`, `academicYears` present in the data, plus the fixed `statuses` list, for populating filter dropdowns |
| POST | `/students` | `student:write` — `{ studentNumber, name, program?, campus?, intake?, academicYear?, status?, guardianContact?, guardianEmail? }`. `status` defaults to `active`. `guardianEmail` is optional and, if set, receives auto-emailed payment receipts when SMTP is configured. |
| PATCH | `/students/:id` | `student:write` — any of `{ status, campus, intake, academicYear }`, audited |
| GET | `/students/:id` | `student:read` — returns `{ student, invoices, balance }` |
| GET | `/invoices?studentId=&status=&search=&dateFrom=&dateTo=&page=&pageSize=&format=` | `invoice:read` |
| GET | `/invoices/:id` | `invoice:read` |
| GET | `/invoices/aged-receivables?asOf=&format=` | `report:view` |
| POST | `/invoices` | `invoice:create` — `{ studentId, date, dueDate, lines: [{description, accountId, amount}] }` |
| POST | `/invoices/bulk` | `invoice:create` — same body shape but `studentIds: [...]` instead of `studentId`. Combine with the `GET /students` filters above to implement "bill everyone matching these filters." |
| GET | `/payments?invoiceId=` | `invoice:read` |
| POST | `/payments` | `payment:record` — `{ invoiceId, date, amount, method: "cash"\|"bank"\|"card", bankTxnRef? }`. Generates a PDF receipt and, if the student has `guardianEmail` set and SMTP is configured, e-mails it (fire-and-forget — never blocks or fails the payment). |
| GET | `/payments/:id/receipt.pdf` | `invoice:read` | Downloads the receipt for any AR payment, any time after the fact. |

## Suppliers & AP

| Method | Path | Permission |
|---|---|---|
| GET | `/suppliers` | `supplier:read` |
| POST | `/suppliers` | `supplier:write` — `{ name, contact? }` |
| GET | `/suppliers/invoices?status=&search=&dateFrom=&dateTo=&page=&pageSize=&format=` | `supplier:read` — includes `approvalThresholdCents` |
| POST | `/suppliers/invoices` | `ap:invoice:create` — `{ supplierId, date, dueDate, lines: [{description, accountId, amount}] }` |
| POST | `/suppliers/payments` | `ap:payment:record` — `{ invoiceId, date, amount, method, bankTxnRef?, approvedBy? }`. `approvedBy` (a different user's id) is required when `amount` exceeds the threshold; self-approval is rejected. |

## Reports

All accept `?period=<period name>` (resolves to that period's end date) or
`?asOf=<ISO date>`; default is today.

| Method | Path | Permission |
|---|---|---|
| GET | `/reports/trial-balance?format=` | `report:view` — `format=csv\|pdf\|xlsx` |
| GET | `/reports/income-statement` | `report:view` |
| GET | `/reports/balance-sheet` | `report:view` |

## Audit log

| Method | Path | Permission |
|---|---|---|
| GET | `/audit-log?entityType=&entityId=&search=&dateFrom=&dateTo=&page=&pageSize=` | `audit:view` — read-only; there is no write/delete route. `search` matches username, action, or entity type. |

Every entry now includes `ipAddress` (the request's IP, captured by the
`authenticate` middleware — `null` for entries created outside an HTTP
request, e.g. by `seed.ts`) and `module` (a human-readable area name —
"General Ledger", "Accounts Receivable", "Student Records", etc. —
derived automatically from `entityType`, no caller changes needed; see
`deriveModule()` in `backend/src/middleware/audit.ts`).

## Notifications

| Method | Path | Permission |
|---|---|---|
| GET | `/notifications` | `report:view` — `{ notifications: [{id, severity, message}], count }`. Built from live data (overdue receivables, AP payments above the approval threshold still awaiting a second approver) — not a stored/dismissible notification system. |

## Payroll interface

| Method | Path | Permission |
|---|---|---|
| POST | `/payroll/import-journal` | `payroll:admin` — `{ date, description?, lines }`, posted through the same ledger validation as any journal entry. |

## Users

| Method | Path | Permission |
|---|---|---|
| GET | `/users` | `user:read` — safe fields only (`id, username, fullName, role`), no password hashes. |

## Budgets (Phase 2)

Workflow: `draft` → `submitted` → `reviewed` → `approved` → `locked`. A
`submitted` or `reviewed` budget can be rejected back to `draft`.

| Method | Path | Permission |
|---|---|---|
| GET | `/budgets?status=&periodId=&accountId=&search=` | `report:view` |
| GET | `/budgets/vs-actual?periodId=` | `report:view` — approved/locked budgets only, compared against real posted GL activity |
| GET | `/budgets/:id` | `report:view` — includes `vsActual` |
| POST | `/budgets` | `budget:create` — `{ name, accountId, periodId, costCenterId?, amount, notes? }` |
| POST | `/budgets/:id/submit` | `budget:submit` |
| POST | `/budgets/:id/review` | `budget:review` |
| POST | `/budgets/:id/approve` | `budget:approve` |
| POST | `/budgets/:id/lock` | `budget:approve` |
| POST | `/budgets/:id/reject` | `budget:review` (if submitted) or `budget:approve` (if reviewed) — `{ reason? }` |

## Period-end closing (Phase 2)

| Method | Path | Permission |
|---|---|---|
| GET | `/periods/:id/close-checklist` | `report:view` — read-only pre-flight checks, doesn't change anything |
| POST | `/periods/:id/year-end-close` | `period:close` — posts one closing journal entry (source `YEAR_END_CLOSE`) zeroing income/expense into the `RETAINED_EARNINGS` control account, then closes the period. Rejects if the period is already closed or has no income/expense activity to close. |
