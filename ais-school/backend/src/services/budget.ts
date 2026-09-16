// Budget management (Phase 2). Workflow: draft -> submitted -> reviewed ->
// approved -> locked, with a reject action that can send a submitted or
// reviewed budget back to draft. Every transition is its own function so
// each one gets its own permission check at the route layer and its own
// audit entry — mirroring how journal entries and invoices are handled
// elsewhere in this codebase.

import type { DataShape } from "../store.js";
import type { Budget, BudgetStatus } from "../types.js";
import type { AuthedUser } from "../middleware/auth.js";
import { badRequest, conflict, newId, nextRefNo, nowIso, notFound } from "../util.js";
import { writeAudit } from "../middleware/audit.js";
import { trialBalance } from "./ledger.js";

export interface CreateBudgetInput {
  name: string;
  accountId: string;
  periodId: string;
  costCenterId?: string | null;
  amount: number; // cents
  notes?: string | null;
  revisionOf?: string | null;
}

export function createBudget(data: DataShape, input: CreateBudgetInput, user: AuthedUser): Budget {
  if (!input.name?.trim()) throw badRequest("MISSING_FIELDS", "name is required.");
  if (!Number.isInteger(input.amount) || input.amount <= 0) throw badRequest("BAD_AMOUNT", "amount must be a positive whole number of cents.");
  const account = data.accounts.find((a) => a.id === input.accountId);
  if (!account) throw notFound("Account not found.");
  const period = data.periods.find((p) => p.id === input.periodId);
  if (!period) throw notFound("Period not found.");

  const budget: Budget = {
    id: newId(),
    refNo: nextRefNo(data.counters, "budget", period.startDate),
    name: input.name.trim(),
    costCenterId: input.costCenterId || null,
    accountId: input.accountId,
    periodId: input.periodId,
    amount: input.amount,
    status: "draft",
    notes: input.notes || null,
    createdBy: user.id,
    createdAt: nowIso(),
    submittedAt: null,
    reviewedBy: null,
    reviewedAt: null,
    approvedBy: null,
    approvedAt: null,
    lockedAt: null,
    revisionOf: input.revisionOf || null,
  };
  data.budgets.push(budget);
  writeAudit(data, { entityType: "Budget", entityId: budget.id, action: "CREATE", before: null, after: budget, user });
  return budget;
}

function findBudget(data: DataShape, id: string): Budget {
  const budget = data.budgets.find((b) => b.id === id);
  if (!budget) throw notFound("Budget not found.");
  return budget;
}

function requireStatus(budget: Budget, expected: BudgetStatus, action: string) {
  if (budget.status !== expected) {
    throw conflict("INVALID_TRANSITION", `Cannot ${action} a budget that is '${budget.status}' (expected '${expected}').`);
  }
}

function transition(data: DataShape, budget: Budget, action: string, user: AuthedUser, apply: (b: Budget) => void) {
  const before = { ...budget };
  apply(budget);
  writeAudit(data, { entityType: "Budget", entityId: budget.id, action, before, after: budget, user });
}

export function submitBudget(data: DataShape, id: string, user: AuthedUser): Budget {
  const budget = findBudget(data, id);
  requireStatus(budget, "draft", "submit");
  transition(data, budget, "SUBMIT", user, (b) => {
    b.status = "submitted";
    b.submittedAt = nowIso();
  });
  return budget;
}

export function reviewBudget(data: DataShape, id: string, user: AuthedUser): Budget {
  const budget = findBudget(data, id);
  requireStatus(budget, "submitted", "review");
  transition(data, budget, "REVIEW", user, (b) => {
    b.status = "reviewed";
    b.reviewedBy = user.id;
    b.reviewedAt = nowIso();
  });
  return budget;
}

export function approveBudget(data: DataShape, id: string, user: AuthedUser): Budget {
  const budget = findBudget(data, id);
  requireStatus(budget, "reviewed", "approve");
  transition(data, budget, "APPROVE", user, (b) => {
    b.status = "approved";
    b.approvedBy = user.id;
    b.approvedAt = nowIso();
  });
  return budget;
}

export function lockBudget(data: DataShape, id: string, user: AuthedUser): Budget {
  const budget = findBudget(data, id);
  requireStatus(budget, "approved", "lock");
  transition(data, budget, "LOCK", user, (b) => {
    b.status = "locked";
    b.lockedAt = nowIso();
  });
  return budget;
}

/** Sends a submitted or reviewed budget back to draft — separation-of-duties means whoever could have advanced it can also send it back. */
export function rejectBudget(data: DataShape, id: string, user: AuthedUser, reason?: string): Budget {
  const budget = findBudget(data, id);
  if (budget.status !== "submitted" && budget.status !== "reviewed") {
    throw conflict("INVALID_TRANSITION", `Cannot reject a budget that is '${budget.status}' — only 'submitted' or 'reviewed' budgets can be sent back to draft.`);
  }
  transition(data, budget, "REJECT", user, (b) => {
    b.status = "draft";
    b.submittedAt = null;
    b.reviewedBy = null;
    b.reviewedAt = null;
    b.notes = reason ? `${b.notes ? b.notes + " | " : ""}Rejected: ${reason}` : b.notes;
  });
  return budget;
}

export interface BudgetVsActual {
  budgetId: string;
  refNo: string;
  name: string;
  accountCode: string;
  accountName: string;
  budgeted: number;
  actual: number;
  variance: number; // actual - budgeted
  variancePercent: number | null;
}

/** Actual = posted GL activity on the budget's account, net in the natural direction for that account type, as of the period's end date. */
export function budgetVsActual(data: DataShape, budget: Budget): BudgetVsActual {
  const account = data.accounts.find((a) => a.id === budget.accountId);
  const period = data.periods.find((p) => p.id === budget.periodId);
  const tb = trialBalance(data, period?.endDate);
  const row = tb.rows.find((r) => r.accountId === budget.accountId);
  // Income/liability/equity grow on the credit side; asset/expense grow on the debit side.
  const isCreditNatured = account?.type === "income" || account?.type === "liability" || account?.type === "equity";
  const actual = row ? (isCreditNatured ? row.credit - row.debit : row.debit - row.credit) : 0;
  const variance = actual - budget.amount;
  return {
    budgetId: budget.id,
    refNo: budget.refNo,
    name: budget.name,
    accountCode: account?.code ?? "—",
    accountName: account?.name ?? "Unknown account",
    budgeted: budget.amount,
    actual,
    variance,
    variancePercent: budget.amount > 0 ? Math.round((variance / budget.amount) * 1000) / 10 : null,
  };
}
