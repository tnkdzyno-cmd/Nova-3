import type { DataShape } from "../store.js";
import type { JournalEntry, JournalLine, JournalSource } from "../types.js";
import type { AuthedUser } from "../middleware/auth.js";
import { badRequest, conflict, newId, nextRefNo, nowIso, notFound } from "../util.js";
import { writeAudit } from "../middleware/audit.js";

export interface DraftLine {
  accountId: string;
  debit?: number;
  credit?: number;
  costCenterId?: string | null;
  tag?: string | null;
  description?: string | null;
}

export interface PostJournalInput {
  date: string;
  description: string;
  lines: DraftLine[];
  source?: JournalSource;
}

/** Finds the open period that contains the given ISO date, or throws. */
export function findOpenPeriodForDate(data: DataShape, isoDate: string) {
  const period = data.periods.find((p) => isoDate >= p.startDate && isoDate <= p.endDate);
  if (!period) {
    throw badRequest("NO_PERIOD", `No accounting period is defined for ${isoDate}.`);
  }
  if (period.status === "closed") {
    throw conflict("PERIOD_CLOSED", `Period ${period.name} is closed. Posting to closed periods is not permitted.`);
  }
  return period;
}

/**
 * Validates and posts a balanced double-entry journal entry.
 * Rule (spec, "Problem-solving rules"): reject any entry where total debits
 * != total credits, or where posting would hit a closed period.
 */
export function postJournalEntry(data: DataShape, input: PostJournalInput, user: AuthedUser): JournalEntry {
  if (!input.lines || input.lines.length < 2) {
    throw badRequest("TOO_FEW_LINES", "A journal entry needs at least two lines.");
  }

  let totalDebit = 0;
  let totalCredit = 0;
  const lines: JournalLine[] = input.lines.map((l) => {
    const debit = Math.round(l.debit ?? 0);
    const credit = Math.round(l.credit ?? 0);
    if (debit < 0 || credit < 0) {
      throw badRequest("NEGATIVE_AMOUNT", "Debit and credit amounts must not be negative.");
    }
    if (debit > 0 && credit > 0) {
      throw badRequest("BOTH_SIDES", "A single journal line cannot have both a debit and a credit.");
    }
    if (debit === 0 && credit === 0) {
      throw badRequest("ZERO_LINE", "A journal line must have a non-zero debit or credit.");
    }
    const account = data.accounts.find((a) => a.id === l.accountId);
    if (!account) throw notFound(`Account ${l.accountId} does not exist.`);
    if (!account.isActive) throw badRequest("INACTIVE_ACCOUNT", `Account ${account.code} ${account.name} is inactive.`);
    totalDebit += debit;
    totalCredit += credit;
    return {
      id: newId(),
      accountId: l.accountId,
      debit,
      credit,
      costCenterId: l.costCenterId ?? null,
      tag: l.tag ?? null,
      description: l.description ?? null,
    };
  });

  if (totalDebit !== totalCredit) {
    throw badRequest(
      "UNBALANCED_ENTRY",
      `Journal entry does not balance: total debits ${totalDebit} cents vs total credits ${totalCredit} cents.`
    );
  }

  const period = findOpenPeriodForDate(data, input.date);

  const entry: JournalEntry = {
    id: newId(),
    refNo: nextRefNo(data.counters, "journal", input.date),
    date: input.date,
    description: input.description,
    periodId: period.id,
    status: "posted",
    source: input.source ?? "manual",
    lines,
    createdBy: user.id,
    createdAt: nowIso(),
    reversalOfId: null,
    reversedById: null,
  };

  data.journalEntries.push(entry);
  writeAudit(data, {
    entityType: "JournalEntry",
    entityId: entry.id,
    action: "POST",
    before: null,
    after: entry,
    user,
  });

  return entry;
}

/**
 * Reverses a posted journal entry by creating a new entry with debits and
 * credits swapped, dated today (or an explicit date), in the currently open
 * period. The original entry is marked 'reversed' but is never deleted or
 * mutated in place — audit trail stays intact either way.
 */
export function reverseJournalEntry(data: DataShape, journalEntryId: string, user: AuthedUser, asOfDate?: string): JournalEntry {
  const original = data.journalEntries.find((j) => j.id === journalEntryId);
  if (!original) throw notFound("Journal entry not found.");
  if (original.status !== "posted") {
    throw conflict("NOT_POSTED", `Only posted entries can be reversed (this entry is '${original.status}').`);
  }

  const date = asOfDate ?? nowIso().slice(0, 10);
  const period = findOpenPeriodForDate(data, date);

  const reversal: JournalEntry = {
    id: newId(),
    refNo: nextRefNo(data.counters, "journal", date),
    date,
    description: `Reversal of ${original.id}: ${original.description}`,
    periodId: period.id,
    status: "posted",
    source: "REVERSAL",
    lines: original.lines.map((l) => ({
      id: newId(),
      accountId: l.accountId,
      debit: l.credit,
      credit: l.debit,
      costCenterId: l.costCenterId,
      tag: l.tag,
      description: l.description,
    })),
    createdBy: user.id,
    createdAt: nowIso(),
    reversalOfId: original.id,
    reversedById: null,
  };

  data.journalEntries.push(reversal);

  const before = { ...original };
  original.status = "reversed";
  original.reversedById = reversal.id;

  writeAudit(data, { entityType: "JournalEntry", entityId: reversal.id, action: "POST_REVERSAL", before: null, after: reversal, user });
  writeAudit(data, { entityType: "JournalEntry", entityId: original.id, action: "MARK_REVERSED", before, after: original, user });

  return reversal;
}

export interface TrialBalanceRow {
  accountId: string;
  code: string;
  name: string;
  type: string;
  debit: number;
  credit: number;
}

/** Sums posted journal lines per account, as of an optional cutoff date. */
export function trialBalance(data: DataShape, asOfDate?: string): { rows: TrialBalanceRow[]; totalDebit: number; totalCredit: number } {
  const totals = new Map<string, { debit: number; credit: number }>();

  for (const entry of data.journalEntries) {
    if (entry.status !== "posted") continue;
    if (asOfDate && entry.date > asOfDate) continue;
    for (const line of entry.lines) {
      const t = totals.get(line.accountId) ?? { debit: 0, credit: 0 };
      t.debit += line.debit;
      t.credit += line.credit;
      totals.set(line.accountId, t);
    }
  }

  const rows: TrialBalanceRow[] = [];
  let totalDebit = 0;
  let totalCredit = 0;

  for (const account of data.accounts) {
    const t = totals.get(account.id);
    if (!t) continue;
    // Net each account to one side for a conventional trial balance presentation.
    const net = t.debit - t.credit;
    const debit = net > 0 ? net : 0;
    const credit = net < 0 ? -net : 0;
    rows.push({ accountId: account.id, code: account.code, name: account.name, type: account.type, debit, credit });
    totalDebit += debit;
    totalCredit += credit;
  }

  rows.sort((a, b) => a.code.localeCompare(b.code));
  return { rows, totalDebit, totalCredit };
}
