# Component Ingest Service

Upload an external **Angular component library** (npm / `.tgz` / `.zip`); the service
builds it into a **Native Federation remote** exposing its components as
`agenticWidget`s and registers them as `kind:'component'` capabilities — so the
Studio's Page/Form designers can use them and the Hub renders them **with no host
redeploy**. (Part B of the design-tokens + ingestion feature.)

The runtime *consumption* path already exists — `provideStaticJsonMfeRegistry` →
`loadRemoteCapabilities` → `ComponentRegistry` → `<mvk-widget-container>`. This
service is the *produce + register* half.

## Pipeline

`unpack → introspect → scaffold → npm install → ng build → serve → register`

1. **Unpack** — `npm pack <spec>` or extract the uploaded archive into `package/`.
2. **Introspect** (`introspect.ts`) — parse the library's `.d.ts` for Ivy
   `ɵcmp` component declarations → class name, selector, `@Input()` names. No type
   resolution / node_modules needed.
3. **Scaffold** (`scaffold.ts`) — write a standalone Native Federation remote
   workspace (its own `angular.json`/`package.json`; never touches the host repo),
   mirroring `platform/matter-management-mfe` (`build`→`esbuild` targets, `main.ts`
   = `initFederation`, `federation.config.js` exposing `./Capability`).
4. **Generate** (`generate.ts`) — `src/capability.ts` =
   `defineCapabilityModule({ components: [agenticWidget({ name, component, propsSchema })…] })`.
   **MVP: `propsSchema` is `z.object({}).passthrough()`** (props forwarded as-is;
   `widget-container` validates leniently). Typed schemas from input types are B2.
5. **Build** — `npm install` + `ng build <remote>` → `dist/<remote>/remoteEntry.json`.
6. **Serve** — copy artifacts under `GET /remotes/<name>/…`.
7. **Register** — append a `RemoteSpec` to `registry.json` **and** POST a
   `kind:'component'` capability per component to the catalog (`catalog.ts`).

## API

| Method | Path | |
|---|---|---|
| `POST` | `/ingest` | `{ "npm": "@progress/kendo-angular-buttons@1.2.3" }` or `{ "archivePath": "/path/lib.tgz" }` → `{ jobId, remoteName }` (202) |
| `GET` | `/ingest/:jobId` | job status: `phase`, `log`, `components`, `remoteEntry` |
| `GET` | `/registry.json` | `{ remotes: RemoteSpec[] }` — the MFE registry the Hub reads |
| `GET` | `/remotes/*` | built `remoteEntry.json` + federation chunks |
| `GET` | `/health` | |

## Run

```bash
cd platform/component-ingest-service
npm install
npm run build && npm start          # or: npm run dev
# → http://localhost:4320
```

Env: `PORT` (4320), `CATALOG_URL` (`http://localhost:8081`, the Java catalog),
`TENANT` (`acme`), `PUBLIC_URL` (base for remoteEntry links), `WORK_DIR`,
`ARTIFACT_DIR`, `REGISTRY_FILE`, `SEED_REMOTES` (JSON `RemoteSpec[]` — seed with the
existing `matter-management` remote so pointing the Hub here keeps it).

### Point the Hub at it (opt-in, no rebuild of behavior)

Set `mfeRegistryUrl` in `platform/agentic-experience-runtime/src/environments/environment.ts`
to `http://localhost:4320/registry.json`. The Hub's existing boot loop then
discovers + loads every remote (seeded + ingested). Default stays the bundled
`mfes.json`, so nothing changes until you opt in.

### Ingest a library

```bash
curl -s -X POST localhost:4320/ingest -H 'content-type: application/json' \
  -d '{"npm":"@progress/kendo-angular-buttons@16.0.0"}'    # → { jobId }
curl -s localhost:4320/ingest/<jobId>                       # poll phase + log
```

## Status & limitations (B1)

- **Verified in-repo:** the deterministic core — `introspect` (Ivy `.d.ts` parsing),
  `generate` (capability.ts + catalog bodies), `scaffold` (workspace), and
  `sanitizeRemote` — **12 unit tests** (`npm test`); the service typechecks.
- **Requires a real run:** `npm install` + `ng build` of an actual library is heavy
  (minutes, ~GB) and is executed when you `POST /ingest` — not exercised by the unit tests.
- **B2 (next):** typed `propsSchema` from input types; a Studio "Upload library" UI.
- **B3 (hardening):** the build runs arbitrary code — run each job in a **sandboxed
  worker** (container, egress allow-list, resource/time limits) before exposing this
  beyond a trusted operator. Not yet sandboxed.
