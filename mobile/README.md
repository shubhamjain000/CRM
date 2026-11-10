# Unstop CRM — iOS & Android App (Expo / React Native)

Native mobile shell for the Unstop CRM platform. Talks to the same backend as
the web app (cookie sessions, tenant scoping, audit logging) — screens:

- **Sign in** — email/password against `/api/auth/login`
- **Home** — live workspace stats (pull-to-refresh)
- **Leads** — real lead list from `/api/crm/leads`
- **Tasks** — task list with priority dots from `/api/productivity/tasks`
- **More** — account, server, sign out

## Run it (5 minutes, no store build needed)

1. Install [Expo Go](https://expo.dev/go) on your iPhone or Android phone.
2. Start the backend (this repo's Next.js server) and note its LAN URL, e.g.
   `http://192.168.x.x:3000`.
3. Then:

```bash
cd mobile
pnpm install
EXPO_PUBLIC_API_URL=http://192.168.x.x:3000 pnpm start
```

4. Scan the QR code from the terminal:
   - **iOS** — Camera app → opens in Expo Go
   - **Android** — Expo Go app → "Scan QR code"

Android simulators can use `pnpm android`, iOS simulators `pnpm ios`
(macOS with Xcode required for the latter).

> `EXPO_PUBLIC_API_URL` defaults to `http://localhost:3000`, which works for
> simulators running on the same machine. Real devices need the host machine's
> LAN address.

## Store builds (TestFlight / Play Store)

```bash
cd mobile
pnpm install
npx eas login
npx eas build --platform ios      # → IPA for TestFlight / App Store
npx eas build --platform android  # → AAB for Play Store
```

App identity: bundle ID / package `com.unstop.crm`, display name
"Unstop CRM", navy `#223558` splash and adaptive icon.

## Where the icon comes from

`assets/icon.png` and `assets/adaptive-icon.png` are rendered from the shared
brand mark — regenerate web + mobile icons together with
`bun scripts/make-icons.ts` from the repo root and copy `public/icons/icon-1024.png`.
