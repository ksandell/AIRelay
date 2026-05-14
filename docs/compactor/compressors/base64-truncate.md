# `base64-truncate`

**Purpose** — Replace long base64 blobs (data URIs, embedded images,
binary dumps) with a fixed-size summary including a content hash.

**Risky** — no.

**Toggle** — `COMPACTOR_BASE64_TRUNCATE_ENABLED` (default `true`).

## Trigger heuristic

Input length ≥ 256 AND contains `base64,` OR a bare base64 run ≥ 256
characters.

## Transform

Two regex passes:

1. **Data URIs**: `data:<mime>;base64,<payload>` where `<payload>` is at
   least 256 base64 chars → replaced entirely with the summary.
2. **Bare runs**: any continuous run of 256+ base64 characters
   (`[A-Za-z0-9+/]{256,}={0,2}`) → replaced with the summary.

Summary format: `<base64: N bytes, sha256:XXXXXXXXXXXX>` (12-char
sha256 prefix of the decoded bytes).

## Before / after

```
[BEFORE]
The icon is data:image/png;base64,iVBORw0KGgoAAAANSU... (4 KB)

[AFTER]
The icon is <base64: 3091 bytes, sha256:c3d4e5f6a7b8>
```

## Known limitations

- Minimum length of 256 chars — short base64 (small SVG-like blobs)
  passes through.
- Bare-run detection may match accidental long alphanumeric strings that
  aren't actually base64. Rare in practice; the sha256 in the summary
  is still derived from a `Buffer.from(..., 'base64')` decode and
  remains stable.

## Safety notes

Property tests assert never-grows and idempotence. The decoded byte count
and a content hash are preserved — enough for the model to recognize the
same blob in a later message without re-sending it. Loss of the actual
payload is intentional.
