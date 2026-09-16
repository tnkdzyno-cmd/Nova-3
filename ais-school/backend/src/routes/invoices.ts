import { Router } from "express";
import { store } from "../store.js";
import { authenticate } from "../middleware/auth.js";
import { require } from "../middleware/rbac.js";
import { createInvoice, createInvoicesBulk, agedReceivables } from "../services/ar.js";
import { paginate, matchesSearch, inDateRange, toCsv, toXlsxBuffer, formatCents } from "../util.js";
import { streamTablePdf } from "../services/pdf.js";
import type { Invoice } from "../types.js";

export const invoicesRouter = Router();
invoicesRouter.use(authenticate);

function studentName(id: string | null): string {
  return store.data.students.find((s) => s.id === id)?.name ?? "Unknown";
}

invoicesRouter.get("/", require("invoice:read"), (req, res) => {
  const { studentId, status, search, dateFrom, dateTo, format } = req.query;
  let invoices = store.data.invoices.filter((i) => i.kind === "AR");
  if (studentId) invoices = invoices.filter((i) => i.studentId === studentId);
  if (status) invoices = invoices.filter((i) => i.status === status);
  if (dateFrom || dateTo) invoices = invoices.filter((i) => inDateRange(i.date, dateFrom, dateTo));
  if (search) invoices = invoices.filter((i) => matchesSearch(search, i.refNo, studentName(i.studentId)));
  invoices = invoices.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const columns = [
    { header: "Ref No", value: (i: Invoice) => i.refNo },
    { header: "Student", value: (i: Invoice) => studentName(i.studentId) },
    { header: "Date", value: (i: Invoice) => i.date },
    { header: "Due date", value: (i: Invoice) => i.dueDate },
    { header: "Total", value: (i: Invoice) => formatCents(i.totalAmount) },
    { header: "Paid", value: (i: Invoice) => formatCents(i.amountPaid) },
    { header: "Outstanding", value: (i: Invoice) => formatCents(i.totalAmount - i.amountPaid) },
    { header: "Status", value: (i: Invoice) => i.status },
  ];

  if (format === "csv") {
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", 'attachment; filename="student-invoices.csv"');
    return res.send(toCsv(invoices, columns));
  }
  if (format === "xlsx") {
    const buffer = toXlsxBuffer(invoices, columns, "Student Invoices");
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", 'attachment; filename="student-invoices.xlsx"');
    return res.send(buffer);
  }
  if (format === "pdf") {
    return streamTablePdf(res, {
      filename: "student-invoices.pdf",
      title: "Student Invoices (Accounts Receivable)",
      subtitle: `${invoices.length} invoices`,
      columns: [
        { header: "Ref No", width: 65, value: (i: Invoice) => i.refNo },
        { header: "Student", width: 110, value: (i: Invoice) => studentName(i.studentId) },
        { header: "Date", width: 55, value: (i: Invoice) => i.date },
        { header: "Due", width: 55, value: (i: Invoice) => i.dueDate },
        { header: "Total", width: 55, align: "right", value: (i: Invoice) => formatCents(i.totalAmount) },
        { header: "Outstanding", width: 65, align: "right", value: (i: Invoice) => formatCents(i.totalAmount - i.amountPaid) },
        { header: "Status", width: 55, value: (i: Invoice) => i.status },
      ],
      rows: invoices,
    });
  }

  const { data, total, page, pageSize, totalPages } = paginate(invoices, req.query);
  res.json({ invoices: data, total, page, pageSize, totalPages });
});

invoicesRouter.get("/aged-receivables", require("report:view"), (req, res) => {
  const asOf = (req.query.asOf as string) ?? new Date().toISOString().slice(0, 10);
  const rows = agedReceivables(store.data, asOf);
  const { format } = req.query;

  const agedColumns = [
    { header: "Student", value: (r: (typeof rows)[number]) => r.studentName },
    { header: "Due date", value: (r: (typeof rows)[number]) => r.dueDate },
    { header: "Ageing", value: (r: (typeof rows)[number]) => r.bucket },
    { header: "Outstanding", value: (r: (typeof rows)[number]) => formatCents(r.outstanding) },
  ];

  if (format === "csv") {
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", 'attachment; filename="aged-receivables.csv"');
    return res.send(toCsv(rows, agedColumns));
  }
  if (format === "xlsx") {
    const buffer = toXlsxBuffer(rows, agedColumns, "Aged Receivables");
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", 'attachment; filename="aged-receivables.xlsx"');
    return res.send(buffer);
  }
  if (format === "pdf") {
    return streamTablePdf(res, {
      filename: "aged-receivables.pdf",
      title: "Aged Receivables",
      subtitle: `As of ${asOf}`,
      columns: [
        { header: "Student", width: 200, value: (r) => r.studentName },
        { header: "Due date", width: 90, value: (r) => r.dueDate },
        { header: "Ageing", width: 80, value: (r) => r.bucket },
        { header: "Outstanding", width: 90, align: "right", value: (r) => formatCents(r.outstanding) },
      ],
      rows,
    });
  }

  res.json({ asOf, rows });
});

invoicesRouter.get("/:id", require("invoice:read"), (req, res) => {
  const invoice = store.data.invoices.find((i) => i.id === req.params.id);
  if (!invoice) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Invoice not found." } });
  res.json({ invoice });
});

// Story: "As a bursar, I want to generate student invoices in bulk for a
// term so I can bill all students quickly."
invoicesRouter.post("/bulk", require("invoice:create"), (req, res, next) => {
  try {
    const { studentIds, date, dueDate, lines } = req.body ?? {};
    const invoices = createInvoicesBulk(store.data, { studentIds, date, dueDate, lines }, req.user!);
    store.save();
    res.status(201).json({ invoices, count: invoices.length });
  } catch (e) {
    next(e);
  }
});

invoicesRouter.post("/", require("invoice:create"), (req, res, next) => {
  try {
    const { studentId, date, dueDate, lines } = req.body ?? {};
    const invoice = createInvoice(store.data, { studentId, date, dueDate, lines }, req.user!);
    store.save();
    res.status(201).json({ invoice });
  } catch (e) {
    next(e);
  }
});
