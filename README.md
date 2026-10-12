# ffch_web_portal
Sends message to a contact or group on WhatsApp

## FFCH Puntuación (Angular web app)

`webApp/` is an Angular web app that replaces `FFCH_Puntuacion/FFCH - Puntuacion.xlsx`: weekly
attendance/payment capture, points/TDP calculation, team balancing, and convocatoria text generation.
It runs entirely client-side (IndexedDB, no server) and is published free on GitHub Pages:

- Live app: `https://iphernandez.github.io/ffch_web_portal/` (once deployed, see [webApp/DEPLOY.md](webApp/DEPLOY.md))
- Local dev / docs: [webApp/README.md](webApp/README.md)
- Data/formula migration notes: [FFCH_Puntuacion/README.md](FFCH_Puntuacion/README.md)

## Web JS CLI help

The Web.js entrypoint now supports a built-in help option:

```bash
node webJsApp/index.js --help
```

For automated poll-vote lookups, you can also override the poll question from the CLI:

```bash
node webJsApp/index.js --auto --type poll-votes --poll-question "Quienes juegan hoy?"
```

The help content is stored in [webJsApp/CLI_HELP.md](webJsApp/CLI_HELP.md) so CLI instructions can be updated without changing code.

## Config profiles

`config.json` now stores named profiles at the top level, including `FFCH` and `TEST`.

- The default runtime profile is `FFCH`.
- Pass `--test` to any app entrypoint to use the `TEST` profile instead.
- The Web.js automated flows now read and update the selected profile under `config.json` instead of assuming a single top-level configuration.
