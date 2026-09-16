import "dotenv/config";
import express from "express";
import cors from "cors";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

import { authRouter } from "./routes/auth.js";
import { accountsRouter } from "./routes/accounts.js";
import { journalRouter } from "./routes/journal.js";
import { periodsRouter } from "./routes/periods.js";
import { studentsRouter } from "./routes/students.js";
import { invoicesRouter } from "./routes/invoices.js";
import { paymentsRouter } from "./routes/payments.js";
import { suppliersRouter } from "./routes/suppliers.js";
import { reportsRouter } from "./routes/reports.js";
import { auditRouter } from "./routes/audit.js";
import { payrollRouter } from "./routes/payroll.js";
import { usersRouter } from "./routes/users.js";
import { notificationsRouter } from "./routes/notifications.js";
import { budgetsRouter } from "./routes/budgets.js";
import { managementRouter } from "./routes/management.js";
import { errorHandler } from "./middleware/errors.js";
import { store } from "./store.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();

// If this is deployed behind a real reverse proxy/load balancer, set
// TRUST_PROXY=true so req.ip (used for audit-log IP capture) reflects the
// actual client address from X-Forwarded-For instead of the proxy's own
// address. Leave unset for local/direct deployments — blindly trusting
// X-Forwarded-For when there is no proxy in front of you lets a client
// spoof its own IP in the audit trail.
if (process.env.TRUST_PROXY === "true") {
  app.set("trust proxy", true);
}

app.use(cors());
app.use(express.json());

app.get("/api/health", (_req, res) => res.json({ ok: true, time: new Date().toISOString() }));

app.use("/api/auth", authRouter);
app.use("/api/accounts", accountsRouter);
app.use("/api/journal-entries", journalRouter);
app.use("/api/periods", periodsRouter);
app.use("/api/students", studentsRouter);
app.use("/api/invoices", invoicesRouter);
app.use("/api/payments", paymentsRouter);
app.use("/api/suppliers", suppliersRouter);
app.use("/api/reports", reportsRouter);
app.use("/api/audit-log", auditRouter);
app.use("/api/payroll", payrollRouter);
app.use("/api/users", usersRouter);
app.use("/api/notifications", notificationsRouter);
app.use("/api/budgets", budgetsRouter);
app.use("/api/management", managementRouter);

// Serve the static frontend from the same origin/port so there is exactly
// one command to run and one URL to open — no CORS setup needed for the demo.
const frontendDir = join(__dirname, "..", "..", "frontend");
if (existsSync(frontendDir)) {
  app.use(express.static(frontendDir));
}

app.use((req, res) => {
  if (req.path.startsWith("/api/")) {
    return res.status(404).json({ error: { code: "NOT_FOUND", message: "No such API route." } });
  }
  res.status(404).sendFile(join(frontendDir, "index.html"), (err) => {
    if (err) res.status(404).send("Not found");
  });
});

app.use(errorHandler);

if (store.data.accounts.length === 0 && store.data.users.length === 0) {
  // eslint-disable-next-line no-console
  console.log("No data found. Run `npm run seed` first to load the chart of accounts, demo users, and sample transactions.");
}

const PORT = Number(process.env.PORT) || 4000;
app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`AIS backend listening on http://localhost:${PORT}`);
});
