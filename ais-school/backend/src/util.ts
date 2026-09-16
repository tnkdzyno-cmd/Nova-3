import { v4 as uuidv4 } from "uuid";
import type { Counters } from "./types.js";
import * as XLSX from "xlsx";

export const newId = () => uuidv4();

export const nowIso = () => new Date().toISOString();

/** cents -> "1,234.56" style string for display/reports. */
export function formatCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const major = Math.floor(abs / 100);
  const minor = String(abs % 100).padStart(2, "0");
  return `${sign}${major.toLocaleString()}.${minor}`;
}

export class HttpError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const badRequest = (code: string, message: string) => new HttpError(400, code, message);
export const forbidden = (message = "You do not have permission to perform this action.") =>
  new HttpError(403, "FORBIDDEN", message);
export const notFound = (message = "Resource not found.") => new HttpError(404, "NOT_FOUND", message);
export const conflict = (code: string, message: string) => new HttpError(409, code, message);

// ---------------------------------------------------------------------------
// Human-readable reference numbers
// ---------------------------------------------------------------------------
// The UUID `id` stays the stable internal primary key (safe for foreign
// keys, never shown to a user). `refNo` is what staff actually read and
// write on receipts and statements — sequential per kind, per year, e.g.
// "INV-2026-0001". Counters live in DataShape.counters so they persist
// across restarts the same way every other table does.

const REF_PREFIX: Record<keyof Counters, string> = {
  journal: "JE",
  arInvoice: "INV",
  apInvoice: "BILL",
  arPayment: "RCT",
  apPayment: "PMT",
  budget: "BUD",
};

/** Mints the next sequential reference number for `kind`, scoped to the given date's year. */
export function nextRefNo(counters: Counters, kind: keyof Counters, isoDate: string): string {
  counters[kind] += 1;
  const year = isoDate.slice(0, 4) || String(new Date().getFullYear());
  return `${REF_PREFIX[kind]}-${year}-${String(counters[kind]).padStart(4, "0")}`;
}

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------
// Opt-in by design: pagination only activates when the caller explicitly
// passes `page`. Several existing screens (the dashboard's summary stats,
// the student roster's balance aggregation, bulk-billing's student picker)
// depend on getting the *entire* filtered list back in one call — making
// pagination mandatory would silently truncate those. When a real database
// and much larger data volumes arrive (see docs/README.md roadmap), those
// call sites should move to dedicated aggregate endpoints and this default
// should flip to always-paginated.

export interface PageResult<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export function paginate<T>(items: T[], query: { page?: unknown; pageSize?: unknown }): PageResult<T> {
  const total = items.length;
  const pageRequested = query.page !== undefined && query.page !== null && query.page !== "";
  if (!pageRequested) {
    return { data: items, total, page: 1, pageSize: total || 0, totalPages: 1 };
  }
  const pageSize = Math.max(1, Math.min(500, Math.trunc(Number(query.pageSize)) || 20));
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.max(1, Math.min(totalPages, Math.trunc(Number(query.page)) || 1));
  const start = (page - 1) * pageSize;
  return { data: items.slice(start, start + pageSize), total, page, pageSize, totalPages };
}

// ---------------------------------------------------------------------------
// Text search + date-range filtering
// ---------------------------------------------------------------------------

/** Case-insensitive substring match of `search` against any of the given field values. */
export function matchesSearch(search: unknown, ...fields: (string | null | undefined)[]): boolean {
  if (!search) return true;
  const q = String(search).trim().toLowerCase();
  if (!q) return true;
  return fields.some((f) => (f ?? "").toLowerCase().includes(q));
}

/** Inclusive ISO-date range check: dateFrom <= value <= dateTo (either bound optional). */
export function inDateRange(value: string, dateFrom: unknown, dateTo: unknown): boolean {
  if (dateFrom && value < String(dateFrom)) return false;
  if (dateTo && value > String(dateTo)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// CSV export
// ---------------------------------------------------------------------------

export interface CsvColumn<T> {
  header: string;
  value: (row: T) => string | number;
}

function csvEscape(value: string | number): string {
  const s = String(value ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv<T>(rows: T[], columns: CsvColumn<T>[]): string {
  const header = columns.map((c) => csvEscape(c.header)).join(",");
  const body = rows.map((row) => columns.map((c) => csvEscape(c.value(row))).join(",")).join("\n");
  return header + "\n" + body + (rows.length ? "\n" : "");
}

// ---------------------------------------------------------------------------
// Excel (.xlsx) export
// ---------------------------------------------------------------------------
// Genuine Excel workbooks (not just CSV renamed) via SheetJS. Reuses the
// same CsvColumn definitions as toCsv() so every export route gets both
// formats for free once it defines its columns once.

export function toXlsxBuffer<T>(rows: T[], columns: CsvColumn<T>[], sheetName = "Sheet1"): Buffer {
  const header = columns.map((c) => c.header);
  const body = rows.map((row) => columns.map((c) => c.value(row)));
  const worksheet = XLSX.utils.aoa_to_sheet([header, ...body]);
  // Reasonable column widths so the export doesn't open with everything
  // truncated to Excel's default ~8-character column.
  worksheet["!cols"] = columns.map((c) => ({ wch: Math.max(c.header.length + 2, 14) }));
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName.slice(0, 31)); // Excel sheet-name length limit
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
}
