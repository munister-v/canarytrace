# Changelog

## 0.1.0 — 2026-11-03

First public release.

- Canary oracle for projections (`fuzzProjection`) with positive controls and
  a comparison against an existing runtime guard.
- Canary oracle for analytics sinks (`createCaptureStore`, `fuzzSink`).
- Source-level mutation analysis with kills counted relative to the original.
- Closed-loop load emulation (`runLoad`).
- CLI: `canarytrace run` (exit 1 on any leak) and `canarytrace summary`.
- Examples: a gradebook, and the teaching-board sensing layer that reproduces
  the privacy results of Munister (2026).
