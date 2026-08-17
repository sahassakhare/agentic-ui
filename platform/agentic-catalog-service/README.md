# Agentic Catalog Service

The **control-plane** the Experience Studio and Hub talk to (default `:8081`). A
Spring Boot service that stores **capabilities** (forms, pages, workflows,
decisions, applications, and the generic kinds) and **experiences**, with
enterprise governance: optimistic concurrency, version history, and an approval
review chain.

> There are **two** catalog backends in this repo. This Java service
> (`platform/agentic-catalog-service`, `:8081`) is the one the **Studio + Hub**
> use. The Node `platform/agentic-catalog-server` (`:8080`, published to npm) is a
> separate implementation and is **not** the Studio's backend.

## Run it locally

Requires **JDK 21** and Maven. The default `local` profile uses an embedded H2
file (`./data/catalog`), **auth disabled** (every request acts as a synthetic
`platform-admin`), and loads the demo seed.

```bash
export JAVA_HOME=$(/usr/libexec/java_home -v 21)   # mvn must run on JDK 21
cd platform/agentic-catalog-service
mvn spring-boot:run
# → http://localhost:8081  (health: /health, H2 console: /h2-console)
```

Flyway owns the schema (`spring.jpa.hibernate.ddl-auto: none`); migrations live per
vendor under `src/main/resources/db/migration/{h2,postgresql,oracle}`. Postgres is
the `postgres` profile (`application-postgres.yml`).

## Capability API

Base: `/v1/catalogs/{tenant}/capabilities`

| Method | Path | Notes |
|---|---|---|
| `GET` | `/?kind=` | list (optionally by kind) |
| `GET` | `/{id}` | fetch one; returns an **`ETag`** (the version) |
| `POST` | `/` | create — defaults to `lifecycle:'draft'` (seeds may pass `published`) |
| `PATCH` | `/{id}` | update body/lifecycle/tags; honours **`If-Match`** |
| `DELETE` | `/{id}` | soft delete (honours `If-Match`) |
| `POST` | `/{id}/transition` | approval action `{action, comment}` |
| `GET` | `/{id}/versions` | version history (newest first) |
| `POST` | `/{id}/rollback/{n}` | restore version `n` (re-enters review) |

### Governance

- **Optimistic concurrency.** Every capability carries an integer `version`
  (JPA `@Version`), returned as the `ETag`. A write may send `If-Match: "<version>"`;
  a stale write is rejected with **412 Precondition Failed** (also enforced
  atomically by Hibernate).
- **Version history.** Every create/update/transition/rollback appends an immutable
  snapshot to `capability_versions`. `GET /:id/versions` lists them; `rollback`
  restores one (and re-enters the review chain).
- **Approval review chain.** `approval_state` moves `draft → review → approved`
  (with `reject`/`revoke`) via `POST /:id/transition`
  (`submit`/`approve`/`reject`/`revoke`/`deprecate`), building an `approval_chain`
  audit trail. **`approve`/`reject` require an approver role**
  (`catalog.auth.approver-roles`, default `platform-admin,catalog-admin,approver`).
- **Publish gate.** Moving `lifecycle → published` requires `approval_state ==
  'approved'` else **409**. Editing the body of an `approved` capability resets it to
  `draft` (re-review before republish).

Experiences (`/v1/catalogs/{tenant}/experiences`) have the analogous
version/approval/publish model this capability governance mirrors.

## Auth

OAuth2 resource server (JWT). `catalog.auth.mode: oidc` validates against the OIDC
issuer; roles come from the JWT `roles` claim. `writer-roles` may create/edit;
`approver-roles` may approve/reject. `mode: disabled` (local dev) permits all as a
synthetic admin.

## Verify

No unit-test module ships; verify by compile + a local smoke run:

```bash
mvn -q compile
# with the service running, exercise the flow:
B=http://localhost:8081/v1/catalogs/acme/capabilities
ID=$(curl -s -X POST $B -d '{"kind":"form","name":"demo","body":{}}' -H 'content-type: application/json' | jq -r .id)
curl -s -o /dev/null -w "%{http_code}\n" -X PATCH $B/$ID -d '{"lifecycle":"published"}' -H 'content-type: application/json'  # 409 (not approved)
curl -s -X POST $B/$ID/transition -d '{"action":"submit"}'  -H 'content-type: application/json'
curl -s -X POST $B/$ID/transition -d '{"action":"approve"}' -H 'content-type: application/json'
curl -s -o /dev/null -w "%{http_code}\n" -X PATCH $B/$ID -d '{"lifecycle":"published"}' -H 'content-type: application/json'  # 200
```
