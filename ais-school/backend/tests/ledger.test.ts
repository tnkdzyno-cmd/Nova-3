import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { Store } from "../src/store.js";
import { postJournalEntry, reverseJournalEntry, trialBalance } from "../src/services/ledger.js";
import type { AuthedUser } from "../src/middleware/auth.js";
import { newId } from "../src/util.js";
import type { Account, Period } from "../src/types.js";

const testUser: AuthedUser = { id: "u1", username: "tester", role: "admin", fullName: "Test User" };

function freshStoreWithAccounts() {
  const store = new Store(false);
  const bank: Account = { id: newId(), code: "1010", name: "Bank", type: "asset", parentId: null, costCenterFlag: false, isActive: true };
  const income: Account = { id: newId(), code: "4000", name: "Fee Income", type: "income", parentId: null, costCenterFlag: false, isActive: true };
  const openPeriod: Period = { id: newId(), name: "2026-Q3", startDate: "2026-07-01", endDate: "2026-09-30", status: "open" };
  const closedPeriod: Period = { id: newId(), name: "2026-Q2", startDate: "2026-04-01", endDate: "2026-06-30", status: "closed" };
  store.data.accounts.push(bank, income);
  store.data.periods.push(openPeriod, closedPeriod);
  return { store, bank, income, openPeriod, closedPeriod };
}

describe("General ledger — double-entry integrity", () => {
  test("rejects an unbalanced journal entry", () => {
    const { store, bank, income } = freshStoreWithAccounts();
    assert.throws(
      () =>
        postJournalEntry(
          store.data,
          {
            date: "2026-08-01",
            description: "Unbalanced",
            lines: [
              { accountId: bank.id, debit: 1000 },
              { accountId: income.id, credit: 900 },
            ],
          },
          testUser
        ),
      /does not balance/
    );
  });

  test("rejects posting to a closed period", () => {
    const { store, bank, income } = freshStoreWithAccounts();
    assert.throws(
      () =>
        postJournalEntry(
          store.data,
          {
            date: "2026-05-15", // falls inside the closed period
            description: "Late entry",
            lines: [
              { accountId: bank.id, debit: 1000 },
              { accountId: income.id, credit: 1000 },
            ],
          },
          testUser
        ),
      /closed/i
    );
  });

  test("accepts a balanced entry in an open period and writes an audit record", () => {
    const { store, bank, income } = freshStoreWithAccounts();
    const before = store.data.auditLog.length;
    const entry = postJournalEntry(
      store.data,
      {
        date: "2026-08-01",
        description: "Fee received",
        lines: [
          { accountId: bank.id, debit: 5000 },
          { accountId: income.id, credit: 5000 },
        ],
      },
      testUser
    );
    assert.equal(entry.status, "posted");
    assert.equal(store.data.auditLog.length, before + 1);
    assert.equal(store.data.auditLog.at(-1)?.action, "POST");
  });

  test("trial balance always balances (total debits === total credits) across many postings", () => {
    const { store, bank, income } = freshStoreWithAccounts();
    for (let i = 0; i < 25; i++) {
      postJournalEntry(
        store.data,
        {
          date: "2026-08-01",
          description: `Entry ${i}`,
          lines: [
            { accountId: bank.id, debit: 100 + i },
            { accountId: income.id, credit: 100 + i },
          ],
        },
        testUser
      );
    }
    const tb = trialBalance(store.data);
    assert.equal(tb.totalDebit, tb.totalCredit);
  });

  test("reversing a posted entry swaps debits/credits and marks the original reversed", () => {
    const { store, bank, income } = freshStoreWithAccounts();
    const entry = postJournalEntry(
      store.data,
      { date: "2026-08-01", description: "Original", lines: [{ accountId: bank.id, debit: 2000 }, { accountId: income.id, credit: 2000 }] },
      testUser
    );
    const reversal = reverseJournalEntry(store.data, entry.id, testUser, "2026-08-02");

    const original = store.data.journalEntries.find((e) => e.id === entry.id)!;
    assert.equal(original.status, "reversed");
    assert.equal(original.reversedById, reversal.id);
    assert.equal(reversal.reversalOfId, entry.id);

    // Net effect of an entry plus its reversal on every account is zero.
    const tb = trialBalance(store.data);
    assert.equal(tb.totalDebit, tb.totalCredit);
  });

  test("cannot reverse an entry that is already reversed", () => {
    const { store, bank, income } = freshStoreWithAccounts();
    const entry = postJournalEntry(
      store.data,
      { date: "2026-08-01", description: "Original", lines: [{ accountId: bank.id, debit: 2000 }, { accountId: income.id, credit: 2000 }] },
      testUser
    );
    reverseJournalEntry(store.data, entry.id, testUser, "2026-08-02");
    assert.throws(() => reverseJournalEntry(store.data, entry.id, testUser, "2026-08-03"), /Only posted entries/);
  });

  test("rejects a line with both a debit and a credit", () => {
    const { store, bank, income } = freshStoreWithAccounts();
    assert.throws(() =>
      postJournalEntry(
        store.data,
        { date: "2026-08-01", description: "Bad line", lines: [{ accountId: bank.id, debit: 100, credit: 50 }, { accountId: income.id, credit: 50 }] },
        testUser
      )
    );
  });
});
