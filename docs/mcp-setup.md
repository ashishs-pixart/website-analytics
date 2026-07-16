# Network Watch recordings as MCP tools

## Status and intent

This document records the implemented MCP architecture and the remaining rollout work. The local `stdio` server, Streamable HTTP entry point, recording/replay tools, deterministic comparison, direct export responses, VS Code configuration, and Copilot CLI workspace configuration are now implemented.

Starting the Electron desktop app starts the data bridge on port 9231, not an MCP transport. VS Code or Copilot CLI reads its workspace configuration and spawns `services/mcp/stdio.mjs`; `services/mcp/http.mjs` must be started separately when Streamable HTTP is wanted. Both MCP entry points are adapters over the running Electron bridge and do not contain the durable recording state themselves. See [`deployment-and-architecture.md`](deployment-and-architecture.md) for the full process and deployment model.

The goal is to let an LLM:

1. discover the number of saved recordings and their stable IDs;
2. see the ordered actions in each recording, with enough human-readable context to identify the action being discussed;
3. request a replay by recording ID; and
4. receive a deterministic summary stating whether every action ran in the recorded sequence and whether the replay produced the same network requests as the original recording.

The primary MCP workflow is deliberately simple:

```text
list_recordings
  → recording count, recording IDs, ordered action IDs and action descriptions

replay_recording(recordingId)
  → replay status, action-sequence comparison, request comparison and summary
```

Timing differences may be included as secondary evidence, but they are not the main success condition. The main success condition is behavioral equivalence: the action sequence completed and the expected requests were reproduced without missing, unexpected, reordered, failed, or status-changed requests.

The same tool implementation should work locally in VS Code and remotely in ChatGPT. The transports and authentication are different, but the tool contracts and replay engine must be shared.

## What exists now

Network Watch already has useful identity primitives:

- Original recordings use `REC-<uuid>` IDs.
- Original actions use `ACT-<uuid>` IDs.
- Replay sessions use `REPLAY-<uuid>` IDs.
- A replay action receives a new `ACT-<uuid>` ID and retains the original action in `sourceActionId`.

This is enough to define a baseline-to-replay mapping:

```text
REC-* recording
  ACT-* original event
       │
       └── sourceActionId
             ↓
REPLAY-* session
  ACT-* replayed event
```

The initial blockers have been addressed as follows:

1. Recordings and replay jobs are persisted in the Electron user-data directory.
2. The extension claims MCP replay jobs containing the selected recording and replays that `REC-*` ID.
3. The Electron main process mirrors CDP request events for baseline/replay evidence and MCP exports.
4. Request-to-event correlation remains an explicitly labelled timestamp-window inference rather than a causal claim.

Production remote rollout still requires an authenticated HTTPS deployment or approved secure tunnel, tenant isolation, and an OAuth policy appropriate to the target ChatGPT workspace.

## Target architecture

```text
VS Code chat                         ChatGPT web
    │ stdio                              │ HTTPS Streamable HTTP
    └──────────────┐         ┌───────────┘
                   ▼         ▼
              Network Watch MCP server
                tools + schemas + auth
                         │
                         ▼
              Recording/replay service
          durable recordings, runs, comparisons
                  │                 │
                  │ commands        │ evidence
                  ▼                 ▼
       Chrome extension worker   CDP capture
            replays actions      network requests
```

Use one MCP application layer with two entry points:

- `stdio` for a local VS Code configuration;
- Streamable HTTP at `/mcp` for ChatGPT and other remote clients.

The MCP specification defines `stdio` and Streamable HTTP as the standard transports. The TypeScript SDK recommends `stdio` for local process-spawned integrations and Streamable HTTP for remote servers. Do not build new work on the deprecated HTTP+SSE transport.

## Step 1 — freeze and validate the recording schema

Create a shared schema used by Electron, the extension, persistence, tests, and MCP output. Prefer Zod as the runtime schema because the MCP TypeScript SDK already uses it for tool validation.

Add an explicit `schemaVersion` and preserve IDs when reading and writing:

