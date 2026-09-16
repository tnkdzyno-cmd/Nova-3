import { Router } from "express";
import { store } from "../store.js";
import { authenticate } from "../middleware/auth.js";
import { require } from "../middleware/rbac.js";
import { roleHasPermission } from "../rbac-policy.js";
import {
  createBudget,
  submitBudget,
  reviewBudget,
  approveBudget,
  lockBudget,
  rejectBudget,
  budgetVsActual,
} from "../services/budget.js";
import { matchesSearch, notFound } from "../util.js";

export const budgetsRouter = Router();
budgetsRouter.use(authenticate);

// Budgets are viewable by anyone with report:view (the same broad
// visibility as financial reports) — but only budget:create/submit/
// review/approve can act on them. This lets e.g. an auditor or a
// department head see the numbers without being able to touch the
// workflow.
budgetsRouter.get("/", require("report:view"), (req, res) => {
  const { status, periodId, accountId, search } = req.query;
  let budgets = store.data.budgets;
  if (status) budgets = budgets.filter((b) => b.status === status);
  if (periodId) budgets = budgets.filter((b) => b.periodId === periodId);
  if (accountId) budgets = budgets.filter((b) => b.accountId === accountId);
  if (search) budgets = budgets.filter((b) => matchesSearch(search, b.refNo, b.name));
  budgets = budgets.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  res.json({ budgets });
});

budgetsRouter.get("/vs-actual", require("report:view"), (req, res) => {
  const { periodId } = req.query;
  let budgets = store.data.budgets.filter((b) => b.status === "approved" || b.status === "locked");
  if (periodId) budgets = budgets.filter((b) => b.periodId === periodId);
  const rows = budgets.map((b) => budgetVsActual(store.data, b));
  const totals = rows.reduce(
    (acc, r) => ({ budgeted: acc.budgeted + r.budgeted, actual: acc.actual + r.actual, variance: acc.variance + r.variance }),
    { budgeted: 0, actual: 0, variance: 0 }
  );
  res.json({ rows, totals });
});

budgetsRouter.get("/:id", require("report:view"), (req, res) => {
  const budget = store.data.budgets.find((b) => b.id === req.params.id);
  if (!budget) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Budget not found." } });
  res.json({ budget, vsActual: budgetVsActual(store.data, budget) });
});

budgetsRouter.post("/", require("budget:create"), (req, res, next) => {
  try {
    const { name, accountId, periodId, costCenterId, amount, notes, revisionOf } = req.body ?? {};
    const budget = createBudget(store.data, { name, accountId, periodId, costCenterId, amount, notes, revisionOf }, req.user!);
    store.save();
    res.status(201).json({ budget });
  } catch (e) {
    next(e);
  }
});

budgetsRouter.post("/:id/submit", require("budget:submit"), (req, res, next) => {
  try {
    const budget = submitBudget(store.data, req.params.id, req.user!);
    store.save();
    res.json({ budget });
  } catch (e) {
    next(e);
  }
});

budgetsRouter.post("/:id/review", require("budget:review"), (req, res, next) => {
  try {
    const budget = reviewBudget(store.data, req.params.id, req.user!);
    store.save();
    res.json({ budget });
  } catch (e) {
    next(e);
  }
});

budgetsRouter.post("/:id/approve", require("budget:approve"), (req, res, next) => {
  try {
    const budget = approveBudget(store.data, req.params.id, req.user!);
    store.save();
    res.json({ budget });
  } catch (e) {
    next(e);
  }
});

// Locking is the final step after approval — gated the same as approve
// itself (whoever can approve a budget can also finalize it).
budgetsRouter.post("/:id/lock", require("budget:approve"), (req, res, next) => {
  try {
    const budget = lockBudget(store.data, req.params.id, req.user!);
    store.save();
    res.json({ budget });
  } catch (e) {
    next(e);
  }
});

// Reject is available to whoever could have advanced the budget from its
// current stage — a submitted budget can be rejected by a reviewer, a
// reviewed one by an approver. The permission needed depends on which
// stage it's at, so this checks manually rather than using a single
// static require() like every other route here.
budgetsRouter.post("/:id/reject", (req, res, next) => {
  try {
    const budget = store.data.budgets.find((b) => b.id === req.params.id);
    if (!budget) throw notFound("Budget not found.");
    const neededPermission = budget.status === "reviewed" ? "budget:approve" : "budget:review";
    if (!roleHasPermission(req.user!.role, neededPermission)) {
      return res.status(403).json({
        error: { code: "FORBIDDEN", message: `Your role does not have the '${neededPermission}' permission needed to reject this budget.` },
      });
    }
    const rejected = rejectBudget(store.data, req.params.id, req.user!, req.body?.reason);
    store.save();
    res.json({ budget: rejected });
  } catch (e) {
    next(e);
  }
});
