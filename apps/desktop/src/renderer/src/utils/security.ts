import type { NetworkRequest } from '../types';

export type SecuritySeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';
export type SecurityRating = 'critical' | 'risky' | 'review' | 'good' | 'pending';

export type SecurityFinding = {
  id: string;
  severity: SecuritySeverity;
  title: string;
  detail: string;
  impact: string;
  recommendation: string;
  standard: string;
};

export type SecurityAnalysis = {
  score: number | null;
  rating: SecurityRating;
  label: string;
  findings: SecurityFinding[];
  positiveSignals: string[];
  scope: 'document' | 'api' | 'resource';
};

const WEIGHTS: Record<SecuritySeverity, number> = { critical: 35, high: 20, medium: 10, low: 4, info: 0 };
const ACTIVE_TYPES = new Set(['Document', 'Script', 'Stylesheet', 'XHR', 'Fetch']);
const API_TYPES = new Set(['XHR', 'Fetch']);
const SECRET_KEY = /(?:^|_)(?:password|passwd|passphrase|secret|client_secret|private_key|access_token|refresh_token|api_key|apikey|authorization|cvv|card_number|credit_card)(?:$|_)/i;
const PERSONAL_KEY = /(?:^|_)(?:ssn|social_security|date_of_birth|dob|email|phone|telephone|postal_address)(?:$|_)/i;
const STACK_TRACE = /(?:\bat\s+[\w$.<>]+\s*\([^\n]+:\d+:\d+\)|Traceback \(most recent call last\)|(?:Exception|Error):[^\n]+\n\s+at\s)/;

const FINDING_GUIDANCE: Record<string, { impact: string; recommendation: string }> = {
  transport: {
    impact: 'Attackers on the network may be able to observe or alter requests and responses.',
    recommendation: 'Serve the endpoint exclusively over HTTPS/WSS, redirect HTTP to HTTPS, and update callers that still use insecure URLs.',
  },
  nosniff: {
    impact: 'A browser may interpret content as a different executable type than the server intended.',
    recommendation: 'Return the correct Content-Type and add X-Content-Type-Options: nosniff.',
  },
  'cors-credentials': {
    impact: 'An overly broad origin policy can expose authenticated data to an unintended website. Browsers reject this exact combination, but it usually signals a broken CORS design.',
    recommendation: 'Return an explicit allowlisted origin, add Vary: Origin, and enable credentials only for endpoints that require them.',
  },
  'cors-wildcard': {
    impact: 'Any website may be able to read this response when the request does not require browser credentials.',
    recommendation: 'Use an explicit origin allowlist for non-public data. Keep the wildcard only when the response is intentionally public.',
  },
  csp: {
    impact: 'The browser has fewer restrictions on where scripts and other active content may be loaded from, increasing the impact of injection defects.',
    recommendation: 'Deploy a restrictive Content-Security-Policy, preferably beginning in Report-Only mode, using nonces or hashes for necessary inline scripts.',
  },
  'csp-unsafe': {
    impact: 'unsafe-inline or unsafe-eval weakens CSP protection against script injection.',
    recommendation: 'Replace unsafe-inline with nonces or hashes and remove eval-style execution before deleting unsafe-eval.',
  },
  framing: {
    impact: 'Another site may be able to embed this page and visually trick a user into interacting with it.',
    recommendation: "Set CSP frame-ancestors 'none' or a narrow allowlist. X-Frame-Options: DENY or SAMEORIGIN is a legacy fallback.",
  },
  hsts: {
    impact: 'A user who follows an HTTP link first may be exposed to downgrade or redirect interception before reaching HTTPS.',
    recommendation: 'Add Strict-Transport-Security with an appropriate max-age after confirming the entire affected host is HTTPS-ready.',
  },
  referrer: {
    impact: 'Navigation may disclose more source URL information than the application intends.',
    recommendation: 'Set an explicit policy such as strict-origin-when-cross-origin, or a stricter value when compatible with the application.',
  },
  permissions: {
    impact: 'Embedded or third-party content may retain access to browser capabilities that the page does not need.',
    recommendation: 'Define a Permissions-Policy that disables unnecessary features and narrowly delegates required capabilities.',
  },
  'server-disclosure': {
    impact: 'Product and framework information can help an attacker prioritize technology-specific probes.',
    recommendation: 'Remove or generalize Server and X-Powered-By values where operationally practical. Do not treat hiding versions as a substitute for patching.',
  },
  'cookie-secure': {
    impact: 'A cookie may be transmitted over an unencrypted connection and intercepted.',
    recommendation: 'Add Secure to cookies created by HTTPS applications and avoid serving the application over HTTP.',
  },
  'cookie-http-only': {
    impact: 'JavaScript can read the cookie, so an XSS defect could steal it. Some deliberately script-readable cookies are exceptions.',
    recommendation: 'Add HttpOnly to session and other server-only cookies. Review client-readable cookies individually instead of applying it blindly.',
  },
  'cookie-samesite': {
    impact: 'The cookie may be sent in more cross-site situations, increasing CSRF and cross-site leakage exposure.',
    recommendation: 'Use SameSite=Lax or Strict when possible. If SameSite=None is required, document the cross-site need and require Secure.',
  },
  'secret-fields': {
    impact: 'Authentication material or another secret may be exposed to browser code, logs, extensions, or anyone able to repeat the request.',
    recommendation: 'Return only fields required by the client. Rotate any genuinely exposed credential and enforce property-level authorization server-side.',
  },
  'personal-fields': {
    impact: 'Personal data may be returned to a caller that does not need it or is not authorized to receive every property.',
    recommendation: 'Minimize the response schema and verify property-level authorization for each reported field. A field name alone does not prove exposure.',
  },
  'sensitive-cache': {
    impact: 'Private response data may remain in browser or intermediary caches and be retrievable later.',
    recommendation: 'Apply Cache-Control: no-store for highly sensitive responses, or a carefully designed private caching policy where caching is required.',
  },
  'stack-trace': {
    impact: 'Implementation paths, dependencies, and internal code structure can give an attacker useful reconnaissance.',
    recommendation: 'Return a generic client-safe error with a correlation ID and keep detailed exceptions in access-controlled server logs.',
  },
};

