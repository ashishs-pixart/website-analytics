import { FormEvent, useCallback, useState } from 'react';

type DictionaryEntry = {
  word: string;
  defs?: string[];
  tags?: string[];
};

type ReplayStep = {
  word: string;
  state: 'queued' | 'running' | 'success' | 'error';
};

type Props = {
  trackedFetch: (label: string, url: string, init?: RequestInit) => Promise<unknown>;
};

const API_ROOT = 'https://api.datamuse.com/words';
const EXAMPLE_WORDS = ['signal', 'latency', 'resilient'];
const PARTS_OF_SPEECH: Record<string, string> = { n: 'noun', v: 'verb', adj: 'adjective', adv: 'adverb', u: 'other' };

function delay(milliseconds: number) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

export function DictionaryReplayLab({ trackedFetch }: Props) {
  const [query, setQuery] = useState('signal');
  const [entry, setEntry] = useState<DictionaryEntry | null>(null);
  const [error, setError] = useState('');
  const [searching, setSearching] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordedWords, setRecordedWords] = useState<string[]>([]);
  const [replaying, setReplaying] = useState(false);
  const [replaySteps, setReplaySteps] = useState<ReplayStep[]>([]);

  const search = useCallback(async (word: string, shouldRecord: boolean, replay = false) => {
    const normalizedWord = word.trim().toLowerCase();
    if (!normalizedWord) return false;

    if (shouldRecord) setRecordedWords((current) => [...current, normalizedWord]);
    setSearching(true);
    setError('');

    try {
      const response = await trackedFetch(
        `${replay ? 'Replay' : 'Dictionary'}: ${normalizedWord}`,
        `${API_ROOT}?sp=${encodeURIComponent(normalizedWord)}&md=d&max=1`,
      ) as DictionaryEntry[];
      if (!response[0]?.defs?.length) throw new Error('No definition returned');
      setEntry(response[0]);
      return true;
    } catch {
      setEntry(null);
      setError(`No definition was returned for “${normalizedWord}”. Try another word.`);
      return false;
    } finally {
      setSearching(false);
    }
  }, [trackedFetch]);

  const submitSearch = (event: FormEvent) => {
    event.preventDefault();
    void search(query, recording);
  };

  const startRecording = () => {
    setRecordedWords([]);
    setReplaySteps([]);
    setRecording(true);
  };

  const replay = async () => {
    if (!recordedWords.length || replaying) return;
    setRecording(false);
    setReplaying(true);
    setReplaySteps(recordedWords.map((word) => ({ word, state: 'queued' })));

    for (let index = 0; index < recordedWords.length; index += 1) {
      const word = recordedWords[index];
      setQuery(word);
      setReplaySteps((current) => current.map((step, stepIndex) => (
        stepIndex === index ? { ...step, state: 'running' } : step
      )));
      const succeeded = await search(word, false, true);
      setReplaySteps((current) => current.map((step, stepIndex) => (
        stepIndex === index ? { ...step, state: succeeded ? 'success' : 'error' } : step
      )));
      await delay(550);
    }

    setReplaying(false);
  };

  const definitions = (entry?.defs || []).slice(0, 3).map((definition) => {
    const [part, ...content] = definition.split('\t');
    return { part: PARTS_OF_SPEECH[part] || part, definition: content.join('\t') || definition };
  });
  const partOfSpeech = definitions[0]?.part || 'definition';

  return (
    <section className="replay-lab" id="replay-lab">
      <div className="section-heading replay-heading">
        <div>
          <p className="kicker"><span>03</span> Explore a live API</p>
          <h2>Dictionary search.</h2>
        </div>
        <p>Search for an English word and inspect the live definition response in Network Watch.</p>
      </div>

      <div className="replay-console">
        <div className="dictionary-pane">
          <div className="pane-label"><span>Dictionary search</span><code>api.datamuse.com</code></div>
          <form className="dictionary-search" onSubmit={submitSearch}>
            <label htmlFor="dictionary-word">Search for an English word</label>
            <div>
              <input
                id="dictionary-word"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Type a word…"
                autoComplete="off"
                disabled={replaying}
              />
              <button type="submit" disabled={searching || replaying}>
                {searching ? 'Searching…' : 'Search'} <span>↗</span>
              </button>
            </div>
          </form>

          <div className="quick-words">
            <span>Try</span>
            {EXAMPLE_WORDS.map((word) => (
              <button key={word} type="button" onClick={() => { setQuery(word); void search(word, recording); }} disabled={searching || replaying}>{word}</button>
            ))}
          </div>

          <div className={`definition-card ${entry ? 'has-result' : ''}`} aria-live="polite">
            {error ? (
              <div className="definition-empty error"><span>404</span><p>{error}</p></div>
            ) : entry ? (
              <>
                <div className="word-heading">
                  <div><span>{partOfSpeech}</span><h3>{entry.word}</h3></div>
                  <code>{entry.tags?.includes('f') ? 'frequency ranked' : 'open dictionary'}</code>
                </div>
                <ol>
                  {definitions.map((definition, index) => (
                    <li key={`${definition.definition}-${index}`}>
                      <p>{definition.definition}</p>
                    </li>
                  ))}
                </ol>
              </>
            ) : (
              <div className="definition-empty"><span>Aa</span><p>Your API response will appear here.</p></div>
            )}
          </div>
        </div>

        <aside className="recorder-pane">
          <div className="pane-label"><span>Journey recorder</span><code>{recording ? '● recording' : replaying ? '↻ replaying' : 'ready'}</code></div>
          <div className="recorder-intro">
            <span className={`record-indicator ${recording ? 'active' : ''}`}><i /></span>
            <div><h3>{recording ? 'Recording searches' : replaying ? 'Replaying journey' : 'Build a replay'}</h3><p>Each submitted word becomes one step and one captured fetch request.</p></div>
          </div>

          <div className="timeline">
            {!recordedWords.length ? (
              <div className="timeline-empty"><span>01</span><p>Start recording, then search two or three words.</p></div>
            ) : recordedWords.map((word, index) => {
              const replayState = replaySteps[index]?.state;
              return (
                <div className={`timeline-step ${replayState || ''}`} key={`${word}-${index}`}>
                  <span>{String(index + 1).padStart(2, '0')}</span>
                  <div><strong>Search “{word}”</strong><small>GET /words?sp={word}&amp;md=d</small></div>
                  <i>{replayState === 'running' ? '···' : replayState === 'success' ? '✓' : replayState === 'error' ? '!' : '●'}</i>
                </div>
              );
            })}
          </div>

          <div className="recorder-actions">
            {!recording ? (
              <button className="record-button" type="button" onClick={startRecording} disabled={replaying}>
                <i /> {recordedWords.length ? 'Record new' : 'Start recording'}
              </button>
            ) : (
              <button className="stop-button" type="button" onClick={() => setRecording(false)}><i /> Stop recording</button>
            )}
            <button className="replay-button" type="button" onClick={() => void replay()} disabled={!recordedWords.length || recording || replaying}>
              ↻ {replaying ? 'Replaying…' : `Replay ${recordedWords.length || ''} step${recordedWords.length === 1 ? '' : 's'}`}
            </button>
          </div>
          <p className="extension-note"><strong>Network Watch tip:</strong> record the same journey with the browser extension to display action IDs, correlated requests, and baseline/replay comparisons in Inspect mode.</p>
        </aside>
      </div>
    </section>
  );
}
