import { useEffect, useRef } from 'react';

type Props = {
  directory: string;
  output: string;
  running: boolean;
  onStop: () => void;
  onClose: () => void;
};

export function CopilotTerminal({ directory, output, running, onStop, onClose }: Props) {
  const outputRef = useRef<HTMLPreElement>(null);
  useEffect(() => {
    if (outputRef.current) outputRef.current.scrollTop = outputRef.current.scrollHeight;
  }, [output]);

  return (
    <div id="modal-overlay">
      <div id="modal" className="copilot-terminal-modal" role="dialog" aria-modal="true" aria-labelledby="copilot-terminal-title">
        <div className="modal-heading">
          <div>
            <h2 id="copilot-terminal-title">Copilot CLI</h2>
            <p className="modal-subtitle">{directory}</p>
          </div>
          <span className={`copilot-run-status ${running ? 'running' : ''}`}>{running ? 'Running' : 'Finished'}</span>
        </div>
        <pre className="copilot-terminal-output" ref={outputRef}>{output || 'Starting Copilot…'}</pre>
        <div className="modal-actions">
          {running && <button className="btn btn-danger" onClick={onStop}>Stop</button>}
          <button className="btn btn-primary" onClick={onClose} disabled={running}>Close</button>
        </div>
      </div>
    </div>
  );
}
