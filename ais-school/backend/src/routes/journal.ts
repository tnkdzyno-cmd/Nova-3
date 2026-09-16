import { Router } from "express";
import { store } from "../store.js";
import { authenticate } from "../middleware/auth.js";
import { require } from "../middleware/rbac.js";
import { postJournalEntry, reverseJournalEntry } from "../services/ledger.js";
import { paginate, matchesSearch, inDateRange, toCsv, toXlsxBuffer } from "../util.js";
import { streamTablePdf } from "../services/pdf.js";
import { formatCents } from "../util.js";

export const journalRouter = Router();
journalRouter.use(authenticate);

function userName(id: string): string {
  return store.data.users.find((u) => u.id === id)?.fullName ?? "Unknown";
}

journalRouter.get("/", require("journal:read"), (req, res) => {
  const { periodId, status, search, dateFrom, dateTo, format } = req.query;
  let entries = store.data.journalEntries;
  if (periodId) entries = entries.filter((e) => e.periodId === periodId);
  if (status) entries = entries.filter((e) => e.status === status);
  if (dateFrom || dateTo) entries = entries.filter((e) => inDateRange(e.date, dateFrom, dateTo));
  if (search) entries = entries.filter((e) => matchesSearch(search, e.refNo, e.description, e.source));
  entries = entries.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const tableColumns = [
    { header: "Ref No", value: (e: (typeof entries)[number]) => e.refNo },
    { header: "Date", value: (e: (typeof entries)[number]) => e.date },
    { header: "Description", value: (e: (typeof entries)[number]) => e.description },
    { header: "Source", value: (e: (typeof entries)[number]) => e.source },
    { header: "Status", value: (e: (typeof entries)[number]) => e.status },
    { header: "Posted By", value: (e: (typeof entries)[number]) => userName(e.createdBy) },
    { header: "Amount", value: (e: (typeof entries)[number]) => formatCents(e.lines.reduce((s, l) => s + l.debit, 0)) },
  ];

  if (format === "csv") {
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", 'attachment; filename="journal-entries.csv"');
    return res.send(toCsv(entries, tableColumns));
  }
  if (format === "xlsx") {
    const buffer = toXlsxBuffer(entries, tableColumns, "Journal Entries");
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", 'attachment; filename="journal-entries.xlsx"');
    return res.send(buffer);
  }
  if (format === "pdf") {
    return streamTablePdf(res, {
      filename: "journal-entries.pdf",
      title: "General Ledger — Journal Entries",
      subtitle: `${entries.length} entries${dateFrom || dateTo ? ` (${dateFrom || "…"} to ${dateTo || "…"})` : ""}`,
      columns: [
        { header: "Ref No", width: 70, value: (e) => e.refNo },
        { header: "Date", width: 55, value: (e) => e.date },
        { header: "Description", width: 190, value: (e) => e.description },
        { header: "Status", width: 55, value: (e) => e.status },
        { header: "Posted By", width: 80, value: (e) => userName(e.createdBy) },
        { header: "Amount", width: 65, align: "right", value: (e) => formatCents(e.lines.reduce((s, l) => s + l.debit, 0)) },
      ],
      rows: entries,
    });
  }

  const { data, total, page, pageSize, totalPages } = paginate(entries, req.query);
  const enriched = data.map((e) => ({ ...e, createdByName: userName(e.createdBy) }));
  res.json({ journalEntries: enriched, total, page, pageSize, totalPages });
});

journalRouter.get("/:id", require("journal:read"), (req, res) => {
  const entry = store.data.journalEntries.find((e) => e.id === req.params.id);
  if (!entry) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Journal entry not found." } });
  res.json({ journalEntry: { ...entry, createdByName: userName(entry.createdBy) } });
});

// Idempotency: repeated POSTs with the same Idempotency-Key header return the
// original entry instead of creating a duplicate (spec: "prefer idempotent
// operations"). A production build would persist this map in the DB;
// here it lives for the process lifetime, which is enough for the demo.
const idempotencyCache = new Map<string, string>(); // key -> journalEntryId

journalRouter.post("/", require("journal:post"), (req, res, next) => {
  try {
    const idemKey = req.header("Idempotency-Key");
    if (idemKey && idempotencyCache.has(idemKey)) {
      const existing = store.data.journalEntries.find((e) => e.id === idempotencyCache.get(idemKey));
      return res.status(200).json({ journalEntry: existing, idempotent: true });
    }
    const { date, description, lines } = req.body ?? {};
    const entry = postJournalEntry(store.data, { date, description, lines, source: "manual" }, req.user!);
    if (idemKey) idempotencyCache.set(idemKey, entry.id);
    store.save();
    res.status(201).json({ journalEntry: entry });
  } catch (e) {
    next(e);
  }
});

journalRouter.post("/:id/reverse", require("journal:reverse"), (req, res, next) => {
  try {
    const reversal = reverseJournalEntry(store.data, req.params.id, req.user!, req.body?.date);
    store.save();
    res.status(201).json({ journalEntry: reversal });
  } catch (e) {
    next(e);
  }
});
