# WorkforceSaaS — QA Test Plan

Companion to `docs/APP_FLOW.md`. Each section has **Positive** cases (the thing
should work) and **Negative** cases (the thing should correctly fail/block/deny
— a negative case "passing" means the bad input was correctly rejected).

Test against the seeded demo data (`npm run seed`) — see credentials at the
bottom. Re-run `npm run seed` any time to reset to a known state; it's
idempotent for company/users/sites/wage-master and only adds workers once.

How to use this: go section by section, check each box, log a bug for anything
that doesn't match the expected result. Don't skip negative cases — that's
where the real bugs hide.

---

## 0. Automated tests (run these first, every time)

```bash
npm test
```

Currently covers `services/validationEngine.js` (Aadhaar/UAN/ESIC/bank format
+ Verhoeff checksum — 38 tests) and `services/wageCalculator.js` (payroll math
— 10 tests). Both are pure functions with no DB dependency, so they run in
under a second and should **always** be green before you start manual QA. If
`npm test` fails, stop — fix that first, manual QA on top of a broken core
calculation is wasted effort.

These don't replace manual QA — they only cover two services. Everything below
this line still needs to be checked by hand (or you extend the test suite —
see §10).

---

## 1. Authentication

**Positive**
- [ ] Valid email + password → redirected to `/dashboard`
- [ ] Logout → session destroyed, redirected to `/auth/login`, browser back
      button does not show authenticated pages
- [ ] "Forgot password" with a real registered email → flash message shown
      (don't assume the email actually sent — check `NotificationLog` table or
      mail provider logs)
- [ ] Reset-password link with a valid, unexpired token → can set new password
      → can log in with new password
- [ ] Session persists across page reloads and new tabs (same browser)

**Negative**
- [ ] Wrong password → generic error (does **not** reveal whether the email
      exists — check the message wording)
- [ ] Non-existent email → same generic error as wrong password
- [ ] 21st login attempt within 15 minutes from the same IP → rate-limited
      (`loginLimiter`, max 20/15min) — verify with a script, not by hand
- [ ] Expired reset-password token → rejected, not silently accepted
- [ ] Reused reset-password token (use it twice) → second use rejected
- [ ] SQL/script injection in email or password fields → rejected as invalid
      input, no server error, no script execution if reflected anywhere
- [ ] Directly visiting any `/dashboard`, `/workers`, etc. URL while logged
      out → redirected to login, not a blank/broken page
- [ ] CSRF: submit the login form with a missing/tampered `_csrf` value (edit
      the hidden field via devtools) → rejected, flash message shown, not a
      silent 500

---

## 2. Role-based access control (do this for **every** role)

For each of the 5 roles, log in and confirm the permission matrix in
`APP_FLOW.md` §1 holds exactly — not "mostly."

**Positive** — each role can do everything its row says ✅ to.

**Negative** — each role is **blocked** from everything its row says ❌ to:
- [ ] `auditor` cannot reach `/workers/register` (typed directly in URL bar,
      not just "hidden from nav") → 403, not a blank page or crash
- [ ] `site_supervisor` cannot reach `/settings/users`, `/sites`, `/payroll`
      generate — same direct-URL test
- [ ] `hr_payroll` cannot delete a worker (`DELETE /workers/:id`) — try via
      the UI and via a raw request if you're comfortable with curl/Postman
- [ ] `company_admin` cannot reach `/admin/companies` (super_admin only)
- [ ] Every blocked action returns **403**, never a 500 or a silent redirect
      to a page that then errors

**Site-supervisor scoping (separate from role permission — this is data
scoping and is easy to get subtly wrong):**
- [ ] Site supervisor's worker list shows **only** workers at their assigned
      site, even though the URL/filter dropdown might suggest otherwise
- [ ] Site supervisor cannot mark attendance for a worker at a different site
      by manipulating the form (try changing a hidden `site_id` field via
      devtools and submitting)
- [ ] Site supervisor's dashboard stats reflect only their site, not the
      whole company

**Multi-tenant isolation (different companies, not just different roles):**
- [ ] Company A's `company_admin` cannot see Company B's workers, sites,
      users, or payroll — by URL guessing (e.g. incrementing a worker ID in
      the URL that belongs to another company) → 403/404, not the data
- [ ] Two companies with workers sharing the same Aadhaar last-4 + similar
      names don't get cross-matched as duplicates in the duplicate-check
      validation (duplicate check is scoped to `company_id` —
      `validationEngine.js::checkDuplicate`)

---

## 3. Worker registration wizard

This is the highest-risk flow — multi-step, file uploads, session state,
multi-tenant `company_id` resolution. Test thoroughly.