```ts
type Recording = {
  schemaVersion: 1;
  id: `REC-${string}` | `REPLAY-${string}`;
  kind: "recording" | "replay";
  sourceRecordingId?: `REC-${string}`;
  url: string;
  title: string;
  startedAt: string;
  stoppedAt: string;
  actions: RecordedAction[];
};

type RecordedAction = {
  id: `ACT-${string}`;
  sourceActionId?: `ACT-${string}`;
  type: "click" | "input" | "change" | "keypress" | "scroll";
  selector: string;
  timestamp: number;
  delayMs: number;
  replayStartedAt?: string;
  replayCompletedAt?: string;
  replayDurationMs?: number;
  replayStatus?: "succeeded" | "failed" | "skipped";
  replayError?: string;
  // Existing optional event fields remain here.
};
```

Validation rules:

- reject duplicate recording IDs;
- reject duplicate action IDs within a recording;
- require every replay `sourceRecordingId` to point to an original recording;
- require every replay action `sourceActionId` to point to exactly one action in that original recording;
- do not silently generate replacement IDs while reading stored data;
- retain older records through a small versioned migration function.

Acceptance criteria:

- A recording round-trips through JSON without an ID changing.
- A replay action can always be joined to its baseline action by `sourceActionId`.
- Invalid or unsupported records produce a typed error rather than entering the store.

## Step 2 — add durable recordings and evidence storage

Move recordings out of `extensionState` memory into a repository owned by Network Watch. Start with a local SQLite database because replay comparisons need indexed joins and atomic run updates. A JSON-file adapter is acceptable for an initial prototype, but it must use atomic replace-on-write and is not the preferred production store.

Suggested entities:

- `recordings`: identity, kind, source recording, page metadata, start/stop timestamps, schema version;
- `recording_events`: stable event identity, source event identity, sequence, selector, input metadata, baseline delay and replay measurements;
- `replay_runs`: run ID, source recording ID, status, requested/started/completed times, error and options;
- `network_requests`: request identity, replay run ID, inferred event ID, start/end/duration, URL, method, status, byte counts and failure data;
- `event_comparisons`: baseline/replay event IDs, timing deltas, request deltas and classification.

Store sensitive request/response headers and bodies only when explicitly enabled. Redact at minimum `authorization`, `cookie`, `set-cookie`, API-key-like headers, password fields, and configured query parameters before MCP output.

Do not return full recordings from a list operation. Use summaries for discovery and a separate detail operation so tool results remain bounded.

Acceptance criteria:

- Recordings survive Electron and extension restarts.
- The original recording is immutable after it becomes a replay baseline.
- Clearing UI state does not accidentally delete baselines unless the user explicitly requests permanent deletion.

## Step 3 — make replay addressable by recording ID

The MCP server cannot call a Chrome extension service worker directly. Add a localhost command queue to the existing bridge:

- `POST /api/replay-jobs` creates a queued replay for a `recordingId` and returns a `runId`.
- `GET /api/replay-jobs/next` lets the extension claim the next job.
- `POST /api/replay-jobs/:runId/events` records per-event progress.
- `POST /api/replay-jobs/:runId/complete` stores the final success or failure.
- `GET /api/replay-jobs/:runId` returns current status.

The extension should poll only while Network Watch reports that MCP replay is enabled, or use a long-poll with a bounded timeout. A job claim needs a lease so a suspended Manifest V3 worker cannot leave a job permanently stuck in `running`.

Refactor `replayActions()` to accept a validated recording object instead of reading only `runtimeState.actions`. For every event:

1. retain the baseline ID as `sourceActionId`;
2. assign a fresh replay event ID;
3. record actual start, completion, status, duration, and readable failure;
4. emit progress to the bridge; and
5. continue or stop according to an explicit `stopOnFailure` option.

The browser tab and origin are side effects. The replay tool must describe them clearly, and clients may ask the user to confirm the invocation.

Acceptance criteria:

- A replay requested with `REC-*` replays that recording, not whichever actions happen to be cached in the extension.
- A missing extension, missing tab, navigation timeout, or missing selector terminates with a stable error code.
- Repeating the same MCP request does not accidentally create duplicate runs: accept an optional `idempotencyKey`.

