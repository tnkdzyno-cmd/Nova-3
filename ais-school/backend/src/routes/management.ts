import { Router } from "express";
import { store } from "../store.js";
import { authenticate } from "../middleware/auth.js";
import { require } from "../middleware/rbac.js";
import { managementSummary } from "../services/management.js";

export const managementRouter = Router();
managementRouter.use(authenticate);
managementRouter.use(require("management:view"));

managementRouter.get("/summary", (_req, res) => {
  res.json(managementSummary(store.data));
});
