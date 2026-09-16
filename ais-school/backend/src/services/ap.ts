import type { DataShape } from "../store.js";
import type { Invoice, InvoiceLine, Payment, PaymentMethod } from "../types.js";
import type { AuthedUser } from "../middleware/auth.js";
import { badRequest, conflict, newId, nextRefNo, nowIso, notFound } from "../util.js";
import { postJournalEntry } from "./ledger.js";
import { writeAudit } from "../middleware/audit.js";

function apControlAccount(data: DataShape) {
  const acc = data.accounts.find((a) => a.isControlAccount === "AP" && a.isActive);
  if (!acc) throw badRequest("NO_AP_CONTROL", "No active Accounts Payable control account is configured.");
  return acc;
}
function cashOrBankAccount(data: DataShape, method: PaymentMethod) {
  const wanted = method === "cash" ? "CASH" : "BANK";
  const acc = data.accounts.find((a) => a.isControlAccount === wanted && a.isActive);
  if (!acc) throw badRequest("NO_CASH_ACCOUNT", `No active ${wanted === "CASH" ? "cash" : "bank"} account is configured.`);
  return acc;
}

export interface CreateSupplierInvoiceInput {
  supplierId: string;
  date: string;
  dueDate: string;
  lines: { description: string; accountId: string; amount: number }[]; // expense accounts
}

/** Two-step approval (configurable threshold) is enforced at the payment stage, not invoice capture — see recordSupplierPayment. */
export function createSupplierInvoice(data: DataShape, input: CreateSupplierInvoiceInput, user: AuthedUser): Invoice {
  const supplier = data.suppliers.find((s) => s.id === input.supplierId);
  if (!supplier) throw notFound("Supplier not found.");
  if (!input.lines?.length) throw badRequest("NO_LINES", "An invoice needs at least one line.");

  const lines: InvoiceLine[] = input.lines.map((l) => {
    if (!Number.isInteger(l.amount) || l.amount <= 0) throw badRequest("BAD_AMOUNT", "Invoice line amounts must be positive whole cents.");
    return { id: newId(), description: l.description, accountId: l.accountId, amount: l.amount };
  });
  const total = lines.reduce((s, l) => s + l.amount, 0);
  const ap = apControlAccount(data);

  const journal = postJournalEntry(
    data,
    {
      date: input.date,
      description: `Supplier invoice from ${supplier.name}`,
      source: "AP_INVOICE",
      lines: [
        ...lines.map((l) => ({ accountId: l.accountId, debit: l.amount, description: l.description })),
        { accountId: ap.id, credit: total, description: `AP — ${supplier.name}` },
      ],
    },
    user
  );

  const invoice: Invoice = {
    id: newId(),
    refNo: nextRefNo(data.counters, "apInvoice", input.date),
    kind: "AP",
    studentId: null,
    supplierId: supplier.id,
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

// Payments above this threshold require a second approver (2-step approval).
// Configurable via AP_APPROVAL_THRESHOLD_CENTS in .env — see docs/README.md.
export const AP_APPROVAL_THRESHOLD_CENTS = Number(process.env.AP_APPROVAL_THRESHOLD_CENTS) || 500_00; // default $500.00

export interface RecordSupplierPaymentInput {
  invoiceId: string;
  date: string;
  amount: number;
  method: PaymentMethod;
  bankTxnRef?: string | null;
  approvedBy?: string | null; // required by the route when amount exceeds threshold
}

export function recordSupplierPayment(data: DataShape, input: RecordSupplierPaymentInput, user: AuthedUser): Payment {
  const invoice = data.invoices.find((i) => i.id === input.invoiceId);
  if (!invoice || invoice.kind !== "AP") throw notFound("Supplier invoice not found.");
  if (invoice.status === "paid" || invoice.status === "void") {
    throw conflict("INVOICE_CLOSED", `Invoice is already ${invoice.status}.`);
  }
  const outstanding = invoice.totalAmount - invoice.amountPaid;
  if (!Number.isInteger(input.amount) || input.amount <= 0) throw badRequest("BAD_AMOUNT", "Payment amount must be positive whole cents.");
  if (input.amount > outstanding) throw badRequest("OVERPAYMENT", `Payment exceeds outstanding balance (${outstanding}).`);

  if (input.amount > AP_APPROVAL_THRESHOLD_CENTS && !input.approvedBy) {
    throw conflict(
      "APPROVAL_REQUIRED",
      `Payments over ${AP_APPROVAL_THRESHOLD_CENTS / 100} require a second approver (approvedBy) before they can be released.`
    );
  }
  if (input.approvedBy && input.approvedBy === user.id) {
    throw conflict("SELF_APPROVAL", "The second approver must be a different user from the one recording the payment.");
  }

  const ap = apControlAccount(data);
  const cashAcc = cashOrBankAccount(data, input.method);
  const supplier = data.suppliers.find((s) => s.id === invoice.supplierId);

  const journal = postJournalEntry(
    data,
    {
      date: input.date,
      description: `Payment to ${supplier?.name ?? "supplier"} — invoice ${invoice.refNo}`,
      source: "AP_PAYMENT",
      lines: [
        { accountId: ap.id, debit: input.amount, description: `AP — ${supplier?.name ?? ""}` },
        { accountId: cashAcc.id, credit: input.amount, description: "Supplier payment" },
      ],
    },
    user
  );

  const payment: Payment = {
    id: newId(),
    refNo: nextRefNo(data.counters, "apPayment", input.date),
    invoiceId: invoice.id,
    date: input.date,
    amount: input.amount,
    method: input.method,
    bankTxnRef: input.bankTxnRef ?? null,
    journalEntryId: journal.id,
    postedBy: user.id,
    approvedBy: input.approvedBy ?? null,
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
