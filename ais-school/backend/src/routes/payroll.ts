import { Router } from "express";
import { store } from "../store.js";
import { authenticate } from "../middleware/auth.js";
import { require } from "../middleware/rbac.js";
import { postJournalEntry } from "../services/ledger.js";

export const payrollRouter = Router();
payrollRouter.use(authenticate);

// Out of scope for this MVP: a full payroll engine. In scope: accepting a
// payroll journal exported from an external payroll system and mapping it
// into the GL as one balanced entry. Restricted to payroll:admin — this is
// the route the RBAC acceptance test targets ("finance clerk cannot access
// payroll admin screens").
payrollRouter.post("/import-journal", require("payroll:admin"), (req, res, next) => {
  try {
    const { date, description, lines } = req.body ?? {};
    const entry = postJournalEntry(
      store.data,
      { date, description: description ?? "Payroll journal import", lines, source: "manual" },
      req.user!
    );
    store.save();
    res.status(201).json({ journalEntry: entry });
  } catch (e) {
    next(e);
  }
});
