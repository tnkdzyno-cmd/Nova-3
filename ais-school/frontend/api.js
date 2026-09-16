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
  const res = await fetch(path, { ...opts, headers, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined });
  if (res.status === 401) {
    clearSession();
    window.location.href = "login.html";
    throw new Error("Session expired");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data?.error?.message || `Request failed (${res.status})`);
    err.code = data?.error?.code;
    err.status = res.status;
    throw err;
  }
  return data;
}

/** cents (integer) -> "1,234.56" for display. */
function money(cents) {
  const n = (cents || 0) / 100;
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
/** "12.50" (form input) -> 1250 (integer cents) for the API. */
function toCents(str) {
  const n = parseFloat(str);
  if (Number.isNaN(n)) return 0;
  return Math.round(n * 100);
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function fmtDate(iso) {
  if (!iso) return "—";
  return iso.length > 10 ? iso.slice(0, 10) : iso;
}

function pillClass(status) {
  return "pill pill-" + String(status).toLowerCase();
}

function showAlert(container, message, kind = "error") {
  const el = document.createElement("div");
  el.className = "alert alert-" + kind;
  el.textContent = message;
  container.prepend(el);
  if (kind !== "error") setTimeout(() => el.remove(), 4000);
}

// ---------------------------------------------------------------------------
// Theme (light/dark)
// ---------------------------------------------------------------------------

function getTheme() { return localStorage.getItem(THEME_KEY) || "light"; }
function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem(THEME_KEY, theme);
}
// Applied immediately at parse time (not on DOMContentLoaded) so the page
// paints in the right theme from the first frame instead of flashing light
// then switching to dark.
applyTheme(getTheme());

function renderThemeToggle(container) {
  const current = getTheme();
  container.innerHTML = `
    <div class="theme-toggle" role="group" aria-label="Theme">
      <button data-theme-choice="light" class="${current === "light" ? "active" : ""}">Light</button>
      <button data-theme-choice="dark" class="${current === "dark" ? "active" : ""}">Dark</button>
    </div>`;
  container.querySelectorAll("[data-theme-choice]").forEach((btn) =>
    btn.addEventListener("click", () => {
      applyTheme(btn.dataset.themeChoice);
      renderThemeToggle(container);
    })
  );
}

// ---------------------------------------------------------------------------
// Icons — a small hand-authored set (Feather/Lucide-style strokes), reused
// across the sidebar, the dashboard's navigation cards, and the header.
// ---------------------------------------------------------------------------

const ICON_PATHS = {
  dashboard: '<rect x="3" y="3" width="7.5" height="7.5" rx="1.5"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5"/>',
  students: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8"/>',
  finance: '<path d="M4 4h11a3 3 0 0 1 3 3v13H7a3 3 0 0 1-3-3V4z"/><path d="M8 9h7M8 13h7"/>',
  accounts: '<path d="M12 3 2 8l10 5 10-5-10-5z"/><path d="M2 14l10 5 10-5"/>',
  billing: '<path d="M6 2h12v20l-3-2-3 2-3-2-3 2V2z"/><path d="M9 7h6M9 11h6"/>',
  budgeting: '<path d="M12 2v10h10a10 10 0 1 1-10-10z"/><path d="M15 2.5A10 10 0 0 1 21.5 9H15V2.5z"/>',
  management: '<path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
  reports: '<path d="M4 20V10M12 20V4M20 20v-7"/>',
  hr: '<circle cx="8" cy="8" r="3"/><circle cx="16" cy="8" r="3"/><path d="M2 20c0-3.3 2.7-6 6-6M22 20c0-3.3-2.7-6-6-6"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><circle cx="17" cy="9" r="3"/><path d="M2.5 20c0-3.6 2.9-6.5 6.5-6.5s6.5 2.9 6.5 6.5M14.5 14c2.8.3 5 2.6 5 6"/>',
  settings: '<circle cx="12" cy="12" r="3.2"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>',
  suppliers: '<rect x="3" y="7" width="18" height="13" rx="1.5"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  audit: '<path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z"/>',
  bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>',
  chevronLeft: '<path d="M15 6l-6 6 6 6"/>',
  chevronRight: '<path d="M9 6l6 6-6 6"/>',
};

function iconSvg(name, size = 18) {
  const inner = ICON_PATHS[name] || ICON_PATHS.dashboard;
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
}

// ---------------------------------------------------------------------------
// Navigation — pages that actually exist, with per-role visibility hints.
// ---------------------------------------------------------------------------

const NAV_ITEMS = [
  { href: "dashboard.html", label: "Dashboard", icon: "dashboard" },
  { href: "management.html", label: "Management Accounts", icon: "management" },
  { href: "students.html", label: "Students & Billing", icon: "students" },
  { href: "journal.html", label: "General Ledger", icon: "finance" },
  { href: "suppliers.html", label: "Suppliers (AP)", icon: "suppliers" },
  { href: "accounts.html", label: "Chart of Accounts", icon: "accounts" },
  { href: "budgeting.html", label: "Budgeting", icon: "budgeting" },
  { href: "reports.html", label: "Reports", icon: "reports" },
  { href: "audit.html", label: "Audit Log", icon: "audit" },
  { href: "users.html", label: "User Management", icon: "users" },
  { href: "settings.html", label: "Settings", icon: "settings" },
];

// UI convenience only — hides links a role has no use for so people aren't
// clicking into a page just to get a permission error. This is NOT a
// security boundary: every route behind these pages is independently
// enforced server-side (see backend/src/rbac-policy.ts), regardless of
// whether the link is shown here.
const NAV_VISIBILITY = {
  admin: null, // null = show everything
  vice_chancellor: null,
  accounts_officer: ["dashboard.html", "students.html", "journal.html", "suppliers.html", "accounts.html", "reports.html", "settings.html"],
  bursar: ["students.html", "reports.html", "settings.html"],
  auditor: ["dashboard.html", "journal.html", "suppliers.html", "accounts.html", "reports.html", "audit.html", "settings.html"],
  it_admin: ["audit.html", "users.html", "settings.html"],
  budget_officer: ["dashboard.html", "budgeting.html", "reports.html", "settings.html"],
};

/** UI hint only (see NAV_VISIBILITY above) — always re-checked server-side. */
function canAccess(page) {
  const user = getUser();
  if (!user) return false;
  const allowed = NAV_VISIBILITY[user.role];
  return allowed === null || allowed === undefined ? true : allowed.includes(page);
}

/** Same UI-hint caveat as canAccess(): a small mirror of rbac-policy.ts for hiding write actions the role can't use. */
const ROLE_CAN = {
  reverseJournal: ["admin", "vice_chancellor"],
  closePeriod: ["admin", "vice_chancellor"],
  writeAccounts: ["admin", "vice_chancellor"],
  payrollAdmin: ["admin", "vice_chancellor"],
  postJournal: ["admin", "vice_chancellor", "accounts_officer"],
  createBudget: ["admin", "budget_officer"],
  submitBudget: ["admin", "budget_officer"],
  reviewBudget: ["admin", "vice_chancellor"],
  approveBudget: ["admin", "vice_chancellor"],
  manageUsers: ["admin", "it_admin"],
};
function roleCan(action) {
  const user = getUser();
  return !!user && (ROLE_CAN[action] || []).includes(user.role);
}

const ROLE_LABELS = {
  admin: "System Administrator",
  vice_chancellor: "Vice-Chancellor",
  accounts_officer: "Accounts Officer",
  bursar: "Bursar",
  auditor: "Auditor",
  it_admin: "IT Administrator",
  budget_officer: "Budget Officer",
};

const INSTITUTION_NAME = "Ridgeview College";

function novaMark(size = 26) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 32 32" fill="none">
    <rect width="32" height="32" rx="8" fill="rgba(255,255,255,0.14)"/>
    <path d="M16 6 L18.2 13.8 L26 16 L18.2 18.2 L16 26 L13.8 18.2 L6 16 L13.8 13.8 Z" fill="#14B8A6"/>
  </svg>`;
}

/** Renders the sidebar into #rail, and enhances any .letterhead on the page with a notifications bell + theme toggle. Every page (except login) includes <div id="rail"></div>. */
function renderRail(activeHref) {
  const user = getUser();
  const railEl = document.getElementById("rail");
  if (railEl) {
    const collapsed = localStorage.getItem("nova_rail_collapsed") === "true";
    document.querySelector(".shell")?.classList.toggle("rail-collapsed", collapsed);

    const links = NAV_ITEMS.filter((item) => canAccess(item.href))
      .map(
        (item) =>
          `<a href="${item.href}" class="${item.href === activeHref ? "active" : ""}">${iconSvg(item.icon)}<span class="label">${item.label}</span></a>`
      )
      .join("");
    railEl.innerHTML = `
      <button class="rail-toggle" id="railToggle" aria-label="Toggle sidebar">${iconSvg(collapsed ? "chevronRight" : "chevronLeft", 13)}</button>
      <div class="crest">
        ${novaMark()}
        <div class="crest-text">Nova<small>${escapeHtml(INSTITUTION_NAME)}</small></div>
      </div>
      <nav>${links}</nav>
      <div class="who">
        <div class="who-detail">
          Signed in as<b>${escapeHtml(user?.fullName || user?.username || "")}</b>
          ${escapeHtml(ROLE_LABELS[user?.role] || (user?.role || "").replaceAll("_", " "))}
        </div>
        <button class="secondary small" id="logoutBtn">Log out</button>
      </div>
    `;
    document.getElementById("logoutBtn")?.addEventListener("click", () => {
      clearSession();
      window.location.href = "login.html";
    });
    document.getElementById("railToggle")?.addEventListener("click", () => {
      const next = !document.querySelector(".shell").classList.contains("rail-collapsed");
      document.querySelector(".shell").classList.toggle("rail-collapsed", next);
      localStorage.setItem("nova_rail_collapsed", String(next));
      renderRail(activeHref); // re-render so the toggle icon and labels flip correctly
    });
  }

  // If someone lands directly on a page their role has no link for (typed
  // the URL, followed an old bookmark), send them somewhere they do have
  // access to instead of letting every fetch on the page fail with 403s.
  if (!canAccess(activeHref)) {
    window.location.href = canAccess("dashboard.html") ? "dashboard.html" : NAV_ITEMS.find((i) => canAccess(i.href))?.href || "login.html";
    return;
  }

  mountHeaderExtras();
}

/** Appends a notification bell + theme toggle to the page's .letterhead, if present, without requiring each page to add markup for it. */
function mountHeaderExtras() {
  const letterhead = document.querySelector(".letterhead");
  if (!letterhead || letterhead.querySelector(".letterhead-actions")) return;
  const actions = document.createElement("div");
  actions.className = "letterhead-actions";
  actions.innerHTML = `
    <div id="themeToggleHost"></div>
    <div class="notif-wrap">
      <button class="notif-bell" id="notifBell" aria-label="Notifications">${iconSvg("bell", 18)}<span class="notif-badge" id="notifBadge" style="display:none;"></span></button>
      <div class="notif-panel" id="notifPanel">
        <h3>Notifications</h3>
        <div id="notifList" class="muted" style="padding:8px;">Loading…</div>
      </div>
    </div>
  `;
  letterhead.appendChild(actions);
  renderThemeToggle(document.getElementById("themeToggleHost"));
  loadNotifications();

  document.getElementById("notifBell").addEventListener("click", (e) => {
    e.stopPropagation();
    document.getElementById("notifPanel").classList.toggle("open");
  });
  document.addEventListener("click", () => document.getElementById("notifPanel")?.classList.remove("open"));
}

async function loadNotifications() {
  try {
    const { notifications, count } = await api("/api/notifications");
    const badge = document.getElementById("notifBadge");
    const list = document.getElementById("notifList");
    if (!badge || !list) return;
    if (count > 0) {
      badge.style.display = "flex";
      badge.textContent = String(count);
    } else {
      badge.style.display = "none";
    }
    const dotColor = { info: "var(--secondary)", warning: "var(--warning)", danger: "var(--danger)" };
    list.innerHTML = notifications.length
      ? notifications
          .map(
            (n) =>
              `<div class="notif-item"><span class="dot" style="background:${dotColor[n.severity] || "var(--secondary)"}"></span><span>${escapeHtml(n.message)}</span></div>`
          )
          .join("")
      : `<div style="padding:10px 8px;">You're all caught up — nothing needs attention right now.</div>`;
  } catch {
    // Notifications are a convenience, not core functionality — a role
    // without report:view will 403 here, which is fine, just show nothing.
    const list = document.getElementById("notifList");
    if (list) list.innerHTML = `<div style="padding:10px 8px;">Notifications aren't available for your role.</div>`;
  }
}

/** Triggers a browser download of a CSV/PDF/XLSX export route, attaching the auth header a plain <a href> can't carry. */
async function downloadExport(path, filename) {
  const token = getToken();
  const res = await fetch(path, { headers: token ? { Authorization: "Bearer " + token } : {} });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data?.error?.message || `Export failed (${res.status})`);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * Renders Prev / page X of Y / Next controls into `container` and wires
 * them to call `onChange(newPage)`. Used by any page with a paginated table.
 */
function renderPager(container, { page, totalPages }, onChange) {
  if (totalPages <= 1) {
    container.innerHTML = "";
    return;
  }
  container.innerHTML = `
    <button class="secondary small" id="pagerPrev" ${page <= 1 ? "disabled" : ""}>&larr; Prev</button>
    <span class="muted mono" style="margin:0 10px;">Page ${page} of ${totalPages}</span>
    <button class="secondary small" id="pagerNext" ${page >= totalPages ? "disabled" : ""}>Next &rarr;</button>
  `;
  container.querySelector("#pagerPrev")?.addEventListener("click", () => onChange(page - 1));
  container.querySelector("#pagerNext")?.addEventListener("click", () => onChange(page + 1));
}
