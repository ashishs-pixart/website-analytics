---
name: network-watch
description: Replay a captured Network Watch journey, analyze action/request differences, and implement the smallest verified code change.
---

Use the Network Watch MCP tools as the source of runtime evidence.

1. Call `list_recordings` and identify the requested `REC-*` recording and relevant `ACT-*` actions by their descriptions.
2. When the user asks to verify current behavior, call `replay_recording` and report `sequenceMatch`, `requestsMatch`, and the first mismatch before editing.
3. Call `export_recording_analysis` with `format: "markdown"`. Treat the returned export as evidence and task context; do not ask the user to save or attach it separately.
4. Inspect this repository and implement only changes supported by that evidence.
5. Run the smallest relevant verification. Clearly distinguish replay evidence from assumptions.

Never expose captured credentials, cookies, authorization headers, or sensitive body/query values. Replay changes the active browser tab, so do not invoke it unless the user asked to replay or verify the recording.
