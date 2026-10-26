# Mail Setup — Forgot Password

How the app sends password-reset emails, what you need before it works in production, and how to set it up. Today the app sends exactly one kind of email: the reset link. Everything here also applies to any emails added later.

---

## How it works

1. On the login page, the user clicks **Forgot password?** and enters their email.
2. The backend creates a random one-time token, stores only its **SHA-256 hash**, and emails a link:
   `https://<your-frontend>/reset-password?token=<token>`
3. The user opens the link, chooses a new password, and is signed straight in.
4. Every other device signed in to that account is signed out.

| Rule | Value |
|---|---|
| Link lifetime | **30 minutes** |
| Uses per link | **One** — and requesting a new link cancels any older one |
| Requests per email | 3 per hour (extra requests are silently ignored) |
| Requests per IP address | 10 per hour (then HTTP 429) |
| Response to the requester | Always the same, whether or not the email has an account, so nobody can use the form to find out who's registered |
| Minimum new password | 8 characters |

If an email fails to send, the user still sees the normal "check your email" message, and the real error is written to the **server log**. Check the Render logs if someone says the email never arrived.

---

## Why an email API and not Gmail / SMTP

**Render's free tier blocks outbound SMTP** — ports 25, 465 and 587 — since September 2025. Nodemailer with Gmail, or any other SMTP server, just times out there.

So the app talks to email providers over their **HTTPS APIs** instead, which Render allows. There is no extra npm package; it uses Node's built-in `fetch`. The code is in [backend/src/lib/mailer.ts](backend/src/lib/mailer.ts).

---

## Which provider

Two are built in. Pick by whether you own a domain name.

| | **Brevo** (recommended now) | **Resend** (once you own a domain) |
|---|---|---|
| Free limit | 300 emails/day | 3,000/month, max 100/day |
| Needs your own domain? | **No** — verify a single sender address (even a Gmail) with a code | **Yes**, to send to anyone. Without one it only delivers to your own account email |
| Works on Render free | Yes (HTTPS API) | Yes (HTTPS API) |
| Setting | `MAIL_PROVIDER=brevo` | `MAIL_PROVIDER=resend` |

**Start with Brevo.** The app currently lives on `onrender.com` and `vercel.app`, which you don't control, so Resend can't send to your users yet. Switch to Resend (or keep Brevo with your domain added) once you buy a domain.

Free-tier terms change; check each provider's pricing page before relying on these numbers.

---

## Requirements checklist

Before forgot-password works in production:

- [ ] **Migration 005 applied on Supabase** — it creates `password_resets`, `shop_logos` and two new columns. Run it **before** pushing the code (see below). Without it, **nobody can log in**: loading the shop now reads its logo column.
- [ ] **A Brevo account** with **one verified sender email address**.
- [ ] **A Brevo API key** (v3).
- [ ] **Five environment variables set on Render** (table below).
- [ ] **`APP_URL` pointing at your Vercel frontend**, so links in emails open the real site and not `localhost`.
- [ ] **Data API protection on the new tables** in Supabase (`password_resets`, `shop_logos`), the same as in Phase 1 of [DEPLOYMENT.md](DEPLOYMENT.md). `password_resets` contains token hashes and must not be readable through Supabase's public API.

---

## Step 1 — Set up Brevo

1. Sign up at brevo.com (free). Brevo may ask for company details and review the account before you can send transactional email. Fill it in honestly; approval is usually quick.
2. **Add and verify a sender.** In Brevo's settings, open **Senders** and add the address emails should come from, e.g. `yourshop.billing@gmail.com`. Brevo emails that address a code; enter it to verify.
3. **Create an API key.** Under **SMTP & API → API keys**, generate a new key and copy it. It's shown once.
   It's an **API key** (`xkeysib-…`), not the SMTP password. The SMTP credentials won't work, because Render blocks SMTP.

Treat the API key like a password: anyone with it can send email as you. Don't paste it into chat or commit it to the repo.

---

## Step 2 — Environment variables on Render

Render → your service → **Environment**:

| Key | Value | Notes |
|---|---|---|
| `MAIL_PROVIDER` | `brevo` | `console` (the default) only prints emails to the log |
| `MAIL_API_KEY` | your Brevo API key | No quotes |
| `MAIL_FROM` | the sender you verified in Brevo | Must match exactly, or Brevo rejects the email |
| `MAIL_FROM_NAME` | e.g. `Vardhman` | The name people see in their inbox |
| `APP_URL` | `https://<your-app>.vercel.app` | No trailing slash; used to build the reset link |

