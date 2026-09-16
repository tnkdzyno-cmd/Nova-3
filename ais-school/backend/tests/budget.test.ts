import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { Store } from "../src/store.js";
import { createBudget, submitBudget, reviewBudget, approveBudget, lockBudget, rejectBudget, budgetVsActual } from "../src/services/budget.js";
import { postJournalEntry } from "../src/services/ledger.js";
import { newId } from "../src/util.js";
import type { AuthedUser } from "../src/middleware/auth.js";
import type { Account, Period } from "../src/types.js";

const officer: AuthedUser = { id: "u1", username: "budgetofficer", role: "budget_officer", fullName: "Budget Officer" };
const vc: AuthedUser = { id: "u2", username: "vc", role: "vice_chancellor", fullName: "Vice Chancellor" };

let store: Store;
let expense: Account;
let bank: Account;
let period: Period;

beforeEach(() => {
  store = new Store(false);
  expense = { id: newId(), code: "5010", name: "Electricity Expense", type: "expense", parentId: null, costCenterFlag: false, isActive: true };
  bank = { id: newId(), code: "1010", name: "Bank", type: "asset", parentId: null, costCenterFlag: false, isActive: true, isControlAccount: "BANK" };
  store.data.accounts.push(expense, bank);
  period = { id: newId(), name: "2027-Q1", startDate: "2027-01-01", endDate: "2027-03-31", status: "open" };
  store.data.periods.push(period);
});

describe("Budget workflow — draft to locked", () => {
  test("creates a budget in draft status with a sequential refNo", () => {
    const b = createBudget(store.data, { name: "Q1 Electricity", accountId: expense.id, periodId: period.id, amount: 50000 }, officer);
    assert.equal(b.status, "draft");
    assert.match(b.refNo, /^BUD-2027-\d{4}$/);
  });

  test("walks the full workflow: draft -> submitted -> reviewed -> approved -> locked", () => {
    let b = createBudget(store.data, { name: "Q1 Electricity", accountId: expense.id, periodId: period.id, amount: 50000 }, officer);
    b = submitBudget(store.data, b.id, officer);
    assert.equal(b.status, "submitted");
    assert.ok(b.submittedAt);

    b = reviewBudget(store.data, b.id, vc);
    assert.equal(b.status, "reviewed");
    assert.equal(b.reviewedBy, vc.id);

    b = approveBudget(store.data, b.id, vc);
    assert.equal(b.status, "approved");
    assert.equal(b.approvedBy, vc.id);

    b = lockBudget(store.data, b.id, vc);
    assert.equal(b.status, "locked");
    assert.ok(b.lockedAt);
  });

  test("rejects out-of-order transitions", () => {
    const b = createBudget(store.data, { name: "Q1 Electricity", accountId: expense.id, periodId: period.id, amount: 50000 }, officer);
    // Still draft — can't review or approve or lock yet.
    assert.throws(() => reviewBudget(store.data, b.id, vc), /Cannot review/);
    assert.throws(() => approveBudget(store.data, b.id, vc), /Cannot approve/);
    assert.throws(() => lockBudget(store.data, b.id, vc), /Cannot lock/);
  });

  test("cannot submit the same budget twice", () => {
    const b = createBudget(store.data, { name: "Q1 Electricity", accountId: expense.id, periodId: period.id, amount: 50000 }, officer);
    submitBudget(store.data, b.id, officer);
    assert.throws(() => submitBudget(store.data, b.id, officer), /Cannot submit/);
  });

  test("reject sends a submitted budget back to draft, clearing submission fields", () => {
    let b = createBudget(store.data, { name: "Q1 Electricity", accountId: expense.id, periodId: period.id, amount: 50000 }, officer);
    b = submitBudget(store.data, b.id, officer);
    b = rejectBudget(store.data, b.id, vc, "Amount looks too high for this account");
    assert.equal(b.status, "draft");
    assert.equal(b.submittedAt, null);
    assert.match(b.notes || "", /too high/);
  });

  test("every transition writes its own audit entry", () => {
    const before = store.data.auditLog.length;
    let b = createBudget(store.data, { name: "Q1 Electricity", accountId: expense.id, periodId: period.id, amount: 50000 }, officer);
    b = submitBudget(store.data, b.id, officer);
    reviewBudget(store.data, b.id, vc);
    const actions = store.data.auditLog.slice(before).map((a) => a.action);
    assert.deepEqual(actions, ["CREATE", "SUBMIT", "REVIEW"]);
    assert.equal(store.data.auditLog.slice(before)[0].module, "Budgeting");
  });
});

describe("Budget vs. actual", () => {
  test("computes variance against real posted GL activity for an expense account", () => {
    const b = createBudget(store.data, { name: "Q1 Electricity", accountId: expense.id, periodId: period.id, amount: 50000 }, officer);
    // Post $450.00 of actual electricity expense within the period.
    postJournalEntry(
      store.data,
      { date: "2027-02-01", description: "Electricity bill", lines: [{ accountId: expense.id, debit: 45000 }, { accountId: bank.id, credit: 45000 }] },
      vc
    );
    const result = budgetVsActual(store.data, b);
    assert.equal(result.budgeted, 50000);
    assert.equal(result.actual, 45000);
    assert.equal(result.variance, -5000); // under budget by $50
    assert.equal(result.variancePercent, -10); // 10% under
  });

  test("an income account's actual is credit-natured (more income than budgeted is a positive variance)", () => {
    const income: Account = { id: newId(), code: "4000", name: "Tuition Fees", type: "income", parentId: null, costCenterFlag: false, isActive: true };
    store.data.accounts.push(income);
    const b = createBudget(store.data, { name: "Q1 Tuition", accountId: income.id, periodId: period.id, amount: 100000 }, officer);
    postJournalEntry(
      store.data,
      { date: "2027-02-01", description: "Tuition received", lines: [{ accountId: bank.id, debit: 120000 }, { accountId: income.id, credit: 120000 }] },
      vc
    );
    const result = budgetVsActual(store.data, b);
    assert.equal(result.actual, 120000);
    assert.equal(result.variance, 20000); // $200 more income than budgeted
  });
});
