// Shared across every page. No build step, no framework — plain fetch()
// against the same-origin REST API the Express server exposes under /api.

const TOKEN_KEY = "ais_token";
const USER_KEY = "ais_user";
const THEME_KEY = "nova_theme";

function getToken() { return localStorage.getItem(TOKEN_KEY); }
function getUser() { try { return JSON.parse(localStorage.getItem(USER_KEY) || "null"); } catch { return null; } }
function setSession(token, user) { localStorage.setItem(TOKEN_KEY, token); localStorage.setItem(USER_KEY, JSON.stringify(user)); }
function clearSession() { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(USER_KEY); }

function requireAuth() {
  if (!getToken()) { window.location.href = "login.html"; throw new Error("redirect"); }
}

/** Thin wrapper: JSON in, JSON out, auto-attaches the bearer token, redirects to login on 401. */
async function api(path, opts = {}) {
  const headers = { "Content-Type": "application/json", ...(opts.headers || {}) };
  const token = getToken();
  if (token) headers.Authorization = "Bearer " + token;
  const res = await fetch(path, { ...opts, headers, body:Because Claude generated and applied the full code directly within its hidden internal workspace, the complete `api.js` file is not visible in your browser. However, based on the **Nova Role Architecture** requirements detailed in your chat tab, I can provide the fully updated `NAV_ITEMS` array. 

This snippet updates the navigation matrix to support your new 6-role RBAC model, activating the HR module, enforcing the new Vice-Chancellor restrictions, and removing the deprecated Budget Officer.

You can copy and paste this directly into your GitHub editor to replace the current `NAV_ITEMS` block starting at line 130:

```javascript
// ---------------------------------------------------------------------------
// Navigation — pages that actually exist, with per-role visibility hints.
// ---------------------------------------------------------------------------
const NAV_ITEMS = [
  { href: "dashboard.html", label: "Dashboard", icon: "dashboard", roles: ["system_admin", "admissions_officer", "bursar", "accounts_officer", "vc", "external_auditor"] },
  { href: "management.html", label: "Management Accounts", icon: "management", roles: ["system_admin", "bursar", "accounts_officer", "vc"] },
  { href: "students.html", label: "Students & Billing", icon: "students", roles: ["system_admin", "admissions_officer", "bursar", "accounts_officer"] },
  { href: "journal.html", label: "General Ledger", icon: "finance", roles: ["system_admin", "bursar", "accounts_officer", "external_auditor"] },
  { href: "budgeting.html", label: "Budgeting", icon: "budgeting", roles: ["system_admin", "bursar", "accounts_officer"] },
  { href: "suppliers.html", label: "Accounts Payable", icon: "suppliers", roles: ["system_admin", "bursar", "accounts_officer"] },
  { href: "hr.html", label: "HR & Payroll", icon: "hr", roles: ["system_admin", "bursar", "accounts_officer"] },
  { href: "reports.html", label: "Reports", icon: "reports", roles: ["system_admin", "bursar", "accounts_officer", "vc", "external_auditor"] },
  { href: "audit.html", label: "Audit Logs", icon: "audit", roles: ["system_admin", "external_auditor"] },
  { href: "users.html", label: "Users", icon: "users", roles: ["system_admin"] },
  { href: "settings.html", label: "Settings", icon: "settings", roles: ["system_admin"] }
];
