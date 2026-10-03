# EstatePal Backend

Modular **Node.js + Express** API for the EstatePal land & sugarcane marketplace.

- **Database / Auth storage:** Supabase (Postgres)
- **Media:** Cloudinary
- **Realtime:** Socket.IO WebSockets
- **Signals:** in-process event bus → push + WS
- **Push:** Expo Push API
- **Host:** Render.com ready (`render.yaml`)

---

## Architecture

```
src/
  config/          env & constants
  db/              Supabase client (service role)
  events/          bus + listeners (signals → push/ws)
  middleware/      auth, validate, errors
  modules/
    auth/          OTP login, sessions
    listings/      CRUD, search, likes, similar
    connections/   contact unlock requests
    payments/      proof submit + verify
    devices/       push token registry
    users/         /me/* routes
    admin/         full admin controls
  services/        push, cloudinary, token helpers
  websocket/       Socket.IO
  utils/           mappers, money, crypto
  app.js           Express app
  server.js        HTTP + WS boot
sql/schema.sql     Postgres schema
```

### Event signals (examples)

| Event | Side effects |
|--------|----------------|
| `listing.approved` | Push **all users** with public listing data + WS `listing:published` + seller “live” push |
| `listing.rejected` | Seller push + WS |
| `connection.requested` | Seller push + WS |
| `connection.unlocked` | Buyer push + WS |
| `payment.proof_submitted` | Admin push + WS |
| `listing.liked` | Seller push |

---

## Setup

### 1. Supabase

1. Create a project at [supabase.com](https://supabase.com)
2. SQL Editor → run **`sql/schema.sql`**
3. Project Settings → API → copy **URL** and **service_role** key

### 2. Cloudinary

Create a free account → Dashboard → copy cloud name, API key, secret.

### 3. Environment

```bash
cp .env.example .env
# fill SUPABASE_*, CLOUDINARY_*, ADMIN_PHONES
```

`ADMIN_PHONES` = E.164 numbers that become `role=admin` on first OTP login.

### 4. Run locally

```bash
npm install
npm run dev
# → http://localhost:4000/health
```

Dev OTP is printed to the console (or set `DEV_OTP=123456`).

### 5. Render.com

1. New Web Service → connect repo
2. Or use Blueprint: `render.yaml`
3. Set env vars from `.env.example`
4. Health check path: `/health`

---

## API (matches mobile app)

| Method | Path | Auth | Notes |
|--------|------|------|--------|
| POST | `/auth/otp` | — | `{ phone }` |
| POST | `/auth/verify` | — | `{ phone, code, acceptedTerms }` → `{ token, user }` |
| GET | `/me` | Bearer | Current user |
| GET | `/listings` | optional | filters: district, category, transactionType, q, sort, cursor |
| GET | `/listings/:id` | optional | increments views |
| GET | `/listings/:id/similar` | optional | |
| POST | `/listings` | yes | create (AWAITING_PAYMENT) |
| POST | `/listings/:id/like` | yes | toggle save |
| GET | `/me/listings` | yes | seller listings + views |
| GET | `/me/saved` | yes | |
| POST | `/connections` | yes | `{ listingId }` |
| GET | `/me/connections` | yes | sent requests |
| GET | `/me/connections/received` | yes | `?listingId=` |
| POST | `/payments/proof` | yes | `{ referenceCode, transactionId, payerPhone? }` |
| POST | `/devices` | yes | `{ pushToken, platform }` |

### Admin (`role=admin`)

| Method | Path |
|--------|------|
| GET | `/admin/dashboard` |
| GET | `/admin/proofs` |
| POST | `/admin/proofs/:id/review` | `{ approve, note? }` |
| GET | `/admin/listings?status=&q=` |
| POST | `/admin/listings/:id/approve` |
| POST | `/admin/listings/:id/reject` | `{ reason? }` |
| GET | `/admin/users` |
| POST | `/admin/users/:id/role` | `{ role }` |
| POST | `/admin/users/:id/identity` | `{ status }` |

**Ownership** is stripped from public listing payloads until the buyer’s connection is `UNLOCKED` (same rule as the app).

---

## WebSockets

```
connect:  wss://YOUR_HOST/socket.io  auth: { token: "<bearer>" }
rooms:    user:{id}, admin, listing:{id}
events:   listing:published, listing:status, connection:new,
          connection:unlocked, payment:verified, payment:proof
```

Mobile can keep using Expo push + React Query invalidation; WS is optional for instant admin dashboards and live feeds.

---

## Frontend switch

In the Expo app `src/config/index.ts`:

```ts
export const MOCK = false;
```

In `app.json` → `extra.apiUrl`:

```json
"apiUrl": "https://estatepal-api.onrender.com"
```

---

## SMS in production

`auth/service.js` logs OTP in non-production. Plug in Africa’s Talking / Twilio in `requestOtp` before go-live.

---

## License

Private — EstatePal.
"# estatepal_backend" 
