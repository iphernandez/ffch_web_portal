# ffch_web_portal

Tooling for the F.F.C.H. amateur soccer league. This repository contains **independent applications** that
share no code. They only share data and content files at the repository root.

| Path | What | Docs |
|---|---|---|
| [`webApp/`](webApp/) | Angular web app that replaces `FFCH_Puntuacion/FFCH - Puntuacion.xlsx` (standings, TDP, weekly capture, team balancer, events). Published on GitHub Pages. | User guide (shown in the app's **Ayuda** page): [webApp/README.md](webApp/README.md). Deploy: [webApp/DEPLOY.md](webApp/DEPLOY.md) |
| [`webJsApp/`](webJsApp/) | Node CLI that automates WhatsApp messages and polls with whatsapp-web.js. Runs locally. | [webJsApp/CLI_HELP.md](webJsApp/CLI_HELP.md) |
| [`functions/`](functions/) | Cloud Function `sendQueuedMail` that sends the webApp's event confirmation emails. | [webApp/DEPLOY.md](webApp/DEPLOY.md) section 0.1 |
| [`FFCH_Puntuacion/`](FFCH_Puntuacion/) | Original Excel exports, `formulas.txt`, and the formula migration notes (also shown in **Ayuda**). | [FFCH_Puntuacion/README.md](FFCH_Puntuacion/README.md) |
| Root files | `config.json`, `puntuacion.json`, `reglamento.md`, `convocatoria.md`, `convocados.md`: used by `webJsApp`. `firebase.json`: Firebase CLI config for rules and functions. | — |

> Keep `webApp/README.md` user-facing (Spanish, no implementation details): it is copied into the app by
> `webApp/scripts/copy-readmes.mjs`. Implementation notes belong in this file.

## webApp (developer reference)

Live app: `https://iphernandez.github.io/ffch_web_portal/`

### Local development

```bash
cd webApp
npm install
npm start        # http://localhost:4200 (prestart copies the READMEs into public/docs)
npm test         # unit tests (Vitest)
npm run build    # production build in dist/webApp/browser
```

Every push to `main` that touches `webApp/**` deploys to GitHub Pages through
`.github/workflows/deploy-webapp.yml`. Firestore rules and functions are deployed separately from the repo root:

```bash
firebase deploy --only firestore:rules
firebase deploy --only functions
```

### Architecture

- **Angular 22**, standalone components, signals, and `withHashLocation()` routing (GitHub Pages has no
  server-side rewrites).
- **Local database: [Dexie.js](https://dexie.org/) over IndexedDB.** This is the browser-side cache and query
  engine that the features read from and write to.
- **Accounts: Firebase Authentication.** Each account also has a `users/{uid}` Firestore profile with name, role,
  status, and linked `playerId`.
- **Shared data: Firestore.** The single document `data/ffch-puntuacion` holds players, weekly records, TDP
  history, and the season config, with a `version` field for optimistic concurrency.
  [`webApp/firestore.rules`](webApp/firestore.rules) is the only server-side authorization.

| Service (`webApp/src/app/core/services`) | Responsibility |
|---|---|
| `DataStoreService` | Dexie/IndexedDB wrapper; local cache and full export/import. |
| `ScoringService` | Formulas from `FFCH_Puntuacion/formulas.txt` (`Pts`, `PtosFecha`, `TDP`, `Puntos`) and the card rules from `reglamento.md`. |
| `RemoteSyncService` | Pull/push of `data/ffch-puntuacion` with optimistic concurrency (`SyncConflictError`). |
| `AuthService` | Login, registration, roles, and admin user management over Firebase Auth + Firestore. |
| `TeamBalancerService` | Greedy split into 2 teams by rating, honoring restrictions. |
| `TeamBalancerStateService` | Live team-balancer state in Firestore and rating push/pull. |
| `MessageTemplateService` | `{{VAR}}` template rendering. |
| `CsvImportService` | One-time migration from the original Excel CSV exports. |
| `EventService` | Events, the enabled event, registrations, the mail outbox, and folding attendance into TDP. |
| `EventReportService` | Option limits and validation, CSV export, WhatsApp summary, and confirmation email content. |

Formula mapping and migration decisions: [FFCH_Puntuacion/README.md](FFCH_Puntuacion/README.md). Architecture
review and refactoring roadmap: [docs/architecture-review.md](docs/architecture-review.md).

### Roles and routing

- `authGuard` protects `/`, `/cuenta`, `/roster`, `/tdp`, `/captura`, `/equipos`, and `/ayuda`.
- `activeEventGuard` protects `/evento` (requires a session and an enabled event; otherwise redirects to `/`).
- `adminGuard` protects `/convocatoria`, `/ajustes`, and `/usuarios`.
- Component `isAdmin` checks only hide UI. Real enforcement is in `firestore.rules`.

### Data sync

| Change | Where it is written | Needs "⬆ Guardar cambios en Firestore" |
|---|---|---|
| Events, enabled event, registrations, user ↔ player link | Firestore, immediately | No |
| Event attendance → TDP (`applyRegistrationsToTdp`) | Merged into the latest `data/ffch-puntuacion` and pushed | No |
| Team balancer: teams, results, restrictions, ratings after a result | `meta/teamBalancerTeams`, `meta/teamBalancer`, ratings merged into `data/ffch-puntuacion` | No |
| Roster, weekly capture, TDP checkboxes and weights | IndexedDB only | **Yes** |

- "⬆ Guardar cambios en Firestore" pushes the whole local copy and replaces the remote one.
- "⬇ Sincronizar desde Firestore" replaces the whole local copy.
- **First-login auto-sync.** `AuthService.autoSyncSharedDataIfNeeded` pulls the shared doc only when the local
  tables are empty. It is a bootstrap step, not a refresh, so caches can go stale. See S1–S3 in the architecture
  review.

### Events and registration

- Categories `pretemporada`, `gala`, and `teamBuilding` map 1:1 to the TDP categories with the same name.
- Event id is `<category>-<year of the date>`, so there is one event per category and year. Past events stay as
  separate documents, which keeps the registration history.
- `locationUrl` accepts only `http(s)://` (`safeHttpUrl`). `deadlineMs` is enforced by the Firestore rules.
- Option limits (cupos) are validated on the client when a registration is submitted.
- Registrations live at `events/{eventId}/registrations/{uid}`. Admin registrations on behalf of a player use the
  linked account's uid, or `player-<playerId>` when there is none, and are marked with `registeredBy`.
- **Guests** are admin-added attendees with no account and no roster player (`EventService.addGuest`):
  - Document id is `guest-<uuid>`, with `guest: true`, `playerId: ''`, `userName: 'Invitado'`, `attending: true`,
    and no answers.
  - Names are trimmed, limited to 80 characters, and must be unique within the event.
  - Guests are skipped for TDP (`pendingAttendance` needs a `playerId`) and for option limits.
  - The existing admin create/delete rules cover them, so no rules change was needed.
- **TDP integration.** Attending creates `<playerId>-<category>-<year>` with `participated: true`:
  1. Non-admins can't write the shared doc, so the TDP page overlays pending registrations in memory.
  2. When an admin registers, opens TDP, or clicks "Aplicar asistencias al TDP", the app merges pending
     attendance into the latest remote doc, writes it to IndexedDB, and sets `appliedToTdp: true` on each
     registration.
  3. After that, TDP is the source of truth, so an admin can uncheck a no-show.
- **Confirmation emails.** The client writes to the `mail` collection, and `functions/sendQueuedMail` sends it
  over SMTP and records the outcome in `delivery`. If sending fails, the registration is still saved.

### Team balancer

- If more than 12 players are selected (`MAX_PLAYERS_PER_GAME`), the 12 with the highest TDP play and the rest
  are substitutes.
- Greedy split: players are sorted by `rating` (descending), and each one goes to the team with the lower
  running total. Restrictions (pairs of `playerId`s that can't play together) are honored.
- **Initial rating** when a player has none: `floor(puntos / maxPuntos × 9 + 1)`, clamped to 1–10.
- **After a result:** each winner gets +1 and each loser gets −1, clamped to 1–10.
- **Persistence:**
  - `meta/teamBalancerTeams` (pending teams, last 10 results, last winner) can be read by any signed-in user.
  - `meta/teamBalancer` (restrictions) is admin-only.
  - Ratings are merged into `data/ffch-puntuacion` right after a result. Other devices pull only the `rating`
    field when they see a new result.
  - Older Dexie `team-balancer:*` settings are migrated once by the first admin device.

### Firestore paths

| Path | Read | Write |
|---|---|---|
| `users/{uid}` | self, admins | self (not role/status/player), admins |
| `data/ffch-puntuacion` | signed-in users | admins |
| `meta/activeEvent` (`{ eventId }`) | signed-in users | admins |
| `meta/teamBalancerTeams` | signed-in users | admins |
| `meta/teamBalancer` | admins | admins |
| `events/{eventId}` | signed-in users | admins |
| `events/{eventId}/registrations/{uid}` | signed-in users | create: the user (enabled event, before deadline, as their linked player) or any admin; update: admins (`appliedToTdp` only); delete: admins |
| `mail/{id}` | nobody (Cloud Function only) | create: a user to their own email, admins to anyone |

Redeploy `webApp/firestore.rules` whenever a path or rule changes.

## webJsApp (WhatsApp CLI)

```bash
cd webJsApp
npm install
npm start                    # interactive menu
node index.js --help         # built-in help
```

For automated poll-vote lookups, you can override the poll question:

```bash
node webJsApp/index.js --auto --type poll-votes --poll-question "Quienes juegan hoy?"
```

The help content is stored in [webJsApp/CLI_HELP.md](webJsApp/CLI_HELP.md) so CLI instructions can be updated without changing code.

### Config profiles

`config.json` stores named profiles at the top level, including `FFCH` and `TEST`.

- The default runtime profile is `FFCH`.
- Pass `--test` to use the `TEST` profile instead.
- The automated flows read and update the selected profile in `config.json` (for example, `WEEK_NUMBER`).