function normalizedHeaders(request: NetworkRequest) {
  const entries = Object.entries({ ...request.responseHeaders, ...request.responseExtraHeaders });
  return Object.fromEntries(entries.map(([name, value]) => [name.toLowerCase(), String(value)]));
}

function isLocalHostname(hostname: string) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

function responseScope(request: NetworkRequest): SecurityAnalysis['scope'] {
  if (request.resourceType === 'Document') return 'document';
  if (API_TYPES.has(request.resourceType) || /(?:json|graphql)/i.test(request.mimeType)) return 'api';
  return 'resource';
}

function sensitiveJsonPaths(body: string): { secret: string[]; personal: string[] } {
  try {
    const parsed = JSON.parse(body);
    const secret: string[] = [];
    const personal: string[] = [];
    const visit = (value: unknown, path: string, depth: number) => {
      if (depth > 8 || secret.length + personal.length >= 20 || value == null) return;
      if (Array.isArray(value)) {
        value.slice(0, 5).forEach((item, index) => visit(item, `${path}[${index}]`, depth + 1));
        return;
      }
      if (typeof value !== 'object') return;
      for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
        const childPath = path ? `${path}.${key}` : key;
        if (SECRET_KEY.test(key)) secret.push(childPath);
        else if (PERSONAL_KEY.test(key)) personal.push(childPath);
        visit(child, childPath, depth + 1);
      }
    };
    visit(parsed, '', 0);
    return { secret, personal };
  } catch {
    return { secret: [], personal: [] };
  }
}

