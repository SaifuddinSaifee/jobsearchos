# Stage 7a: Email settings

Gmail connection, sending rules, writing defaults and contact-finder status, configured once in Settings.

Status: built. Deviation from the plan: `email_accounts` also has a `needs_reconnect` flag, set when Google rejects the refresh token (`invalid_grant`), so Settings can show "Reconnect needed".

---

## Context

Stage 7 (contact discovery and cold email sending, see [PLAN.md](PLAN.md)) needs one place where the user configures email: connect their Gmail, set sending rules, set the defaults the cold-email writer uses, and check that the contact-finder keys work.

Today Settings ([settings/page.tsx](../src/app/(app)/settings/page.tsx)) is a read-only health page. Secrets live in `.env` via [env.ts](../src/lib/env.ts). Nothing exists yet for OAuth, token storage or encryption.

This stage builds the settings and the Gmail connection only. Generating emails and sending them to contacts come later in Stage 7, and that work reads these settings. The rules behind each setting come from [cold-email.md](cold-email.md).

### Decisions

- **OAuth client:** the Google OAuth client ID and secret go in `.env`, like the other keys. The user connects from a button in Settings.
- **Scopes:** `gmail.send` and `gmail.readonly` are requested now, so reply detection later does not need a reconnect. `openid email` is also requested, to learn the connected address.
- **What Settings covers:** Gmail connection, sending rules, writing defaults and contact-finder key status.

---

## Approach

### 1. Env ([env.ts](../src/lib/env.ts), `.env.example`)

Add optional variables, following the `TAVILY_API_KEY` pattern: each is optional, and the feature that needs it reports clearly when it is missing.

- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
- `APP_URL` (default `http://localhost:3000`), used to build the redirect URI `${APP_URL}/api/gmail/callback`
- `TOKEN_ENCRYPTION_KEY`: 32 bytes, base64. `.env.example` shows how to generate one: `openssl rand -base64 32`
- `HUNTER_API_KEY`, `APOLLO_API_KEY`

### 2. Schema and migration

Add the tables to `src/lib/db/schema.ts` and generate `drizzle/0009_email_settings.sql` with drizzle-kit.

- **`app_settings`:** a single row (`id` text primary key `'default'`), with `cold_email` jsonb typed `ColdEmailSettings` and `updated_at`. It is not versioned like `profile_versions`, because these are config values, not content.
- **`email_accounts`:**
  - Columns: `id`, `provider` (`'gmail'`), `email`, `scopes` text[], `refresh_token_enc` text, `access_token_enc` text, `access_token_expires_at`, `connected_at`, `disconnected_at`
  - Soft delete through `disconnected_at`, matching migration 0007
  - At most one active Gmail account, enforced by a partial unique index where `disconnected_at is null`

### 3. Settings domain (`src/lib/email/`)

#### `settings.ts`

A Zod `ColdEmailSettingsSchema` with defaults taken from [cold-email.md](cold-email.md), plus `getColdEmailSettings()` and `saveColdEmailSettings()`. It follows the pattern of [profile/schema.ts](../src/lib/profile/schema.ts) (`emptyInstructions()`) and [profile/service.ts](../src/lib/profile/service.ts), with `db` injectable for tests.

| Group | Field | Default |
| --- | --- | --- |
| Sending | `dailyCap` | 25 |
| | `sendDays` | Tue, Wed, Thu |
| | `sendWindowStart`, `sendWindowEnd` | 09:00, 11:00 |
| | `useRecipientTimeZone` | true |
| | `followUpBusinessDays` | 5 |
| | `maxFollowUps` | 1 (max 2) |
| | `bccSelf` | false |
| | `requireVerifiedAddress` | true |
| Writing | `senderName` | empty |
| | `signOff` | first name |
| | `links` | up to 2, each a label and a URL |
| | `minWords`, `maxWords` | 60, 120 |
| | `followUpMaxWords` | 50 |
| | `extraBannedPhrases` | empty list |
| | `defaultAngle` | `auto` (or `proof_of_work`, `value_offer`, `question`, `direct`) |
| Contacts | `providerOrder` | `hunter`, then `apollo` |
| | `excludeGenericInboxes` | true |

#### `crypto.ts`

AES-256-GCM using `node:crypto`, keyed from `TOKEN_ENCRYPTION_KEY`.

- `encrypt(text)` and `decrypt(blob)`, storing `iv.tag.ciphertext` in base64
- Throws a clear error when the key is missing

#### `gmail.ts`

Uses plain `fetch`, so no new dependency is needed.

- `authUrl(state)`: sets `access_type=offline`, `prompt=consent` and `include_granted_scopes=true`
- `exchangeCode(code)` and `refreshAccessToken()`
- `getAccessToken()`: refreshes the token when it has expired and saves the new one encrypted
- `connectedAccount()`
- `disconnect()`: revokes access at `oauth2.googleapis.com/revoke` and soft-deletes the row
- `sendTestEmail()`: builds a plain-text RFC 2822 message, base64url-encodes it and posts it to `users/me/messages/send`, addressed to the user's own address. The Stage 7 send flow reuses the same send function.

### 4. OAuth routes (`src/app/api/gmail/`)

