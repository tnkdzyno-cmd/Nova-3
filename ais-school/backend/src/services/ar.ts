import type { DataShape } from "../store.js";
import type { Invoice, InvoiceLine, Payment, PaymentMethod } from "../types.js";
import type { AuthedUser } from "../middleware/auth.js";
import { badRequest, conflict, newId, nextRefNo, nowIso, notFound } from "../util.js";
import { postJournalEntry } from "./ledger.js";
import { writeAudit } from "../middleware/audit.js";

function arControlAccount(data: DataShape) {
  const acc = data.accounts.find((a) => a.isControlAccount === "AR" && a.isActive);
  if (!acc) throw badRequest("NO_AR_CONTROL", "No active Accounts Receivable control account is configured.");
  return acc;
}

function cashOrBankAccount(data: DataShape, method: PaymentMethod) {
  const wanted = method === "cash" ? "CASH" : "BANK";
  const acc = data.accounts.find((a) => a.isControlAccount === wanted && a.isActive);
  if (!acc) throw badRequest("NO_CASH_ACCOUNT", `No active ${wanted === "CASH" ? "cash" : "bank"} account is configured.`);
  return acc;
}

export interface CreateInvoiceInput {
  studentId: string;
  date: string;
  dueDate: string;
  lines: { description: string; accountId: string; amount: number }[]; // amount in cents
}

/**
 * Creates a student invoice AND immediately raises the matching GL entry
 * (Debit AR control, Credit each income line) so the subledger and the
 * general ledger can never drift apart.
 */
export function createInvoice(data: DataShape, input: CreateInvoiceInput, user: AuthedUser): Invoice {
  const student = data.students.find((s) => s.id === input.studentId);
  if (!student) throw notFound("Student not found.");
  if (!input.lines?.length) throw badRequest("NO_LINES", "An invoice needs at least one line.");

  const lines: InvoiceLine[] = input.lines.map((l) => {
    if (!Number.isInteger(l.amount) || l.amount <= 0) throw badRequest("BAD_AMOUNT", "Invoice line amounts must be positive whole cents.");
    return { id: newId(), description: l.description, accountId: l.accountId, amount: l.amount };
  });
  const total = lines.reduce((s, l) => s + l.amount, 0);
  const ar = arControlAccount(data);

  const journal = postJournalEntry(
    data,
    {
      date: input.date,
      description: `Invoice to ${student.name} (${student.studentNumber})`,
      source: "AR_INVOICE",
      lines: [
        { accountId: ar.id, debit: total, description: `AR — ${student.name}` },
        ...lines.map((l) => ({ accountId: l.accountId, credit: l.amount, description: l.description })),
      ],
    },
    user
  );

  const invoice: Invoice = {
    id: newId(),
    refNo: nextRefNo(data.counters, "arInvoice", input.date),
    kind: "AR",
    studentId: student.id,
    supplierId: null,
    date: input.date,
    dueDate: input.dueDate,
    lines,
    totalAmount: total,
    amountPaid: 0,
    status: "open",
    journalEntryId: journal.id,
    createdBy: user.id,
    createdAt: nowIso(),
  };
  data.invoices.push(invoice);
  writeAudit(data, { entityType: "Invoice", entityId: invoice.id, action: "CREATE", before: null, after: invoice, user });
  return invoice;
}

export interface BulkInvoiceInput {
  studentIds: string[];
  date: string;
  dueDate: string;
  lines: { description: string; accountId: string; amount: number }[];
}

/** Bulk termly billing: same fee lines applied to every student in the cohort. */
export function createInvoicesBulk(data: DataShape, input: BulkInvoiceInput, user: AuthedUser): Invoice[] {
  if (!input.studentIds?.length) throw badRequest("NO_STUDENTS", "Select at least one student.");
  return input.studentIds.map((studentId) =>
    createInvoice(data, { studentId, date: input.date, dueDate: input.dueDate, lines: input.lines }, user)
  );
}

export interface RecordPaymentInput {
  invoiceId: string;
  date: string;
  amount: number; // cents
  method: PaymentMethod;
  bankTxnRef?: string | null;
}

export function recordPayment(data: DataShape, input: RecordPaymentInput, user: AuthedUser): Payment {
  const invoice = data.invoices.find((i) => i.id === input.invoiceId);
  if (!invoice) throw notFound("Invoice not found.");
  if (invoice.status === "paid" || invoice.status === "void") {
    throw conflict("INVOICE_CLOSED", `Invoice is already ${invoice.status}; cannot record a further payment.`);
  }
  const outstanding = invoice.totalAmount - invoice.amountPaid;
  if (!Number.isInteger(input.amount) || input.amount <= 0) throw badRequest("BAD_AMOUNT", "Payment amount must be positive whole cents.");
  if (input.amount > outstanding) {
    throw badRequest("OVERPAYMENT", `Payment (${input.amount}) exceeds outstanding balance (${outstanding}).`);
  }

  const ar = arControlAccount(data);
  const cashAcc = cashOrBankAccount(data, input.method);
  const student = data.students.find((s) => s.id === invoice.studentId);

  const journal = postJournalEntry(
    data,
    {
      date: input.date,
      description: `Payment received from ${student?.name ?? "student"} — invoice ${invoice.refNo}`,
      source: "AR_PAYMENT",
      lines: [
        { accountId: cashAcc.id, debit: input.amount, description: "Fee payment received" },
        { accountId: ar.id, credit: input.amount, description: `AR — ${student?.name ?? ""}` },
      ],
    },
    user
  );

  const payment: Payment = {
    id: newId(),
    refNo: nextRefNo(data.counters, "arPayment", input.date),
    invoiceId: invoice.id,
    date: input.date,
    amount: input.amount,
    method: input.method,
    bankTxnRef: input.bankTxnRef ?? null,
    journalEntryId: journal.id,
    postedBy: user.id,
    createdAt: nowIso(),
  };
  data.payments.push(payment);

  const before = { ...invoice };
  invoice.amountPaid += input.amount;
  invoice.status = invoice.amountPaid >= invoice.totalAmount ? "paid" : "partial";

  writeAudit(data, { entityType: "Payment", entityId: payment.id, action: "CREATE", before: null, after: payment, user });
  writeAudit(data, { entityType: "Invoice", entityId: invoice.id, action: "UPDATE_BALANCE", before, after: invoice, user });

  return payment;
}

export interface AgedRow {
  invoiceId: string;
  studentName: string;
  dueDate: string;
  outstanding: number;
  bucket: "current" | "1-30" | "31-60" | "61-90" | "90+";
}

export function agedReceivables(data: DataShape, asOfDate: string): AgedRow[] {
  const asOf = new Date(asOfDate).getTime();
  const rows: AgedRow[] = [];
  for (const inv of data.invoices) {
    if (inv.kind !== "AR" || inv.status === "paid" || inv.status === "void") continue;
    const outstanding = inv.totalAmount - inv.amountPaid;
    if (outstanding <= 0) continue;
    const daysOverdue = Math.floor((asOf - new Date(inv.dueDate).getTime()) / 86_400_000);
    let bucket: AgedRow["bucket"] = "current";
    if (daysOverdue > 90) bucket = "90+";
    else if (daysOverdue > 60) bucket = "61-90";
    else if (daysOverdue > 30) bucket = "31-60";
    else if (daysOverdue > 0) bucket = "1-30";
    const student = data.students.find((s) => s.id === inv.studentId);
    rows.push({ invoiceId: inv.id, studentName: student?.name ?? "Unknown", dueDate: inv.dueDate, outstanding, bucket });
  }
  return rows;
}