## Step 4 — prove action-sequence and request equivalence

### Action-sequence comparison

Every recording must expose actions in a stable `sequence` starting at 1. The LLM-visible action descriptor must contain:

- stable action `id`;
- `sequence` position;
- action `type`;
- a generated human-readable `description`, such as `Click “Add to cart”` or `Press Enter in #search`;
- page URL and selector;
- safe input metadata such as a key or redacted value summary; and
- original `delayMs` as context.

Do not make the model infer what `ACT-*` means from an ID alone. Generate `description` deterministically from captured event fields and keep the raw structured fields beside it.

During replay, match each replay event to the baseline using `sourceActionId`. The sequence is equivalent only when:

1. the number of replay actions equals the number of baseline actions;
2. every baseline action has exactly one replay action;
3. replay actions appear in the same source-action order; and
4. every action has `replayStatus: "succeeded"`.

Return `firstMismatch` with the sequence number, expected action ID, actual action ID if any, and error. Never reduce partial execution to a generic `false` without explaining where it diverged.

### Network-request comparison

Capture baseline requests for the original recording and replay requests for the replay run. For each event, open its evidence window immediately before dispatch and close it immediately before the next event. Tag requests with `recordingId` or `runId` and the current event ID inside Network Watch's capture service.

Request-to-event association remains temporal attribution, so expose `correlation: "time-window"`; do not claim causal attribution.

Normalize each request into this comparison fingerprint:

```text
method + origin + normalized pathname + normalized query + resource type
```

Normalization must remove fragments, sort query parameters, ignore configured volatile keys/values such as timestamps and cache busters, redact credentials, preserve repeated occurrences, and retain request order within each action window.

By default, a request is the same when its normalized fingerprint and occurrence position match. Compare HTTP status separately so the output distinguishes `same request, different response status` from a missing request. Response-body equality is optional and should use a redacted content hash when captured; it is not required for the initial equivalence result.

Report every comparison category:

- `matched`: expected request appeared in the same action window and order;
- `missing`: baseline request did not appear during replay;
- `unexpected`: replay produced a request absent from the baseline;
- `statusChanged`: fingerprint matched but status differed;
- `reordered`: the same requests appeared in a different order;
- `ambiguous`: repeated or overlapping requests could not be paired confidently.

The summary must include baseline, replay, matched, missing, unexpected, reordered, status-changed, and ambiguous counts. `requestsMatch` is true only when there are no missing, unexpected, reordered, status-changed, or ambiguous requests.

### Optional timing evidence

Keep timing subordinate to equivalence. For matched requests, the result may include baseline/replay duration and delta. A slower request is reported as a timing regression but does not make `requestsMatch` false by itself.

## Step 5 — expose the model-facing MCP tools

Every tool should define `inputSchema` and `outputSchema`, return `structuredContent`, and also include a compact JSON text content block for compatibility. MCP annotations are hints, not a security boundary.

### Tool 1: `list_recordings`

This read-only tool returns the total number of recordings, their IDs, and the ordered actions that let the LLM understand what each ID represents.

Input:

```json
{
  "limit": 20,
  "cursor": null
}
```

Output:

```json
{
  "recordingCount": 2,
  "recordings": [
    {
      "id": "REC-checkout",
      "title": "Checkout",
      "url": "https://example.test/cart",
      "eventCount": 2,
      "startedAt": "...",
      "actions": [
        {
          "id": "ACT-add-to-cart",
          "sequence": 1,
          "type": "click",
          "description": "Click “Add to cart”",
          "pageUrl": "https://example.test/products/1",
          "selector": "button[data-testid=add-to-cart]",
          "delayMs": 850
        },
        {
          "id": "ACT-open-cart",
          "sequence": 2,
          "type": "click",
          "description": "Click “Cart”",
          "pageUrl": "https://example.test/products/1",
          "selector": "a[href=/cart]",
          "delayMs": 1200
        }
      ]
    }
  ],
  "nextCursor": null
}
```

