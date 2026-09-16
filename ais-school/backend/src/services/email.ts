// Sends receipt e-mails via SMTP when the deployment has one configured.
// With no SMTP_HOST set, sendReceiptEmail() is a documented no-op — the
// receipt still generates and is downloadable, the payment still records
// normally, and nothing throws. This matches the brief: "sends it via
// email if an email service is configured."

import nodemailer from "nodemailer";

let cachedTransport: ReturnType<typeof nodemailer.createTransport> | null | undefined;

function isEmailConfigured(): boolean {
  return Boolean(process.env.SMTP_HOST);
}

function getTransport() {
  if (cachedTransport !== undefined) return cachedTransport;
  if (!isEmailConfigured()) {
    cachedTransport = null;
    return null;
  }
  cachedTransport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_SECURE === "true",
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
  });
  return cachedTransport;
}

export interface ReceiptEmailInput {
  to: string;
  studentName: string;
  refNo: string;
  amountDisplay: string;
  pdfBuffer: Buffer;
}

/**
 * Fire-and-forget by design: callers should not let email delivery failure
 * block or roll back a payment that has already posted to the ledger. Returns
 * true if a send was attempted (regardless of delivery outcome), false if
 * skipped because no SMTP transport is configured.
 */
export async function sendReceiptEmail(input: ReceiptEmailInput): Promise<{ attempted: boolean; error?: string }> {
  const transport = getTransport();
  if (!transport) return { attempted: false };

  try {
    await transport.sendMail({
      from: process.env.SMTP_FROM || "accounts@ridgeview.example",
      to: input.to,
      subject: `Payment receipt ${input.refNo} — ${input.studentName}`,
      text: `Thank you for your payment of $${input.amountDisplay} for ${input.studentName}. Receipt ${input.refNo} is attached.`,
      attachments: [{ filename: `receipt-${input.refNo}.pdf`, content: input.pdfBuffer, contentType: "application/pdf" }],
    });
    return { attempted: true };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`Receipt email to ${input.to} failed:`, (err as Error).message);
    return { attempted: true, error: (err as Error).message };
  }
}
