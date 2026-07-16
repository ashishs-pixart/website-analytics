# Deployment, MCP, Copilot CLI, and repository boundaries

## What starts what

Network Watch has four processes with different jobs. They are connected, but they are not interchangeable.

| Process | How it starts | What it provides |
| --- | --- | --- |
| Electron desktop app | `pnpm start` or the packaged application | UI, CDP capture, durable recording store, and the private data/extension bridge at `127.0.0.1:9231` |
| Chrome extension | Loaded by Chromium | Recording, replay, responsive capture, and polling for queued MCP replay jobs |
| MCP stdio adapter | Spawned by VS Code or Copilot CLI from an MCP configuration | Six model-facing tools; it calls the Electron bridge |
| MCP HTTP adapter | `pnpm run mcp:http` or the Compose `mcp` profile | The same six tools at `/mcp` for an HTTP-capable MCP client |

Starting Electron makes the data source available. It does **not** register MCP tools with every model client. An MCP client still needs a server declaration telling it what process to spawn or which HTTP URL to connect to.

For local stdio, the chain is:

```text
Copilot CLI or VS Code
  → reads .mcp.json or .vscode/mcp.json
  → starts node mcp/stdio.mjs
  → MCP tool call
  → NetworkWatchClient HTTP call to 127.0.0.1:9231
  → durable store / replay queue in Electron
  → extension claims replay job and controls the active browser tab
```

The stdio MCP process is intentionally disposable. The client starts it for the session, communicates through stdin/stdout, and stops it later. Persistent state belongs to Network Watch, not to the stdio process.

For Streamable HTTP, `mcp/http.mjs` is a separately started transport on port 9232. It still needs the Electron bridge on port 9231. Exposing port 9232 without running Network Watch produces discoverable tools that fail when called because their data source is absent.

## GitHub Copilot CLI: two integrations, not one

Network Watch supports two distinct Copilot CLI paths.

### Direct Inspect-sidebar execution

The desktop app generates a Markdown evidence prompt, asks for a code directory, and spawns:

```text
copilot --autopilot --allow-all --max-autopilot-continues 10 --no-color -p <prompt>
```

This path does not require MCP. Network Watch has already inserted the chosen screenshot, event, replay, and request evidence into the prompt. It is a direct child-process integration with broad file and command permissions, guarded by a native confirmation dialog.

### Copilot CLI using Network Watch MCP tools

When Copilot starts in this repository, it discovers [`.mcp.json`](../.mcp.json), starts `mcp/stdio.mjs`, and can call tools such as `list_recordings` and `replay_recording`. Workspace MCP files are discovered from the CLI working directory up to the Git root, so selecting an unrelated repository in the Inspect sidebar does not automatically carry this repository's `.mcp.json` into that project.

For another repository:

- add a workspace `.mcp.json` there whose command and arguments use absolute paths to this checkout;
- add the server to Copilot's user configuration with `copilot mcp add`; or
- connect Copilot to the optional HTTP MCP endpoint.