export function analyzeRequestSecurity(request: NetworkRequest): SecurityAnalysis {
  if (request.status == null && !request.failed) {
    return { score: null, rating: 'pending', label: 'Pending', findings: [], positiveSignals: [], scope: responseScope(request) };
  }

  const findings: SecurityFinding[] = [];
  const positiveSignals: string[] = [];
  const headers = normalizedHeaders(request);
  const scope = responseScope(request);
  let url: URL | null = null;
  try { url = new URL(request.url); } catch { /* Keep analyzing captured metadata. */ }
  const add = (id: string, severity: SecuritySeverity, title: string, detail: string, standard: string) => {
    const guidance = FINDING_GUIDANCE[id] || { impact: 'This signal requires manual security review.', recommendation: 'Confirm whether the observed behavior is intentional and apply the referenced standard.' };
    findings.push({ id, severity, title, detail, impact: guidance.impact, recommendation: guidance.recommendation, standard });
  };

  if (url?.protocol === 'https:' || url?.protocol === 'wss:') positiveSignals.push('Encrypted transport');
  else if (url && !isLocalHostname(url.hostname)) add('transport', 'critical', 'Unencrypted transport', 'The response was delivered without HTTPS/WSS.', 'OWASP API8:2023');

  const contentType = headers['content-type'] || request.mimeType || '';
  if (ACTIVE_TYPES.has(request.resourceType) && !/^nosniff(?:\s|$)/i.test(headers['x-content-type-options'] || '')) {
    add('nosniff', 'medium', 'MIME sniffing protection missing', 'Add X-Content-Type-Options: nosniff.', 'OWASP HTTP Headers');
  } else if (headers['x-content-type-options']?.toLowerCase().includes('nosniff')) positiveSignals.push('MIME sniffing disabled');

  const allowOrigin = headers['access-control-allow-origin'];
  const allowCredentials = headers['access-control-allow-credentials']?.toLowerCase() === 'true';
  if (allowOrigin === '*' && allowCredentials) add('cors-credentials', 'critical', 'Unsafe CORS combination', 'Wildcard origin is combined with credentialed cross-origin access.', 'OWASP API8:2023');
  else if (allowOrigin === '*' && scope === 'api') add('cors-wildcard', 'medium', 'Wildcard CORS policy', 'Any origin can read this API response when browser credential rules permit it.', 'OWASP API8:2023');

  if (scope === 'document') {
    const csp = headers['content-security-policy'] || '';
    if (!csp) add('csp', 'high', 'Content Security Policy missing', 'No Content-Security-Policy header was observed on this document.', 'OWASP HTTP Headers');
    else {
      positiveSignals.push('Content Security Policy present');
      if (/unsafe-inline|unsafe-eval/i.test(csp)) add('csp-unsafe', 'medium', 'Permissive Content Security Policy', 'The policy contains unsafe-inline or unsafe-eval.', 'OWASP HTTP Headers');
    }
    if (!headers['x-frame-options'] && !/frame-ancestors\s+/i.test(csp)) add('framing', 'medium', 'Frame protection missing', 'Neither frame-ancestors nor X-Frame-Options was observed.', 'OWASP HTTP Headers');
    if (url?.protocol === 'https:' && !isLocalHostname(url.hostname) && !headers['strict-transport-security']) add('hsts', 'medium', 'HSTS missing', 'HTTPS is used, but Strict-Transport-Security was not observed.', 'OWASP HTTP Headers');
    if (!headers['referrer-policy']) add('referrer', 'low', 'Referrer policy missing', 'Set an explicit restrictive Referrer-Policy.', 'OWASP HTTP Headers');
    if (!headers['permissions-policy']) add('permissions', 'low', 'Permissions policy missing', 'No Permissions-Policy header was observed.', 'OWASP HTTP Headers');
  }

  if (headers.server || headers['x-powered-by']) add('server-disclosure', 'low', 'Server technology disclosed', 'Server or X-Powered-By reveals implementation information.', 'OWASP API8:2023');

  const setCookie = headers['set-cookie'] || '';
  if (setCookie) {
    const cookies = setCookie.split(/\r?\n/).filter(Boolean);
    if (url?.protocol === 'https:' && cookies.some(cookie => !/;\s*secure\b/i.test(cookie))) add('cookie-secure', 'high', 'Cookie lacks Secure', 'At least one observed cookie may be sent without the Secure attribute.', 'MDN secure cookie guidance');
    if (cookies.some(cookie => !/;\s*httponly\b/i.test(cookie))) add('cookie-http-only', 'medium', 'Cookie lacks HttpOnly', 'At least one observed cookie may be accessible to JavaScript.', 'MDN secure cookie guidance');
    if (cookies.some(cookie => !/;\s*samesite=(?:strict|lax)\b/i.test(cookie))) add('cookie-samesite', 'low', 'Cookie SameSite policy needs review', 'At least one observed cookie lacks an explicit SameSite=Strict or Lax attribute.', 'MDN secure cookie guidance');
  }

  if (request.bodyCache != null && !request.bodyBase64) {
    const paths = sensitiveJsonPaths(request.bodyCache);
    if (paths.secret.length) add('secret-fields', 'critical', 'Secret-like fields in response', `Review exposure of: ${paths.secret.join(', ')}. Values were not inspected or displayed.`, 'OWASP API3:2023');
    if (paths.personal.length) add('personal-fields', 'high', 'Personal-data fields in response', `Verify object-level authorization for: ${paths.personal.join(', ')}.`, 'OWASP API3:2023');
    const sensitive = paths.secret.length || paths.personal.length || /authorization|cookie/i.test(JSON.stringify(request.requestHeaders));
    if (sensitive && !/\b(?:no-store|private)\b/i.test(headers['cache-control'] || '')) add('sensitive-cache', 'high', 'Sensitive response may be cacheable', 'Use an appropriate Cache-Control policy for private data.', 'OWASP API8:2023');
    if (Number(request.status) >= 500 && (STACK_TRACE.test(request.bodyCache) || /\/Users\/|\/home\/|[A-Z]:\\/i.test(request.bodyCache))) add('stack-trace', 'high', 'Internal error details exposed', 'The error response appears to contain a stack trace or local filesystem path.', 'OWASP API8:2023');
  } else if (/json/i.test(contentType)) {
    positiveSignals.push('Load the response body for structural exposure checks');
  }

  const score = Math.max(0, 100 - findings.reduce((total, finding) => total + WEIGHTS[finding.severity], 0));
  const rating: SecurityRating = findings.some(finding => finding.severity === 'critical')
    ? 'critical'
    : score >= 85 ? 'good' : score >= 65 ? 'review' : score >= 40 ? 'risky' : 'critical';
  const label = rating === 'good' ? 'Good' : rating === 'review' ? 'Review' : rating === 'risky' ? 'Risky' : 'Critical';
  return { score, rating, label, findings, positiveSignals, scope };
}
