import { Router } from "express";
import { store } from "../store.js";
import { authenticate } from "../middleware/auth.js";
import { require } from "../middleware/rbac.js";
import { writeAudit } from "../middleware/audit.js";
import { badRequest, newId } from "../util.js";
import type { Account } from "../types.js";

export const accountsRouter = Router();
accountsRouter.use(authenticate);

accountsRouter.get("/", require("accounts:read"), (req, res) => {
  res.json({ accounts: store.data.accounts });
});

accountsRouter.post("/", require("accounts:write"), (req, res, next) => {
  try {
    const { code, name, type, parentId, costCenterFlag, isControlAccount } = req.body ?? {};
    if (!code || !name || !type) throw badRequest("MISSING_FIELDS", "code, name and type are required.");
    if (store.data.accounts.some((a) => a.code === code)) throw badRequest("DUPLICATE_CODE", `Account code ${code} already exists.`);

    const account: Account = {
      id: newId(),
      code,
      name,
      type,
      parentId: parentId ?? null,
      costCenterFlag: !!costCenterFlag,
      isActive: true,
      isControlAccount: isControlAccount ?? undefined,
    };
    store.data.accounts.push(account);
    writeAudit(store.data, { entityType: "Account", entityId: account.id, action: "CREATE", before: null, after: account, user: req.user! });
    store.save();
    res.status(201).json({ account });
  } catch (e) {
    next(e);
  }
});

accountsRouter.patch("/:id", require("accounts:write"), (req, res, next) => {
  try {
    const account = store.data.accounts.find((a) => a.id === req.params.id);
    if (!account) throw badRequest("NOT_FOUND", "Account not found.");
    const before = { ...account };
    const { name, isActive, parentId, costCenterFlag } = req.body ?? {};
    if (name !== undefined) account.name = name;
    if (isActive !== undefined) account.isActive = isActive;
    if (parentId !== undefined) account.parentId = parentId;
    if (costCenterFlag !== undefined) account.costCenterFlag = costCenterFlag;
    writeAudit(store.data, { entityType: "Account", entityId: account.id, action: "UPDATE", before, after: account, user: req.user! });
    store.save();
    res.json({ account });
  } catch (e) {
    next(e);
  }
});
