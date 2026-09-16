import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { nextRefNo, paginate, matchesSearch, inDateRange, toCsv } from "../src/util.js";
import type { Counters } from "../src/types.js";

function freshCounters(): Counters {
  return { journal: 0, arInvoice: 0, apInvoice: 0, arPayment: 0, apPayment: 0, budget: 0 };
}

describe("nextRefNo — human-readable reference numbers", () => {
  test("mints sequential, zero-padded numbers per kind", () => {
    const counters = freshCounters();
    assert.equal(nextRefNo(counters, "arInvoice", "2026-09-01"), "INV-2026-0001");
    assert.equal(nextRefNo(counters, "arInvoice", "2026-09-02"), "INV-2026-0002");
    assert.equal(nextRefNo(counters, "arInvoice", "2026-09-03"), "INV-2026-0003");
  });

  test("each kind has its own independent counter and prefix", () => {
    const counters = freshCounters();
    assert.equal(nextRefNo(counters, "journal", "2026-01-01"), "JE-2026-0001");
    assert.equal(nextRefNo(counters, "arInvoice", "2026-01-01"), "INV-2026-0001");
    assert.equal(nextRefNo(counters, "apInvoice", "2026-01-01"), "BILL-2026-0001");
    assert.equal(nextRefNo(counters, "arPayment", "2026-01-01"), "RCT-2026-0001");
    assert.equal(nextRefNo(counters, "apPayment", "2026-01-01"), "PMT-2026-0001");
    // Advancing one kind doesn't touch the others.
    assert.equal(nextRefNo(counters, "journal", "2026-01-02"), "JE-2026-0002");
    assert.equal(nextRefNo(counters, "arInvoice", "2026-01-02"), "INV-2026-0002");
  });

  test("the year in the reference number comes from the transaction date, not the clock", () => {
    const counters = freshCounters();
    assert.equal(nextRefNo(counters, "journal", "2025-12-31"), "JE-2025-0001");
    assert.equal(nextRefNo(counters, "journal", "2026-01-01"), "JE-2026-0002");
  });
});

describe("paginate — opt-in pagination", () => {
  const items = Array.from({ length: 25 }, (_, i) => i + 1);

  test("with no page param, returns everything (dashboard/aggregation call sites depend on this)", () => {
    const result = paginate(items, {});
    assert.deepEqual(result.data, items);
    assert.equal(result.total, 25);
    assert.equal(result.totalPages, 1);
  });

  test("with a page param, slices correctly using the default page size", () => {
    const page1 = paginate(items, { page: "1" });
    assert.equal(page1.data.length, 20); // default pageSize
    assert.deepEqual(page1.data, items.slice(0, 20));
    assert.equal(page1.totalPages, 2);

    const page2 = paginate(items, { page: "2" });
    assert.deepEqual(page2.data, items.slice(20, 25));
  });

  test("respects an explicit pageSize", () => {
    const result = paginate(items, { page: "1", pageSize: "10" });
    assert.equal(result.data.length, 10);
    assert.equal(result.totalPages, 3);
  });

  test("clamps out-of-range page numbers instead of returning an empty page", () => {
    const result = paginate(items, { page: "999", pageSize: "10" });
    assert.equal(result.page, 3); // clamped to the last real page
    assert.deepEqual(result.data, items.slice(20, 25));
  });

  test("clamps pageSize to a sane maximum (500) so a caller can't request the entire table in one page", () => {
    const big = Array.from({ length: 1000 }, (_, i) => i);
    const result = paginate(big, { page: "1", pageSize: "10000" });
    assert.equal(result.pageSize, 500);
    assert.equal(result.data.length, 500);
  });
});

describe("matchesSearch / inDateRange", () => {
  test("matchesSearch is case-insensitive across multiple fields", () => {
    assert.equal(matchesSearch("zesa", "INV-2026-0001", "ZESA Holdings"), true);
    assert.equal(matchesSearch("nothing-like-this", "INV-2026-0001", "ZESA Holdings"), false);
    assert.equal(matchesSearch(undefined, "anything"), true); // no filter = everything matches
  });

  test("inDateRange respects inclusive bounds on either side", () => {
    assert.equal(inDateRange("2026-09-15", "2026-09-01", "2026-09-30"), true);
    assert.equal(inDateRange("2026-09-15", "2026-09-16", undefined), false);
    assert.equal(inDateRange("2026-09-15", undefined, "2026-09-14"), false);
    assert.equal(inDateRange("2026-09-15", undefined, undefined), true);
  });
});

describe("toCsv — export formatting", () => {
  test("quotes and escapes fields containing commas, quotes, or newlines", () => {
    const rows = [{ name: 'Bulawayo Stationers, "Best" Ltd', note: "line1\nline2" }];
    const csv = toCsv(rows, [
      { header: "Name", value: (r) => r.name },
      { header: "Note", value: (r) => r.note },
    ]);
    const lines = csv.trim().split("\n");
    assert.equal(lines[0], "Name,Note");
    // The embedded comma/quote/newline must not break the CSV structure.
    assert.match(csv, /"Bulawayo Stationers, ""Best"" Ltd"/);
  });

  test("produces just a header row for an empty dataset", () => {
    const csv = toCsv([] as { a: string }[], [{ header: "A", value: (r) => r.a }]);
    assert.equal(csv, "A\n");
  });
});
