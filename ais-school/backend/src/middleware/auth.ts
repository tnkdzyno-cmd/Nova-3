import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import type { Role } from "../types.js";

export const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";

export interface AuthedUser {
  id: string;
  username: string;
  role: Role;
  fullName: string;
  ipAddress?: string | null; // set per-request by authenticate(), never part of the signed JWT
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthedUser;
    }
  }
}

export function authenticate(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).json({ error: { code: "UNAUTHENTICATED", message: "Missing or invalid Authorization header." } });
  }
  const token = header.slice("Bearer ".length);
  try {
    const payload = jwt.verify(token, JWT_SECRET) as AuthedUser;
    req.user = { ...payload, ipAddress: req.ip ?? null };
    next();
  } catch {
    return res.status(401).json({ error: { code: "INVALID_TOKEN", message: "Session expired or invalid. Please log in again." } });
  }
}

export function requireRole(allowedRoles: Role | Role[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: { code: "UNAUTHENTICATED", message: "Missing or invalid Authorization header." } });
    }
    const roles = Array.isArray(allowedRoles) ? allowedRoles : [allowedRoles];
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: { code: "FORBIDDEN", message: "You do not have permission to perform this action." } });
    }
    next();
  };
}
