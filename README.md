# SkyBridge Travels — Website

A full travel/recruitment agency website for SkyBridge Travels (Ho, Ghana):
public marketing pages, a Jobs/Tours/Destinations catalogue, application and
booking forms, and an admin dashboard — backed by a real shared database
(Firebase) instead of just one browser's local storage.

This file covers: how to run it, how to finish the Firebase setup (**you
need to do a few things in the Firebase Console — see below**), what's
genuinely functional vs. what a static site still can't do on its own, and
where everything lives in the code.

---

## 1. Running it

Unzip everything into one folder and open `index.html` — no build step,
no `npm install`. For best results (and so the browser's security rules
for `fetch`/Firebase behave the same as they will on a real domain), serve
it with a simple local server rather than opening the file directly:

```
python3 -m http.server 8000
```

then visit `http://localhost:8000`. To actually go live, upload the whole
folder to any static host (Netlify, Vercel, Cloudflare Pages, GitHub Pages,
or ordinary shared hosting/cPanel all work — there's no server-side code).

**Admin dashboard:** footer → *Admin*, or go straight to `login.html`.

---

## 2. Firebase setup — do this before the admin login will work

The site's shared data (jobs, tours, destinations, bookings, applications,
messages, settings) and the admin login are both powered by **Firebase**
(Realtime Database + Authentication). The project's API keys are already
wired in (`firebase-config.js`), but **three things can only be done inside
the Firebase Console itself — I don't have the ability to do these for
you**, and the site won't fully work until you have:

