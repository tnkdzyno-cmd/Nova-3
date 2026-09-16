import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import jwt from "jsonwebtoken";
import type { AddressInfo } from "node:net";
import { store } from "../src/store.js";
import { JWT_SECRET } from "../src/middleware/auth.js";
import { journalRouter } from "../src/routes/journal.js";
import { errorHandler } from "../src/middleware/errors.js";
import { postJournalEntry } from "../src/services/ledger.js";
import { newId } from "../src/util.js";
import * as XLSX from "xlsx";
import type { AuthedUser } from "../src/middleware/auth.js";

// Full HTTP-level test: real Express app, real JWTs. Unlike util.test.ts
// (which tests paginate()/toCsv() as pure functions) this confirms the
// journal-entries ROUTE actually wires filters, pagination, and export
// format switching together correctly.

let baseUrl: string;
let server: ReturnType<typeof app.listen>;
const app = express();
app.use(express.json());
app.use("/api/journal-entries", journalRouter);
app.use(errorHandler);

const vc: AuthedUser = { id: newId(), username: "vc", role: "vice_chancellor", fullName: "Test Vice Chancellor" };
function authHeader() {
  return { Authorization: `Bearer ${jwt.sign(vc, JWT_SECRET, { expiresIn: "1h" })}` };
}

let bankId: string, incomeId: string;

before(async () => {
  store.reset();
  const bank = { id: newId(), code: "1010", name: "Bank", type: "asset" as const, parentId: null, costCenterFlag: false, isActive: true };
  const income = { id: newId(), code: "4000", name: "Fee Income", type: "income" as const, parentId: null, costCenterFlag: false, isActive: true };
  store.data.accounts.push(bank, income);
  bankId = bank.id;
  incomeId = income.id;
  store.data.periods.push({ id: newId(), name: "2026-Q3", startDate: "2026-07-01", endDate: "2026-09-30", status: "open" });
  store.data.users.push({ id: vc.id, username: vc.username, passwordHash: "x", role: vc.role, fullName: vc.fullName, lastLogin: null, isActive: true });

  // Post 23 distinct entries so pagination has more than one page to work with.
  for (let i = 0; i < 23; i++) {
    postJournalEntry(
      store.data,
      {
        date: "2026-08-01",
        description: i === 0 ? "Insurance premium accrual" : `Entry number ${i}`,
        lines: [{ accountId: bankId, debit: 100 }, { accountId: incomeId, credit: 100 }],
      },
      vc
    );
  }

  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const addr = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

after(() => {
  server.close();
});

describe("GET /api/journal-entries — pagination, filtering, export", () => {
  test("with no page param, returns every entry (dashboard.html depends on this)", async () => {
    const res = await fetch(`${baseUrl}/api/journal-entries`, { headers: authHeader() });
    const body = (await res.json()) as any;
    assert.equal(res.status, 200);
    assert.equal(body.journalEntries.length, 23);
    assert.equal(body.total, 23);
  });

  test("with page + pageSize, returns a correctly-sized slice and metadata", async () => {
    const res = await fetch(`${baseUrl}/api/journal-entries?page=1&pageSize=10`, { headers: authHeader() });
    const body = (await res.json()) as any;
    assert.equal(body.journalEntries.length, 10);
    assert.equal(body.total, 23);
    assert.equal(body.totalPages, 3);
    assert.equal(body.page, 1);
  });

  test("second page returns the remaining distinct entries", async () => {
    const page1 = (await (await fetch(`${baseUrl}/api/journal-entries?page=1&pageSize=10`, { headers: authHeader() })).json()) as any;
    const page2 = (await (await fetch(`${baseUrl}/api/journal-entries?page=2&pageSize=10`, { headers: authHeader() })).json()) as any;
    const ids1 = new Set(page1.journalEntries.map((e: { id: string }) => e.id));
    const ids2 = new Set(page2.journalEntries.map((e: { id: string }) => e.id));
    assert.equal([...ids2].some((id) => ids1.has(id)), false, "pages should not overlap");
  });

  test("search filters by description or refNo", async () => {
    const res = await fetch(`${baseUrl}/api/journal-entries?search=insurance`, { headers: authHeader() });
    const body = (await res.json()) as any;
    assert.equal(body.journalEntries.length, 1);
    assert.match(body.journalEntries[0].description, /Insurance/);
  });

  test("every entry is enriched with a refNo and createdByName", async () => {
    const res = await fetch(`${baseUrl}/api/journal-entries?page=1&pageSize=1`, { headers: authHeader() });
    const body = (await res.json()) as any;
    assert.match(body.journalEntries[0].refNo, /^JE-2026-\d{4}$/);
    assert.equal(body.journalEntries[0].createdByName, "Test Vice Chancellor");
  });

  test("format=csv returns a CSV file with the same filters applied", async () => {
    const res = await fetch(`${baseUrl}/api/journal-entries?format=csv&search=insurance`, { headers: authHeader() });
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") || "", /text\/csv/);
    const text = await res.text();
    const lines = text.trim().split("\n");
    assert.equal(lines.length, 2); // header + the one matching row
    assert.match(lines[0], /^Ref No,Date,Description/);
  });

  test("format=pdf returns a PDF file", async () => {
    const res = await fetch(`${baseUrl}/api/journal-entries?format=pdf`, { headers: authHeader() });
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") || "", /application\/pdf/);
    const buf = Buffer.from(await res.arrayBuffer());
    assert.equal(buf.subarray(0, 4).toString(), "%PDF");
  });

  test("format=xlsx returns a genuine, parseable Excel workbook", async () => {
    const res = await fetch(`${baseUrl}/api/journal-entries?format=xlsx&search=insurance`, { headers: authHeader() });
    assert.equal(res.status, 200);
    assert.match(
      res.headers.get("content-type") || "",
      /application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet/
    );
    const buf = Buffer.from(await res.arrayBuffer());
    // .xlsx files are zip archives — "PK" magic bytes confirm it's not just CSV with a renamed extension.
    assert.equal(buf.subarray(0, 2).toString(), "PK");
    const workbook = XLSX.read(buf, { type: "buffer" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as string[][];
    assert.deepEqual(rows[0].slice(0, 2), ["Ref No", "Date"]);
    assert.equal(rows.length, 2); // header + the one matching row
    assert.match(rows[1][2], /Insurance/);
  });

  test("export ignores pagination — CSV includes all 23 matching rows, not just one page", async () => {
    const res = await fetch(`${baseUrl}/api/journal-entries?format=csv&page=1&pageSize=5`, { headers: authHeader() });
    const text = await res.text();
    const dataLines = text.trim().split("\n").slice(1); // drop header
    assert.equal(dataLines.length, 23);
  });
});
