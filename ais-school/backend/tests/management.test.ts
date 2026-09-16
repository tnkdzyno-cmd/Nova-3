import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { Store } from "../src/store.js";
import { managementSummary } from "../src/services/management.js";
import { postJournalEntry } from "../src/services/ledger.js";
import { createInvoice, recordPayment } from "../src/services/ar.js";
import { createBudget, submitBudget } from "../src/services/budget.js";
import { newId } from "../src/util.js";
import type { AuthedUser } from "../src/middleware/auth.js";
import type { Account, Period, Student } from "../src/types.js";

const admin: AuthedUser = { id: "u1", username: "admin", role: "admin", fullName: "Admin" };
const officer: AuthedUser = { id: "u2", username: "officer", role: "accounts_officer", fullName: "Officer" };

let store: Store;
let bank: Account, ar: Account, income: Account;
let period: Period;
let student: Student;

beforeEach(() => {
  store = new Store(false);
  bank = { id: newId(), code: "1010", name: "Bank", type: "asset", parentId: null, costCenterFlag: false, isActive: true, isControlAccount: "BANK" };
  ar = { id: newId(), code: "1200", name: "AR", type: "asset", parentId: null, costCenterFlag: false, isActive: true, isControlAccount: "AR" };
  income = { id: newId(), code: "4000", name: "Tuition Fees", type: "income", parentId: null, costCenterFlag: false, isActive: true };
  store.data.accounts.push(bank, ar, income);
  period = { id: newId(), name: "2026-Q3", startDate: "2026-07-01", endDate: "2026-09-30", status: "open" };
  store.data.periods.push(period);
  student = { id: newId(), studentNumber: "STU-001", name: "Test Student", program: "O-Level", guardianContact: "", status: "active" };
  store.data.students.push(student);
});

describe("managementSummary", () => {
  test("reflects cash position and net surplus from real posted activity", () => {
    postJournalEntry(
      store.data,
      { date: "2026-08-01", description: "Opening cash", lines: [{ accountId: bank.id, debit: 500000 }, { accountId: income.id, credit: 500000 }] },
      admin
    );
    const summary = managementSummary(store.data);
    assert.equal(summary.cashPositionCents, 500000);
    assert.equal(summary.netSurplusCents, 500000);
    assert.equal(summary.trialBalanceOk, true);
  });

  test("AR outstanding reflects unpaid invoices", () => {
    const invoice = createInvoice(store.data, { studentId: student.id, date: "2026-08-01", dueDate: "2026-08-31", lines: [{ description: "Tuition", accountId: income.id, amount: 10000 }] }, officer);
    recordPayment(store.data, { invoiceId: invoice.id, date: "2026-08-05", amount: 4000, method: "bank" }, officer);
    const summary = managementSummary(store.data);
    assert.equal(summary.totalAROutstandingCents, 6000);
  });

  test("pending budget approvals lists submitted/reviewed budgets, not drafts or already-approved ones", () => {
    const draft = createBudget(store.data, { name: "Draft budget", accountId: income.id, periodId: period.id, amount: 10000 }, admin);
    const submitted = createBudget(store.data, { name: "Submitted budget", accountId: income.id, periodId: period.id, amount: 20000 }, admin);
    submitBudget(store.data, submitted.id, admin);

    const summary = managementSummary(store.data);
    const refNos = summary.pendingBudgetApprovals.map((b) => b.refNo);
    assert.ok(refNos.includes(submitted.refNo));
    assert.ok(!refNos.includes(draft.refNo));
  });
});
