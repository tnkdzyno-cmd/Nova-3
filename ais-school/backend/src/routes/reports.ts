import { Router } from "express";
import { store } from "../store.js";
import { authenticate } from "../middleware/auth.js";
import { require } from "../middleware/rbac.js";
import { trialBalance } from "../services/ledger.js";
import { formatCents, toCsv, toXlsxBuffer } from "../util.js";
import { streamTablePdf } from "../services/pdf.js";
import type { TrialBalanceRow } from "../services/ledger.js";

export const reportsRouter = Router();
reportsRouter.use(authenticate);
reportsRouter.use(require("report:view"));

function resolveAsOf(req: import("express").Request): string {
  const period = req.query.period as string | undefined;
  if (period) {
    const p = store.data.periods.find((x) => x.name === period);
    if (p) return p.endDate;
  }
  return (req.query.asOf as string) ?? new Date().toISOString().slice(0, 10);
}

// GET /api/reports/trial-balance?period=2026-08  (matches spec API example)
// Also supports &format=csv or &format=pdf for the export buttons.
reportsRouter.get("/trial-balance", (req, res) => {
  const asOf = resolveAsOf(req);
  const tb = trialBalance(store.data, asOf);
  const balanced = tb.totalDebit === tb.totalCredit;
  const { format } = req.query;

  const tbColumns = [
    { header: "Code", value: (r: TrialBalanceRow) => r.code },
    { header: "Account", value: (r: TrialBalanceRow) => r.name },
    { header: "Type", value: (r: TrialBalanceRow) => r.type },
    { header: "Debit", value: (r: TrialBalanceRow) => formatCents(r.debit) },
    { header: "Credit", value: (r: TrialBalanceRow) => formatCents(r.credit) },
  ];

  if (format === "csv") {
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", 'attachment; filename="trial-balance.csv"');
    return res.send(toCsv(tb.rows, tbColumns));
  }
  if (format === "xlsx") {
    const buffer = toXlsxBuffer(tb.rows, tbColumns, "Trial Balance");
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", 'attachment; filename="trial-balance.xlsx"');
    return res.send(buffer);
  }
  if (format === "pdf") {
    return streamTablePdf(res, {
      filename: "trial-balance.pdf",
      title: "Trial Balance",
      subtitle: `As of ${asOf} — ${balanced ? "Balanced" : "OUT OF BALANCE"} (Dr ${formatCents(tb.totalDebit)} / Cr ${formatCents(tb.totalCredit)})`,
      columns: [
        { header: "Code", width: 55, value: (r: TrialBalanceRow) => r.code },
        { header: "Account", width: 220, value: (r: TrialBalanceRow) => r.name },
        { header: "Type", width: 70, value: (r: TrialBalanceRow) => r.type },
        { header: "Debit", width: 75, align: "right", value: (r: TrialBalanceRow) => formatCents(r.debit) },
        { header: "Credit", width: 75, align: "right", value: (r: TrialBalanceRow) => formatCents(r.credit) },
      ],
      rows: tb.rows,
    });
  }

  res.json({
    asOf,
    balanced,
    totalDebit: tb.totalDebit,
    totalCredit: tb.totalCredit,
    totalDebitDisplay: formatCents(tb.totalDebit),
    totalCreditDisplay: formatCents(tb.totalCredit),
    rows: tb.rows.map((r) => ({ ...r, debitDisplay: formatCents(r.debit), creditDisplay: formatCents(r.credit) })),
  });
});

reportsRouter.get("/income-statement", (req, res) => {
  const asOf = resolveAsOf(req);
  const tb = trialBalance(store.data, asOf);
  const income = tb.rows.filter((r) => r.type === "income");
  const expense = tb.rows.filter((r) => r.type === "expense");
  const totalIncome = income.reduce((s, r) => s + r.credit - r.debit, 0);
  const totalExpense = expense.reduce((s, r) => s + r.debit - r.credit, 0);
  res.json({
    asOf,
    income: income.map((r) => ({ code: r.code, name: r.name, amount: r.credit - r.debit, display: formatCents(r.credit - r.debit) })),
    expense: expense.map((r) => ({ code: r.code, name: r.name, amount: r.debit - r.credit, display: formatCents(r.debit - r.credit) })),
    totalIncome,
    totalExpense,
    netSurplus: totalIncome - totalExpense,
    netSurplusDisplay: formatCents(totalIncome - totalExpense),
  });
});

reportsRouter.get("/balance-sheet", (req, res) => {
  const asOf = resolveAsOf(req);
  const tb = trialBalance(store.data, asOf);
  const assets = tb.rows.filter((r) => r.type === "asset");
  const liabilities = tb.rows.filter((r) => r.type === "liability");
  const equity = tb.rows.filter((r) => r.type === "equity");

  // Retained surplus for the period folds in here so the sheet balances
  // even before a formal period-end closing entry is posted.
  const income = tb.rows.filter((r) => r.type === "income").reduce((s, r) => s + r.credit - r.debit, 0);
  const expense = tb.rows.filter((r) => r.type === "expense").reduce((s, r) => s + r.debit - r.credit, 0);
  const netSurplus = income - expense;

  const totalAssets = assets.reduce((s, r) => s + r.debit - r.credit, 0);
  const totalLiabilities = liabilities.reduce((s, r) => s + r.credit - r.debit, 0);
  const totalEquity = equity.reduce((s, r) => s + r.credit - r.debit, 0) + netSurplus;

  res.json({
    asOf,
    assets: assets.map((r) => ({ code: r.code, name: r.name, amount: r.debit - r.credit, display: formatCents(r.debit - r.credit) })),
    liabilities: liabilities.map((r) => ({ code: r.code, name: r.name, amount: r.credit - r.debit, display: formatCents(r.credit - r.debit) })),
    equity: equity.map((r) => ({ code: r.code, name: r.name, amount: r.credit - r.debit, display: formatCents(r.credit - r.debit) })),
    netSurplusForPeriod: netSurplus,
    totalAssets,
    totalLiabilitiesAndEquity: totalLiabilities + totalEquity,
    balanced: totalAssets === totalLiabilities + totalEquity,
  });
});
