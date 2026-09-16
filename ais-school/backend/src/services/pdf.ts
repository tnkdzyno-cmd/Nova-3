// PDF generation via pdfkit — pure JS, no native bindings, so it runs
// anywhere Node runs without a build toolchain. Two shapes are covered:
// a generic tabular report (trial balance, journal entries, invoice lists)
// and a purpose-built payment receipt.

import PDFDocument from "pdfkit";
import type { Response } from "express";
import { formatCents } from "../util.js";

const SCHOOL_NAME = process.env.SCHOOL_NAME || "Ridgeview College";

export interface PdfColumn<T> {
  header: string;
  width: number;
  align?: "left" | "right";
  value: (row: T) => string;
}

/**
 * Streams a simple ruled tabular PDF straight to the HTTP response —
 * a school letterhead, a title/subtitle, a header row, and one row per
 * record, paginating automatically when the content overflows a page.
 */
export function streamTablePdf<T>(
  res: Response,
  opts: { filename: string; title: string; subtitle?: string; columns: PdfColumn<T>[]; rows: T[] }
) {
  const doc = new PDFDocument({ size: "A4", margin: 40 });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${opts.filename}"`);
  doc.pipe(res);

  drawLetterhead(doc, opts.title, opts.subtitle);

  const left = doc.page.margins.left;
  const tableWidth = opts.columns.reduce((s, c) => s + c.width, 0);

  function drawHeaderRow(y: number) {
    doc.font("Helvetica-Bold").fontSize(8.5).fillColor("#1c2b3a");
    let x = left;
    for (const col of opts.columns) {
      doc.text(col.header, x, y, { width: col.width, align: col.align ?? "left" });
      x += col.width;
    }
    doc.moveTo(left, y + 14).lineTo(left + tableWidth, y + 14).strokeColor("#1c2b3a").lineWidth(1).stroke();
  }

  let y = doc.y + 6;
  drawHeaderRow(y);
  y += 20;
  doc.font("Helvetica").fontSize(8.5).fillColor("#1c2b3a");

  if (!opts.rows.length) {
    doc.fillColor("#5b6b74").text("No records match the current filters.", left, y);
  }

  for (const row of opts.rows) {
    if (y > doc.page.height - doc.page.margins.bottom - 30) {
      doc.addPage();
      drawLetterhead(doc, opts.title, opts.subtitle, true);
      y = doc.y + 6;
      drawHeaderRow(y);
      y += 20;
      doc.font("Helvetica").fontSize(8.5).fillColor("#1c2b3a");
    }
    let x = left;
    for (const col of opts.columns) {
      doc.text(col.value(row), x, y, { width: col.width, align: col.align ?? "left" });
      x += col.width;
    }
    doc.moveTo(left, y + 13).lineTo(left + tableWidth, y + 13).strokeColor("#d8dfdd").lineWidth(0.5).stroke();
    y += 17;
  }

  doc.end();
}

function drawLetterhead(doc: PDFKit.PDFDocument, title: string, subtitle?: string, compact = false) {
  doc.font("Helvetica-Bold").fontSize(compact ? 12 : 16).fillColor("#1c2b3a").text(SCHOOL_NAME, { continued: false });
  doc.font("Helvetica").fontSize(9).fillColor("#5b6b74").text("Accounts Office");
  if (!compact) doc.moveDown(0.6);
  doc.font("Helvetica-Bold").fontSize(compact ? 10 : 13).fillColor("#1c2b3a").text(title);
  if (subtitle) doc.font("Helvetica").fontSize(9).fillColor("#5b6b74").text(subtitle);
  doc.moveDown(0.4);
  doc
    .moveTo(doc.page.margins.left, doc.y)
    .lineTo(doc.page.width - doc.page.margins.right, doc.y)
    .strokeColor("#1c2b3a")
    .lineWidth(1.5)
    .stroke();
  doc.moveDown(0.5);
}

export interface ReceiptData {
  refNo: string;
  date: string;
  studentName: string;
  studentNumber: string;
  invoiceRefNo: string;
  amountCents: number;
  method: string;
  bankTxnRef: string | null;
  postedByName: string;
  invoiceTotalCents: number;
  invoicePaidCents: number;
}

/** Returns the receipt as a Buffer (used both for the download route and for e-mail attachments). */
export function buildReceiptPdf(data: ReceiptData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A5", margin: 36 });
    const chunks: Buffer[] = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.font("Helvetica-Bold").fontSize(15).fillColor("#1c2b3a").text(SCHOOL_NAME);
    doc.font("Helvetica").fontSize(9).fillColor("#5b6b74").text("Accounts Office — Official Receipt");
    doc.moveDown(0.8);
    doc.moveTo(doc.page.margins.left, doc.y).lineTo(doc.page.width - doc.page.margins.right, doc.y).strokeColor("#1c2b3a").lineWidth(1.5).stroke();
    doc.moveDown(0.8);

    doc.font("Helvetica-Bold").fontSize(12).fillColor("#1c2b3a").text(`Receipt ${data.refNo}`);
    doc.font("Helvetica").fontSize(9).fillColor("#5b6b74").text(`Date: ${data.date}`);
    doc.moveDown(0.8);

    const row = (label: string, value: string) => {
      doc.font("Helvetica").fontSize(9.5).fillColor("#5b6b74").text(label, { continued: true, width: 160 });
      doc.font("Helvetica-Bold").fillColor("#1c2b3a").text(value);
    };

    row("Received from: ", data.studentName + ` (${data.studentNumber})`);
    row("Against invoice: ", data.invoiceRefNo);
    row("Payment method: ", data.method.toUpperCase());
    if (data.bankTxnRef) row("Reference: ", data.bankTxnRef);
    doc.moveDown(0.6);

    doc.font("Helvetica-Bold").fontSize(18).fillColor("#2c6e63").text(`Amount received: $${formatCents(data.amountCents)}`);
    doc.moveDown(0.4);

    const outstanding = data.invoiceTotalCents - data.invoicePaidCents;
    doc.font("Helvetica").fontSize(9).fillColor("#5b6b74").text(
      `Invoice total: $${formatCents(data.invoiceTotalCents)}   ·   Paid to date: $${formatCents(data.invoicePaidCents)}   ·   Balance remaining: $${formatCents(outstanding)}`
    );

    doc.moveDown(1.2);
    doc.font("Helvetica").fontSize(8.5).fillColor("#5b6b74").text(`Recorded by ${data.postedByName}. This receipt was generated automatically by the school's accounting system.`);

    doc.end();
  });
}
