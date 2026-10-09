---
status: In progress
severity: High
type: Bug
component: [log-v3]
opened: "2026-10-05"
parent: 0158-implement-the-v3-log.md
---

# A crash inside a contiguous transition can leave a clean root in a scattered record

Recovery repairs the state; the refusal in `open` is not built yet.

## What is confirmed

- A contiguous transition writes the changed units and the header into one slot range.

## What was done <a id="done" class="decision"></a>

Recovery of a clean root makes the record contiguous. See
[§4.6](https://github.com/nosferatech/vampiredb/blob/main/docs/design/Minimal_Log.md#contiguous-at-rest).
