# Network Watch: fresh project setup

This guide takes a new machine from an empty clone to a working Network Watch desktop app, Chrome extension, MCP server, and Copilot workflow.

Use a disposable or safe test website for recording and replay. Replay can click, type, navigate, and regenerate network requests in the active tab.

## 1. Prerequisites

Install the following first:

- Node.js 20 or newer (Node 22 was used during development).
- pnpm 10 or newer.
- Google Chrome, Microsoft Edge, Brave, or another Chromium-based browser.
- Optional: VS Code with GitHub Copilot enabled.
- Optional: GitHub Copilot CLI and a GitHub account with Copilot access.

Check Node.js and pnpm:

```bash
node --version
pnpm --version
```

If Node.js is missing, install the current LTS release from [nodejs.org](https://nodejs.org/).

If pnpm is missing, first try Corepack, which ships with supported Node.js distributions:

```bash
corepack enable
corepack prepare pnpm@latest --activate
pnpm --version
```

If Corepack is unavailable, follow the [pnpm installation guide](https://pnpm.io/installation). Open a new terminal after installation so `pnpm` is available on `PATH`.

## 2. Install project dependencies

Open a terminal in the cloned project folder:

```bash
cd "/path/to/network-watch"
pnpm install
```

`pnpm install` reads `package.json` and `pnpm-lock.yaml`, installs the exact locked dependency graph, and runs the project's `postinstall` step. That step downloads Electron's platform-specific binary.

Check that Electron is usable before proceeding:

```bash
pnpm exec electron --version
```

If Electron reports that it was not installed correctly, run the following from the repository root:

```bash
pnpm install
pnpm exec electron --version
```

Do not mix npm and pnpm in the same existing install. If you change package managers, remove the installation directory only after confirming that no needed local changes are inside it, then reinstall with one manager.

## 3. Start Network Watch

```bash
pnpm start
```

This command does two things:

1. Runs `pnpm run build:renderer`, which builds the React interface into `apps/desktop/dist/renderer`.
2. Runs Electron, which opens the Network Watch desktop app.

When the app opens, it also starts its private local extension/data bridge at:

```text
http://127.0.0.1:9231
```

Keep this app running while using the extension, recording/replaying, or using MCP. Port `9231` is an internal local bridge, not the public MCP endpoint.

## 4. Connect Network Watch to a browser

### Recommended: start a debug browser from the app

1. In Network Watch, click **Start Browser**.
2. Choose Chrome, Brave, or Edge.
3. Click **Scan**.
4. Choose the website tab in the **Tab** dropdown.
5. Click **Connect**.

Network Watch starts its own browser profile with remote debugging enabled and restricted to localhost. Navigate in the selected tab and confirm requests appear in the Network table.

### Alternative: start the browser yourself

Launch a browser with a debugging port, then scan/connect from Network Watch.

macOS Chrome:

```bash
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222
```

Linux Chrome or Brave:

```bash
google-chrome --remote-debugging-port=9222
brave-browser --remote-debugging-port=9222
```

Windows PowerShell:

```powershell
"C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222
```

Then set Host to `localhost`, Port to `9222`, click **Scan**, select the page, and click **Connect**.

## 5. Load the Website Analytics extension

If you used Network Watch's **Start Browser** button, the app opens `chrome://extensions` in its dedicated debug profile. Enable **Developer mode**, click **Load unpacked**, then use **Reveal extension** in Network Watch to locate the folder. This is required only once for that browser profile.

If you started or selected another browser profile, load the extension unpacked:

1. Use the same Chromium browser that Network Watch is connected to.
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Click **Load unpacked**.
5. Select this repository's `apps/extension` folder itself — the folder containing `manifest.json` — rather than the parent `apps` folder or the `manifest.json` file.
6. Pin **Website Analytics for Network Watch** for easier access.

**Start Browser** launches the selected browser without first checking whether the debugging port is occupied. If the browser cannot bind that port, select a free port or click **Scan** to connect to an existing debug browser.

After pulling project changes, return to `chrome://extensions` and click **Reload** on the extension card. This is important because the extension service worker creates the alarm used to claim MCP replay jobs.

A packaged Electron installer also contains `apps/extension` as an unpacked runtime resource and supplies it to the browser started by Network Watch. Store publication is needed only when users must install/update the extension independently in their normal browser profile. See [extension distribution](extension-distribution.md).

The extension works on normal `http` and `https` pages. Chrome internal pages and the Chrome Web Store cannot host its content script.

## 6. Verify the desktop + extension workflow

1. Keep Network Watch connected to the target tab.
2. Open the extension popup and confirm it says **Network Watch connected**.
3. Click **Record**.
4. Perform two or three harmless actions, for example opening a menu and searching a public test page.
5. Click **Stop recording**.
6. In Network Watch, select **Inspect**.
7. Confirm the `REC-*` recording and its `ACT-*` actions appear.

Optional responsive/visual check:

1. In the extension, click **Simulate**.
2. Click **Select elements**, select one or more page elements, then stop selecting.
3. At a breakpoint, click **Add breakpoint capture**.
4. Review the screenshot and element metadata in Network Watch's **Inspect** tab.

## 7. Use exports and generated prompts

### Network request export

1. Stay in **Network** mode.
2. Use the filters if you only want a subset of requests.
3. Click **Export**.
4. Choose either **Postman collection** or **Selected fields**.
5. If using selected fields, choose request/response/headers/payload/timing fields.
6. Confirm **Export** and choose a save location.

Postman exports are JSON. Selected-field exports are Markdown. The current Export UI does not expose HAR, even though the repository contains a HAR serializer utility.

### Inspect prompt export

1. In **Inspect**, add feedback to a screenshot, selected element, or recorded event.
2. Click the app toolbar's **Export** button.
3. Select breakpoint evidence and/or journey/replay evidence.
4. Optionally include meaningful request analysis.
5. Click **Export prompt** and select a save location.

### Generate a prompt for Copilot without immediately running it

1. Open **Setup Copilot** in Inspect.
2. Select the code directory when prompted.
3. Click **Generate Prompt**.
4. Choose the evidence in the modal.
5. Click **Add to Chat**.
6. Review or edit the complete prompt in the sidebar chat field.
7. Click **Send** when ready.

## 8. Set up MCP in VS Code

Network Watch must already be running because the MCP server calls the local bridge at `127.0.0.1:9231`.

This repository already includes `.vscode/mcp.json`. To use it from this repository:

1. Open the repository in VS Code.
2. Open the Command Palette.
3. Run **MCP: List Servers**.
4. Select `network-watch`, start it, and approve the trust prompt.
5. Open Copilot Chat in Agent mode.
6. Use the tools selector to confirm the six Network Watch tools are enabled.

Try this first prompt:

```text
List my Network Watch recordings and their IDs. Do not replay anything yet.
```

Then, with a safe test site open:

```text
Replay the newest Network Watch recording. Summarize whether action sequence and network requests matched the original recording.
```

VS Code starts the stdio MCP child process automatically. You do not normally run `pnpm run mcp:stdio` yourself. To inspect the server manually, run:

```bash
pnpm run mcp:stdio
```

Keep stdout reserved for MCP protocol messages; diagnostics appear on stderr.

### Use MCP from a different VS Code workspace

Open **MCP: Open User Configuration** in VS Code and add an absolute-path server definition:

```json
{
  "servers": {
    "network-watch": {
      "type": "stdio",
      "command": "node",
      "args": ["/absolute/path/to/network-watch/services/mcp/stdio.mjs"],
      "env": {
        "NETWORK_WATCH_URL": "http://127.0.0.1:9231"
      }
    }
  }
}
```

Replace `/absolute/path/to/network-watch` with the real project directory. This user-level configuration makes the server available to every VS Code workspace on the same machine.

See the official [VS Code MCP server guide](https://code.visualstudio.com/docs/agent-customization/mcp-servers).

## 9. Set up GitHub Copilot CLI and its MCP connection

### Install and authenticate Copilot CLI

Install Copilot CLI using the current [official GitHub instructions](https://docs.github.com/en/copilot/how-tos/copilot-cli/set-up-copilot-cli/install-copilot-cli), then verify it is available:

```bash
copilot --version
copilot login
```

Complete the browser/device login flow. Restart Network Watch after installing the CLI so its desktop process inherits the terminal's updated `PATH`.

### Use the checked-in MCP configuration

From this repository:

```bash
cd "/path/to/network-watch"
copilot
```

The checked-in `.mcp.json` starts `services/mcp/stdio.mjs`, which provides:

- `list_recordings`
- `get_recording`
- `replay_recording`
- `get_replay_result`
- `export_recording_analysis`
- `export_network_capture`

Inside Copilot CLI, enter:

```text
/mcp
```

Confirm that `network-watch` is listed, then use a prompt such as:

```text
List Network Watch recordings. Choose the newest REC-* recording, replay it, summarize the action and request comparison, then call export_recording_analysis in Markdown. Do not modify code.
```

The extension checks for queued MCP replay jobs on an alarm, so replay can take roughly 30 seconds to begin. Keep Network Watch, the extension, and the browser tab open until the response completes.

## 10. Connect Copilot from the Network Watch sidebar

This is separate from MCP. It lets the Electron app run Copilot CLI in a selected code directory and show its output in the Inspect sidebar.

1. Complete the Copilot CLI installation/login above.
2. Fully quit and restart Network Watch.
3. In **Inspect**, click **Setup Copilot**.
4. Click **Select working directory** and choose the project Copilot may edit.
5. Add Inspect feedback or record journeys so there is evidence to include.
6. Use **Generate Prompt** → **Add to Chat**, review the draft, then click **Send**.
7. Review the native permission warning before allowing Copilot to run.

The sidebar streams Copilot stdout and stderr. Its **Stop** button terminates the complete Copilot process tree. Follow-up messages use the latest session in the selected directory.

Copilot receives broad tool permissions for the bounded automated task, so use only a trusted repository and review its file changes before committing them.

## 11. Optional remote MCP endpoint

For local VS Code and Copilot use stdio. To test the HTTP MCP endpoint locally:

```bash
NETWORK_WATCH_MCP_TOKEN=replace-with-a-long-random-value pnpm run mcp:http
```

The endpoint listens at `http://127.0.0.1:9232/mcp`. Do not publish the desktop bridge on port `9231`. A remote client needs HTTPS, authentication, and an approved deployment or secure tunnel; ChatGPT cannot connect directly to a localhost MCP server.

## 12. Verify the install

Run the renderer build and MCP tests:

```bash
pnpm run build:renderer
pnpm run test:mcp
```

Expected result: the renderer build completes, and the MCP tests validate tool discovery, HTTP handshake, action ordering, replay comparisons, exports, and redaction.

## 13. Fast troubleshooting

| Symptom | What to check |
| --- | --- |
| `pnpm: command not found` | Install/enable pnpm, open a new terminal, then run `pnpm --version`. |
| Electron install error | Run `pnpm install` from the repository root, then verify `pnpm exec electron --version`. |
| Scan finds no browser | Use **Start Browser**, or launch Chromium with `--remote-debugging-port=9222`. |
| Extension says offline | Start/restart Network Watch and verify the desktop app is still open. |
| Screenshot button disabled | Start responsive simulation and ensure the extension bridge is connected. |
| MCP server cannot reach recordings | Keep Network Watch running, reload the extension, and start the MCP server from VS Code/Copilot. |
| MCP replay remains queued | Wait up to about 30 seconds, then ensure the extension has been loaded/reloaded and the safe target tab remains open. |
| Copilot sidebar says CLI missing | Run `copilot --version` in a fresh terminal, then fully restart Network Watch. |
| Copilot does not modify code | Confirm the selected directory is the intended repository and approve the native permission prompt. |

## 14. Important local ports

| Port | Purpose | Exposure rule |
| --- | --- | --- |
| `9222` by default | Chromium remote-debugging endpoint | Keep local and use only on trusted machines. |
| `9231` | Private Network Watch desktop/extension/MCP bridge | Never expose publicly. |
| `9232` by default | Optional Streamable HTTP MCP endpoint | Use only with a token, HTTPS, and appropriate deployment controls. |