`recordingCount` is the total before pagination, not merely the number on the current page. If a recording is too large, return `actionsTruncated: true` and expose the same action shape through an optional `get_recording` support tool.

### Tool 2: `replay_recording`

This side-effecting tool replays the selected recording and, when it completes, returns the action-sequence and request comparison in the same result.

Input:

```json
{
  "recordingId": "REC-...",
  "stopOnFailure": true,
  "waitForCompletion": true,
  "timeoutMs": 120000,
  "idempotencyKey": "caller-generated-key"
}
```

Completed output:

```json
{
  "runId": "REPLAY-...",
  "recordingId": "REC-...",
  "status": "completed",
  "summary": {
    "message": "All 8 actions replayed in order. 12 of 12 expected requests matched; no missing or unexpected requests.",
    "equivalent": true,
    "sequenceMatch": true,
    "requestsMatch": true,
    "eventsTotal": 8,
    "eventsSucceeded": 8,
    "eventsFailed": 0,
    "baselineRequestCount": 12,
    "replayRequestCount": 12,
    "matchedRequestCount": 12,
    "missingRequestCount": 0,
    "unexpectedRequestCount": 0,
    "reorderedRequestCount": 0,
    "statusChangedRequestCount": 0,
    "ambiguousRequestCount": 0,
    "timingRegressionCount": 1
  },
  "events": [
    {
      "sourceEventId": "ACT-add-to-cart",
      "replayEventId": "ACT-replay-add-to-cart",
      "sequence": 1,
      "description": "Click “Add to cart”",
      "success": true,
      "replayStatus": "succeeded",
      "requests": {
        "match": true,
        "matched": [
          {
            "fingerprint": "POST example.test/api/cart Fetch",
            "baselineStatus": 200,
            "replayStatus": 200,
            "responseSame": true,
            "responseComparisonBasis": "body-hash",
            "responseMessage": "Same response received.",
            "baselineDurationMs": 420,
            "replayDurationMs": 810,
            "deltaMs": 390,
            "timingComparison": "slower"
          }
        ],
        "missing": [],
        "unexpected": [],
        "reordered": [],
        "statusChanged": [],
        "ambiguous": []
      }
    }
  ],
  "firstMismatch": null
}
```

The text report and `message` must be generated deterministically from stored comparison data; no model is used. Response bodies are represented by SHA-256 hashes and are never placed in the replay result. If both hashes are available, `responseSame` means the status/error outcome and exact response body match. Otherwise `responseComparisonBasis` is `status-and-error`. Overall equivalence is:

```text
equivalent = sequenceMatch && requestsMatch
```

If replay exceeds the tool timeout, return `runId` with `status: "queued" | "running"`. An internal/read-only `get_replay_result` support tool may return the same final shape later. A normal completed replay must not require a separate comparison call.

## Step 6 — implement the MCP server package

The implemented service is:

```text
services/mcp/
  server.mjs                shared tool registration and Zod schemas
  stdio.mjs                 local stdio entry point
  http.mjs                  Streamable HTTP entry point
packages/bridge-client/
  network-watch-client.mjs  local Electron bridge client
test/
  mcp-server.test.mjs       stdio/tool contract test
  mcp-http.test.mjs         Streamable HTTP integration test
```

Add `@modelcontextprotocol/sdk` and `zod`. Keep all stdout output clean in `stdio` mode because stdout is the JSON-RPC channel; diagnostics must go to stderr.

The local MCP process can talk to the Network Watch service on `127.0.0.1`, but it should authenticate with a random per-install token stored outside source control. Do not weaken the existing extension-origin check to make MCP work. Give the extension bridge and MCP service distinct authenticated routes or listeners.

The root scripts are:

```json
{
  "mcp:stdio": "node services/mcp/stdio.mjs",
  "mcp:http": "node services/mcp/http.mjs",
  "test:mcp": "node --test test/*.test.js test/*.test.mjs"
}
```

Pin and review dependency versions during implementation rather than copying a version from this planning document.

## Step 7 — connect the local server to VS Code

