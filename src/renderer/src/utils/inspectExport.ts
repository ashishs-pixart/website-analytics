import type { ExtensionRecording, ExtensionScreenshot, NetworkRequest } from '../types';
import { requestDuration } from './format';

function fenced(value: string, language = '') {
  return `\`\`\`${language}\n${value.trim() || '(not captured)'}\n\`\`\``;
}

function relatedRequests(recording: ExtensionRecording, actionIndex: number, requests: NetworkRequest[]) {
  const action = recording.actions[actionIndex];
  const nextAction = recording.actions[actionIndex + 1];
  const start = action.timestamp - 100;
  const end = nextAction?.timestamp ?? Math.min(Date.parse(recording.stoppedAt) + 1000, action.timestamp + 15000);
  return requests.filter((request) => {
    if (!request.wallTime) return false;
    const requestTime = request.wallTime * 1000;
    return requestTime >= start && requestTime < end;
  });
}

function responseSignature(request: NetworkRequest) {
  const body = request.bodyCache == null ? '' : request.bodyCache.slice(0, 10000);
  return [request.method, request.url, request.status, request.mimeType, request.encodedDataLength, body].join('|');
}

export function meaningfulRequestInsights(requests: NetworkRequest[]) {
  const counts = new Map<string, number>();
  requests.forEach(request => counts.set(responseSignature(request), (counts.get(responseSignature(request)) || 0) + 1));
  return new Map(requests.map(request => {
    const reasons: string[] = [];
    const duration = requestDuration(request);
    if (request.failed || request.status === 'ERR' || (typeof request.status === 'number' && request.status >= 400)) reasons.push('failed or error response');
    if (duration != null && duration >= 1000) reasons.push(`slow response (${Math.round(duration)} ms)`);
    const repeats = counts.get(responseSignature(request)) || 0;
    if (repeats > 1) reasons.push(request.bodyCache != null
      ? `same request and response observed ${repeats} times; review caching or deduplication`
      : `same request with equivalent response status, type, and size observed ${repeats} times; load response bodies to confirm content before caching`);
    return [request.id, reasons];
  }).filter((entry): entry is [string, string[]] => entry[1].length > 0));
}

export function elementFeedbackId(screenshotId: string, elementIndex: number) {
  return `${screenshotId}:element:${elementIndex}`;
}

