# ADR 0001: Forks share source sidecars

## Decision

Forked pi sessions retain the absolute sidecar paths already recorded in their copied transcript and do not copy payload files.

## Rationale

Sidecars are retained until the user deletes them. Sharing keeps forks small and works with the extension's normal recovery path: a reference tells the model to use pi's native `read` on that absolute path.

## Consequences

- A fork is not portable without its source session's `offloads/` directory.
- Deleting or moving source sidecars makes those references unreadable.
- During a later context projection, a missing sidecar leaves the hydrated result intact rather than producing a dangling reference.
- No fork copy, link management, cleanup, or relocation mechanism is introduced.
