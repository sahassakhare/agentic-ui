# ADR-003: MFE registry source as a pluggable adapter

**Status**: Accepted (M3).

## Context

Different orgs deploy MFE registries differently. The user's `mfe-registry-platform` is a Spring Boot service exposing `GET /mfes?env=...` and an SSE `/mfes/watch`. Other orgs use Consul, etcd, a Backstage plugin, or a static JSON file in S3. Coupling the lib to one shape would force every consumer to build a translation layer.

## Decision

Define `MfeRegistrySource` as a pluggable interface and ship two reference adapters:

```ts
export interface MfeRegistrySource {
  readonly id: string;
  discover(env: string): Promise<readonly RemoteSpec[]>;
  watch?(env: string): Observable<readonly RemoteSpec[]>;  // optional live updates
}
```

- `provideStaticJsonMfeRegistry({url, refreshIntervalMs?})` — fetches a JSON document, polls if `refreshIntervalMs` is set.
- `provideSpringBootMfeRegistry({url, capabilityManifestResolver?})` — REST + SSE; accepts an override for deriving `capabilityManifestUrl` from records that don't carry it natively.

`MfeRegistryClient` injects whichever source is configured and is the only thing the rest of the lib talks to.

## Consequences

- Consumers without an existing MFE registry can ship a static `mfes.json` to S3 and be done.
- Consumers with `mfe-registry-platform` get a first-class adapter; if the schema lacks a `capabilityManifestUrl` field, `capabilityManifestResolver` derives one by convention without a server change.
- Adding Consul / etcd / a third-party adapter requires implementing one interface; the lib does not need to fork.

## Alternatives considered

- **Hardcode against `mfe-registry-platform`** — fast for one consumer, blocks OSS adoption.
- **Static JSON only** — simplest, but loses the SSE live-update path that production MFE platforms care about.
- **Consul / etcd as the canonical** — niche; doesn't match the user's existing investment.

## Open question

The Spring Boot adapter assumes one of `remoteName` or `mfeId` and one of `remoteEntry` or `remoteEntryUrl` on each record. Confirmed via the `capabilityManifestResolver` escape hatch, but at M3 kickoff a one-day spike validates the schema against the live service. See PLAN.md §11 R2 for the contingency.
