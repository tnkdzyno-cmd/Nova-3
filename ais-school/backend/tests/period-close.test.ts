import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { Store } from "../src/store.js";
import { closeChecklist, yearEndClose } from "../src/services/periodClose.js";
import { postJournalEntry, trialBalance } from "../src/services/ledger.js";
import { newId } from "../src/util.js";
import type { AuthedUser } from "../src/middleware/auth.js";
import type { Account, Period } from "../src/types.js";

const admin: AuthedUser = { id: "u1", username: "admin", role: "admin", fullName: "Admin" };

let store: Store;
let bank: Account, income: Account, expense: Account, retainedEarnings: Account;
let period: Period;

beforeEach(() => {
  store = new Store(false);
  bank = { id: newId(), code: "1010", name: "Bank", type: "asset", parentId: null, costCenterFlag: false, isActive: true, isControlAccount: "BANK" };
  income = { id: newId(), code: "4000", name: "Tuition Fees", type: "income", parentId: null, costCenterFlag: false, isActive: true };
  expense = { id: newId(), code: "5000", name: "Salaries", type: "expense", parentId: null, costCenterFlag: false, isActive: true };
  retainedEarnings = { id: newId(), code: "3000", name: "Retained Earnings", type: "equity", parentId: null, costCenterFlag: false, isActive: true, isControlAccount: "RETAINED_EARNINGS" };
  store.data.accounts.push(bank, income, expense, retainedEarnings);
  period = { id: newId(), name: "2026-Q3", startDate: "2026-07-01", endDate: "2026-09-30", status: "open" };
  store.data.periods.push(period);
});

describe("closeChecklist", () => {
  test("passes 'trial balance balanced' and 'no earlier open periods' with a clean period", () => {
    const items = closeChecklist(store.data, period.id);
    const tbItem = items.find((i) => i.label.includes("Trial balance"));
    const earlierItem = items.find((i) => i.label.includes("earlier periods"));
    assert.equal(tbItem?.passed, true);
    assert.equal(earlierItem?.passed, true);
  });

  test("flags an earlier open period", () => {
    const earlier: Period = { id: newId(), name: "2026-Q2", startDate: "2026-04-01", endDate: "2026-06-30", status: "open" };
    store.data.periods.push(earlier);
    const items = closeChecklist(store.data, period.id);
    const earlierItem = items.find((i) => i.label.includes("earlier periods"));
    assert.equal(earlierItem?.passed, false);
    assert.match(earlierItem?.detail || "", /2026-Q2/);
  });

  test("throws for an unknown period", () => {
    assert.throws(() => closeChecklist(store.data, "nonexistent"), /not found/i);
  });
});

describe("yearEndClose", () => {
  test("zeros income and expense into Retained Earnings and closes the period", () => {
    postJournalEntry(
      store.data,
      { date: "2026-08-01", description: "Fees received", lines: [{ accountId: bank.id, debit: 100000 }, { accountId: income.id, credit: 100000 }] },
      admin
    );
    postJournalEntry(
      store.data,
      { date: "2026-08-05", description: "Salaries paid", lines: [{ accountId: expense.id, debit: 60000 }, { accountId: bank.id, credit: 60000 }] },
      admin
    );

    const entry = yearEndClose(store.data, period.id, admin);
    assert.equal(entry.source, "YEAR_END_CLOSE");

    // Income and expense accounts are now net zero for the period (the
    // row still exists in the trial balance — it just nets to 0/0).
    const tb = trialBalance(store.data, period.endDate);
    const incomeRow = tb.rows.find((r) => r.accountId === income.id);
    const expenseRow = tb.rows.find((r) => r.accountId === expense.id);
    assert.equal(incomeRow?.debit, 0);
    assert.equal(incomeRow?.credit, 0);
    assert.equal(expenseRow?.debit, 0);
    assert.equal(expenseRow?.credit, 0);

    // Retained Earnings picked up the $400 net surplus (100000 - 60000 = 40000 cents).
    const reRow = tb.rows.find((r) => r.accountId === retainedEarnings.id);
    assert.equal(reRow?.credit, 40000);

    // The period itself is now closed.
    const closedPeriod = store.data.periods.find((p) => p.id === period.id);
    assert.equal(closedPeriod?.status, "closed");

    // Trial balance still balances after the closing entry.
    assert.equal(tb.totalDebit, tb.totalCredit);
  });

  test("rejects running year-end close twice on the same period", () => {
    postJournalEntry(
      store.data,
      { date: "2026-08-01", description: "Fees received", lines: [{ accountId: bank.id, debit: 100000 }, { accountId: income.id, credit: 100000 }] },
      admin
    );
    yearEndClose(store.data, period.id, admin);
    // Period is now closed, so a second attempt should fail on that basis
    // even before the "already closed" duplicate check would matter.
    assert.throws(() => yearEndClose(store.data, period.id, admin), /already closed/i);
  });

  test("rejects closing a period with no income/expense activity at all", () => {
    assert.throws(() => yearEndClose(store.data, period.id, admin), /nothing to close/i);
  });
});