export function makeInspectPrompt(
  screenshots: ExtensionScreenshot[],
  feedback: Record<string, string>,
  recordings: ExtensionRecording[] = [],
  actionFeedback: Record<string, string> = {},
  networkRequests: NetworkRequest[] = [],
  includeMeaningfulRequests = true,
  elementFeedback: Record<string, string> = {},
  scope: { breakpoints: boolean; events: boolean } = { breakpoints: true, events: true },
) {
  const insights = meaningfulRequestInsights(networkRequests);
  const reviewed = scope.breakpoints ? screenshots.filter((screenshot) => {
    const elements = screenshot.elements?.length ? screenshot.elements : screenshot.element ? [screenshot.element] : [];
    return feedback[screenshot.id]?.trim() || elements.some((_element, index) => elementFeedback[elementFeedbackId(screenshot.id, index)]?.trim());
  }) : [];
  const sections = reviewed.map((screenshot, index) => {
    const elements = screenshot.elements?.length ? screenshot.elements : screenshot.element ? [screenshot.element] : [];
    const elementEvidence = elements.length ? elements.flatMap((element, elementIndex) => {
      const css = [
        ...element.cssRules,
        `Computed styles:\n${Object.entries(element.computedStyles).map(([name, value]) => `${name}: ${value};`).join('\n')}`,
      ].filter(Boolean).join('\n\n');
      return [
        `### Element ${elementIndex + 1}: ${element.selector}`,
        '',
        '#### HTML',
        fenced(element.html, 'html'),
        '',
        '#### CSS',
        fenced(css, 'css'),
        '',
        '#### Requested change for this element',
        elementFeedback[elementFeedbackId(screenshot.id, elementIndex)]?.trim() || '(No element-specific change provided.)',
        '',
      ];
    }) : ['### Selected elements', '', '(No element was selected for this screenshot.)', ''];

    return [
      `## ${index + 1}. Breakpoint ${screenshot.width}×${screenshot.height}`,
      `- Page: ${screenshot.title || '(untitled)'}`,
      `- URL: ${screenshot.url}`,
      `- Captured: ${screenshot.capturedAt}`,
      `- Element selectors: ${elements.map(element => element.selector).join(', ') || '(none)'}`,
      '',
      ...elementEvidence,
      '### Requested change',
      feedback[screenshot.id]?.trim() || '(No breakpoint-wide change provided.)',
    ].join('\n');
  });

  const actionSections = scope.events ? recordings.flatMap((recording) => {
    const sessionSummary = [
      `## ${recording.kind === 'replay' ? 'Replay' : 'Recording'} session ${recording.id}`,
      `- Source recording: ${recording.sourceRecordingId || '(original session)'}`,
      `- Page: ${recording.title || '(untitled)'}`,
      `- URL: ${recording.url}`,
      `- Started: ${recording.startedAt}`,
      `- Stopped: ${recording.stoppedAt}`,
      `- Actions: ${recording.actions.length}`,
      `- Replay totals: ${recording.summary ? `${recording.summary.successfulActions} succeeded, ${recording.summary.failedActions} failed, ${recording.summary.totalActions} total` : '(not a replay session)'}`,
    ].join('\n');
    const events = recording.actions.map((action, actionIndex) => {
      const requestedChange = actionFeedback[action.id]?.trim();
      const requests = includeMeaningfulRequests
        ? relatedRequests(recording, actionIndex, networkRequests).filter(request => insights.has(request.id))
        : [];
      const requestEvidence = requests.length
        ? requests.map((request) => {
          const duration = requestDuration(request);
          const bodyEvidence = request.bodyCache == null
            ? 'response body not loaded'
            : `response sample: ${JSON.stringify(request.bodyCache.slice(0, 2000))}`;
          const reason = insights.get(request.id)?.join('; ');
          return `- ${request.method} ${request.url} → ${request.status ?? 'pending'}${duration == null ? '' : ` in ${Math.round(duration)} ms`}; ${request.encodedDataLength || 0} bytes; ${request.mimeType || 'unknown type'}; ${bodyEvidence}${reason ? `; insight: ${reason}` : ''}`;
        }).join('\n')
        : includeMeaningfulRequests ? '- No meaningful network requests were found in this action window.' : '- Meaningful request analysis was excluded by the user.';

      return [
        `### Event ${actionIndex + 1}: ${action.id}`,
        `- Recording ID: ${recording.id}`,
        `- Session kind: ${recording.kind || 'recording'}`,
        `- Source recording: ${recording.sourceRecordingId || '(original)'}`,
        `- Event: ${action.type}`,
        `- Replay outcome: ${action.outcome || '(not a replay action)'}`,
        `- Replay error: ${action.replayError || '(none)'}`,
        `- Replay method: ${action.executionMethod || '(not replayed)'}`,
        `- Element resolution: ${action.resolutionMethod || '(not recorded)'}`,
        `- Selector: ${action.selector}`,
        `- URL at event start: ${action.startUrl || action.pageUrl || recording.url}`,
        `- URL after event: ${action.resultUrl || '(not measured)'}`,
        `- URL expected for next event: ${action.expectedResultUrl || '(no later event)'}`,
        `- URL changed: ${action.urlChanged == null ? '(not measured)' : action.urlChanged ? 'yes' : 'no'}`,
        `- URL correction before replay: ${action.urlCorrection ? `${action.urlCorrection.fromUrl} → ${action.urlCorrection.toUrl} (${action.urlCorrection.succeeded ? 'succeeded' : `failed: ${action.urlCorrection.error}`})` : '(not needed)'}`,
        `- Input/key: ${action.key || action.value || '(none)'}`,
        '',
        '#### Network requests after this event',
        requestEvidence,
        '',
        '#### Requested change for this event',
        requestedChange || '(No event-specific change provided.)',
      ].join('\n');
    });
    return [sessionSummary, ...events];
  }) : [];

  const instruction = scope.breakpoints && scope.events
    ? 'Use the responsive and recorded-journey evidence below to update the website. Preserve behavior at other breakpoints, prefer maintainable changes, and explain any tradeoffs or assumptions.'
    : scope.events
      ? 'Use the recorded and replayed journey evidence below to improve the website behavior. Preserve unrelated behavior and explain any tradeoffs or assumptions.'
      : 'Use the breakpoint-specific evidence below to update the website. Preserve behavior at other breakpoints, prefer maintainable CSS, and explain any tradeoffs or assumptions.';

  return [
    '# Website improvement request',
    '',
    instruction,
    '',
    ...sections,
    ...(actionSections.length ? ['', '# Recorded journeys and replay evidence', '', ...actionSections] : []),
    '',
    '## Expected response',
    'Propose the smallest safe changes, identify the files or selectors to update, and include a verification checklist for every exported breakpoint and journey event.',
  ].join('\n');
}
