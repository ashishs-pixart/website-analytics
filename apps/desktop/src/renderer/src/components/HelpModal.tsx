export function HelpModal({ onClose }: { onClose: () => void }) {
  return (
    <div id="modal-overlay" onClick={(event) => event.target === event.currentTarget && onClose()}>
      <div id="modal">
        <h2>How to enable remote debugging</h2>
        <p>Launch your browser with the remote debugging flag, then click Scan.</p>
        <div className="launch-commands">
          <div className="launch-cmd">
            <span className="browser-name">Chrome / Brave</span>
            <code>google-chrome --remote-debugging-port=9222<br />brave-browser --remote-debugging-port=9222</code>
          </div>
          <div className="launch-cmd">
            <span className="browser-name">Edge</span>
            <code>msedge --remote-debugging-port=9222</code>
          </div>
          <div className="launch-cmd">
            <span className="browser-name">Windows Chrome</span>
            <code>&quot;C:\Program Files\Google\Chrome\Application\chrome.exe&quot; --remote-debugging-port=9222 --remote-debugging-address=0.0.0.0</code>
          </div>
          <div className="launch-cmd">
            <span className="browser-name">Docker host value</span>
            <code>host.docker.internal:9222</code>
          </div>
        </div>
        <button className="btn btn-primary" onClick={onClose}>Got it</button>
      </div>
    </div>
  );
}
