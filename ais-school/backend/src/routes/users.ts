import { Router } from "express";
import { store } from "../store.js";
import { authenticate } from "../middleware/auth.js";
import { require } from "../middleware/rbac.js";
import { writeAudit } from "../middleware/audit.js";
import { badRequest, notFound } from "../util.js";
import { DATA_SCOPES, type DataScope } from "../types.js";

export const usersRouter = Router();
usersRouter.use(authenticate);

// Intentionally returns only non-sensitive fields — no password hashes.
// Full user administration (create/deactivate/reset password) is out of
// scope for this MVP; see docs/README.md roadmap. dataScopes is included
// so the User Management UI can show current auditor grants — visible to
// anyone who can list users, editable only via the endpoint below.
usersRouter.get("/", require("user:read"), (_req, res) => {
  const users = store.data.users
    .filter((u) => u.isActive)
    .map((u) => ({ id: u.id, username: u.username, fullName: u.fullName, role: u.role, dataScopes: u.role === "auditor" ? u.dataScopes ?? [] : undefined }));
  res.json({ users, availableScopes: DATA_SCOPES });
});

// Grants (or revokes) which data domains a specific auditor account can
// read. Only meaningful for role === "auditor" — every other role's
// access is governed by rbac-policy.ts alone. Gated behind user:manage,
// the same permission that already covers user administration
// (admin and it_admin today).
usersRouter.put("/:id/data-scopes", require("user:manage"), (req, res, next) => {
  try {
    const user = store.data.users.find((u) => u.id === req.params.id);
    if (!user) throw notFound("User not found.");
    if (user.role !== "auditor") {
      throw badRequest("NOT_AN_AUDITOR", "Data scopes only apply to auditor accounts — this user's access is governed by their role instead.");
    }
    const scopes = req.body?.scopes;
    if (!Array.isArray(scopes) || !scopes.every((s) => DATA_SCOPES.includes(s))) {
      throw badRequest("INVALID_SCOPES", `scopes must be an array drawn from: ${DATA_SCOPES.join(", ")}`);
    }
    const before = { ...user };
    user.dataScopes = scopes as DataScope[];
    writeAudit(store.data, { entityType: "User", entityId: user.id, action: "UPDATE_DATA_SCOPES", before, after: user, user: req.user! });
    store.save();
    res.json({ user: { id: user.id, username: user.username, fullName: user.fullName, role: user.role, dataScopes: user.dataScopes } });
  } catch (e) {
    next(e);
  }
});
