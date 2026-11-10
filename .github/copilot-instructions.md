# Copilot instructions — FFCH Web Portal

Spanish-speaking amateur soccer league (F.F.C.H.) tooling. It replaces an Excel workbook used for weekly attendance, points, TDP (seniority bonus), team balancing, events, and WhatsApp messages.
Detailed findings and the refactoring roadmap: [docs/architecture-review.md](../docs/architecture-review.md).

## Repo map

| Path | What | Runtime |
|---|---|---|
| `webApp/` | Main app. Angular 22, standalone components, signals, hash routing, deployed to GitHub Pages by `.github/workflows/deploy-webapp.yml` | Browser |
| `functions/` | One Cloud Function (`sendQueuedMail`), triggered by `mail/{id}` create, that sends mail through nodemailer (SMTP) | Node 22, Firebase Functions v2 |
| `webJsApp/` | CLI for WhatsApp automation (whatsapp-web.js + Puppeteer): convocatoria, polls, poll voters, convocados | Node, ESM, runs locally |
| `FFCH_Puntuacion/` | Legacy Excel CSV exports + `formulas.txt` (source of truth for scoring formulas) + JSON snapshot | Data |
| Root `config.json` | CLI profiles (`FFCH`, `TEST`): group, seasons, poll, templates. **The CLI mutates it** (`WEEK_NUMBER`) | CLI state |
| Root `puntuacion.json` | CLI player lookup (`wanombre`/`wanumber`), separate from Firestore | CLI state |
| Root `*.md` (`reglamento`, `convocatoria`, `convocados`) | League rules and WhatsApp templates (`{{KEY}}` placeholders) | Content |
| `webApp/firestore.rules` | **The only real authorization layer** | Firestore |

## webApp data flow (read before touching data code)

```
Firebase Auth ──► AuthService ──► users/{uid} profile (isAdmin, disabled, playerId)
                       │ first login with an empty IndexedDB only
                       ▼
Firestore data/ffch-puntuacion  ◄──push(version)── RemoteSyncService ──pull──►  DataStoreService (Dexie / IndexedDB)
 (ONE doc: players, weeklyRecords,                                              ▲   all features read/write here
  tdpHistory, seasonConfig, version)                                            │
                                                                                │
Firestore events/{id}/registrations/{uid} ── EventService.applyRegistrationsToTdp (admin) ─┘
Firestore meta/activeEvent  (onSnapshot ► EventService.activeEvent signal)
Firestore mail/{id} ──► functions/sendQueuedMail ──► SMTP
```

- **Local-first:** roster, weekly capture, TDP, and team-balancer edits write **only to IndexedDB**. They reach Firestore when an admin clicks *Guardar en Firestore* in Ajustes (`SettingsComponent.pushToFirestore`).
- **Non-admin caches can go stale:** `AuthService.autoSyncSharedDataIfNeeded` pulls only when the local tables are empty.
- Events and registrations are separate collections because non-admins cannot write the shared doc.
- Team-balancer state is in Firestore and updates live through `TeamBalancerStateService`:
  - `meta/teamBalancerTeams` holds the pending teams, history, and last winner. Any signed-in user can read it.
  - `meta/teamBalancer` holds the restrictions and is admin-only.
  - Player `rating` stays in the shared players data. After a result it is pushed with `pushRatings()`, and other devices fetch it with `pullRatings()`.

## Core services (`webApp/src/app/core/services`)

