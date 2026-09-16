# Quick reference — day-to-day tasks

For bursars and accounts officers. Every task below is designed to be
**3 clicks or fewer, under a minute**.

## Sign in

Go to the web address you were given, enter your username and password.
Forgotten password? Ask your Vice-Chancellor or IT administrator — there's
no self-service reset yet (see `docs/NOVA_ROADMAP.md` for what's next).

## Bill a student

1. **Students & Billing** in the left menu.
2. Find the student in the list and click **View**.
3. Under *New invoice*, pick the fee account, type a description and
   amount, then **Create invoice**.

## Bill a group of students at once

Use the **Bulk billing** panel on the same page:

1. Set any combination of filters — campus, status, intake, academic year,
   billing status, or a text search — to narrow down who you're billing.
2. Click **Select all filtered** to select everyone currently matching
   your filters, **Select all students** to select the entire roster
   regardless of filters, or **Clear selection** to start over. Your
   selection is remembered even if you then change the filters, so you
   can build up a batch across several filter passes.
3. Add your fee lines, set the invoice/due dates, and click **Bill
   selected students** — everyone selected gets the same invoice in one
   action.

## Record a fee payment

1. **Students & Billing** → find the student → **View**.
2. Under *Record payment*, pick which invoice it's against (only invoices
   still owing money are listed), enter the amount and method, and
   **Record payment**.

The student's balance and invoice status update immediately. A receipt
(e.g. `RCT-2026-0004`) appears in the *Payments received* table right
below — click **Receipt PDF** to download it any time, and if the student
has a guardian e-mail on file, it's sent there automatically.

## Find a specific transaction

Every invoice, payment, and journal entry has a short reference number
(`INV-2026-0001`, `RCT-2026-0004`, `JE-2026-0012`) instead of a long ID —
that's what to write on paperwork or search for. The **General Ledger**,
**Suppliers & Payables**, and **Audit Log** pages all have a search box
plus a from/to date range above their tables. Long lists are split into
pages — use **Prev / Next** below the table.

## Export a report

On **Reports**, **General Ledger**, and **Suppliers & Payables**, look for
**Export CSV** / **Export PDF** near the top of the table — Excel export
(genuine `.xlsx`, not renamed CSV) is available from the same export
buttons on the main reports. Exports download everything currently
matching your search and date filters, not just what's on screen.

## Check what a student owes

**Students & Billing** — the *Outstanding* column on the student list shows
every student's total balance at a glance, along with their campus and
enrolment status. Click **View** on any student for the full breakdown by
invoice.

## Run a trial balance

**Reports** → the *Trial balance* tab is the default view. Pick a period
from the dropdown at the top if you want a specific term instead of
everything to date. It should always say **Balanced** — if it ever doesn't,
that's a system problem to flag to your Vice-Chancellor immediately, not
something to try to fix by re-entering transactions.

## Find out who changed something

**Audit Log** — filter by entity type (e.g. "Payments") or search by
username/action. Click **Details** on any row to see the exact before/
after values, who made the change, when, from what IP address, and which
module it belongs to. This log cannot be edited or deleted by anyone,
including administrators.

## Pay a supplier invoice

1. **Suppliers & Payables** → capture the invoice under *New supplier
   invoice* when it arrives (or find it already listed if someone else
   captured it).
2. Under *Supplier invoices*, click **Pay** next to it.
3. Confirm the amount and method, then **Release payment**.

Payments over the approval threshold (shown on the payment form) need a
second person's name selected before the button will work — this is
enforced by the system, not just a reminder.

## Check your notifications

The bell icon in the top-right of every page shows a live count — overdue
receivables and supplier payments awaiting a second approver. Click it for
details. This isn't a to-do list you dismiss items from; it always
reflects what's actually true in the data right now.

## Switch to dark mode

**Settings** in the left menu, or the light/dark switch in the top-right
of any page. Your choice is remembered on this device.

## What you can't do (and why)

Your access is set by your role, not by what buttons happen to be visible.
If something is greyed out or gives a permission error:

- **Accounts Officers** can post routine transactions but cannot reverse a
  posted journal entry or close an accounting period — that needs a
  Vice-Chancellor.
- Only a **Vice-Chancellor or System Administrator** can reach payroll
  import.
- **Bursars** only see Students & Billing and Reports — General Ledger,
  Suppliers, and the Audit Log aren't part of their role.

This isn't a bug — it's the same separation-of-duties control an external
auditor will expect to see in place. The full role-by-role breakdown is on
the **User Management** page, or in `docs/NOVA_ROADMAP.md` §4.
