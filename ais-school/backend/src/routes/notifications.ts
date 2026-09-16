import { Router } from "express";
import { store } from "../store.js";
import { authenticate } from "../middleware/auth.js";
import { require } from "../middleware/rbac.js";
import { agedReceivables } from "../services/ar.js";
import { AP_APPROVAL_THRESHOLD_CENTS } from "../services/ap.js";
import { formatCents } from "../util.js";

export const notificationsRouter = Router();
notificationsRouter.use(authenticate);
notificationsRouter.use(require("report:view"));

export interface Notification {
  id: string;
  severity: "info" | "warning" | "danger";
  message: string;
}

/**
 * Deliberately not a stored/dismissible notification system (that's a
 * larger feature — see docs/NOVA_ROADMAP.md). This surfaces two things
 * that are already true in the data and genuinely worth a bursar or
 * vice-chancellor's attention: overdue receivables and AP invoices that
 * will require a second approver whenever someone gets around to paying
 * them.
 */
notificationsRouter.get("/", (_req, res) => {
  const notifications: Notification[] = [];
  const asOf = new Date().toISOString().slice(0, 10);

  const overdue = agedReceivables(store.data, asOf).filter((r) => r.bucket !== "current");
  if (overdue.length) {
    const total = overdue.reduce((s, r) => s + r.outstanding, 0);
    notifications.push({
      id: "overdue-receivables",
      severity: overdue.some((r) => r.bucket === "90+" || r.bucket === "61-90") ? "danger" : "warning",
      message: `${overdue.length} invoice${overdue.length === 1 ? " is" : "s are"} overdue — $${formatCents(total)} outstanding.`,
    });
  }

  const pendingApproval = store.data.invoices.filter(
    (i) => i.kind === "AP" && i.status !== "paid" && i.status !== "void" && i.totalAmount - i.amountPaid > AP_APPROVAL_THRESHOLD_CENTS
  );
  if (pendingApproval.length) {
    notifications.push({
      id: "ap-pending-approval",
      severity: "info",
      message: `${pendingApproval.length} supplier payment${pendingApproval.length === 1 ? "" : "s"} above the approval threshold ${
        pendingApproval.length === 1 ? "is" : "are"
      } awaiting a second approver.`,
    });
  }

  res.json({ notifications, count: notifications.length });
});
