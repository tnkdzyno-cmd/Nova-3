// Loads a realistic demo dataset: a modernized multi-campus chart of
// accounts, two periods (one open, one closed — so the "cannot post to a
// closed period" rule is directly demoable), demo users for all eight
// Nova roles, a handful of students across different campuses/statuses
// (for the bulk-billing filters), suppliers, and a set of posted
// transactions so every screen has something to show.
//
// Run with: npm run seed   (safe to re-run — it resets the store first)
//
// SAFETY: this script WIPES all existing data before reloading the demo
// set. To stop it from ever being run against a live production dataset by
// accident, it refuses to proceed when NODE_ENV=production unless the
// --force flag is also passed explicitly:
//   NODE_ENV=production npm run seed                 -> refuses, exits 1
//   NODE_ENV=production npm run seed -- --force       -> proceeds (you asked twice)

import "dotenv/config";
import bcrypt from "bcryptjs";
import { Store } from "./store.js";
import { newId, nowIso } from "./util.js";
import type { Account, CostCenter, Period, Student, Supplier, User } from "./types.js";
import { postJournalEntry } from "./services/ledger.js";
import { createInvoicesBulk, recordPayment } from "./services/ar.js";
import { createSupplierInvoice, recordSupplierPayment } from "./services/ap.js";
import { createBudget, submitBudget, reviewBudget, approveBudget, lockBudget } from "./services/budget.js";
import type { AuthedUser } from "./middleware/auth.js";

if (process.env.NODE_ENV === "production" && !process.argv.includes("--force")) {
  console.error("Refusing to run: NODE_ENV=production and this script deletes all existing data.");
  console.error("If you really mean to reset a production dataset, re-run with the --force flag:");
  console.error("  npm run seed -- --force");
  process.exit(1);
}

const store = new Store(true);
store.reset();
const data = store.data;

function account(code: string, name: string, type: Account["type"], opts: Partial<Account> = {}): Account {
  const acc: Account = { id: newId(), code, name, type, parentId: null, costCenterFlag: false, isActive: true, ...opts };
  data.accounts.push(acc);
  return acc;
}

// --- Chart of accounts (modernized, multi-campus-ready structure) --------

// Assets — current
const cash = account("1000", "Cash on Hand", "asset", { isControlAccount: "CASH" });
const bank = account("1010", "Bank — Operating Account", "asset", { isControlAccount: "BANK" });
const ar = account("1200", "Accounts Receivable — Students", "asset", { isControlAccount: "AR" });
account("1210", "Inventory", "asset");
account("1220", "Prepayments", "asset");

// Assets — non-current
const buildings = account("1510", "Buildings", "asset");
account("1500", "Land", "asset");
account("1520", "Vehicles", "asset");
account("1530", "Furniture & Fittings", "asset");
account("1540", "Equipment", "asset");
account("1550", "Computers & IT Equipment", "asset");
account("1560", "Library Assets", "asset");
account("1590", "Accumulated Depreciation", "asset"); // contra-asset

// Liabilities — current
const ap = account("2000", "Accounts Payable — Suppliers", "liability", { isControlAccount: "AP" });
account("2100", "Salaries Payable", "liability");
account("2110", "Tax Payable", "liability");
account("2200", "Deferred Fee Income", "liability");

// Liabilities — long-term
account("2500", "Loans", "liability");
account("2510", "Mortgage Obligations", "liability");
account("2520", "Lease Liabilities", "liability");

// Equity
account("3000", "Retained Earnings", "equity", { isControlAccount: "RETAINED_EARNINGS" });
account("3100", "Capital Funds", "equity");
const openingEquity = account("3900", "Opening Balance Equity", "equity"); // working account for opening entries

// Income
const tuitionIncome = account("4000", "Tuition Fees", "income");
account("4010", "Registration Fees", "income");
const accommodationIncome = account("4020", "Accommodation Fees", "income");
account("4030", "Library Fees", "income");
account("4040", "Examination Fees", "income");
account("4050", "Grants", "income");
account("4060", "Donations", "income");
account("4090", "Other Income", "income");

// Expenses
account("5000", "Salaries and Wages", "expense");
const electricity = account("5010", "Electricity Expense", "expense");
account("5020", "Water Expense", "expense");
account("5030", "Cleaning Services Expense", "expense");
account("5040", "Internet Expense", "expense");
account("5050", "Security Expense", "expense");
account("5060", "Maintenance Expense", "expense");
const stationery = account("5070", "Teaching Materials & Stationery", "expense");
account("5080", "Depreciation Expense", "expense");

const costCenters: CostCenter[] = [
  { id: newId(), code: "ACAD", name: "Academic" },
  { id: newId(), code: "BOARD", name: "Boarding" },
  { id: newId(), code: "ADMIN", name: "Administration" },
];
data.costCenters.push(...costCenters);

// Prior period is CLOSED on purpose — lets you demo the "posting to a
// closed period is rejected" control immediately after seeding.
const closedPeriod: Period = { id: newId(), name: "2026-Q2", startDate: "2026-04-01", endDate: "2026-06-30", status: "closed" };
const openPeriod: Period = { id: newId(), name: "2026-Q3", startDate: "2026-07-01", endDate: "2026-09-30", status: "open" };
data.periods.push(closedPeriod, openPeriod);

