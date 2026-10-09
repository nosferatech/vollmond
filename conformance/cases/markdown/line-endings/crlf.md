---
status: Open
---

# Flusher stalls under load

Seen twice on the perf box.

## What is confirmed

```yaml data
runs: [R0007, R0009]
```

The flusher waits on a barrier that never completes.