### Step 1 — Enable the Realtime Database
In the [Firebase Console](https://console.firebase.google.com/) → your
`skybridge-travels-database` project → **Build → Realtime Database** →
*Create Database* (if not already created). Choose any region.

### Step 2 — Apply the security rules
Still in **Realtime Database → Rules**, paste in the contents of
`database.rules.json` (included in this zip) and publish. In short, these
rules make jobs/tours/destinations/settings publicly readable but only
admin-writable, and let visitors **create** an application/booking/message (one record each, keyed by its reference number) but never read, change or delete any — only the signed-in admin can:

```json
{
  "rules": {
    ".read": false,
    ".write": false,

    "jobs":         { ".read": true, ".write": "auth != null" },
    "tours":        { ".read": true, ".write": "auth != null" },
    "destinations": { ".read": true, ".write": "auth != null" },
    "settings":     { ".read": true, ".write": "auth != null" },

    "applications": {
      ".read": "auth != null",
      "$id": {
        ".write": "auth != null || (!data.exists() && newData.exists())",
        ".validate": "newData.hasChildren(['id', 'status']) && (data.exists() || newData.child('id').val() === $id) && (auth != null || newData.child('status').val() === 'Pending')"
      }
    },
    "bookings": {
      ".read": "auth != null",
      "$id": {
        ".write": "auth != null || (!data.exists() && newData.exists())",
        ".validate": "newData.hasChildren(['id', 'status']) && (data.exists() || newData.child('id').val() === $id) && (auth != null || newData.child('status').val() === 'Pending')"
      }
    },
    "messages": {
      ".read": "auth != null",
      "$id": {
        ".write": "auth != null || (!data.exists() && newData.exists())",
        ".validate": "newData.hasChildren(['id']) && (data.exists() || newData.child('id').val() === $id) && (auth != null || newData.child('sent').val() === false)"
      }
    }
  }
}
```

> **Updating from an earlier version?** Re-paste and re-publish these rules — applications, bookings and messages are now stored one record per submission instead of as a single list, and the old rules don't cover that shape.

### Step 3 — Enable Email/Password sign-in and create the admin account
Go to **Build → Authentication → Sign-in method** → enable **Email/Password**.
Then go to the **Users** tab → *Add user* → enter:
- Email: `admin@skybridgetravelsgh.com` (this exact address — it's the one
  hardcoded in `firebase-config.js` as `ADMIN_EMAIL`; change it there if
  you'd rather use a different address)
- Password: whatever you want the admin login to use (to keep the password you originally asked for, use `SkyTravelsGH2026` — Firebase accepts it; a longer, more unique password is safer for a live site)

The login page only ever asks for a password (the email above is used
automatically behind the scenes), so the experience for whoever logs in
stays exactly "username `admin`, password ______" like before — the
difference is the password is now verified by Firebase's own servers, not
checked against anything stored in this code.

### Step 4 — Add your real domain to Authorized Domains
**Authentication → Settings → Authorized domains** → add whatever domain
you deploy the site to (e.g. `skybridgetravelsgh.com`). `localhost` is
already allowed by default for local testing.

Once those four steps are done, the admin login and every form on the site
read and write through Firebase for real.

### ⚠️ A note on testing
I built and wired up this Firebase integration against the project config
you gave me, following Firebase's documented API exactly — but **this
sandbox has no internet access**, so I could not make a single real network
call to your actual Firebase project to confirm it end-to-end. What I *did*
do instead: built a faithful mock of the Firebase SDK and ran the full app
against it (login with right/wrong passwords, session persistence across
page loads, adding a job from the dashboard, confirming it appears live on
the public Jobs page in another tab without a refresh, submitting the
contact form, the honeypot silently dropping a bot-like submission) — all
of that passed with zero JavaScript errors. What remains to verify only
you can do, after completing steps 1–4 above and deploying: sign in with
your real admin password, add a test job, and confirm it shows up on
`jobs.html`. If anything doesn't behave as expected, the browser's
DevTools → Console tab will show the exact Firebase error.

---

## 3. What's genuinely functional

- **Real shared backend.** Firebase Realtime Database is now the source of
  truth for jobs, tours, destinations, applications, bookings, messages and
  settings — shared live across every visitor, browser and device, not just
  one person's browser. See *"How the data layer works"* below for the
  architecture.
- **Real admin authentication.** The admin password is verified by Firebase
  Authentication server-side — it is never stored, hashed, or checked
  anywhere in this front-end code. Firebase also independently rate-limits
  repeated failed sign-ins.
- **Full application & booking details in the dashboard.** In **Admin → Applications** and **Admin → Bookings**, click **View** on any row to open everything the visitor submitted: contact details (tap-to-email / call / WhatsApp), the job or tour, preferred date and traveller count with an estimated total, qualifications, work experience, cover letter, special requests and the submission time — plus Approve/Reject (or Confirm/Cancel) and one-tap Email/WhatsApp buttons. The window updates live if the status changes. **Note:** for CVs, only the file *name* is recorded, not the file itself (storing uploaded files would need Firebase Storage); ask applicants to email or WhatsApp their CV.
- **Live updates everywhere.** Add or edit a job/tour/destination in the
  dashboard (from any device) and every open copy of the Jobs/Tours/
  Destinations/homepage pages updates within moments, with no manual
  refresh — a dashboard open on a second device sees new applications and
  bookings the same way.
- **8 real job vacancies** (replacing the old sample listings), transcribed
  from the recruitment flyers you supplied — Construction Helper (UAE),
  Internal/External Cleaner (Dubai), Warehouse Worker (Serbia), Automotive &
  Heavy Machinery technicians (Turkey), Construction Skilled Workers &
  Helpers (UAE), Truck Drivers/Warehouse/Welders (Poland, 3-year contract),
  Construction Worker (Montenegro), and General Helpers/Welders/Plumbers/
  Bricklayers (Dubai). Each has real requirements and benefits pulled from
  the flyer text, editable in the dashboard.
- **Rotating hero photography.** Every marketing page's hero section now
  shows a 3-image, auto-rotating slider (tour sites / destinations / jobs),
  composited from real photography already in your own flyers — no stock
  downloads needed. Pauses on hover, has click-through dots, and respects
  `prefers-reduced-motion`.
- **Mobile-responsive, with no horizontal overflow.** Checked at 360/375/
  390/414px on every page — nav collapses to a hamburger menu, the search
  and filter bars go full-width and stack, grids go to one column, and a
  site-wide CSS safety net (`overflow-x: hidden` + `overflow-wrap` on text)
  stops anything unexpected from ever forcing the page wider than the
  screen.
- **Real anti-spam on every public form** (contact, job application, tour
  booking): a lightweight arithmetic CAPTCHA plus an invisible honeypot
  field. Verified to actually block a bot-like submission (filled honeypot)
  while letting a real human through.
- **XSS-safe rendering.** Every place admin-entered data (job titles, tour
  descriptions, etc.) gets displayed, it passes through a shared escaping
  helper (`wwEsc` in `main.js`) first, so it can never be interpreted as
  HTML/script by a visitor's browser.
- **Security headers.** Content-Security-Policy, Referrer-Policy and a
  clickjacking guard on every page; `_headers` (Netlify/Cloudflare Pages)
  and `.htaccess` (Apache) files included so a real deployment can enforce
  the same policy at the HTTP level, which is stronger than what an HTML
  `<meta>` tag alone can do; `robots.txt` and `sitemap.xml` for search
  engines.

---

## 4. How the data layer works (read this before changing `main.js`)

Because this is a static site (no server to run your own code on), the
cleanest way to get a *real*, live-synced backend without rewriting every
page into async/await is a **cache-then-sync** pattern, implemented as
`WWSync` near the top of `main.js`:

1. Firebase Realtime Database is the **source of truth**.
2. On every page load, a live listener (`firebase.database().ref(path).on('value', …)`)
   mirrors each collection into this browser's `localStorage` the moment it
   changes — from *any* device, not just this one.
3. Because of that cache, `WW.getJobs()`, `WW.getTours()`, etc. can stay
   simple, synchronous function calls everywhere else in the codebase
   (`jobs.js`, `admin.js`, every page's inline scripts) — they just read the
   cache, which Firebase is kept busy refreshing in the background.
4. Writes (`WW.saveJobs(...)`, `WW.addApplication(...)`, etc.) go to
   Firebase **and** update the local cache optimistically at the same
   moment, so the admin's own UI never has to wait on a round-trip.
4a. **Applications, bookings and messages work differently** (this matters for privacy): each submission is written as its own record at `/applications/<ref>`, `/bookings/<ref>` or `/messages/<id>`. A visitor's browser only ever writes its own new record — it can't read, overwrite or delete anyone else's — and keeps no local copy. The dashboard only starts listening to these collections once the admin is signed in, and clears its local copy of them when the admin signs out.
5. Pages that should visibly update live (Jobs, Tours, Destinations, the
   homepage, the admin dashboard) listen for a custom `ww:<collection>-updated`
   event, which fires every time the cache refreshes, and re-render.

If Firebase can't be reached (offline, ad-blocker, or steps 1–4 above not
done yet), everything quietly keeps working from whatever's in
`localStorage` already — the site never hard-fails, it just stops staying
in sync with other devices until Firebase is reachable again.

---

## 5. What a static site still can't do on its own

Even with a real database and real authentication, two things are outside
what any front-end-only site can honestly promise:

1. **It can't send real email or WhatsApp messages by itself.** Doing that
   needs a transactional email provider (SendGrid, Postmark, Amazon SES) or
   the WhatsApp Business API, called from a server that can hold a secret
   API key safely — a key placed in front-end JavaScript is visible to
   anyone who views the page source. **What this build does instead:**
   every trigger point (new contact message, new application, new booking)
   drafts the exact message and logs it to the shared `messages` collection
   (visible under **Admin → Messages**, synced live to every admin device),
   with a one-click pre-filled `mailto:` / `wa.me` link to actually send it.
   That's the most a static site can honestly do — the next step is a small
   server function (a Firebase Cloud Function is the natural fit here,
   since you're already on Firebase) that watches the `messages` path and
   actually sends the email/WhatsApp message automatically.
2. **A compromised Firebase config is still a config, not a secret.** The
   `apiKey` in `firebase-config.js` is meant to be public (it identifies
   the project, it doesn't authorize anything by itself) — real access
   control lives entirely in the security rules (`database.rules.json`)
   and in who has a real Firebase Authentication account. Don't rely on
   hiding `firebase-config.js`; rely on the rules.

---

## 6. File map

- **`firebase-config.js`** — Firebase project config + SDK init. Change
  `ADMIN_EMAIL` here if you want the admin account under a different
  address.
- **`database.rules.json`** — the security rules to paste into Firebase
  Console → Realtime Database → Rules.
- **`main.js`** — the shared `WW` data/auth layer, the `WWSync` Firebase
  sync engine, the hero slider, the CAPTCHA/honeypot helpers, and the
  clickjacking guard.
- **`admin.js`, `dashboard.html`** — the admin CRUD tool (Jobs, Tours,
  Destinations, Applications, Bookings, Messages, Settings tabs).
- **`login.html`** — the admin sign-in form (Firebase Authentication).
- **`services.js`** — the 12 services shown on the homepage and
  `services.html`; edit this one file to update both places at once.
- **`jobs.js`** — the Jobs listing page's search/filter logic.
- **`img/hero-*.jpg`** — the three rotating hero photos. Replace these
  three files (same filenames) to change what the slider shows.
- **`_headers`** (Netlify/Cloudflare Pages) / **`.htaccess`** (Apache) —
  real HTTP security headers for production hosting.
- **`robots.txt`, `sitemap.xml`** — update the domain in both once you know
  your final URL.

---

## 7. Before you consider this "live"

- [ ] Complete the four Firebase Console steps in section 2.
- [ ] Log in with your real admin password and confirm the dashboard loads.
- [ ] Add a test job/tour from the dashboard and confirm it appears on the
      public site.
- [ ] Replace sample content you haven't personally verified yet: the tour
      packages, destinations, testimonials and "by the numbers" stats are
      still placeholder business content — edit or remove them from the
      dashboard (Tours/Destinations) or `index.html` (testimonials/stats).
- [ ] Update `robots.txt` and `sitemap.xml` with your real domain.
- [ ] If hosting on Netlify/Cloudflare Pages/Apache, confirm `_headers` or
      `.htaccess` is actually being picked up (check response headers in
      DevTools → Network on the live site).
- [ ] Have someone qualified review `privacy.html` and `terms.html` — I
      wrote them as reasonable starting points, not legal advice.
