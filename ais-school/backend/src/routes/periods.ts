import { Router } from "express";
import { store } from "../store.js";
import { authenticate } from "../middleware/auth.js";
import { require } from "../middleware/rbac.js";
import { writeAudit } from "../middleware/audit.js";
import { badRequest, newId } from "../util.js";
import type { Period } from "../types.js";
import { closeChecklist, yearEndClose } from "../services/periodClose.js";

export const periodsRouter = Router();
periodsRouter.use(authenticate);

// report:view rather than journal:read — periods are reference data needed
// by Reports' and Budgeting's period-selector dropdowns too, and several
// roles that legitimately use those (bursar, budget_officer, vice_chancellor)
// don't have journal:read. Mutating routes below stay gated behind the
// stricter period:close.
periodsRouter.get("/", require("report:view"), (req, res) => {
  res.json({ periods: store.data.periods.slice().sort((a, b) => a.startDate.localeCompare(b.startDate)) });
});

periodsRouter.post("/", require("period:close"), (req, res, next) => {
  try {
    const { name, startDate, endDate } = req.body ?? {};
    if (!name || !startDate || !endDate) throw badRequest("MISSING_FIELDS", "name, startDate and endDate are required.");
    const period: Period = { id: newId(), name, startDate, endDate, status: "open" };
    store.data.periods.push(period);
    writeAudit(store.data, { entityType: "Period", entityId: period.id, action: "CREATE", before: null, after: period, user: req.user! });
    store.save();
    res.status(201).json({ period });
  } catch (e) {
    next(e);
  }
});

// Closing a period is a controlled, audited action (spec: "period close/unclose
// with controls and audit trail"), gated to vice_chancellor/admin via period:close.
periodsRouter.post("/:id/close", require("period:close"), (req, res, next) => {
  try {
    const period = store.data.periods.find((p) => p.id === req.params.id);
    if (!period) throw badRequest("NOT_FOUND", "Period not found.");
    const before = { ...period };
    period.status = "closed";
    writeAudit(store.data, { entityType: "Period", entityId: period.id, action: "CLOSE", before, after: period, user: req.user! });
    store.save();
    res.json({ period });
  } catch (e) {
    next(e);
  }
});

periodsRouter.post("/:id/reopen", require("period:close"), (req, res, next) => {
  try {
    const period = store.data.periods.find((p) => p.id === req.params.id);
    if (!period) throw badRequest("NOT_FOUND", "Period not found.");
    const before = { ...period };
    period.status = "open";
    writeAudit(store.data, { entityType: "Period", entityId: period.id, action: "REOPEN", before, after: period, user: req.user! });
    store.save();
    res.json({ period });
  } catch (e) {
    next(e);
  }
});

// Month-end: a pre-flight checklist, read-only — doesn't change anything,
// just tells you what's worth checking before you hit "close".
periodsRouter.get("/:id/close-checklist", require("report:view"), (req, res, next) => {
  try {
    const items = closeChecklist(store.data, req.params.id);
    res.json({ items, allPassed: items.every((i) => i.passed) });
  } catch (e) {
    next(e);
  }
});

// Year-end: posts the closing entry (zeroing income/expense into Retained
// Earnings) and closes the period in one action. Same permission as any
// other period-closing action.
periodsRouter.post("/:id/year-end-close", require("period:close"), (req, res, next) => {
  try {
    const entry = yearEndClose(store.data, req.params.id, req.user!);
    store.save();
    res.status(201).json({ journalEntry: entry });
  } catch (e) {
    next(e);
  }
});
