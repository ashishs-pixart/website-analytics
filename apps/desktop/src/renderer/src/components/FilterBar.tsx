import { RESOURCE_TYPES } from '../constants';

type FilterBarProps = {
  filterText: string;
  filterType: string;
  errorsOnly: boolean;
  requestCount: number;
  totalCount: number;
  onFilterTextChange: (value: string) => void;
  onFilterTypeChange: (value: string) => void;
  onErrorsOnlyChange: (value: boolean) => void;
  onClear: () => void;
};

function typeLabel(type: string) {
  if (type === 'Document') return 'Doc';
  if (type === 'Script') return 'JS';
  if (type === 'Stylesheet') return 'CSS';
  if (type === 'Image') return 'Img';
  return type;
}

export function FilterBar({
  filterText,
  filterType,
  errorsOnly,
  requestCount,
  totalCount,
  onFilterTextChange,
  onFilterTypeChange,
  onErrorsOnlyChange,
  onClear,
}: FilterBarProps) {
  return (
    <div id="filter-bar">
      <input id="inp-filter" type="search" placeholder="Filter by URL, method, status..." value={filterText} onChange={(event) => onFilterTextChange(event.target.value)} />
      <div className="type-filters">
        {RESOURCE_TYPES.map((type) => (
          <button key={type} className={`type-btn ${filterType === type ? 'active' : ''}`} onClick={() => onFilterTypeChange(type)}>
            {typeLabel(type)}
          </button>
        ))}
      </div>
      <label className="checkbox-label"><input type="checkbox" checked={errorsOnly} onChange={(event) => onErrorsOnlyChange(event.target.checked)} /> Errors only</label>
      <span id="req-count">{requestCount} request{requestCount === 1 ? '' : 's'}</span>
      <button className="btn btn-danger tab-clear-button" onClick={onClear} disabled={!totalCount}>Clear Network</button>
    </div>
  );
}
