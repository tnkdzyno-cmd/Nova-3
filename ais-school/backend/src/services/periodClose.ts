// Period-end closing tools (Phase 2). Two distinct features:
//
// - closeChecklist(): a set of computable pre-flight checks surfaced
//   before closing a period. Because this system posts every transaction
//   immediately (no draft/unposted state), a checklist can't find
//   "unposted transactions" the way a batch-posting system's would — the
//   genuinely useful checks here are about sequencing and outstanding
//   items instead.
// - yearEndClose(): posts a single closing journal entry that zeros every
//   income/expense account's activity for the period into Retained
//   Earnings, then closes the period. Runs once per period — a second
//   attempt is rejected rather than double-closing.

import type { DataShape } from "../store.js";
import type { JournalEntry } from "../types.js";
import type { AuthedUser } from "../middleware/auth.js";
import { badRequest, conflict, notFound } from "../util.js";
import { trialBalance, postJournalEntry, findOpenPeriodForDate } from "./ledger.js";
import { AP_APPROVAL_THRESHOLD_CENTS } from "./ap.js";

export interface ChecklistItem {
  label: string;
  passed: boolean;
  detail: string;
}

export function closeChecklist(data: DataShape, periodId: string): ChecklistItem[] {
  const period = data.periods.find((p) => p.id === periodId);
  if (!period) throw notFound("Period not found.");

  const items: ChecklistItem[] = [];

  // 1. Trial balance is balanced. Always true by construction in this
  // system (every posting is validated debit=credit before it's
  // accepted) — shown anyway because an auditor closing the books wants
  // to see it confirmed, not assumed.
  const tb = trialBalance(data, period.endDate);
  items.push({
    label: "Trial balance is balanced",
    passed: tb.totalDebit === tb.totalCredit,
    detail: `Debits ${tb.totalDebit} / Credits ${tb.totalCredit} (cents)`,
  });

  // 2. Every earlier period is already closed. Closing period N while an
  // earlier period N-1 is still open would let someone post a
  // backdated entry into N-1 after N's numbers are supposedly final.
  const earlierOpenPeriods = data.periods.filter((p) => p.id !== period.id && p.endDate < period.startDate && p.status === "open");
  items.push({
    label: "All earlier periods are closed",
    passed: earlierOpenPeriods.length === 0,
    detail:
      earlierOpenPeriods.length === 0
        ? "No earlier open periods."
        : `Still open: ${earlierOpenPeriods.map((p) => p.name).join(", ")}`,
  });

  // 3. No AP payments sitting above the approval threshold, unresolved.
  const pendingApproval = data.invoices.filter(
    (i) => i.kind === "AP" && i.status !== "paid" && i.status !== "void" && i.totalAmount - i.amountPaid > AP_APPROVAL_THRESHOLD_CENTS
  );
  items.push({
    label: "No supplier payments awaiting approval",
    passed: pendingApproval.length === 0,
    detail: pendingApproval.length === 0 ? "None outstanding." : `${pendingApproval.length} invoice(s) above the approval threshold still unpaid.`,
  });

  // 4. The period has actually ended (soft check — closing early isn't
  // blocked, just flagged).
  const today = new Date().toISOString().slice(0, 10);
  items.push({
    label: "Period end date has passed",
    passed: today >= period.endDate,
    detail: today >= period.endDate ? `Ended ${period.endDate}.` : `Doesn't end until ${period.endDate} — closing now would be early.`,
  });

  return items;
}

/**
 * Posts one closing journal entry zeroing every income/expense account's
 * net activity for the period into Retained Earnings, then closes the
 * period. Idempotent-safe: rejects if this period already has a
 * YEAR_END_CLOSE entry, rather than posting a duplicate.
 */
export function yearEndClose(data: DataShape, periodId: string, user: AuthedUser): JournalEntry {
  const period = data.periods.find((p) => p.id === periodId);
  if (!period) throw notFound("Period not found.");
  if (period.status !== "open") throw conflict("PERIOD_CLOSED", "This period is already closed.");

  const alreadyClosed = data.journalEntries.some((e) => e.source === "YEAR_END_CLOSE" && e.periodId === periodId && e.status === "posted");
  if (alreadyClosed) throw conflict("ALREADY_CLOSED", "A year-end closing entry has already been posted for this period.");

  const retainedEarnings = data.accounts.find((a) => a.isControlAccount === "RETAINED_EARNINGS" && a.isActive);
  if (!retainedEarnings) throw badRequest("NO_RETAINED_EARNINGS", "No active Retained Earnings control account is configured.");

  const tb = trialBalance(data, period.endDate);
  const lines: { accountId: string; debit?: number; credit?: number; description: string }[] = [];
  let netIncome = 0;

  for (const row of tb.rows) {
    const account = data.accounts.find((a) => a.id === row.accountId);
    if (!account) continue;
    if (account.type === "income") {
      const balance = row.credit - row.debit; // income accounts run credit-natured
      if (balance !== 0) {
        lines.push({ accountId: account.id, debit: balance > 0 ? balance : undefined, credit: balance < 0 ? -balance : undefined, description: `Close ${account.name} to Retained Earnings` });
        netIncome += balance;
      }
    } else if (account.type === "expense") {
      const balance = row.debit - row.credit; // expense accounts run debit-natured
      if (balance !== 0) {
        lines.push({ accountId: account.id, credit: balance > 0 ? balance : undefined, debit: balance < 0 ? -balance : undefined, description: `Close ${account.name} to Retained Earnings` });
        netIncome -= balance;
      }
    }
  }

  if (lines.length === 0) {
    throw conflict("NOTHING_TO_CLOSE", "No income or expense activity was posted in this period — nothing to close.");
  }

  if (netIncome > 0) lines.push({ accountId: retainedEarnings.id, credit: netIncome, description: "Net surplus for the period" });
  else if (netIncome < 0) lines.push({ accountId: retainedEarnings.id, debit: -netIncome, description: "Net deficit for the period" });

  // Post as of the period's end date, inside the period being closed.
  findOpenPeriodForDate(data, period.endDate); // will throw if period.endDate somehow isn't inside an open period — defensive, should never trip given the checks above

  const entry = postJournalEntry(
    data,
    { date: period.endDate, description: `Year-end close — ${period.name}`, source: "YEAR_END_CLOSE", lines },
    user
  );

  period.status = "closed";
  return entry;
}
