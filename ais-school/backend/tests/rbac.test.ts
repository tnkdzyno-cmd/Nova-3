import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import jwt from "jsonwebtoken";
import type { AddressInfo } from "node:net";
import { store } from "../src/store.js";
import { JWT_SECRET } from "../src/middleware/auth.js";
import { journalRouter } from "../src/routes/journal.js";
import { payrollRouter } from "../src/routes/payroll.js";
import { periodsRouter } from "../src/routes/periods.js";
import { errorHandler } from "../src/middleware/errors.js";
import { postJournalEntry } from "../src/services/ledger.js";
import { newId } from "../src/util.js";
import type { AuthedUser } from "../src/middleware/auth.js";

// Full HTTP-level test: a real Express app, real JWTs, real middleware chain.
// This is what actually guarantees the spec's permission acceptance test:
// "Finance clerk cannot access payroll admin screens; only finance vc
// can reverse posted journals."

let baseUrl: string;
let server: ReturnType<typeof app.listen>;
const app = express();
app.use(express.json());
app.use("/api/journal-entries", journalRouter);
app.use("/api/payroll", payrollRouter);
app.use("/api/periods", periodsRouter);
app.use(errorHandler);

function tokenFor(user: AuthedUser): string {
  return jwt.sign(user, JWT_SECRET, { expiresIn: "1h" });
}

const clerk: AuthedUser = { id: newId(), username: "officer1", role: "accounts_officer", fullName: "Test Officer" };
const vc: AuthedUser = { id: newId(), username: "vc", role: "vice_chancellor", fullName: "Test Vice Chancellor" };

let bankId: string;
let incomeId: string;
let postedEntryId: string;

before(async () => {
  store.reset();
  const bank = { id: newId(), code: "1010", name: "Bank", type: "asset" as const, parentId: null, costCenterFlag: false, isActive: true };
  const income = { id: newId(), code: "4000", name: "Fee Income", type: "income" as const, parentId: null, costCenterFlag: false, isActive: true };
  store.data.accounts.push(bank, income);
  bankId = bank.id;
  incomeId = income.id;
  store.data.periods.push({ id: newId(), name: "2026-Q3", startDate: "2026-07-01", endDate: "2026-09-30", status: "open" });

  const entry = postJournalEntry(
    store.data,
    { date: "2026-08-01", description: "Seed entry", lines: [{ accountId: bankId, debit: 1000 }, { accountId: incomeId, credit: 1000 }] },
    vc
  );
  postedEntryId = entry.id;

  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const addr = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

after(() => {
  server.close();
});

describe("RBAC — payroll admin and journal reversal", () => {
  test("accounts officer is denied access to the payroll admin route (403)", async () => {
    const res = await fetch(`${baseUrl}/api/payroll/import-journal`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokenFor(clerk)}` },
      body: JSON.stringify({ date: "2026-08-01", lines: [{ accountId: bankId, debit: 100 }, { accountId: incomeId, credit: 100 }] }),
    });
    assert.equal(res.status, 403);
    const body = (await res.json()) as { error: { code: string } };
    assert.equal(body.error.code, "FORBIDDEN");
  });

  test("vice-chancellor IS allowed to reach the payroll admin route", async () => {
    const res = await fetch(`${baseUrl}/api/payroll/import-journal`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokenFor(vc)}` },
      body: JSON.stringify({ date: "2026-08-01", description: "Payroll", lines: [{ accountId: bankId, credit: 100 }, { accountId: incomeId, debit: 100 }] }),
    });
    assert.equal(res.status, 201);
  });

  test("accounts officer cannot reverse a posted journal entry (403)", async () => {
    const res = await fetch(`${baseUrl}/api/journal-entries/${postedEntryId}/reverse`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokenFor(clerk)}` },
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 403);
  });

  test("vice-chancellor CAN reverse a posted journal entry", async () => {
    const res = await fetch(`${baseUrl}/api/journal-entries/${postedEntryId}/reverse`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokenFor(vc)}` },
      body: JSON.stringify({ date: "2026-08-02" }),
    });
    assert.equal(res.status, 201);
  });

  test("accounts officer cannot close an accounting period (403)", async () => {
    const period = store.data.periods[0];
    const res = await fetch(`${baseUrl}/api/periods/${period.id}/close`, {
      method: "POST",
      headers: { Authorization: `Bearer ${tokenFor(clerk)}` },
    });
    assert.equal(res.status, 403);
  });

  test("requests without a token are rejected (401)", async () => {
    const res = await fetch(`${baseUrl}/api/journal-entries`);
    assert.equal(res.status, 401);
  });

  test("a role with report:view but not journal:read can still list periods (regression: bursar/budget_officer need this for dropdowns)", async () => {
    const reportOnlyRole: AuthedUser = { id: newId(), username: "bursar1", role: "bursar", fullName: "Test Bursar" };
    const res = await fetch(`${baseUrl}/api/periods`, { headers: { Authorization: `Bearer ${tokenFor(reportOnlyRole)}` } });
    assert.equal(res.status, 200);
  });
});
