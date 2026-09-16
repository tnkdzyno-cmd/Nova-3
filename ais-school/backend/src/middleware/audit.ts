import type { DataShape } from "../store.js";
import type { AuthedUser } from "./auth.js";
import { newId, nowIso } from "../util.js";

// Maps an audited entity type to the human-readable module name shown in
// the audit log. Invoice/Payment are split into AR vs AP by peeking at the
// `kind` field on whichever of before/after is present, since one entity
// type covers both subledgers.
const MODULE_BY_ENTITY: Record<string, string> = {
  Account: "Chart of Accounts",
  JournalEntry: "General Ledger",
  Period: "Period Management",
  Student: "Student Records",
  Supplier: "Accounts Payable",
  Budget: "Budgeting",
  User: "User Management",
};

function deriveModule(entityType: string, before: unknown, after: unknown): string {
  if (entityType === "Invoice" || entityType === "Payment") {
    const kind = (after as { kind?: string; invoiceId?: string })?.kind ?? (before as { kind?: string })?.kind;
    if (kind === "AP") return "Accounts Payable";
    if (kind === "AR") return "Accounts Receivable";
    // Payment records don't carry `kind` directly (that's on the invoice) —
    // default to AR since that's by far the more common path.
    return "Accounts Receivable";
  }
  return MODULE_BY_ENTITY[entityType] ?? "General";
}

/**
 * Every financial mutation must call this. There is deliberately no
 * "delete audit log" or "edit audit log" route anywhere in the API —
 * the log is append-only, satisfying the spec's "immutable audit trail"
 * requirement.
 *
 * Captures IP address and module automatically: IP comes from
 * user.ipAddress (set by the authenticate() middleware for every request,
 * before any handler code runs), and module is derived from entityType —
 * neither requires the caller to pass anything extra.
 */
export function writeAudit(
  data: DataShape,
  params: {
    entityType: string;
    entityId: string;
    action: string;
    before: unknown;
    after: unknown;
    user: AuthedUser;
  }
) {
  data.auditLog.push({
    id: newId(),
    entityType: params.entityType,
    entityId: params.entityId,
    action: params.action,
    before: params.before,
    after: params.after,
    userId: params.user.id,
    username: params.user.username,
    ipAddress: params.user.ipAddress ?? null,
    module: deriveModule(params.entityType, params.before, params.after),
    timestamp: nowIso(),
  });
}
