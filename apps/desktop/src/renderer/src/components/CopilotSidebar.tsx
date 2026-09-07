import { useEffect, useRef, type FormEvent } from 'react';
import { MarkdownOutput } from './MarkdownOutput';

type Props = {
  directory: string;
  output: string;
  running: boolean;
  stopping: boolean;
  canRun: boolean;
  chatDraft: string;
  onChatDraftChange: (value: string) => void;
  onSelectDirectory: () => void;
  onRun: () => void;
  onGeneratePrompt: () => void;
  onSendChat: (message: string) => void;
  onStop: () => void;
  onClose: () => void;
};

export function CopilotSidebar({ directory, output, running, stopping, canRun, chatDraft, onChatDraftChange, onSelectDirectory, onRun, onGeneratePrompt, onSendChat, onStop, onClose }: Props) {
  const outputRef = useRef<HTMLDivElement>(null);
  const directoryName = directory.split(/[\\/]/).filter(Boolean).pop() || directory;
  useEffect(() => {
    if (outputRef.current) outputRef.current.scrollTop = outputRef.current.scrollHeight;
  }, [output]);
  const submitChat = (event: FormEvent) => {
    event.preventDefault();
    if (!chatDraft.trim() || running || !directory) return;
    onSendChat(chatDraft.trim());
    onChatDraftChange('');
  };

  return (
    <aside className="copilot-sidebar" aria-labelledby="copilot-sidebar-title">
      <div className="copilot-sidebar-heading">
        <div><h2 id="copilot-sidebar-title">Copilot CLI</h2><p>Work on the selected code directory.</p></div>
        <button className="modal-close" aria-label="Close Copilot sidebar" onClick={onClose}>×</button>
      </div>

      {directory ? (
        <button className="copilot-directory-button" title={`Working directory: ${directory}\nClick to change`} onClick={onSelectDirectory} disabled={running}>
          <span>Working in</span><strong>📁 {directoryName}</strong>
        </button>
      ) : (
        <div className="copilot-directory-card">
          <p>Select where the website code lives before starting Copilot.</p>
          <button className="btn btn-secondary" onClick={onSelectDirectory}>Select working directory</button>
        </div>
      )}

      <div className="copilot-session-bar">
        <span className={`copilot-run-status ${running ? 'running' : ''}`}>{stopping ? '● Stopping…' : running ? '● Running' : output ? 'Finished' : 'Ready'}</span>
        {running ? <button className="btn btn-danger" onClick={onStop} disabled={stopping}>{stopping ? 'Stopping…' : 'Stop'}</button> : null}
      </div>
      {!canRun && <p className="copilot-hint">Add a screenshot change note or record some events to create a prompt.</p>}
      <MarkdownOutput output={output} ref={outputRef} />
      <div className="copilot-prompt-actions">
        <button className="btn btn-secondary" onClick={onGeneratePrompt} disabled={!directory || running || !canRun}>Generate Prompt</button>
        <button className="btn btn-ghost" onClick={onRun} disabled={!directory || running || !canRun}>Run all evidence</button>
      </div>
      <form className="copilot-chat" onSubmit={submitChat}>
        <textarea value={chatDraft} onChange={(event) => onChatDraftChange(event.target.value)} placeholder="Ask Copilot a follow-up…" disabled={!directory || running} />
        <button className="btn btn-primary" type="submit" disabled={!directory || running || !chatDraft.trim()}>Send</button>
      </form>
    </aside>
  );
}