function user(username: string, password: string, role: User["role"], fullName: string): User {
  const u: User = {
    id: newId(),
    username,
    passwordHash: bcrypt.hashSync(password, 10),
    role,
    fullName,
    lastLogin: null,
    isActive: true,
  };
  data.users.push(u);
  return u;
}

const admin = user("admin", "Admin123!", "admin", "System Administrator");
const viceChancellor = user("vc", "Chancellor123!", "vice_chancellor", "Prof. Grace Mabhena");
const officer = user("officer", "Officer123!", "accounts_officer", "Nomsa Dube");
user("bursar", "Bursar123!", "bursar", "Tendai Ncube");
const auditor = user("auditor", "Audit123!", "auditor", "External Auditor");
// Deliberately partial — demonstrates that an auditor's access is granted
// per-scope by an administrator, not automatic by role. This auditor can
// review the ledger and reports and their own audit trail, but has NOT
// been granted access to suppliers, student records, billing, accounts,
// or the user directory — those calls will 403 with a clear "not granted"
// message, exactly as an admin restricting a specific audit engagement
// would expect. Adjust via User Management → this account → Manage access.
auditor.dataScopes = ["journal", "reports", "audit"];
user("itadmin", "ITAdmin123!", "it_admin", "IT Administrator");
const budgetOfficer = user("budgetofficer", "Budget123!", "budget_officer", "Blessing Sithole");

// A spread of campuses, statuses, intakes and academic years so the bulk
// billing filters (campus / status / intake / academic year / billing
// status) all have something real to filter against.
const students: Student[] = [
  {
    id: newId(), studentNumber: "STU-2026-001", name: "Thandiwe Sibanda", program: "A-Level Sciences",
    guardianContact: "+263 77 000 0001", guardianEmail: "sibanda.guardian@example.com",
    campus: "Main Campus", intake: "September 2026", academicYear: "2026/2027", status: "active",
  },
  {
    id: newId(), studentNumber: "STU-2026-002", name: "Kudzai Moyo", program: "A-Level Commercials",
    guardianContact: "+263 77 000 0002", guardianEmail: "moyo.guardian@example.com",
    campus: "Main Campus", intake: "September 2026", academicYear: "2026/2027", status: "active",
  },
  {
    id: newId(), studentNumber: "STU-2026-003", name: "Rutendo Ncube", program: "O-Level",
    guardianContact: "+263 77 000 0003", guardianEmail: null,
    campus: "City Campus", intake: "January 2026", academicYear: "2025/2026", status: "active",
  },
  {
    id: newId(), studentNumber: "STU-2025-014", name: "Tapiwa Chirwa", program: "A-Level Sciences",
    guardianContact: "+263 77 000 0004", guardianEmail: null,
    campus: "Main Campus", intake: "September 2025", academicYear: "2025/2026", status: "deferred",
  },
  {
    id: newId(), studentNumber: "STU-2023-081", name: "Farai Gumbo", program: "A-Level Commercials",
    guardianContact: "+263 77 000 0005", guardianEmail: null,
    campus: "City Campus", intake: "January 2023", academicYear: "2022/2023", status: "graduated",
  },
];
data.students.push(...students);

const suppliers: Supplier[] = [
  { id: newId(), name: "Bulawayo Stationers (Pvt) Ltd", contact: "accounts@bulawayostationers.co.zw" },
  { id: newId(), name: "ZESA Holdings", contact: "billing@zesa.co.zw" },
];
data.suppliers.push(...suppliers);

const asAdmin: AuthedUser = { id: admin.id, username: admin.username, role: admin.role, fullName: admin.fullName };
const asViceChancellor: AuthedUser = { id: viceChancellor.id, username: viceChancellor.username, role: viceChancellor.role, fullName: viceChancellor.fullName };
const asOfficer: AuthedUser = { id: officer.id, username: officer.username, role: officer.role, fullName: officer.fullName };
const asBudgetOfficer: AuthedUser = { id: budgetOfficer.id, username: budgetOfficer.username, role: budgetOfficer.role, fullName: budgetOfficer.fullName };

// --- Opening balances ---------------------------------------------------
postJournalEntry(
  data,
  {
    date: "2026-07-01",
    description: "Opening balances for FY2026",
    source: "manual",
    lines: [
      { accountId: bank.id, debit: 5_000_000 }, // $50,000.00
      { accountId: buildings.id, debit: 2_000_000 }, // $20,000.00
      { accountId: openingEquity.id, credit: 7_000_000 },
    ],
  },
  asAdmin
);

// --- Term billing (AR) — only the three active students get billed ------
const activeStudentIds = students.filter((s) => s.status === "active").map((s) => s.id);
createInvoicesBulk(
  data,
  {
    studentIds: activeStudentIds,
    date: "2026-09-01",
    dueDate: "2026-09-05", // deliberately in the past relative to the demo's "today" —
    // Rutendo's invoice (left unpaid below) is then genuinely overdue,
    // giving the aged-receivables report and notifications something real
    // to surface rather than an all-current, nothing-to-see demo.
    lines: [
      { description: "Tuition — Term 3", accountId: tuitionIncome.id, amount: 45_000 }, // $450.00
      { description: "Accommodation — Term 3", accountId: accommodationIncome.id, amount: 30_000 }, // $300.00
    ],
  },
  asViceChancellor
);

