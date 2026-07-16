# Website Analytics Chrome extension

## Load the extension

1. Start Network Watch so its local bridge is available on `127.0.0.1:9231`.
2. Open `chrome://extensions` in Chrome.
3. Enable **Developer mode**.
4. Choose **Load unpacked**.
5. Select this `website-analytics-extension` folder.

## Workflow

1. Connect Network Watch to the same website tab if network capture is required.
2. Use **Record**, perform the user journey, and choose **Stop recording**.
3. Choose **Replay** to repeat the clicks and keystrokes and regenerate network requests. Each replay is stored as its own evidence session.
4. Choose **Simulate** to render 1920×1080, 1760×990, 1600×900, 1460×810, and 1320×720. The page refreshes at each fitted breakpoint and pauses after the fifth.
5. Optionally choose **Select element** and click an element on the page.
6. Reopen the popup and choose **Screenshot** to capture the full DOM-rendered page.
7. Open **Inspect** mode in Network Watch to review recording/action IDs, per-action network requests, screenshots, and change-request forms before exporting the improvement prompt.

The extension works on normal `http` and `https` pages. Chrome internal pages and the Chrome Web Store do not allow content scripts.
