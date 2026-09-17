import type { Role } from "./types.js";

// Every mutating or sensitive route declares one of these permission strings.
// Keeping the matrix in one file makes "who can do what" auditable at a glance.
export const PERMISSIONS = [
  "accounts:read",
  "accounts:write",
  "journal:read",
  "journal:post",
  "journal:reverse",
  "journal:approve",
  "period:close",
  "student:read",
  "student:write",
  "student:admit",
  "invoice:read",
  "invoice:create",
  "payment:record",
  "supplier:read",
  "supplier:write",
  "ap:invoice:create",
  "ap:payment:record",
  "report:view",
  "audit:view",
  "user:read",
  "user:manage",
  "payroll:admin",
  "payroll:input",
  "payroll:approve",
  "budget:create",
  "budget:submit",
  "budget:review",
  "budget:approve",
  "quota:manage",
  "management:view",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const ALL: Permission[] = [...PERMISSIONS];

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  // System Administrator — full access & user directory management (merged IT Admin)
  admin: ALL,

  // Vice-Chancellor — Executive View (KPIs, Strategy, Management Accounts, Approvals, Reports)
  vice_chancellor: [
    "report:view",
    "management:view",
    "audit:view",
    "user:read",
    "budget:review",
    "budget:approve",
    "journal:read",
    "payroll:approve",
  ],

  // Bursar — Chief Financial Officer (approves journals, budgets, payroll runs, quotas)
  bursar: [
    "accounts:read",
    "accounts:write",
    "journal:read",
    "journal:post",
    "journal:approve",
    "journal:reverse",
    "period:close",
    "student:read",
    "student:write",
    "invoice:read",
    "invoice:create",
    "payment:record",
    "supplier:read",
    "supplier:write",
    "ap:invoice:create",
    "ap:payment:record",
    "report:view",
    "audit:view",
    "user:read",
    "payroll:admin",
    "payroll:approve",
    "budget:create",
    "budget:submit",
    "budget:review",
    "budget:approve",
    "quota:manage",
  ],

  // Accounts Officer — Day-to-day financial entry (drafts journals, budgets & payroll inputs)
  accounts_officer: [
    "accounts:read",
    "journal:read",
    "journal:post",
    "invoice:read",
    "invoice:create",
    "payment:record",
    "supplier:read",
    "supplier:write",
    "ap:invoice:create",
    "ap:payment:record",
    "report:view",
    "user:read",
    "budget:create",
    "budget:submit",
    "payroll:input",
  ],

  // Admissions Officer — Dedicated student intake & registration management
  admissions_officer: [
    "student:read",
    "student:write",
    "student:admit",
    "user:read",
  ],

  // External Auditor — Read-only access across general ledger, financial statements & audit log
  auditor: [
    "accounts:read",
    "journal:read",
    "student:read",
    "invoice:read",
    "supplier:read",
    "report:view",
    "audit:view",
    "user:read",
  ],
};

export function roleHasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}