const firstInvoice = data.invoices[0];
const secondInvoice = data.invoices[1];
recordPayment(data, { invoiceId: firstInvoice.id, date: "2026-09-05", amount: firstInvoice.totalAmount, method: "bank", bankTxnRef: "EFT-100234" }, asOfficer);
recordPayment(data, { invoiceId: secondInvoice.id, date: "2026-09-06", amount: 40_000, method: "cash" }, asOfficer);
// Rutendo's invoice (data.invoices[2]) is left fully unpaid on purpose — gives
// the aged receivables report and the "unpaid" billing-status filter something
// to show.

// --- Supplier invoicing (AP), including a payment above the approval threshold ---
const stationeryInvoice = createSupplierInvoice(
  data,
  {
    supplierId: suppliers[0].id,
    date: "2026-09-02",
    dueDate: "2026-09-20",
    lines: [{ description: "Exercise books and stationery — Term 3", accountId: stationery.id, amount: 15_000 }],
  },
  asOfficer
);
recordSupplierPayment(data, { invoiceId: stationeryInvoice.id, date: "2026-09-07", amount: 15_000, method: "bank", bankTxnRef: "EFT-100240" }, asOfficer);

const zesaInvoice = createSupplierInvoice(
  data,
  {
    supplierId: suppliers[1].id,
    date: "2026-09-03",
    dueDate: "2026-09-25",
    lines: [{ description: "Electricity — August 2026", accountId: electricity.id, amount: 80_000 }], // $800 > $500 threshold
  },
  asOfficer
);
// Above the $500 threshold: needs a second approver different from the poster.
recordSupplierPayment(
  data,
  { invoiceId: zesaInvoice.id, date: "2026-09-08", amount: 80_000, method: "bank", bankTxnRef: "EFT-100255", approvedBy: viceChancellor.id },
  asOfficer
);

// --- Budgets (Phase 2) — one in each workflow state, so every stage of
// the approval pipeline is directly demoable. Electricity already has
// $800 of real posted expense (from the ZESA invoice above), so its
// budget line shows a genuine variance once approved.
const electricityBudget = createBudget(
  data,
  { name: "Q3 Electricity — Main Campus", accountId: electricity.id, periodId: openPeriod.id, amount: 70_000, notes: "Based on last year's Q3 usage plus 10%." },
  asBudgetOfficer
);
submitBudget(data, electricityBudget.id, asBudgetOfficer);
// Review and approval are now both a Vice-Chancellor action (the role
// consolidates what used to be separate Finance Manager and Principal
// steps) — separation of duties still holds one level up: Budget Officer
// creates/submits, Vice-Chancellor reviews/approves.
reviewBudget(data, electricityBudget.id, asViceChancellor);
approveBudget(data, electricityBudget.id, asViceChancellor);
lockBudget(data, electricityBudget.id, asViceChancellor);

const tuitionBudget = createBudget(
  data,
  { name: "Q3 Tuition Fee Income", accountId: tuitionIncome.id, periodId: openPeriod.id, amount: 1_200_000, notes: "Projected from enrolment numbers." },
  asBudgetOfficer
);
submitBudget(data, tuitionBudget.id, asBudgetOfficer);
reviewBudget(data, tuitionBudget.id, asViceChancellor);
// Left "reviewed", not yet approved — demonstrates the Vice-Chancellor's
// pending-approval queue on Management Accounts.

createBudget(
  data,
  { name: "Q3 Teaching Materials & Stationery", accountId: stationery.id, periodId: openPeriod.id, amount: 25_000 },
  asBudgetOfficer
);
// Left in "draft" — demonstrates a budget still being worked on.

store.save();

console.log("Seed complete.");
console.log(`  ${data.accounts.length} accounts, ${data.periods.length} periods, ${data.users.length} users,`);
console.log(`  ${data.students.length} students, ${data.suppliers.length} suppliers,`);
console.log(`  ${data.invoices.length} invoices, ${data.payments.length} payments, ${data.journalEntries.length} journal entries.`);
console.log("");
console.log("Demo logins (username / password):");
console.log("  admin / Admin123!            — System Administrator (full access)");
console.log("  vc / Chancellor123!          — Vice-Chancellor (reverse journals, close periods, approve AP payments/budgets/journals, Management Accounts, payroll admin)");
console.log("  officer / Officer123!        — Accounts Officer (post transactions, cannot reverse or close periods)");
console.log("  bursar / Bursar123!          — Bursar (student billing & receipts only)");
console.log("  auditor / Audit123!          — Auditor (read-only, including the audit log)");
console.log("  itadmin / ITAdmin123!        — IT Administrator (user directory + audit log only)");
console.log("  budgetofficer / Budget123!   — Budget Officer (create/submit budgets)");
console.log(`Seeded at ${nowIso()}`);
