# Website Analytics extension distribution

The extension is a separate browser process component, but it does not always require a separate public release.

## Distribution decision

| Use case | Publish separately? | Installation path |
| --- | --- | --- |
| Local development | No | Load `apps/extension` unpacked from `chrome://extensions`. |
| Browser started by Network Watch | No | Load the bundled directory once from `chrome://extensions`; the dedicated profile retains it. |
| Internal managed company devices | Not necessarily public | Use Chrome enterprise force-install policy, or publish to a private Google Workspace domain. |
| Selected external testers | Yes, if they use normal Chrome installation | Publish as Private trusted-testers or Unlisted in the Chrome Web Store. |
| General users in their normal Chrome profile | Yes | Publish through the Chrome Web Store for installation, signing, review, and updates. |

Chrome's supported general distribution mechanisms are the Chrome Web Store and enterprise-managed self-hosting. Unpacked loading is intended for trusted development. Windows and macOS do not support arbitrary local CRX installation for ordinary users. See Chrome's [extension distribution guide](https://developer.chrome.com/docs/extensions/how-to/distribute), [alternative installation methods](https://developer.chrome.com/docs/extensions/how-to/distribute/install-extensions), and [enterprise publishing options](https://developer.chrome.com/docs/webstore/cws-enterprise/).

## How the Electron package carries the extension

`package.json` copies the extension outside `app.asar` because an external Chromium process needs a real filesystem directory:

```json
{
  "extraResources": [
    {
      "from": "apps/extension",
      "to": "extension",
      "filter": ["**/*"]
    }
  ]
}
```

At runtime, the desktop resolves one of two locations:

```text
Development: <repository>/apps/extension
Packaged app: <Electron resources>/extension
```

When the user clicks **Start Browser**, Electron starts a persistent dedicated profile and opens `chrome://extensions`. The user selects the packaged directory once with **Load unpacked**. This does not modify the user's normal Chrome profile, and avoids relying on restricted command-line extension-loading switches in stable Chrome.

## Why the extension cannot run inside Electron alone

The extension must observe and control the actual Chromium page where the user's website runs. Its content script, service worker, popup, `chrome.tabs`, `chrome.alarms`, and `chrome.debugger` APIs belong to that browser. Electron can package the files and launch the browser, but the browser still loads the extension as its own component.

## Recommended product rollout

1. Keep bundled/unpacked loading for development and controlled demonstrations.
2. Use a dedicated Chromium profile so extension permissions and replay activity are isolated from personal browsing.
3. For an internal organization, prefer private-domain publishing or enterprise policy.
4. For external users, publish an Unlisted or Public Chrome Web Store item and let the desktop detect whether it is installed.
5. Keep the store extension ID stable and add an update/migration plan before relying on persisted extension state.
