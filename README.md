# Network Inspector

A production-ready Electron desktop app for inspecting browser network traffic through the Chrome DevTools Protocol.

## Features

- Attach to Chrome, Edge, Brave, or another Chromium browser launched with remote debugging.
- Live request table with method, status, type, URL, size, and duration.
- Filter by URL/method/status, resource type, and errors only.
- Inspect request headers, response headers, request body, response body, timing, raw event data, and WebSocket frames.
- Export the currently filtered traffic as an importable Postman JSON collection or a readable Markdown (`.md`) file with selected request, response, header, payload, and timing fields.
- Use the companion Chrome extension to record/replay journeys and regenerate their network traffic.
- Simulate eleven fitted desktop, tablet, and mobile breakpoints, capture visible-viewport screenshots with selected-element HTML/CSS metadata, correlate requests to recorded actions, and export an LLM-ready improvement prompt.
- Expose recordings, deterministic replay comparisons, and recording/network exports through MCP for VS Code, GitHub Copilot CLI, and remote Streamable HTTP clients.
- Secure Electron setup with `contextIsolation: true` and no renderer Node integration.

## Prerequisites

Install these before the first test:

- **Node.js 20 or later** and `pnpm` (the project was tested with Node 22 and pnpm 10).
- A Chromium browser: Chrome, Edge, or Brave.
- **Optional:** VS Code with MCP support, or [GitHub Copilot CLI](https://docs.github.com/en/copilot/how-tos/copilot-cli/set-up-copilot-cli/install-copilot-cli) for the agent workflow.

Use a normal development profile or a dedicated test browser profile. Do not test on a website where replaying clicks, form input, or purchases would have real consequences.

## First-time setup and end-to-end test

### 1. Install and start Network Watch

From this repository:

```bash
pnpm install
pnpm start
```

This builds the React interface and opens the Network Watch desktop app. It also starts the private extension/data bridge on `127.0.0.1:9231`. Port 9231 is not an MCP transport; VS Code or Copilot CLI separately starts the stdio MCP adapter configured in this repository.

You can use `npm install` and `npm start` instead if you prefer npm, but use one package manager consistently for the workspace.

### 2. Start a browser that Network Watch can capture

The simplest option is to click **Start browser** in Network Watch, choose Chrome, Edge, or Brave, then click **Scan**.

Alternatively, start Chrome/Edge/Brave yourself with remote debugging:

#### Launch a browser with remote debugging

Chrome / Brave on Linux:

```bash
google-chrome --remote-debugging-port=9222
brave-browser --remote-debugging-port=9222
```

Edge:

```bash
msedge --remote-debugging-port=9222
```

Windows Chrome:

```powershell
"C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222
```

macOS Chrome:

```bash
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222
```

Then open a normal `http` or `https` page. In Network Watch:

1. Click **Scan**.
2. Select the website tab.
3. Click **Connect**.
4. Browse once and confirm that requests appear in the Network table.

The desktop app must remain running and connected while you record/replay if you want request comparison and MCP exports.

### 3. Load the Website Analytics extension

The unpacked extension is in [`website-analytics-extension`](website-analytics-extension).

1. In the same Chromium browser, open `chrome://extensions`.
2. Turn on **Developer mode**.
3. Click **Load unpacked**.
4. Select the `website-analytics-extension` folder in this repository.
5. Pin the extension if you want quick access to its popup.

After pulling changes to this project, click **Reload** on the extension card. The current version requires the `alarms` permission so it can claim MCP-triggered replay jobs.

### 4. Record a small safe journey

1. Return to the tab connected in Network Watch.
2. Open the Website Analytics extension popup.
3. Click **Record**.
4. Perform two or three safe actions, such as opening a navigation menu, entering a search term, and submitting the search.
5. Click **Stop recording**.

The extension stores the journey with a `REC-*` ID and each action with an `ACT-*` ID. Network Watch persists the recording plus the requests captured during each action window. In **Inspect** mode you can see the recorded actions and replay sessions.

For a manual extension-only check, select the recording in the popup and click **Replay**. The active tab will be refreshed or navigated as needed, then the recorded actions will run again.

### 5. Verify the local MCP server

The MCP stdio adapter is launched automatically by VS Code or Copilot CLI from the repository configuration; you normally do not start it in a separate terminal. The Network Watch desktop app must already be running because the adapter calls its bridge. To inspect the adapter manually:

```bash
pnpm run mcp:stdio
```

It writes diagnostics to stderr and reserves stdout for MCP protocol messages. Stop it with `Ctrl+C`.

Run the automated contract checks with:

```bash
pnpm run test:mcp
```

They verify MCP tool discovery, the Streamable HTTP handshake, action ordering, request comparison, export generation, and secret redaction.

### 6. Test with VS Code

The repository includes [`.vscode/mcp.json`](.vscode/mcp.json).

1. Open this repository in VS Code.
2. Open the Command Palette and choose **MCP: List Servers**.
3. Start `network-watch` and approve the trust prompt.
4. In Copilot Chat/Agent mode, ask: `List Network Watch recordings.`
5. Select a `REC-*` ID from the result, then ask Copilot to replay it and inspect the export.

### 7. Test with GitHub Copilot CLI

Install Copilot CLI first if the `copilot` command is unavailable. Authenticate your **GitHub/Copilot account** from this repository:

```bash
copilot login
copilot
```

Follow the browser/device-login prompts, then choose to trust this repository when Copilot asks. The login authenticates the Copilot CLI service; it does **not** send Network Watch data to GitHub by itself. The Network Watch MCP server remains a local child process communicating with `127.0.0.1:9231`.

Inside Copilot CLI:

1. Enter `/mcp` and confirm that `network-watch` is listed with six tools.
2. Ask Copilot to list recordings.
3. Ask it to replay one `REC-*` recording.
4. Ask it to call the export tool and use that returned evidence to work on the code.

Use this prompt verbatim for the first test:

```text
List my Network Watch recordings. Choose the most recent REC-* recording, replay it, summarize sequenceMatch and requestsMatch, then call export_recording_analysis in Markdown and explain the result without changing code.
```

MCP replay jobs are claimed by the extension on its local alarm cycle, which can take up to about 30 seconds. `replay_recording` waits for completion by default; do not close Network Watch, the extension, or the active website tab while it is running.

#### Run Copilot from the Inspect sidebar

1. Install GitHub Copilot CLI, run `copilot login`, and restart Network Watch so the desktop app can find the `copilot` command on `PATH`.
2. In **Inspect**, click **Setup Copilot**. A sidebar opens on the right.
3. Click **Select working directory** and choose the directory containing the code that Copilot may edit.
4. Capture breakpoints or journeys and add visual change notes where appropriate.
5. Click **Generate Prompt**, choose the breakpoint and event evidence in the familiar export modal, then click **Add to Chat**. Review or edit the generated prompt in the sidebar chat box before pressing **Send**. Use **Run all evidence** when no review is needed.
6. Review the native permission warning and confirm. Network Watch starts Copilot CLI in that directory and streams its live output into the sidebar.
7. After a run finishes, use the chat box at the bottom for follow-up instructions. Follow-ups continue the latest Copilot CLI session in the selected repository.

The selected directory and terminal output remain available if you close and reopen the sidebar during the same Network Watch session. The task uses bounded autopilot with a maximum of 10 continuations. It grants Copilot permission to edit files and run commands, so select only a trusted repository and review the resulting changes. **Stop** terminates the running CLI process.

If Network Watch says the CLI is missing, verify `copilot --version` works in a new terminal, then fully quit and restart Network Watch. GUI applications inherit their `PATH` when they launch.

### 8. Let Copilot work from the export

After the first verification succeeds, use a task prompt such as:

```text
Replay REC-.... If the sequence or requests do not match, call export_recording_analysis and use the returned export as evidence. Find the smallest supported code fix, implement it, and run the relevant test.
```

The export is a direct MCP tool response. Copilot receives it in its context automatically; you do not need to save, copy, or attach an export file. The optional `network-watch` custom agent in [`.github/agents/network-watch.agent.md`](.github/agents/network-watch.agent.md) follows the same workflow.

### 9. Optional remote MCP/ChatGPT test

For local VS Code and Copilot CLI testing, use `stdio` only. For a remote MCP client, start the HTTP endpoint with a long random token:

```bash
NETWORK_WATCH_MCP_TOKEN=replace-with-a-long-random-token pnpm run mcp:http
```

It listens at `http://127.0.0.1:9232/mcp`. Keep it localhost-only for development. ChatGPT cannot connect directly to localhost; use an approved HTTPS deployment or secure tunnel and authentication. Never expose the extension bridge at `127.0.0.1:9231` publicly.

## Website Analytics extension

For responsive simulation, element selection, screenshots, and detailed extension behavior, see [`website-analytics-extension/README.md`](website-analytics-extension/README.md).

See [`PRODUCT_SPEC.md`](PRODUCT_SPEC.md) for architecture, phased implementation steps, security constraints, acceptance criteria, and known limitations.

## MCP tools reference

Start Network Watch and keep it connected to the Chrome tab whose traffic should be captured. Reload the unpacked extension after pulling changes so its MCP replay alarm is registered.

The local MCP server exposes:

- `list_recordings`: total count, `REC-*` IDs, and ordered `ACT-*` descriptions.
- `get_recording`: complete recording and baseline request evidence.
- `replay_recording`: replays a recording in the active Chrome tab and compares action order and requests.
- `get_replay_result`: retrieves a queued or completed `REPLAY-*` result.
- `export_recording_analysis`: returns the recording/replay export directly as Markdown or JSON model context.
- `export_network_capture`: returns the current captured request export directly as Markdown or JSON.

Copilot CLI reads the checked-in [`.mcp.json`](.mcp.json); VS Code reads [`.vscode/mcp.json`](.vscode/mcp.json). Do not put tokens, cookies, or API keys in either file.

See [`mcp-setup.md`](mcp-setup.md) for contracts, comparison semantics, security controls, and current setup references.

See [`docs/deployment-and-architecture.md`](docs/deployment-and-architecture.md) for Docker Compose, GitHub Actions, the exact MCP/Copilot process chain, and the recommended multi-application directory split.

## Notes

- Response bodies are loaded on demand. Some bodies may not be available after cache/service-worker redirects or if the browser has discarded them.
- The extension bridge listens only on `127.0.0.1`. Recordings and replay results are persisted in Network Watch's Electron user-data directory; screenshots remain session data.
- Chrome extensions cannot force-open the native DevTools Elements panel. The extension provides an in-page element picker and captures equivalent selector, HTML, stylesheet-rule, and computed-style metadata.
- For security, expose remote debugging only on trusted local machines.
- Firefox CDP support is limited compared with Chromium. Chromium browsers are recommended.

## Project layout

```text
src/main.js       Electron main process and CDP bridge
src/preload.js    Safe IPC API exposed to the renderer
src/network-watch-store.js Durable recording, request evidence, replay, comparison, and export service
src/renderer      React + TypeScript renderer app
mcp               MCP server, stdio entry point, and Streamable HTTP entry point
docs              Deployment and architecture guidance
src/style.css     Shared dark developer-tool UI styles
dist/renderer     Generated renderer build loaded by Electron
```
