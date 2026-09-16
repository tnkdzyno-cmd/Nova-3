import { Router } from "express";
import { store } from "../store.js";
import { authenticate } from "../middleware/auth.js";
import { require } from "../middleware/rbac.js";
import { writeAudit } from "../middleware/audit.js";
import { badRequest, newId, paginate, matchesSearch, inDateRange, toCsv, toXlsxBuffer, formatCents } from "../util.js";
import type { Supplier, Invoice } from "../types.js";
import { createSupplierInvoice, recordSupplierPayment, AP_APPROVAL_THRESHOLD_CENTS } from "../services/ap.js";
import { streamTablePdf } from "../services/pdf.js";

export const suppliersRouter = Router();
suppliersRouter.use(authenticate);

function supplierName(id: string | null): string {
  return store.data.suppliers.find((s) => s.id === id)?.name ?? "Unknown";
}

suppliersRouter.get("/", require("supplier:read"), (req, res) => {
  res.json({ suppliers: store.data.suppliers });
});

suppliersRouter.post("/", require("supplier:write"), (req, res, next) => {
  try {
    const { name, contact } = req.body ?? {};
    if (!name) throw badRequest("MISSING_FIELDS", "name is required.");
    const supplier: Supplier = { id: newId(), name, contact: contact ?? "" };
    store.data.suppliers.push(supplier);
    writeAudit(store.data, { entityType: "Supplier", entityId: supplier.id, action: "CREATE", before: null, after: supplier, user: req.user! });
    store.save();
    res.status(201).json({ supplier });
  } catch (e) {
    next(e);
  }
});

suppliersRouter.get("/invoices", require("supplier:read"), (req, res) => {
  const { status, search, dateFrom, dateTo, format } = req.query;
  let invoices = store.data.invoices.filter((i) => i.kind === "AP");
  if (status) invoices = invoices.filter((i) => i.status === status);
  if (dateFrom || dateTo) invoices = invoices.filter((i) => inDateRange(i.date, dateFrom, dateTo));
  if (search) invoices = invoices.filter((i) => matchesSearch(search, i.refNo, supplierName(i.supplierId)));
  invoices = invoices.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const apColumns = [
    { header: "Ref No", value: (i: Invoice) => i.refNo },
    { header: "Supplier", value: (i: Invoice) => supplierName(i.supplierId) },
    { header: "Date", value: (i: Invoice) => i.date },
    { header: "Due date", value: (i: Invoice) => i.dueDate },
    { header: "Total", value: (i: Invoice) => formatCents(i.totalAmount) },
    { header: "Paid", value: (i: Invoice) => formatCents(i.amountPaid) },
    { header: "Outstanding", value: (i: Invoice) => formatCents(i.totalAmount - i.amountPaid) },
    { header: "Status", value: (i: Invoice) => i.status },
  ];

  if (format === "csv") {
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", 'attachment; filename="supplier-invoices.csv"');
    return res.send(toCsv(invoices, apColumns));
  }
  if (format === "xlsx") {
    const buffer = toXlsxBuffer(invoices, apColumns, "Supplier Invoices");
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", 'attachment; filename="supplier-invoices.xlsx"');
    return res.send(buffer);
  }
  if (format === "pdf") {
    return streamTablePdf(res, {
      filename: "supplier-invoices.pdf",
      title: "Supplier Invoices (Accounts Payable)",
      subtitle: `${invoices.length} invoices`,
      columns: [
        { header: "Ref No", width: 65, value: (i: Invoice) => i.refNo },
        { header: "Supplier", width: 130, value: (i: Invoice) => supplierName(i.supplierId) },
        { header: "Date", width: 55, value: (i: Invoice) => i.date },
        { header: "Due", width: 55, value: (i: Invoice) => i.dueDate },
        { header: "Outstanding", width: 70, align: "right", value: (i: Invoice) => formatCents(i.totalAmount - i.amountPaid) },
        { header: "Status", width: 55, value: (i: Invoice) => i.status },
      ],
      rows: invoices,
    });
  }

  const { data, total, page, pageSize, totalPages } = paginate(invoices, req.query);
  res.json({ invoices: data, total, page, pageSize, totalPages, approvalThresholdCents: AP_APPROVAL_THRESHOLD_CENTS });
});

suppliersRouter.post("/invoices", require("ap:invoice:create"), (req, res, next) => {
  try {
    const { supplierId, date, dueDate, lines } = req.body ?? {};
    const invoice = createSupplierInvoice(store.data, { supplierId, date, dueDate, lines }, req.user!);
    store.save();
    res.status(201).json({ invoice });
  } catch (e) {
    next(e);
  }
});

suppliersRouter.post("/payments", require("ap:payment:record"), (req, res, next) => {
  try {
    const { invoiceId, date, amount, method, bankTxnRef, approvedBy } = req.body ?? {};
    const payment = recordSupplierPayment(store.data, { invoiceId, date, amount, method, bankTxnRef, approvedBy }, req.user!);
    store.save();
    res.status(201).json({ payment });
  } catch (e) {
    next(e);
  }
});
