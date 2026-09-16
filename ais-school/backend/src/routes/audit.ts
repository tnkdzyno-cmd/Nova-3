import { Router } from "express";
import { store } from "../store.js";
import { authenticate } from "../middleware/auth.js";
import { require } from "../middleware/rbac.js";
import { paginate, matchesSearch, inDateRange } from "../util.js";

export const auditRouter = Router();
auditRouter.use(authenticate);
auditRouter.use(require("audit:view"));

// Story: "As an auditor, I want to see the full audit trail for any posted
// journal entry" — generalised to any entity via query params.
auditRouter.get("/", (req, res) => {
  const { entityType, entityId, search, dateFrom, dateTo } = req.query;
  let log = store.data.auditLog;
  if (entityType) log = log.filter((a) => a.entityType === entityType);
  if (entityId) log = log.filter((a) => a.entityId === entityId);
  if (dateFrom || dateTo) log = log.filter((a) => inDateRange(a.timestamp.slice(0, 10), dateFrom, dateTo));
  if (search) log = log.filter((a) => matchesSearch(search, a.username, a.action, a.entityType));
  log = log.slice().sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  const { data, total, page, pageSize, totalPages } = paginate(log, req.query);
  res.json({ auditLog: data, total, page, pageSize, totalPages });
});
