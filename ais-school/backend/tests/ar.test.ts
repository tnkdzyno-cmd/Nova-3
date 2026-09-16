import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { Store } from "../src/store.js";
import { createInvoice, recordPayment } from "../src/services/ar.js";
import { newId } from "../src/util.js";
import type { AuthedUser } from "../src/middleware/auth.js";
import type { Account, Period, Student } from "../src/types.js";

const user: AuthedUser = { id: "u1", username: "bursar1", role: "bursar", fullName: "Test Bursar" };

let store: Store;
let ar: Account, bank: Account, cash: Account, income: Account;
let student: Student;

beforeEach(() => {
  store = new Store(false);
  ar = { id: newId(), code: "1200", name: "AR — Students", type: "asset", parentId: null, costCenterFlag: false, isActive: true, isControlAccount: "AR" };
  bank = { id: newId(), code: "1010", name: "Bank", type: "asset", parentId: null, costCenterFlag: false, isActive: true, isControlAccount: "BANK" };
  cash = { id: newId(), code: "1000", name: "Cash on Hand", type: "asset", parentId: null, costCenterFlag: false, isActive: true, isControlAccount: "CASH" };
  income = { id: newId(), code: "4000", name: "Tuition Income", type: "income", parentId: null, costCenterFlag: false, isActive: true };
  store.data.accounts.push(ar, bank, cash, income);
  const period: Period = { id: newId(), name: "2026-Q3", startDate: "2026-07-01", endDate: "2026-09-30", status: "open" };
  store.data.periods.push(period);
  student = { id: newId(), studentNumber: "STU-001", name: "Test Student", program: "O-Level", guardianContact: "", status: "active" };
  store.data.students.push(student);
});

describe("AR — invoice -> payment -> balance workflow", () => {
  test("creating an invoice raises a balanced GL entry (Debit AR, Credit income)", () => {
    const invoice = createInvoice(store.data, { studentId: student.id, date: "2026-09-01", dueDate: "2026-09-30", lines: [{ description: "Tuition", accountId: income.id, amount: 10000 }] }, user);
    assert.equal(invoice.totalAmount, 10000);
    assert.equal(invoice.status, "open");
    const journal = store.data.journalEntries.find((j) => j.id === invoice.journalEntryId)!;
    const debitTotal = journal.lines.reduce((s, l) => s + l.debit, 0);
    const creditTotal = journal.lines.reduce((s, l) => s + l.credit, 0);
    assert.equal(debitTotal, creditTotal);
    assert.equal(debitTotal, 10000);
  });

  test("invoice, payment, and journal entry all carry a human-readable refNo distinct from the internal id", () => {
    const invoice = createInvoice(store.data, { studentId: student.id, date: "2026-09-01", dueDate: "2026-09-30", lines: [{ description: "Tuition", accountId: income.id, amount: 10000 }] }, user);
    assert.match(invoice.refNo, /^INV-2026-\d{4}$/);
    assert.notEqual(invoice.refNo, invoice.id);

    const journal = store.data.journalEntries.find((j) => j.id === invoice.journalEntryId)!;
    assert.match(journal.refNo, /^JE-2026-\d{4}$/);

    const payment = recordPayment(store.data, { invoiceId: invoice.id, date: "2026-09-05", amount: 10000, method: "cash" }, user);
    assert.match(payment.refNo, /^RCT-2026-\d{4}$/);
    assert.notEqual(payment.refNo, payment.id);
  });

  test("full payment marks invoice paid, updates balance, and both steps are audited", () => {
    const invoice = createInvoice(store.data, { studentId: student.id, date: "2026-09-01", dueDate: "2026-09-30", lines: [{ description: "Tuition", accountId: income.id, amount: 10000 }] }, user);
    const auditBefore = store.data.auditLog.length;

    const payment = recordPayment(store.data, { invoiceId: invoice.id, date: "2026-09-05", amount: 10000, method: "bank", bankTxnRef: "REF1" }, user);

    const updated = store.data.invoices.find((i) => i.id === invoice.id)!;
    assert.equal(updated.status, "paid");
    assert.equal(updated.amountPaid, 10000);
    assert.equal(payment.amount, 10000);

    // Posting the payment's GL entry, creating the Payment record, and
    // updating the Invoice balance each write their own audit record.
    assert.equal(store.data.auditLog.length, auditBefore + 3);
    const actions = store.data.auditLog.slice(auditBefore).map((a) => a.action);
    assert.deepEqual(actions.sort(), ["CREATE", "POST", "UPDATE_BALANCE"]);
  });

  test("partial payment leaves the invoice in 'partial' status with correct outstanding balance", () => {
    const invoice = createInvoice(store.data, { studentId: student.id, date: "2026-09-01", dueDate: "2026-09-30", lines: [{ description: "Tuition", accountId: income.id, amount: 10000 }] }, user);
    recordPayment(store.data, { invoiceId: invoice.id, date: "2026-09-05", amount: 4000, method: "cash" }, user);
    const updated = store.data.invoices.find((i) => i.id === invoice.id)!;
    assert.equal(updated.status, "partial");
    assert.equal(updated.totalAmount - updated.amountPaid, 6000);
  });

  test("rejects a payment that would exceed the outstanding balance", () => {
    const invoice = createInvoice(store.data, { studentId: student.id, date: "2026-09-01", dueDate: "2026-09-30", lines: [{ description: "Tuition", accountId: income.id, amount: 10000 }] }, user);
    assert.throws(() => recordPayment(store.data, { invoiceId: invoice.id, date: "2026-09-05", amount: 10001, method: "cash" }, user), /exceeds/);
  });

  test("rejects a payment against an already-paid invoice", () => {
    const invoice = createInvoice(store.data, { studentId: student.id, date: "2026-09-01", dueDate: "2026-09-30", lines: [{ description: "Tuition", accountId: income.id, amount: 5000 }] }, user);
    recordPayment(store.data, { invoiceId: invoice.id, date: "2026-09-05", amount: 5000, method: "cash" }, user);
    assert.throws(() => recordPayment(store.data, { invoiceId: invoice.id, date: "2026-09-06", amount: 1, method: "cash" }, user), /already paid/);
  });
});
