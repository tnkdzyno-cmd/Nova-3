import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { store } from "../store.js";
import { JWT_SECRET, authenticate } from "../middleware/auth.js";
import { nowIso } from "../util.js";

export const authRouter = Router();

authRouter.post("/login", (req, res) => {
  const { username, password } = req.body ?? {};
  if (!username || !password) {
    return res.status(400).json({ error: { code: "MISSING_FIELDS", message: "Username and password are required." } });
  }
  const user = store.data.users.find((u) => u.username === username && u.isActive);
  if (!user || !bcrypt.compareSync(password, user.passwordHash)) {
    // Deliberately identical error for unknown user vs wrong password (no username enumeration).
    return res.status(401).json({ error: { code: "INVALID_CREDENTIALS", message: "Incorrect username or password." } });
  }
  user.lastLogin = nowIso();
  store.save();

  const payload = { id: user.id, username: user.username, role: user.role, fullName: user.fullName };
  const token = jwt.sign(payload, JWT_SECRET, { expiresIn: "8h" });
  res.json({ token, user: payload });
});

authRouter.get("/me", authenticate, (req, res) => {
  res.json({ user: req.user });
});