VS Code supports workspace configuration in `.vscode/mcp.json` and user-profile configuration through **MCP: Open User Configuration**. Use workspace configuration only if the team should share the server declaration. Do not commit secrets.

After the MCP server is built, add:

```json
{
  "servers": {
    "network-watch": {
      "type": "stdio",
      "command": "node",
      "args": ["${workspaceFolder}/services/mcp/stdio.mjs"],
      "env": {
        "NETWORK_WATCH_URL": "http://127.0.0.1:9232",
        "NETWORK_WATCH_TOKEN": "${input:networkWatchToken}"
      }
    }
  },
  "inputs": [
    {
      "id": "networkWatchToken",
      "type": "promptString",
      "description": "Network Watch MCP token",
      "password": true
    }
  ]
}
```

Then:

1. build and start Network Watch;
2. run **MCP: List Servers** and start `network-watch`;
3. review and accept the trust prompt;
4. inspect server output if startup fails;
5. verify `list_recordings` first;
6. invoke `replay_recording` only with a disposable test site and visible browser tab.

VS Code can also configure an HTTP server with `"type": "http"` and a URL, but local `stdio` is simpler for development because VS Code owns the MCP child-process lifecycle.

## Step 8 — connect the remote server to ChatGPT

ChatGPT does not connect directly to a localhost MCP endpoint. Deploy the Streamable HTTP endpoint on HTTPS, or use OpenAI's Secure MCP Tunnel for a private/on-premises/developer-machine server. Treat the tunnel as the preferred development bridge; do not expose port `9231` or the Electron bridge publicly.

Current ChatGPT setup path:

1. confirm the workspace plan and permissions support custom MCP apps/developer mode;
2. have the workspace admin enable developer mode;
3. expose the authenticated `/mcp` Streamable HTTP endpoint through the approved remote deployment or Secure MCP Tunnel;
4. go to ChatGPT **Settings → Apps → Create** (or the corresponding Workspace Settings path);
5. enter the MCP endpoint and authentication metadata;
6. choose **Scan Tools**, complete OAuth if used, and review the discovered schemas;
7. create the draft app and test it in a new chat;
8. publish only after replay side effects, redaction, tenant isolation, and audit logs have been reviewed.

Availability and admin paths can change during the beta. As of the research date below, full MCP support is documented for ChatGPT Business and Enterprise/Edu on the web, while Pro has more limited custom-app behavior. Verify the live workspace UI before rollout.

For a personal prototype, a bearer token can protect a single-user tunnel. For a shared or published app, implement OAuth and bind every recording/run query to the authenticated user or workspace. Never rely on an LLM-supplied `userId` for authorization.

## Step 9 — security controls before enabling replay

Replay is a browser-changing action and captured content is untrusted. Implement these controls before remote use:

- allowlist origins that may be replayed;
- block `file:`, browser-internal, extension, and privileged URLs;
- require explicit confirmation for replay in clients that support it;
- mark read tools as read-only and replay as side-effecting in tool metadata;
- never replay password or file-upload values;
- redact secrets before persistence and again before MCP serialization;
- cap recordings, events, tool result size, replay duration, redirects, and concurrent jobs;
- log requester, recording ID, run ID, timestamps, status, and policy decision without secret values;
- prevent arbitrary URL, shell command, selector script, or JavaScript input from reaching the replay engine;
- treat page text, HTML, response bodies, and recording labels as untrusted data, never as MCP/server instructions;
- keep the existing extension-only bridge private and introduce authenticated MCP-facing access rather than publishing it.

## Step 10 — tests and staged rollout

### Stage A: pure contract tests

- recording schema versions and migrations;
- duplicate/missing ID rejection;
- baseline-to-replay action joins;
- deterministic human-readable action descriptions;
- exact action count/order comparison and first-mismatch reporting;
- request fingerprint normalization;
- repeated, missing, unexpected, reordered, status-changed, and ambiguous request classification;
- deterministic summary generation from structured results;
- output schema validation and result-size limits.

### Stage B: local integration tests

