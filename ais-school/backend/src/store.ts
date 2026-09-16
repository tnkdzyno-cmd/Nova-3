// Lightweight in-memory data store, snapshotted to a JSON file on disk.
//
// WHY NOT A REAL DATABASE HERE:
// This MVP is designed to run anywhere with zero setup (no DB server, no
// native driver compilation) so it can be reviewed and demoed instantly.
// The repository layer below is the ONLY place that touches storage, so
// swapping it for PostgreSQL (see docs/schema.sql for the target production
// schema) means rewriting this one file — nothing in routes/ or services/
// needs to change. See docs/README.md "Path to production" for the plan.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import type {
  Account,
  CostCenter,
  Period,
  JournalEntry,
  User,
  Student,
  Supplier,
  Invoice,
  Payment,
  AuditLogEntry,
  Counters,
  Budget,
} from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_FILE = process.env.DATA_FILE ? resolve(process.env.DATA_FILE) : join(__dirname, "..", "data.json");

export interface DataShape {
  accounts: Account[];
  costCenters: CostCenter[];
  periods: Period[];
  journalEntries: JournalEntry[];
  users: User[];
  students: Student[];
  suppliers: Supplier[];
  invoices: Invoice[];
  payments: Payment[];
  auditLog: AuditLogEntry[];
  budgets: Budget[];
  counters: Counters;
}

function emptyData(): DataShape {
  return {
    accounts: [],
    costCenters: [],
    periods: [],
    journalEntries: [],
    users: [],
    students: [],
    suppliers: [],
    invoices: [],
    payments: [],
    auditLog: [],
    budgets: [],
    counters: { journal: 0, arInvoice: 0, apInvoice: 0, arPayment: 0, apPayment: 0, budget: 0 },
  };
}

class Store {
  data: DataShape;
  private persist: boolean;

  constructor(persist = true) {
    this.persist = persist;
    if (persist && existsSync(DATA_FILE)) {
      const loaded = JSON.parse(readFileSync(DATA_FILE, "utf-8"));
      // Merge onto a fresh emptyData() so a data.json written by an older
      // version of the app (missing e.g. `counters`) upgrades cleanly
      // instead of crashing on first read.
      this.data = { ...emptyData(), ...loaded, counters: { ...emptyData().counters, ...(loaded.counters ?? {}) } };
    } else {
      this.data = emptyData();
    }
  }

  save() {
    if (!this.persist) return;
    writeFileSync(DATA_FILE, JSON.stringify(this.data, null, 2));
  }

  reset() {
    this.data = emptyData();
    this.save();
  }
}

// Singleton used by the running server. Tests create their own isolated,
// non-persisting instances via `new Store(false)` so test runs never touch
// each other or the demo data.json on disk.
export const store = new Store(process.env.NODE_ENV !== "test");
export { Store };