Read `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md` before writing these routes.

- **`connect/route.ts` (GET):**
  1. Creates a random `state`.
  2. Stores it in an httpOnly cookie, using `await cookies()` as Next 16 requires.
  3. Redirects to Google.
- **`callback/route.ts` (GET):**
  1. Checks that `state` matches the cookie.
  2. Exchanges the code for tokens.
  3. Reads the email address from the id_token or from userinfo.
  4. Saves the tokens encrypted.
  5. Redirects to `/settings?tab=email&gmail=connected`. On error, it redirects with `gmail=error&reason=...`.

### 5. Server actions (`src/app/(app)/settings/actions.ts`)

- `saveColdEmailSettingsAction`
- `disconnectGmailAction`
- `sendTestEmailAction`
- `checkContactProvidersAction`: calls Hunter `/v2/account` and Apollo's auth-health endpoint with the keys from env

All four return the `ActionResult` shape from [profile/actions.ts](../src/app/(app)/profile/actions.ts) and call `revalidatePath('/settings')`.

### 6. UI

**Settings page:** change [settings/page.tsx](../src/app/(app)/settings/page.tsx) to two tabs.

- **General:** the current health checks and models, unchanged, plus a new Gmail row showing the connected address or "Not connected".
- **Email:** the new components below.
- The selected tab is kept in the URL with `nuqs`, as on the Jobs page. The tabs use `@/components/ui/tabs`, following [profile-tabs.tsx](../src/components/profile/profile-tabs.tsx).

**New components in `src/components/settings/`:**

- **`gmail-card.tsx`** shows one of three states:
  - **Not configured:** the env variables are missing. Shows the setup steps.
  - **Not connected:** a Connect Gmail button that links to `/api/gmail/connect`.
  - **Connected:** the address, scopes and connection date, with Send test email and Disconnect buttons. Disconnect asks for confirmation in a dialog.

  When the user returns from Google, a sonner toast reports the result of the `?gmail=` parameter.
- **`email-settings-form.tsx`:** react-hook-form with the Zod resolver, like [instructions-form.tsx](../src/components/profile/instructions-form.tsx).
  - Three cards: Sending, Writing defaults, Contact finding
  - Built from `Switch`, `NativeSelect` and `Input`
  - A `Textarea` for extra banned phrases, one per line
  - A links list with add and remove buttons (lucide `Plus` and `X` icons, each with a label)
- **`contact-providers-card.tsx`:** status for Hunter and Apollo: whether each key is set, and a Check button that shows remaining credits when the API returns them.

**Feedback and styling:** use the shared motion system.

- Buttons show a pending state while their action runs.
- Every save, connect and disconnect shows a toast.
- Skeletons appear where data loads.
- No symbol characters in the UI; use lucide icons only.

### 7. Docs

- **[PLAN.md](PLAN.md), Stage 7:** note that the settings were built first and that the scopes are now send plus readonly. Link to this document.
- **README, new "Setup: Gmail" section:**
  1. Create a Google Cloud project and enable the Gmail API.
  2. Set up the OAuth consent screen in Testing mode, with the user's own address as a test user.
  3. Create a Web client with the redirect URI `http://localhost:3000/api/gmail/callback`.
  4. Fill in `.env`.

  The section should also say that refresh tokens for apps in Testing mode expire after 7 days. The UI detects `invalid_grant` and shows "Reconnect".

---

## Files

- **New:**
  - `src/lib/email/settings.ts`, `crypto.ts`, `gmail.ts`
  - `src/app/api/gmail/connect/route.ts`, `src/app/api/gmail/callback/route.ts`
  - `src/app/(app)/settings/actions.ts`
  - `src/components/settings/*`
  - `drizzle/0009_*.sql`
  - `tests/email-settings.test.ts`, `tests/email-crypto.test.ts`
- **Modified:** `src/lib/env.ts`, `.env.example`, `src/lib/db/schema.ts`, `src/app/(app)/settings/page.tsx`, `docs/PLAN.md`, `README.md`

---

## Verification

1. **Static checks:** `npm run lint` (this also catches symbol characters), `npx tsc --noEmit` and `npm test`.
2. **Tests** (vitest, using the patterns in [helpers.ts](../tests/helpers.ts) and the test DB):
   - **Crypto:** a value round-trips through encrypt and decrypt, and a tampered ciphertext throws.
   - **Settings:**
     - Defaults are returned when no row exists.
     - A saved value loads back.
     - Invalid values are rejected: `maxWords` below `minWords`, `maxFollowUps` above 2, more than 2 links.
   - **`gmail.ts`, with `fetch` mocked:**
     - An expired token is refreshed.
     - The raw MIME message is encoded correctly.
     - `invalid_grant` is mapped to a "reconnect" state.
3. **Manual check:** run `npm run dev` and open Settings, then the Email tab.
   - Without the Google env variables, the setup steps are shown.
   - With them, Connect Gmail goes through Google consent. Back in the app, the connected address shows and a toast appears.
   - Send test email arrives in the user's inbox.
   - Disconnect revokes access, and the card returns to Not connected.
   - Edited settings are still there after a reload.
   - Hunter's Check button shows the key status.