- seed two recordings and verify `recordingCount`, IDs, action IDs, descriptions, sequence, and pagination;
- replay a deterministic local fixture site;
- assert full sequence/request equivalence for an unchanged replay;
- assert the first failed or reordered action is identified;
- assert missing, unexpected, reordered, and status-changed requests produce a non-equivalent summary;
- assert that a deliberately slow but otherwise matching endpoint remains equivalent and is reported separately as a timing regression;
- restart Electron and verify recordings/runs persist;
- verify cancellation, timeout, idempotency, and expired job leases.

### Stage C: MCP client tests

- run the MCP Inspector against `stdio`;
- test VS Code discovery and every tool;
- run the same contract suite against Streamable HTTP;
- verify structured output conforms to `outputSchema`;
- verify errors use stable codes and do not leak stacks, headers, bodies, or tokens.

### Stage D: ChatGPT draft app

- connect only through the private tunnel or a staging HTTPS deployment;
- use synthetic recordings with no customer data;
- verify tool discovery after schema changes (refresh/rescan tools);
- check that replay requires the expected user confirmation;
- test account/workspace isolation before publishing.

## Recommended implementation order

1. Shared schemas and migrations.
2. Durable recording/run/evidence repository.
3. Addressable replay jobs and extension polling.
4. Stable action sequence plus tagged baseline/replay network capture.
5. Deterministic action and request equivalence service.
6. `list_recordings` with recording count, IDs, and ordered action descriptors.
7. Local VS Code `stdio` integration.
8. `replay_recording` with the completed comparison result after security and idempotency tests.
9. Authenticated Streamable HTTP endpoint.
10. ChatGPT draft app through Secure MCP Tunnel, then reviewed deployment.

This order intentionally proves the evidence model locally before giving a remote model permission to operate a browser.

## Definition of done

- An LLM receives the total recording count, stable recording IDs, and ordered action IDs/descriptions without unbounded body data.
- It can refer to a specific action unambiguously and select a stable `REC-*` ID for replay.
- The returned `runId` can be polled safely after timeout or client disconnect.
- Every replay event maps to its original stable event ID.
- Action count, order, success, partial success, failure, and timeout are distinguishable, with the first mismatch identified.
- The replay result compares baseline and replay request counts and classifies matched, missing, unexpected, reordered, status-changed, and ambiguous requests.
- The deterministic summary states whether the action sequence matched, whether requests matched, and whether the replay was equivalent overall.
- Timing differences are secondary evidence and do not silently alter behavioral equivalence.
- The same fixture produces equivalent structured results through VS Code and ChatGPT transports.
- Recordings survive restarts and are isolated by authenticated user/workspace.
- No bridge, token, credential, cookie, authorization header, or unredacted sensitive body is exposed to an MCP client.

## Research sources

Research checked on 2026-07-16:

- [VS Code: Add and manage MCP servers](https://code.visualstudio.com/docs/agent-customization/mcp-servers) — `.vscode/mcp.json`, local/remote server configuration, trust, management, and logs.
- [VS Code: MCP configuration reference](https://code.visualstudio.com/docs/agents/reference/mcp-configuration) — `servers`, `inputs`, and configuration structure.
- [OpenAI: Developer mode and MCP apps in ChatGPT](https://help.openai.com/en/articles/12584461-developer-mode-apps-and-full-mcp-connectors-in-chatgpt-beta) — current availability, app creation, tool scanning, remote-server requirement, Secure MCP Tunnel, and publishing controls.
- [OpenAI: Apps in ChatGPT](https://help.openai.com/en/articles/11487775-connectors-in-chatgpt/) — custom MCP apps and workspace deployment context.
- [MCP specification: Tools](https://modelcontextprotocol.io/specification/2025-06-18/server/tools) — input/output schemas, structured results, content compatibility, and annotations.
- [MCP specification: Transports](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports) — `stdio` and Streamable HTTP.
- [MCP TypeScript SDK: Server](https://ts.sdk.modelcontextprotocol.io/server) — server construction, transport selection, resources, and localhost DNS-rebinding guidance.