The backend **refuses to start** if `MAIL_PROVIDER` is `brevo` or `resend` but `MAIL_API_KEY` or `MAIL_FROM` is missing. You'll see it in the deploy log, so a half-configured setup can't fail silently.

Render redeploys when you save.

---

## Step 3 — Apply migration 005 to Supabase, then push

From your Mac (with `SUPA` set to your session-pooler string, as before):

```bash
cd /Users/aayushgoswami/Documents/startup/backend
psql "$SUPA" -v ON_ERROR_STOP=1 -1 -f db/migrations/005_logos_and_password_reset.sql
```

Expected:

```
CREATE TABLE
CREATE INDEX
ALTER TABLE
CREATE TABLE
CREATE INDEX
ALTER TABLE
```

Then commit and push. Render and Vercel redeploy.

---

## Step 4 — Test it in production

1. Open the Vercel site → **Log in → Forgot password?** → enter **your own** email.
2. The email should arrive within a minute. **Check spam** the first time (see Deliverability).
3. Open the link → set a new password → you're signed in.
4. Open the same link again: it should say **Link expired** (single use).
5. If nothing arrives: Render → **Logs**, search for `Password reset email failed`. The line after it is Brevo's exact reason.

---

## Local development

Nothing to set up. With no `MAIL_PROVIDER` in `backend/.env`, it's `console`: the reset email is **printed in the backend's terminal** instead of being sent, link included. Copy the link into the browser.

The link uses `APP_URL`, which defaults to `http://localhost:5173` (`npm run dev`). If you run the built app with `npm run preview` on port 4173, add this to `backend/.env`:

```
APP_URL=http://localhost:4173
```

To try real sending from your Mac, set the same variables as Render in `backend/.env`. Local machines aren't blocked from SMTP, but the app uses the API either way.

---

## Deliverability (landing in the inbox, not spam)

Sending **from a Gmail address through Brevo** works, but Gmail, Yahoo and others treat mail as more suspicious when it comes from `@gmail.com` but wasn't sent by Gmail's own servers. Expect some resets to land in spam at first.

The real fix is **your own domain** (around ₹800–1,000/year). Then:

1. Buy a domain and add it to Brevo (or Resend).
2. Add the **SPF, DKIM and DMARC** DNS records the provider shows you. This proves the email is genuinely from you.
3. Change `MAIL_FROM` to an address on that domain, e.g. `no-reply@yourshop.in`.

This is also what unlocks Resend.

---

## Troubleshooting

| Symptom | Where to look | Cause / fix |
|---|---|---|
| Backend won't start: `MAIL_API_KEY and MAIL_FROM are required…` | Render deploy log | Provider set but key or sender missing |
| User gets "check your email" but nothing arrives | Render logs → `Password reset email failed` | Brevo's reason is printed: usually an unverified sender or a wrong key |
| `HTTP 401` from Brevo | Render logs | Wrong API key, or the SMTP password was used instead of the API key |
| `HTTP 400 … sender` from Brevo | Render logs | `MAIL_FROM` isn't a verified sender in Brevo |
| Email arrives, link opens `localhost` | — | `APP_URL` not set on Render |
| Link says "Link expired" immediately | — | Older than 30 minutes, already used, or a newer link was requested since |
| "Too many requests" | — | 10 requests/hour from one network; wait an hour |
| Lands in spam | — | Expected with a Gmail sender; add your own domain (above) |
| `ETIMEDOUT` to `smtp.gmail.com` | Render logs | Someone switched to SMTP; Render free blocks it. Use the API |

---

## Security summary

- The database stores only a **hash** of each reset token, never the token itself, so a database leak can't be used to reset passwords.
- Links are **single-use**, expire in **30 minutes**, and a new request cancels older links.
- The form never reveals whether an email is registered.
- Requests are rate-limited per email and per IP address.
- A reset **signs out every other device** (sessions issued before the change stop working).
- The emailed link is the only way to reset. There's no security question or SMS fallback to attack.
- The owner can still reset any password from the server with `npm run set-password -- <email>` in `backend/`.
