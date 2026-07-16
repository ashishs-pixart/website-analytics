import { useEffect, useState } from 'react';
import { EXPORT_FIELDS, type ExportField } from '../utils/export';

export type ExportFormat = 'postman' | 'selected';

type ExportModalProps = {
  requestCount: number;
  fetchRequestCount: number;
  scopeLabel: string;
  exporting: boolean;
  onClose: () => void;
  onExport: (format: ExportFormat, fields: Set<ExportField>, fetchOnly: boolean) => void;
};

export function ExportModal({ requestCount, fetchRequestCount, scopeLabel, exporting, onClose, onExport }: ExportModalProps) {
  const [format, setFormat] = useState<ExportFormat>('postman');
  const [fields, setFields] = useState<Set<ExportField>>(new Set(EXPORT_FIELDS.map((field) => field.id)));
  const [fetchOnly, setFetchOnly] = useState(false);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !exporting) onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [exporting, onClose]);

  const toggleField = (field: ExportField) => {
    setFields((current) => {
      const next = new Set(current);
      if (next.has(field)) next.delete(field);
      else next.add(field);
      return next;
    });
  };

  const effectiveRequestCount = fetchOnly ? fetchRequestCount : requestCount;
  const canExport = effectiveRequestCount > 0 && (format === 'postman' || fields.size > 0) && !exporting;

  return (
    <div id="modal-overlay" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !exporting) onClose();
    }}>
      <div id="modal" className="export-modal" role="dialog" aria-modal="true" aria-labelledby="export-title">
        <div className="modal-heading">
          <div>
            <h2 id="export-title">Export requests</h2>
            <p className="modal-subtitle">{effectiveRequestCount} {scopeLabel} request{effectiveRequestCount === 1 ? '' : 's'} will be exported.</p>
          </div>
          <button className="modal-close" type="button" aria-label="Close export dialog" onClick={onClose} disabled={exporting}>×</button>
        </div>

        <fieldset className="export-section">
          <legend>Choose export format</legend>
          <label className={`export-option ${format === 'postman' ? 'selected' : ''}`}>
            <input type="radio" name="export-format" value="postman" checked={format === 'postman'} onChange={() => setFormat('postman')} />
            <span><strong>Postman collection</strong><small>Importable requests with URLs, methods, headers, and payloads.</small></span>
          </label>
          <label className={`export-option ${format === 'selected' ? 'selected' : ''}`}>
            <input type="radio" name="export-format" value="selected" checked={format === 'selected'} onChange={() => setFormat('selected')} />
            <span><strong>Selected fields</strong><small>A Markdown file containing only the data you choose below.</small></span>
          </label>
        </fieldset>

        <fieldset className="export-section" disabled={exporting}>
          <legend>Filter requests</legend>
          <label className={`export-option ${fetchOnly ? 'selected' : ''}`}>
            <input type="checkbox" checked={fetchOnly} onChange={(event) => setFetchOnly(event.target.checked)} />
            <span><strong>Only Fetch requests</strong><small>Exclude XHR, documents, CSS, JavaScript, images, fonts, and other resource types. {fetchRequestCount} request{fetchRequestCount === 1 ? '' : 's'} match.</small></span>
          </label>
          {fetchOnly && effectiveRequestCount === 0 && <p className="field-error">No Fetch requests are available in the current scope.</p>}
        </fieldset>

        <fieldset className="export-section" disabled={format !== 'selected' || exporting}>
          <legend>Select data</legend>
          <div className="export-fields">
            {EXPORT_FIELDS.map((field) => (
              <label className="export-field" key={field.id}>
                <input type="checkbox" checked={fields.has(field.id)} onChange={() => toggleField(field.id)} />
                <span><strong>{field.label}</strong><small>{field.description}</small></span>
              </label>
            ))}
          </div>
          {format === 'selected' && fields.size === 0 && <p className="field-error">Select at least one field.</p>}
        </fieldset>

        <div className="modal-actions">
          <button className="btn btn-ghost" type="button" onClick={onClose} disabled={exporting}>Cancel</button>
          <button className="btn btn-primary" type="button" onClick={() => onExport(format, fields, fetchOnly)} disabled={!canExport}>
            {exporting ? 'Preparing export...' : 'Export'}
          </button>
        </div>
      </div>
    </div>
  );
}
