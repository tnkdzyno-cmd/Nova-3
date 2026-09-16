// Core domain types for the School AIS MVP.
// Monetary values are stored as integer CENTS to avoid floating point drift
// in financial calculations. Convert to major units only for display.

export type AccountType = "asset" | "liability" | "equity" | "income" | "expense";

export interface Account {
  id: string;
  code: string;
  name: string;
  type: AccountType;
  parentId: string | null;
  costCenterFlag: boolean;
  isActive: boolean;
  isControlAccount?: "AR" | "AP" | "BANK" | "CASH" | "RETAINED_EARNINGS"; // ties this account to a subledger or system process
}

export interface CostCenter {
  id: string;
  code: string;
  name: string;
}

export type PeriodStatus = "open" | "closed";

export interface Period {
  id: string;
  name: string; // e.g. "2026-08"
  startDate: string; // ISO date
  endDate: string; // ISO date
  status: PeriodStatus;
}

export type JournalEntryStatus = "posted" | "reversed";
export type JournalSource = "manual" | "AR_INVOICE" | "AR_PAYMENT" | "AP_INVOICE" | "AP_PAYMENT" | "REVERSAL" | "YEAR_END_CLOSE";

export interface JournalLine {
  id: string;
  accountId: string;
  debit: number; // cents
  credit: number; // cents
  costCenterId: string | null;
  tag: string | null;
  description: string | null;
}

export interface JournalEntry {
  id: string;
  refNo: string; // human-readable, e.g. "JE-2026-0001" — id remains the stable FK
  date: string; // ISO date
  description: string;
  periodId: string;
  status: JournalEntryStatus;
  source: JournalSource;
  lines: JournalLine[];
  createdBy: string;
  createdAt: string;
  reversalOfId: string | null;
  reversedById: string | null;
}

export type Role =
  | "admin" // System Administrator
  | "vice_chancellor" // Vice-Chancellor (consolidates the former "finance_manager" and "principal" roles)
  | "accounts_officer" // Accounts Officer (was "finance_clerk")
  | "bursar" // Bursar
  | "auditor" // Auditor
  | "it_admin" // IT Administrator (not in the Nova spec's role list, kept for user-directory admin)
  | "budget_officer"; // Budget Officer

// The data domains an auditor's read access can be scoped to. An admin
// (or IT admin) grants these per auditor account — auditors do NOT get
// blanket read access to every module by virtue of the role, unlike every
// other role here. Meaningless for non-auditor roles (their access is
// governed by rbac-policy.ts's static role permissions as usual).
export const DATA_SCOPES = ["accounts", "journal", "students", "billing", "suppliers", "reports", "audit", "users"] as const;
export type DataScope = (typeof DATA_SCOPES)[number];

export interface User {
  id: string;
  username: string;
  passwordHash: string;
  role: Role;
  fullName: string;
  lastLogin: string | null;
  isActive: boolean;
  dataScopes?: DataScope[]; // only meaningful when role === "auditor"
}

export type StudentStatus = "active" | "deferred" | "suspended" | "graduated";

export interface Student {
  id: string;
  studentNumber: string;
  name: string;
  program: string;
  guardianContact: string;
  guardianEmail?: string | null; // optional — used for e-mailing payment receipts
  campus?: string;
  intake?: string; // e.g. "January 2026"
  academicYear?: string; // e.g. "2026/2027"
  status: StudentStatus;
}

export interface Supplier {
  id: string;
  name: string;
  contact: string;
}

export type InvoiceKind = "AR" | "AP";
export type InvoiceStatus = "open" | "partial" | "paid" | "void";

export interface InvoiceLine {
  id: string;
  description: string;
  accountId: string; // income account (AR) or expense account (AP) this line hits
  amount: number; // cents
}

export interface Invoice {
  id: string;
  refNo: string; // human-readable, e.g. "INV-2026-0001" (AR) or "BILL-2026-0001" (AP)
  kind: InvoiceKind;
  studentId: string | null;
  supplierId: string | null;
  date: string;
  dueDate: string;
  lines: InvoiceLine[];
  totalAmount: number; // cents
  amountPaid: number; // cents
  status: InvoiceStatus;
  journalEntryId: string; // the entry raised at invoice creation
  createdBy: string;
  createdAt: string;
}

export type PaymentMethod = "cash" | "bank" | "card";

export interface Payment {
  id: string;
  refNo: string; // human-readable, e.g. "RCT-2026-0001" (AR receipt) or "PMT-2026-0001" (AP payment)
  invoiceId: string;
  date: string;
  amount: number; // cents
  method: PaymentMethod;
  bankTxnRef: string | null;
  journalEntryId: string;
  postedBy: string;
  approvedBy?: string | null;
  createdAt: string;
}

export interface AuditLogEntry {
  id: string;
  entityType: string;
  entityId: string;
  action: string;
  before: unknown;
  after: unknown;
  userId: string;
  username: string;
  ipAddress: string | null;
  module: string;
  timestamp: string;
}

export interface AppError {
  status: number;
  code: string;
  message: string;
}

/** Per-kind sequential counters used to mint human-readable reference numbers. */
export interface Counters {
  journal: number;
  arInvoice: number;
  apInvoice: number;
  arPayment: number;
  apPayment: number;
  budget: number;
}

// ---------------------------------------------------------------------------
// Budgeting (Phase 2)
// ---------------------------------------------------------------------------

export type BudgetStatus = "draft" | "submitted" | "reviewed" | "approved" | "locked";

export interface Budget {
  id: string;
  refNo: string; // e.g. "BUD-2027-0001"
  name: string;
  costCenterId: string | null;
  accountId: string; // the GL account this budget line tracks
  periodId: string;
  amount: number; // cents
  status: BudgetStatus;
  notes: string | null;
  createdBy: string;
  createdAt: string;
  submittedAt: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  lockedAt: string | null;
  revisionOf: string | null; // points to the prior version if this is a revision
}
