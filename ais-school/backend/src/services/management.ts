// Management Accounts (KPIs + approvals queue) for the Vice-Chancellor
// role (which consolidates the former Finance Manager and Principal
// roles). Distinct from the plain staff dashboard,
// which deliberately shows no financial figures — this view exists
// specifically to give leadership the numbers the rest of the app hides
// from the general landing page.

import type { DataShape } from "../store.js";
import { trialBalance } from "./ledger.js";
import { agedReceivables } from "./ar.js";
import { AP_APPROVAL_THRESHOLD_CENTS } from "./ap.js";
import { budgetVsActual } from "./budget.js";

export interface ManagementSummary {
  asOf: string;
  cashPositionCents: number;
  totalAROutstandingCents: number;
  totalAPOutstandingCents: number;
  overdueReceivablesCents: number;
  netSurplusCents: number;
  trialBalanceOk: boolean;
  budgetSummary: { totalBudgeted: number; totalActual: number; totalVariance: number; count: number };
  pendingBudgetApprovals: { id: string; refNo: string; name: string; status: string; amount: number }[];
  pendingApPayments: { id: string; refNo: string; supplierName: string; outstandingCents: number }[];
}

export function managementSummary(data: DataShape): ManagementSummary {
  const asOf = new Date().toISOString().slice(0, 10);
  const tb = trialBalance(data, asOf);

  const cashAccountIds = data.accounts.filter((a) => a.isControlAccount === "CASH" || a.isControlAccount === "BANK").map((a) => a.id);
  const cashPositionCents = tb.rows.filter((r) => cashAccountIds.includes(r.accountId)).reduce((s, r) => s + r.debit - r.credit, 0);

  const arInvoices = data.invoices.filter((i) => i.kind === "AR" && i.status !== "void");
  const totalAROutstandingCents = arInvoices.reduce((s, i) => s + (i.totalAmount - i.amountPaid), 0);

  const apInvoices = data.invoices.filter((i) => i.kind === "AP" && i.status !== "void");
  const totalAPOutstandingCents = apInvoices.reduce((s, i) => s + (i.totalAmount - i.amountPaid), 0);

  const overdueReceivablesCents = agedReceivables(data, asOf)
    .filter((r) => r.bucket !== "current")
    .reduce((s, r) => s + r.outstanding, 0);

  const income = tb.rows.filter((r) => data.accounts.find((a) => a.id === r.accountId)?.type === "income").reduce((s, r) => s + r.credit - r.debit, 0);
  const expense = tb.rows.filter((r) => data.accounts.find((a) => a.id === r.accountId)?.type === "expense").reduce((s, r) => s + r.debit - r.credit, 0);
  const netSurplusCents = income - expense;

  const activeBudgets = data.budgets.filter((b) => b.status === "approved" || b.status === "locked");
  const vsActualRows = activeBudgets.map((b) => budgetVsActual(data, b));
  const budgetSummary = vsActualRows.reduce(
    (acc, r) => ({ totalBudgeted: acc.totalBudgeted + r.budgeted, totalActual: acc.totalActual + r.actual, totalVariance: acc.totalVariance + r.variance, count: acc.count + 1 }),
    { totalBudgeted: 0, totalActual: 0, totalVariance: 0, count: 0 }
  );

  const pendingBudgetApprovals = data.budgets
    .filter((b) => b.status === "submitted" || b.status === "reviewed")
    .map((b) => ({ id: b.id, refNo: b.refNo, name: b.name, status: b.status, amount: b.amount }));

  const pendingApPayments = apInvoices
    .filter((i) => i.totalAmount - i.amountPaid > AP_APPROVAL_THRESHOLD_CENTS)
    .map((i) => ({
      id: i.id,
      refNo: i.refNo,
      supplierName: data.suppliers.find((s) => s.id === i.supplierId)?.name ?? "Unknown supplier",
      outstandingCents: i.totalAmount - i.amountPaid,
    }));

  return {
    asOf,
    cashPositionCents,
    totalAROutstandingCents,
    totalAPOutstandingCents,
    overdueReceivablesCents,
    netSurplusCents,
    trialBalanceOk: tb.totalDebit === tb.totalCredit,
    budgetSummary,
    pendingBudgetApprovals,
    pendingApPayments,
  };
}
