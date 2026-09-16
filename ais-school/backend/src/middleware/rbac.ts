import type { Request, Response, NextFunction } from "express";
import { roleHasPermission, type Permission } from "../rbac-policy.js";
import { store } from "../store.js";
import type { DataScope } from "../types.js";

// Maps a permission to the data-scope key that gates it for the `auditor`
// role specifically. Every permission the auditor role is statically
// granted in rbac-policy.ts appears here — that static grant is a ceiling
// ("an auditor could see this"), and this map is the actual gate ("this
// specific auditor account has been granted it"). Every other role's
// access is governed purely by rbac-policy.ts, unaffected by this map.
const AUDITOR_SCOPE_FOR_PERMISSION: Partial<Record<Permission, DataScope>> = {
  "accounts:read": "accounts",
  "journal:read": "journal",
  "student:read": "students",
  "invoice:read": "billing",
  "supplier:read": "suppliers",
  "report:view": "reports",
  "audit:view": "audit",
  "user:read": "users",
};

/** Route guard: require("journal:reverse") etc. Requires authenticate() to have run first. */
export function require(permission: Permission) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: { code: "UNAUTHENTICATED", message: "Login required." } });
    }
    if (!roleHasPermission(req.user.role, permission)) {
      return res.status(403).json({
        error: {
          code: "FORBIDDEN",
          message: `Your role (${req.user.role}) does not have the '${permission}' permission.`,
        },
      });
    }

    if (req.user.role === "auditor") {
      const scope = AUDITOR_SCOPE_FOR_PERMISSION[permission];
      if (scope) {
        // Looked up live (not from the JWT) so an admin revoking a scope
        // takes effect immediately, not just at the auditor's next login.
        const liveUser = store.data.users.find((u) => u.id === req.user!.id);
        const granted = liveUser?.dataScopes ?? [];
        if (!granted.includes(scope)) {
          return res.status(403).json({
            error: {
              code: "SCOPE_NOT_GRANTED",
              message: `Your auditor account has not been granted access to '${scope}' data. Ask a System Administrator to grant it.`,
            },
          });
        }
      }
    }

    next();
  };
}