- `scoring.service.ts`: pure functions that must match `FFCH_Puntuacion/formulas.txt` cell for cell. `Pts` is a decision tree over (rsvp, jugo, sede) → {5,3,1,-3,-1,-2,7,0}. `PtosFecha` is 0 when the player played and got a red card (2nd+ tardanza, or `pago === false`). `Puntos = (1 + TDP) × (ΣPtosFecha [+ 7 if sedeTemporadaAnterior])`. **Any change here needs a spec update and must be checked against the CSVs.**
- `data-store.service.ts`: Dexie schema v2, with tables `players`, `weeklyRecords`, `tdpHistory`, `seasonConfig`, `settings`, and the unused `users`. `importAll` replaces all data.
- `remote-sync.service.ts`: optimistic concurrency on the `version` field. Throws `SyncConflictError`.
- `auth.service.ts`: Firebase Auth plus the profile doc, the one-time seed admin, Spanish error mapping, and admin user management.
- `event.service.ts`: CRUD for events and registrations, the live active event, the mail outbox, and folding attendance into TDP.
- `event-report.service.ts`: option usage and limits, validation, CSV and WhatsApp export, and the confirmation email HTML (escaped).
- `team-balancer.service.ts`: snake draft by rating with incompatibility restrictions, ±1 rating after a result.
- `team-balancer-state.service.ts`: two live docs (public teams and admin-only restrictions); `arrayUnion`/`arrayRemove` for restrictions; a transaction for results; rating push and pull on the shared data doc; one-time migrations.
- `csv-import.service.ts`: one-time import of the legacy Excel CSVs (fixed column layout for TDP).
- `message-template.service.ts`: `{{KEY}}` replacement.

## Conventions

- **Language:** UI text, error messages, and domain terms are **Spanish** (`fecha`, `jugo`, `sede`, `pago`, `tarde`, `galactico`, `convocatoria`, `Tarjeta Roja`). Identifiers, comments, and file names are English. Keep domain field names as they are; they match the spreadsheet and the Firestore payload.
- **Angular:** standalone components with `imports: [...]`, `signal`/`computed`/`effect`, and constructor injection with `private readonly`. Use the `@if`/`@for` control flow, and always give `@for` a `track`. Template-driven forms (`FormsModule`). Every route is lazy (`loadComponent`). Guards: `authGuard`, `adminGuard`, `activeEventGuard`.
- **Admin checks:** components gate their mutations with `get isAdmin()`. That only protects the UI. Real enforcement for shared data has to go in `firestore.rules`.
- **IDs:** player id = `slugify(galactico)`; weekly record id = `${playerId}-${fecha}`; TDP entry id = `${playerId}-${category}-${year}`; event id = `eventId(category, date)`. Dates are `YYYY-MM-DD` strings in local time. Match day is Thursday.
- **Errors:** show them through a `statusMessage`/`eventMessage` signal using Spanish text, and catch around Firestore calls.
- **Tests:** Vitest through `ng test`. Specs live next to the services (`*.spec.ts`). `csv-import.real-data.spec.ts` reads the real CSVs.
- **Comments:** one short line, only for intent that isn't obvious from the code (existing style).

## Commands

```bash
cd webApp && npm start          # prestart copies READMEs into public/docs, then ng serve
cd webApp && npm test           # Vitest
cd webApp && npm run build      # prod build -> dist/webApp/browser
firebase deploy --only functions,firestore:rules   # from repo root
cd webJsApp && npm start        # interactive CLI; npm run auto:* for automated flows
```

## Guardrails when changing code

1. `webApp/` and `webJsApp/` are **independent applications**. Never import code from one into the other, and don't create a shared package. They may only share data and content files at the repo root.
2. `webApp/README.md` is the **user guide** shown on the in-app *Ayuda* page (copied by `scripts/copy-readmes.mjs`). Keep it in Spanish, aimed at players and admins, with no code, paths, or dev commands. Implementation notes go in the root `README.md`.
3. Change `firestore.rules` together with any new Firestore path or write. Deploy with `firebase deploy --only firestore:rules`.
4. Changing the Dexie schema requires a new `this.version(n)`. Never edit an existing version.
5. The shared doc has a **1 MiB Firestore limit**, and `weeklyRecords` grows by about (players × weeks). Don't add large fields to it.
6. Don't add new copies of these helpers. Shared versions should live in `core/utils`:
   - `slugify`, which is already duplicated
   - next-Thursday / season-start date math, which is already in 3 places with different semantics
   - `errorMessage`
   - Blob download
7. Keep `ScoringService` pure and deterministic. Feature components must call it rather than re-implementing formulas.
8. Never commit secrets. `functions/.env.ffch-puntuacion` holds non-secret params only, and `SMTP_PASSWORD` lives in Secret Manager. The Firebase web config in `environment.ts` is public by design.
9. `webJsApp` has **two** template syntaxes: `renderTemplate` uses `{{KEY}}` and `FileHandler.replaceVar` uses `{key}`. The webApp uses `{{KEY}}`. Prefer `{{KEY}}`.
