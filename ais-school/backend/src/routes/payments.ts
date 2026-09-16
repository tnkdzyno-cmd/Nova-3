import { Router } from "express";
import { store } from "../store.js";
import { authenticate } from "../middleware/auth.js";
import { require } from "../middleware/rbac.js";
import { recordPayment } from "../services/ar.js";
import { buildReceiptPdf } from "../services/pdf.js";
import { sendReceiptEmail } from "../services/email.js";
import { notFound, formatCents } from "../util.js";

export const paymentsRouter = Router();
paymentsRouter.use(authenticate);

paymentsRouter.get("/", require("invoice:read"), (req, res) => {
  const { invoiceId } = req.query;
  let payments = store.data.payments;
  if (invoiceId) payments = payments.filter((p) => p.invoiceId === invoiceId);
  res.json({ payments: payments.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)) });
});

function receiptDataFor(paymentId: string) {
  const payment = store.data.payments.find((p) => p.id === paymentId);
  if (!payment) throw notFound("Payment not found.");
  const invoice = store.data.invoices.find((i) => i.id === payment.invoiceId);
  if (!invoice || invoice.kind !== "AR") throw notFound("This payment has no receipt (not a student receipt).");
  const student = store.data.students.find((s) => s.id === invoice.studentId);
  const postedBy = store.data.users.find((u) => u.id === payment.postedBy);
  return {
    payment,
    invoice,
    student,
    receipt: {
      refNo: payment.refNo,
      date: payment.date,
      studentName: student?.name ?? "Unknown student",
      studentNumber: student?.studentNumber ?? "—",
      invoiceRefNo: invoice.refNo,
      amountCents: payment.amount,
      method: payment.method,
      bankTxnRef: payment.bankTxnRef,
      postedByName: postedBy?.fullName ?? "Unknown",
      invoiceTotalCents: invoice.totalAmount,
      invoicePaidCents: invoice.amountPaid,
    },
  };
}

// Downloadable at any time after the fact — not just at the moment of payment.
paymentsRouter.get("/:id/receipt.pdf", require("invoice:read"), async (req, res, next) => {
  try {
    const { receipt } = receiptDataFor(req.params.id);
    const buffer = await buildReceiptPdf(receipt);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="receipt-${receipt.refNo}.pdf"`);
    res.send(buffer);
  } catch (e) {
    next(e);
  }
});

// Story: "Create invoice -> record payment -> student balance updates;
// audit log records each step." A receipt PDF is generated on every
// payment and, if the student has a guardian e-mail on file AND SMTP is
// configured, e-mailed automatically. E-mail failure never blocks or
// rolls back the payment — it has already posted to the ledger by then.
paymentsRouter.post("/", require("payment:record"), async (req, res, next) => {
  try {
    const { invoiceId, date, amount, method, bankTxnRef } = req.body ?? {};
    const payment = recordPayment(store.data, { invoiceId, date, amount, method, bankTxnRef }, req.user!);
    store.save();
    res.status(201).json({ payment });

    // Fire-and-forget: response has already been sent above.
    try {
      const { receipt, student } = receiptDataFor(payment.id);
      if (student?.guardianEmail) {
        const pdfBuffer = await buildReceiptPdf(receipt);
        const result = await sendReceiptEmail({
          to: student.guardianEmail,
          studentName: student.name,
          refNo: payment.refNo,
          amountDisplay: formatCents(payment.amount),
          pdfBuffer,
        });
        if (result.attempted && !result.error) {
          // eslint-disable-next-line no-console
          console.log(`Receipt ${payment.refNo} e-mailed to ${student.guardianEmail}.`);
        }
      }
    } catch (emailErr) {
      // eslint-disable-next-line no-console
      console.error("Receipt e-mail step failed (payment already recorded successfully):", emailErr);
    }
  } catch (e) {
    next(e);
  }
});
