# 0021 — Artifacts load whole and stay resident; region-chunking rejected

**Status:** accepted

## Context

Milestone 2 adds three detail levels of `versions.*.json` and two of
`land.*.json`, loaded progressively as the user zooms (see
docs/phase-2-milestone-2-design.md, "Prefetching"). `versions.2.json` (full
detail) is 73.5 MB uncompressed on the real pinned build. The instinct on
seeing a file that size is to chunk it by region, so only the area on screen
is ever fetched or parsed. This record says why that was measured and
rejected, not assumed unnecessary.

## Measurement: payload and heap

Taken against the full pinned build (13,380 versions), not the fixture, with
`node --expose-gc`:

| level | gzipped | raw | JSON.parse | heap resident |
|---|---|---|---|---|
| coarse (`versions.0`) | 2.89 MB | 33.9 MB | 77 ms | 120 MB |
| mid (`versions.1`) | 4.47 MB | 45.0 MB | 88 ms | 151 MB |
| full (`versions.2`) | 12.05 MB | 73.5 MB | 149 ms | 219 MB |

All three resident at once: **331 MB** heap. Transfer for all three, if a
visitor eventually fetches every level, is **19.4 MB gzipped**. These are two
different figures measuring two different things -- on-the-wire bytes
(gzipped) against in-memory cost (heap resident) -- and neither should be
read as standing in for the other; see the correction below for why this
distinction matters again at deploy time.

Parse time is not the bottleneck: 149 ms at worst is a visible hitch, not a
freeze. Transfer and heap are the real costs, and 331 MB resident is heavy but
inside a desktop tab's ordinary budget.

## Decision

Artifacts load whole, on demand, and stay resident once fetched. No chunking
by region, no eviction of a parsed artifact.

**Region-chunked delivery was rejected**, not deferred as an oversight. It
would be a real piece of pipeline work (deciding chunk boundaries that do not
split a polity's own geometry oddly, indexing which chunks a viewport needs)
and a real piece of viewer work (fetching and merging chunks, handling a
version whose geometry spans chunk boundaries, cache invalidation across
chunks) bought for a problem this measurement shows does not exist yet: 331 MB
resident, worst case, all three levels, every version ever visited, is well
inside what a desktop browser tab tolerates. Building the chunking machinery
now would be solving a memory problem this dataset does not have, in exchange
for a viewer that has to reconstruct "the whole world" out of pieces for a
milestone whose target is desktop, not a memory-constrained device.

**The measurement that would change the answer: an order-of-magnitude larger
dataset.** 331 MB at ~13,000 versions does not extrapolate safely to
~130,000: heap resident scales with vertex count, not row count, and denser
coverage (the stated long-term goal -- see docs/phase-1-importer.md, "Going
from a coarse global map to a high-resolution regional one") would plausibly
raise both the per-version vertex count and the version count together. When
that dataset exists, re-run the same `node --expose-gc` measurement against
it before assuming chunking is still unnecessary; this record does not claim
it stays unnecessary forever, only that it is not needed for the dataset this
milestone ships against.

## Correction: the deployed site's actual size, and Task 9's staging gap

`stage-data-lib.mjs` (`packages/viewer/scripts/stage-data-lib.mjs`) originally
staged a curated subset of four artifacts (`polities.json`, `versions.0.json`,
`land.0.json`, `manifest.json`) into `public-data/`, on the reasoning --
correct for Milestone 1, stale by the time Milestone 2 shipped -- that the
other four were bytes the viewer never requested. Task 9 found this had not
been updated: the deployed site was missing `changes.json` (a 404 at
startup, since `fetchArtifacts` fetches it unconditionally) and both
`versions.1.json` and `versions.2.json`, so the progressive-upgrade chain had
nothing to upgrade to -- the deployed map could never get past coarse detail,
silently, because the files it needed were never staged. All eight of the
pipeline's outputs are staged now.

That makes the deployed site's real on-disk size, measured directly
(`ls -la dist/` after `pnpm build` against the real pinned sources, summed):
**154 MB uncompressed** across all eight artifacts. The largest single file
is `versions.2.json` at **77.0 MB** (measured the same way), comfortably
under GitHub Pages' 100 MB per-file limit.

This is a different number from the 19.4 MB gzipped transfer figure in the
"Payload and heap" table above, and the two must not be conflated: 19.4 MB is
what a browser actually downloads over the wire (gzip compression applied by
the host), while 154 MB is what sits on disk, uncompressed, in the `dist/`
directory GitHub Pages serves from and what a service worker or a
no-compression host would need to hold. A future reader citing "the artifact
size" should say which of these two numbers, and this record exists partly
so that conflation does not happen by omission.

## Consequences

- No pipeline or viewer work is spent on region-chunking for this milestone.
- The 331 MB heap and 154 MB on-disk figures are both now load-bearing
  numbers this project should re-measure, not re-guess, if the dataset grows
  materially or a new artifact is added.
- Anyone re-reading the "chunk it, it's 73 MB" instinct should read this
  record's rejected-alternative section first, and re-take the measurement
  against whatever dataset prompted the instinct rather than assume the
  73 MB figure from Milestone 2 still applies.