**Positive**
- [ ] Complete all 5 steps with fully valid data → worker created, status
      `active`, validation results show mostly/all "pass"
- [ ] "Save Draft" from Step 1 → exits wizard, worker status `draft`, resuming
      `/workers/register` later restores the entered data
- [ ] Step 2 auto-fills wage rate when Category+Zone match a Wage Master
      entry — and the field stays editable after auto-fill
- [ ] Upload a valid JPEG/PNG/PDF under the size limit for each document slot
      in Step 3 → uploads succeed, preview/filename shown
- [ ] Add multiple family members in Step 4, remove one before submitting →
      only the remaining ones are saved
- [ ] Step 5 review page accurately reflects everything entered in 1–4
      (cross-check every field, not just the obvious ones)
- [ ] Final submit → redirected to the new worker's profile, validation
      engine results displayed (pass/fail per check)
- [ ] Registering as `super_admin` (no company of their own) → worker's
      company is correctly derived from the selected site, not left null
      (this was a real bug — see git history — re-verify it's still fixed)

**Negative — validation should block, not crash**
- [ ] Step 1: empty required field (name, father's name, DOB, mobile,
      address) → inline error, draft preserved, not lost
- [ ] Step 1: Aadhaar with letters, wrong digit count, or spaces → rejected
      with a clear message
- [ ] Step 1: mobile number not exactly 10 digits → rejected
- [ ] Step 1: DOB that makes the worker under 18 at date of joining (check at
      submit, not just Step 1 — `checkAge` runs at final validation) →
      worker is created but validation result for `age_verification` shows
      `fail`, not silently passed
- [ ] Step 2: negative or non-numeric wage rate → rejected
- [ ] Step 2: UAN provided but not exactly 12 digits → rejected
- [ ] Step 2: ESIC marked applicable but number left blank or wrong length
      (must be 17 digits) → rejected
- [ ] Step 3: upload a file **over** the limit (document: 2MB, photo: 100KB)
      → rejected with a clear message, not a generic server error
- [ ] Step 3: upload a disallowed file type (e.g. `.exe`, `.zip`, `.docx` —
      allowed are JPEG/PNG/PDF for documents, JPEG/PNG only for photo) →
      rejected
- [ ] Step 3/4 (multipart forms): tamper with or strip the `_csrf` query
      param from the form action URL before submitting → rejected, and
      critically: **does not redirect to the dashboard losing all wizard
      data** (this exact bug existed before — see git history — confirm it
      stays fixed for any future change to these two steps)
- [ ] Submit the same Aadhaar number for two different workers in the same
      company → second one's validation shows `duplicate_check: fail`, but
      the worker is still created (validation failing ≠ submission blocked —
      confirm this is the intended behavior, not a bug)
- [ ] Register a worker with a wage rate below the Wage Master minimum for
      their Category+Zone → created, but `wage_compliance` shows `fail`
- [ ] Abandon the wizard halfway (close tab after Step 2) → no orphaned
      `Worker` row should exist in the DB (drafts live in session only until
      final submit creates the row)
- [ ] Two browser tabs, same user, editing the wizard simultaneously with
      different data → no crash; document whatever the actual behavior is
      (session draft is shared across tabs by design — confirm this doesn't
      silently corrupt data)

---

## 4. Worker list, search, view, delete

**Positive**
- [ ] Search by name, mobile, or Aadhaar last-4 → correct matches only
- [ ] Filter by site and by status (active/inactive/draft) → correct subset
- [ ] Pagination works past 25 results (`PAGINATION_LIMIT`)
- [ ] Worker profile page shows correct decrypted-display data (last 4 digits
      only for Aadhaar/bank/UAN/ESIC — never full numbers in the UI)
- [ ] `company_admin`/`super_admin` deactivating a worker → confirmation
      prompt shown, worker status changes, worker no longer appears in
      default active-only views

**Negative**
- [ ] Search with special characters / SQL-meta characters (`'`, `%`, `--`)
      → no error, no unexpected results, no SQL error leaked
- [ ] Search for a string that matches nothing → "No workers found", not an
      error page
- [ ] Visiting `/workers/:id` for a worker that doesn't exist → 404, not 500
- [ ] Visiting `/workers/:id` for a worker in **another company** → 403/404,
      never the data
- [ ] `hr_payroll` or `site_supervisor` attempting the delete action (hidden
      in UI, but try the raw `DELETE /workers/:id` request) → 403

---

## 5. Attendance

**Positive**
- [ ] Mark Present/Half-day/Absent for a worker for today → saved instantly
      (AJAX), reflected on dashboard's "Present Today" stat without reload
- [ ] Enter OT hours for a present worker → saved, reflected later in payroll
- [ ] View a past date via `?date=YYYY-MM-DD` → correct historical data shown
- [ ] Muster roll for a month → correct daily grid, CSV export downloads and
      contains correct data
- [ ] Apply for leave, then approve it as `site_supervisor`+ → status updates
      visible to the applicant

**Negative**
- [ ] Mark attendance for a future date → confirm whether this is
      intentionally allowed or should be blocked (decide and document — not
      currently obviously restricted, worth a deliberate decision)
- [ ] OT hours negative or absurdly large (e.g. 999) → should be rejected or
      at least flagged — check current min/max constraints in the form
- [ ] Mark attendance twice for the same worker+date → second mark should
      **update**, not create a duplicate row (`Attendance` has a unique
      index on `worker_id + date` — confirm the upsert behaves correctly,
      not a DB constraint error surfacing to the user)
- [ ] `auditor` attempting to mark attendance (no nav link, but try the raw
      `POST /attendance/mark`) → 403
- [ ] Approve a leave request as a role without `leaves:approve` → 403

---

## 6. Documents

**Positive**
- [ ] Pending documents queue shows all unverified uploads across the
      company's workers
- [ ] Verify a document → status changes to `verified`, timestamp + verifier
      recorded, removed from pending queue
- [ ] Reject a document with a reason → status `rejected`, reason stored and
      visible
- [ ] Document completeness check on the worker's compliance result updates
      after verify/reject (re-run validation or check it auto-refreshes —
      confirm which)

**Negative**
- [ ] Reject without providing a reason → blocked, reason should be required
- [ ] `site_supervisor` attempting to verify/reject (no `documents:verify`
      permission) → 403
- [ ] Request a document file (`GET /documents/:id`) belonging to another
      company → 403/404, file never served
- [ ] Request a non-existent document ID → 404, not a path-traversal
      vulnerability (confirm the file-serving code resolves the path safely,
      doesn't accept `../../` style IDs)

---

## 7. Payroll

**Positive**
- [ ] Generate payroll for the current month → one `Payroll` row per active
      worker with attendance, correct gross/PF/ESIC/net math (cross-check a
      couple by hand against `services/wageCalculator.js` formulas: OT rate =
      daily_wage/8 × 2, PF = 12% of gross if applicable, ESIC = 0.75% of
      gross if applicable)
- [ ] Re-generate for the same month → existing rows are **overwritten**, not
      duplicated (unique on `worker_id + month + year`)
- [ ] View payroll for a past month → correct historical figures
- [ ] Filter payroll by site → correct subset
- [ ] Export CSV → downloads, contains correct rows and totals

**Negative**
- [ ] Generate payroll for a worker with **zero attendance** in the month →
      gross/net should be ₹0, not an error or `NaN`
- [ ] Generate payroll for a worker with no `EmploymentDetail` (shouldn't
      normally happen, but a draft worker promoted oddly) → should be
      skipped gracefully, not crash the whole generation
- [ ] `site_supervisor` attempting `POST /payroll/generate` → 403
- [ ] Generate payroll twice rapidly (double-click) → no duplicate/corrupted
      rows, no race condition producing wrong totals

---

## 8. Reports & Compliance

**Positive**
- [ ] Compliance dashboard score matches a hand-calculated weighted average
      for a small known dataset (pick 2–3 seeded workers, work out their
      pass/fail checks, verify the score lines up with
      `services/reportService.js` weighting)
- [ ] Missing-documents list shows exactly the workers with incomplete docs
- [ ] Wage / PF / Audit report pages load without error and show
      role-appropriate, company-scoped data only

**Negative**
- [ ] Compliance score for a company with **zero workers** → shows 100%
      (per `getComplianceScore`'s explicit zero-worker case — confirm this
      reads sensibly in the UI rather than looking like a bug)
- [ ] `site_supervisor` cannot reach any `/reports/*` page (no
      `reports:read` permission) → 403
- [ ] Audit log never shows another company's entries, even to `super_admin`
      browsing without a company filter selected

---

## 9. Settings & Administration

**Positive**
- [ ] Update own profile name → saved, reflected immediately in the navbar
- [ ] Change own password with correct current password → succeeds, can log
      in with new password
- [ ] `company_admin` creates a new user → appears in user list with correct
      role, default password works for that user's first login
- [ ] `company_admin` adds a new Wage Master rate → appears in the list,
      immediately available for Step 2 auto-fill in worker registration
- [ ] `company_admin`/`super_admin` creates/edits a site → appears correctly
      in site dropdowns app-wide
- [ ] `super_admin` creates a company + subscription → company can then have
      users/sites/workers added

**Negative**
- [ ] Change password with **wrong** current password → rejected, clear
      error, password not changed
- [ ] New password under 8 characters → rejected
- [ ] Create a user with an email already in use (anywhere on the platform,
      not just this company — `email` is globally unique) → rejected with a
      clear message, not a raw DB constraint error
- [ ] Create a user with an invalid role string (bypass the dropdown via
      devtools) → rejected, not silently accepted with a broken role
- [ ] `hr_payroll`/`site_supervisor` attempting `/settings/users` or
      `/sites` → 403
- [ ] Two wage master entries for the exact same Category+Zone+effective
      date → confirm whether this is blocked or allowed-and-the-newest-wins;
      either is defensible but it should be a **decision**, not an accident
- [ ] Note: new users are **not emailed** their default password — confirm
      this matches your expectations (flash message tells the admin to share
      it manually); if you expect email delivery, that's a gap to flag, not
      a bug in what's there

---

## 10. Internationalization

**Positive**
- [ ] Switching language via the navbar/login pills changes text on: navbar,
      sidebar, bottom nav + "More" sheet, dashboard, login, Workers,
      Attendance, Payroll, Settings (all 3 tabs), Sites, Compliance report
- [ ] Selected language persists across page navigation and after logout/
      login (cookie-based, 1 year expiry)
- [ ] Devanagari (Hindi/Marathi), Gujarati, and Telugu text renders with
      correct glyphs, not tofu boxes — check on a device/OS that doesn't
      have these fonts pre-installed, not just your dev machine
- [ ] Voice input (mic icon) language follows the selected UI language where
      supported by the browser's Web Speech API

**Negative / known gaps — confirm these match expectations, they're not bugs**
- [ ] Worker registration wizard (all 5 steps) is still English-only
- [ ] PF report, Wage report, Audit report pages are still English-only
- [ ] Super Admin pages (companies, subscriptions) are still English-only
- [ ] User-entered data (worker names, addresses, company names) is correctly
      **never** translated — only static UI chrome should change language

---

## 11. Responsive / cross-device

- [ ] Test at three widths minimum: ~375px (phone), ~768px (tablet), ~1280px
      (desktop) — not just by shrinking a desktop browser, an actual device
      or devtools device emulation catches more
- [ ] Sidebar (desktop) vs bottom nav + "More" sheet (mobile) — confirm the
      breakpoint switch happens cleanly at 992px, no overlap/gap
- [ ] No page causes horizontal scroll on a 375px-wide viewport (tables
      should scroll horizontally **within** their own container, not blow
      out the page)
- [ ] Forms (especially the worker wizard) are usable one-handed on mobile —
      tap targets large enough, no fields hidden off-screen
- [ ] Dropdown menus (user menu) don't render off-screen or clipped near
      viewport edges on mobile

---

## 12. General robustness

- [ ] Submitting any form twice rapidly (double-click) doesn't create
      duplicate records anywhere
- [ ] Browser back button after submitting a form doesn't resubmit/duplicate
      (check payroll generation and worker registration specifically)
- [ ] All flash messages (success/error/info) auto-dismiss and don't stack
      indefinitely if multiple actions happen quickly
- [ ] A 500 error anywhere shows the friendly error page, never a raw stack
      trace (check this with `NODE_ENV=production` specifically — the error
      handler shows `err.message` only in development)
- [ ] Server logs (`console.error`) capture enough detail to debug a
      production issue without needing to reproduce it live

---

## Seeded test accounts

All passwords: `Admin@1234` (super admin uses the same unless overridden via
`.env`).

| Role | Email |
|---|---|
| Super Admin | `admin@workforce.local` |
| Company Admin | `companyadmin@example.com` |
| Site Supervisor | `supervisor@example.com` (Main Site) |
| HR/Payroll | `hrpayroll@example.com` |
| Auditor | `auditor@example.com` |

The seed (`npm run seed`) intentionally includes broken data for negative
testing: 2 workers with invalid Aadhaar checksums, 1 below-minimum wage,
2 with missing documents, 1 left in `draft` status. Use these to verify
negative-path rendering without having to manually create bad data yourself.

---

## Extending automated coverage (§0)

If you want more of this plan automated rather than manual, the next highest-
value targets (pure logic, no DB/session mocking needed) are:
- `utils/dateUtil.js::todayLocal()` — mock `Date` to a few fixed timestamps
  across timezones and assert the string output (this is the function that
  fixed the "Present Today shows 0" timezone bug — worth pinning down)
- `services/reportService.js` scoring math — needs DB mocking (Jest +
  `jest.mock('../models')` like `validationEngine.test.js` does) since it
  queries Worker/Document/EmploymentDetail counts directly
- Route-level integration tests with `supertest` against a real (test) MySQL
  database would catch the RBAC/multi-tenant negative cases in §2 far more
  reliably than manual clicking — worth investing in if this app keeps
  growing
