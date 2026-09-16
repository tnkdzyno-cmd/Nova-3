import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import jwt from "jsonwebtoken";
import type { AddressInfo } from "node:net";
import { store } from "../src/store.js";
import { JWT_SECRET } from "../src/middleware/auth.js";
import { journalRouter } from "../src/routes/journal.js";
import { suppliersRouter } from "../src/routes/suppliers.js";
import { usersRouter } from "../src/routes/users.js";
import { errorHandler } from "../src/middleware/errors.js";
import { newId } from "../src/util.js";
import type { AuthedUser } from "../src/middleware/auth.js";
import type { User } from "../src/types.js";

// Full HTTP-level test: an auditor's static role permission
// (journal:read, supplier:read, etc.) is a ceiling, not a grant — the
// specific scope must also be recorded on their User record, checked live
// on every request (not cached in the JWT), and only an admin/it_admin
// can change it via PUT /api/users/:id/data-scopes.

let baseUrl: string;
let server: ReturnType<typeof app.listen>;
const app = express();
app.use(express.json());
app.use("/api/journal-entries", journalRouter);
app.use("/api/suppliers", suppliersRouter);
app.use("/api/users", usersRouter);
app.use(errorHandler);

const admin: AuthedUser = { id: newId(), username: "admin1", role: "admin", fullName: "Test Admin" };
const officer: AuthedUser = { id: newId(), username: "officer1", role: "accounts_officer", fullName: "Test Officer" };
let auditorRecord: User;
let auditorAuth: AuthedUser;

function tokenFor(user: AuthedUser): string {
  return jwt.sign(user, JWT_SECRET, { expiresIn: "1h" });
}

before(async () => {
  store.reset();
  store.data.periods.push({ id: newId(), name: "2026-Q3", startDate: "2026-07-01", endDate: "2026-09-30", status: "open" });
  store.data.users.push({ id: admin.id, username: admin.username, passwordHash: "x", role: "admin", fullName: admin.fullName, lastLogin: null, isActive: true });
  store.data.users.push({ id: officer.id, username: officer.username, passwordHash: "x", role: "accounts_officer", fullName: officer.fullName, lastLogin: null, isActive: true });

  auditorRecord = { id: newId(), username: "auditor1", passwordHash: "x", role: "auditor", fullName: "Test Auditor", lastLogin: null, isActive: true, dataScopes: ["journal"] };
  store.data.users.push(auditorRecord);
  auditorAuth = { id: auditorRecord.id, username: auditorRecord.username, role: "auditor", fullName: auditorRecord.fullName };

  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const addr = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

after(() => {
  server.close();
});

describe("Auditor data scopes — granted vs. not granted", () => {
  test("auditor CAN read journal (scope granted in setup)", async () => {
    const res = await fetch(`${baseUrl}/api/journal-entries`, { headers: { Authorization: `Bearer ${tokenFor(auditorAuth)}` } });
    assert.equal(res.status, 200);
  });

  test("auditor CANNOT read suppliers (scope not granted) — clear SCOPE_NOT_GRANTED error, not a generic 403", async () => {
    const res = await fetch(`${baseUrl}/api/suppliers/invoices`, { headers: { Authorization: `Bearer ${tokenFor(auditorAuth)}` } });
    assert.equal(res.status, 403);
    const body = (await res.json()) as { error: { code: string; message: string } };
    assert.equal(body.error.code, "SCOPE_NOT_GRANTED");
    assert.match(body.error.message, /suppliers/);
  });

  test("non-auditor roles are completely unaffected by data scopes (officer has no scopes set at all, still works)", async () => {
    const res = await fetch(`${baseUrl}/api/journal-entries`, { headers: { Authorization: `Bearer ${tokenFor(officer)}` } });
    assert.equal(res.status, 200);
  });
});

describe("Admin-managed scope grants", () => {
  test("admin can grant a new scope, and it takes effect immediately on the next request (live lookup, not JWT-cached)", async () => {
    // Not granted yet.
    let res = await fetch(`${baseUrl}/api/suppliers/invoices`, { headers: { Authorization: `Bearer ${tokenFor(auditorAuth)}` } });
    assert.equal(res.status, 403);

    // Admin grants it — same JWT token, no re-login needed.
    const grantRes = await fetch(`${baseUrl}/api/users/${auditorRecord.id}/data-scopes`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokenFor(admin)}` },
      body: JSON.stringify({ scopes: ["journal", "suppliers"] }),
    });
    assert.equal(grantRes.status, 200);

    res = await fetch(`${baseUrl}/api/suppliers/invoices`, { headers: { Authorization: `Bearer ${tokenFor(auditorAuth)}` } });
    assert.equal(res.status, 200);

    // Revoke again — also takes effect immediately.
    await fetch(`${baseUrl}/api/users/${auditorRecord.id}/data-scopes`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokenFor(admin)}` },
      body: JSON.stringify({ scopes: ["journal"] }),
    });
    res = await fetch(`${baseUrl}/api/suppliers/invoices`, { headers: { Authorization: `Bearer ${tokenFor(auditorAuth)}` } });
    assert.equal(res.status, 403);
  });

  test("a non-admin (accounts officer) cannot grant scopes", async () => {
    const res = await fetch(`${baseUrl}/api/users/${auditorRecord.id}/data-scopes`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokenFor(officer)}` },
      body: JSON.stringify({ scopes: ["journal", "suppliers"] }),
    });
    assert.equal(res.status, 403);
  });

  test("rejects setting scopes on a non-auditor account", async () => {
    const res = await fetch(`${baseUrl}/api/users/${officer.id}/data-scopes`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokenFor(admin)}` },
      body: JSON.stringify({ scopes: ["journal"] }),
    });
    assert.equal(res.status, 400);
  });

  test("rejects an invalid scope name", async () => {
    const res = await fetch(`${baseUrl}/api/users/${auditorRecord.id}/data-scopes`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokenFor(admin)}` },
      body: JSON.stringify({ scopes: ["not-a-real-scope"] }),
    });
    assert.equal(res.status, 400);
  });

  test("GET /api/users surfaces the auditor's current scopes for the admin UI, but not for other roles' entries", async () => {
    const res = await fetch(`${baseUrl}/api/users`, { headers: { Authorization: `Bearer ${tokenFor(admin)}` } });
    const body = (await res.json()) as { users: { role: string; dataScopes?: string[] }[] };
    const auditorEntry = body.users.find((u) => u.role === "auditor");
    const officerEntry = body.users.find((u) => u.role === "accounts_officer");
    assert.ok(Array.isArray(auditorEntry?.dataScopes));
    assert.equal(officerEntry?.dataScopes, undefined);
  });
});
