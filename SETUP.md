# EstatePal backend — setup notes (updated)

## 1. Supabase secret key

If you see `Unregistered API key` on `/auth/register`:

1. Dashboard → Project → **Settings → API Keys**
2. Create a **new Secret key** (`sb_secret_...`) or copy the **legacy service_role** JWT (`eyJ...`)
3. Set `SUPABASE_SERVICE_ROLE_KEY` in local `.env` **and** on Render
4. Verify:

```bash
curl -s "https://YOUR_PROJECT.supabase.co/rest/v1/users?select=id&limit=1" \
  -H "apikey: YOUR_SECRET_KEY" \
  -H "Authorization: Bearer YOUR_SECRET_KEY"
```

Expect `[]` or a JSON array — not an error.

## 2. Listing columns (run once in SQL editor)

```sql
ALTER TABLE listings ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE listings ADD COLUMN IF NOT EXISTS cane_age_months INT;
ALTER TABLE listings ADD COLUMN IF NOT EXISTS harvests INT;
```

Or run the full `sql/schema.sql` (safe `IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS`).

## 3. Email codes not arriving

Render free tier often **blocks SMTP**. Prefer Resend:

1. https://resend.com → API key
2. Set `RESEND_API_KEY=re_...` on the server
3. Until a domain is verified, Resend only delivers to your Resend account email

Gmail SMTP needs an **App Password**, and the host must allow outbound 587/465.

In development, codes are always printed in the server log: `[email-otp]` / `[email] →`.

Optional: `DEV_EMAIL_OTP=123456` forces a fixed code in development.

## 4. Local run

```bash
cp .env.example .env   # fill secrets
npm install
npm run migrate        # optional if using scripts
npm run dev
```

## Changes in this package

- Listings: `description`, `caneAgeMonths`, `harvests` (cuttings) persisted + mapped
- Auth login: no longer masks DB/key errors as “wrong password”
- Email: Resend-first, clearer logs, HTML code template
- Startup health check probes `users` table (not Auth Admin API)
- Error middleware surfaces Supabase key errors clearly