Official Copilot CLI supports [local stdio and Streamable HTTP MCP servers](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-mcp-servers), repository/user configurations, `/mcp` management commands, and [programmatic autopilot limits](https://docs.github.com/en/copilot/concepts/agents/copilot-cli/autopilot). MCP tool calls remain subject to Copilot permissions and organizational MCP allowlists.

The [custom agent](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/create-custom-agents-for-cli) at [`.github/agents/network-watch.agent.md`](../.github/agents/network-watch.agent.md) supplies workflow instructions. It does not create the MCP connection. The MCP configuration supplies tools; the agent profile tells Copilot when and how to use them.

## Docker Compose

### Desktop-only local evaluation

```bash
docker compose up --build network-inspector
```

Open `http://127.0.0.1:6080/vnc.html?autoconnect=1` to see the Electron desktop. Chromium is installed in the image, so **Start browser** can launch a browser in the same container and Network Watch can reach its loopback CDP port. Load the unpacked extension from `/app/website-analytics-extension` inside that Chromium profile.

Compose binds VNC, noVNC, the extension bridge, and MCP ports to host loopback only. Application data is stored in the `network-watch-data` volume.

### Desktop plus Streamable HTTP MCP

Choose a token instead of relying on the local development default:

```bash
export NETWORK_WATCH_MCP_TOKEN="$(openssl rand -hex 32)"
docker compose --profile mcp up --build
```

The optional `network-watch-mcp` service shares the Electron container's network namespace. This is deliberate: the private Electron bridge continues to be addressed as `127.0.0.1:9231`, while only the authenticated MCP adapter is intended for MCP clients.

The endpoint is `http://127.0.0.1:9232/mcp` and expects:

```text
Authorization: Bearer <NETWORK_WATCH_MCP_TOKEN>
```

Compose is appropriate for local Linux evaluation and HTTP-MCP testing. It is not the preferred daily desktop setup on macOS or Windows, and the in-app Copilot sidebar is not included in the image because Copilot CLI credentials and source-code mounts are host concerns. Run the native desktop app for that workflow.

Do not publish ports 5900, 6080, 9231, or 9232 on a public interface. noVNC/VNC in this development image has no password, and the port-9231 bridge is an internal application API rather than a public MCP API.

## GitHub Actions

The workflow has three responsibilities:

1. `quality` runs on pull requests, branch pushes, tags, and manual runs. It installs with Node 20 and pnpm 10, type-checks, runs store/MCP tests, builds the renderer, and builds the Docker image.
2. `package` runs only outside pull requests and creates Linux, Windows, and macOS Electron artifacts.
3. `publish` runs only for `v*` tags or when a manual workflow explicitly enables `publish_release`.

This avoids creating a GitHub release for every push. Packaging remains unsigned unless signing and notarization secrets are added.

## Argument against the current code structure

The repository works as an MVP, but the boundaries are increasingly expensive:

- `src/main.js` owns Electron lifecycle, CDP, the HTTP bridge, file dialogs, browser launching, persistence wiring, and Copilot process supervision. A change to any backend feature risks the whole desktop entry point.
- `src/network-watch-store.js` combines persistence, schema normalization, redaction, request attribution, comparison, replay jobs, and export formatting. These policies should be independently testable.
- `website-analytics-extension/background.js` combines recording history, replay execution, MCP polling, responsive emulation, screenshots, and popup messaging.
- The renderer is reasonably componentized, but it imports one global stylesheet and owns network capture, Inspect export, and Copilot session state in a single `App` component.
- Docker, packaging, MCP, extension, desktop, and documentation all live at the root without a clear application/package boundary.
- Shared recording/action contracts are duplicated as JavaScript objects, TypeScript types, and implicit MCP/store shapes. Drift is already a larger risk than file count.

## Recommended target layout

These components can and should be separated, but moving files without first extracting contracts would only relocate coupling.

```text
apps/
  desktop/
    main/                 Electron bootstrap and IPC composition
    preload/
    renderer/
  extension/              Manifest, popup, worker, content scripts
services/
  mcp/                    stdio and HTTP transport entry points
packages/
  domain/                 versioned schemas and action/recording types
  store/                  persistence adapters and migrations
  replay-analysis/        request normalization, comparison, exports
  cdp/                    target discovery and network capture
  bridge-client/          typed client used by MCP and tests
infra/
  docker/
docs/
test/
  unit/
  integration/
```

Recommended extraction order:

1. Create `packages/domain` with versioned Zod schemas and generated or inferred TypeScript types.
2. Split `network-watch-store.js` into persistence, redaction, comparison, and export modules without changing runtime behavior.
3. Split `main.js` into CDP, bridge routes, browser launcher, and Copilot runner; leave `main.js` as dependency composition only.
4. Move the existing extension under `apps/extension` and add a small build step so it can consume shared browser-safe schemas.
5. Move MCP under `services/mcp`, using the shared bridge client and domain contracts.
6. Move infrastructure files last, after Electron Builder, Docker COPY paths, MCP configs, tests, and extension-loading documentation have been updated together.

Do not split the MCP transport into its own remote deployment yet while its only data source is a loopback Electron process. For a real hosted MCP service, first move recordings and replay jobs into a network-accessible, authenticated multi-user backend and treat the desktop and extension as agents of that service.
