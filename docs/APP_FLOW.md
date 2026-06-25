# WorkforceSaaS — Application Flow

A map of who can do what, and the order screens are meant to be used in. Use this
alongside `docs/QA_TEST_PLAN.md` when verifying a build.

## 1. Roles

| Role | Scope | Typical user |
|---|---|---|
| `super_admin` | All companies | You / platform operator |
| `company_admin` | One company, all its sites | Contractor / business owner |
| `site_supervisor` | One company, **one assigned site only** | Foreman on a specific site |
| `hr_payroll` | One company, all its sites | Payroll/HR officer |
| `auditor` | One company, all its sites, **read-only** | Compliance auditor |

Permission matrix lives in `middlewares/rbac.js` (`PERMISSIONS` object) — that file
is the source of truth if this table ever drifts from the code.

| Action | super_admin | company_admin | hr_payroll | site_supervisor | auditor |
|---|:---:|:---:|:---:|:---:|:---:|
| View workers | ✅ | ✅ | ✅ | ✅ | ✅ |
| Register/edit workers | ✅ | ✅ | ✅ (update only) | ✅ (create only) | ❌ |
| Delete (deactivate) workers | ✅ | ✅ | ❌ | ❌ | ❌ |
| Verify/reject documents | ✅ | ✅ | ✅ | ❌ | ❌ |
| Mark attendance | ✅ | ✅ | ✅ | ✅ | ❌ |
| Approve leave | ✅ | ✅ | ✅ | ✅ | ❌ |
| Generate payroll | ✅ | ✅ | ✅ | ❌ | ❌ |
| View reports | ✅ | ✅ | ✅ | ❌ | ✅ |
| Manage users | ✅ | ✅ | ❌ | ❌ | ❌ |
| Manage wage master | ✅ | ✅ | ❌ | ❌ | ❌ |
| Manage sites | ✅ | ✅ | ❌ | ❌ | ❌ |
| Manage companies/subscriptions | ✅ | ❌ | ❌ | ❌ | ❌ |

A `site_supervisor` is additionally **scoped to their one assigned site** — every
worker/attendance/payroll query they make is filtered to `site_id = their site`,
enforced in `middlewares/tenantScope.js`, not just hidden in the UI.

## 2. Entry flow

```
/  →  if logged in → /dashboard
   →  if not       → /auth/login
```

**Login** (`/auth/login`)
- Email + password → POST `/auth/login`
- Rate-limited: 20 attempts / 15 min per IP (`loginLimiter` in `server.js`)
- On success: session created, redirect to `/dashboard`
- "Forgot password?" → `/auth/forgot-password` → emails a reset link → `/auth/reset-password?token=...`

## 3. Dashboard (`/dashboard`)

Landing page after login. Shows 4 stat tiles (Total Workers, Present Today, Pending
Docs, Issues) and Quick Action buttons (Add Worker, Attendance, Compliance, Payroll).
Every tile/button is a real link into the relevant module — the dashboard itself
holds no data entry.

## 4. Worker registration (the core flow)

This is the most complex flow in the app — a 5-step wizard with server-side
session-backed drafts (`req.session.workerDraft`), so a worker can be saved
mid-way and resumed.

```
/workers/register                  (GET — starts/resumes the wizard)
  → Step 1: Personal details       POST /workers/register/step1
  → Step 2: Employment details     POST /workers/register/step2
  → Step 3: Documents (uploads)    POST /workers/register/step3   (multipart)
  → Step 4: Family members         POST /workers/register/step4   (multipart)
  → Step 5: Review                 GET  /workers/register/step5
  → Submit                         POST /workers/register/submit
```

- Each step validates its own fields server-side (`express-validator`) before
  advancing — failing validation re-renders the same step with errors, draft is
  **not** lost.
- "Save Draft" is available from Step 1 onward — exits the wizard, draft persists
  in session, worker status stays `draft` until final submit.
- Step 2 auto-fills the daily wage rate from Wage Master based on
  Category + Zone, but the field stays editable (a deliberate fix — see git
  history if curious why).
- Steps 3 & 4 are `multipart/form-data` — the CSRF token is passed as a **query
  string parameter**, not a hidden form field, because multer parses the body
  after CSRF middleware runs. This is the single easiest thing to break if a
  form on this app is ever copy-pasted without checking enctype.
- On final Submit: creates the `Worker` + `EmploymentDetail` rows in a DB
  transaction, runs the full validation engine (10 checks — Aadhaar
  format/checksum, age, UAN, ESIC, bank/IFSC, duplicate check, wage compliance,
  document completeness), and redirects to the new worker's profile showing
  pass/fail results.
- If the registering user is `super_admin` (no company of their own), the
  worker's `company_id` is derived from the **selected site**, not the user.

## 5. Day-to-day operations

**Attendance**
```
/attendance              daily marking grid for today (or ?date=YYYY-MM-DD)
/attendance/muster-roll  full-month calendar view, exportable to CSV
/attendance/leaves       leave requests + approval (site_supervisor+ can approve)
```
Marking attendance is AJAX (`POST /attendance/mark`), no page reload — Present /
Half-day / Absent buttons + an OT hours field per worker per day.

**Documents**
```
/documents/pending          queue of unverified uploads
POST /documents/:id/verify  marks verified
POST /documents/:id/reject  marks rejected, requires a reason
```

**Payroll**
```
/payroll                         view payroll for a month/site (defaults to current month)
POST /payroll/generate           (re)computes payroll for all active workers in
                                  scope for the selected month — idempotent,
                                  overwrites existing rows for that month
```
Generation reads `Attendance` rows for the month + `EmploymentDetail.wage_rate`,
runs `services/wageCalculator.js` (pure function, unit tested), and writes one
`Payroll` row per worker per month (unique on `worker_id + month + year`).

**Reports**
```
/reports/compliance   overall + per-check compliance score, missing-docs list
/reports/wage         wage compliance report
/reports/pf           PF/UAN report
/reports/audit        audit log viewer
```

## 6. Administration

**Settings** (`/settings/*`) — tabbed: Profile / Users / Wage Master
- Profile: any logged-in user can edit their own name + change password
- Users: `company_admin`+ creates users for their company (default password
  `Temp@1234`, forced to look believable but not auto-emailed yet — flag this
  if you expect email delivery)
- Wage Master: defines the minimum daily rate per Category × Zone, used both to
  auto-fill Step 2 of worker registration and to flag wage non-compliance

**Sites** (`/sites`) — `company_admin`+ only. Create/edit sites, assign a
supervisor.

**Super Admin** (`/admin/*`) — `super_admin` only. Manage companies and
subscriptions across the whole platform.

## 7. Language

5 languages: English, Hindi, Gujarati, Marathi, Telugu. Switching is a real page
navigation (`GET /lang/:code` sets a cookie, redirects back) — not a JS toggle —
so it works without JS and survives login/logout. Coverage is currently: nav
chrome, dashboard, login, Workers/Attendance/Payroll/Settings/Sites/Compliance
list pages. The worker wizard, PF/wage/audit report pages, and admin pages are
**not yet translated** — see QA plan §9.
