import { removeDynamicRules, setDynamicRules } from '~utils/declarativeNetRequest';

import type { ExtensionFetchRequest, PrepareStreamRequest } from './types';

const TRANSIENT_RULE_START = 40_000;
const TRANSIENT_RULE_END = 49_999;

let nextTransientRuleId = TRANSIENT_RULE_START;

const DNR_ONLY_HEADERS = new Set([
  'accept-charset',
  'accept-encoding',
  'connection',
  'content-length',
  'cookie',
  'host',
  'keep-alive',
  'origin',
  'referer',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'user-agent',
]);

function nextRuleId(): number {
  const id = nextTransientRuleId;
  nextTransientRuleId = nextTransientRuleId === TRANSIENT_RULE_END ? TRANSIENT_RULE_START : nextTransientRuleId + 1;
  return id;
}

function splitHeaders(headers: Record<string, string>): {
  dynamicHeaders: Record<string, string>;
  fetchHeaders: Record<string, string>;
} {
  return Object.entries(headers).reduce(
    (result, [name, value]) => {
      result.dynamicHeaders[name] = value;
      const normalizedName = name.toLowerCase();
      if (!DNR_ONLY_HEADERS.has(normalizedName) && !normalizedName.startsWith('sec-')) {
        result.fetchHeaders[name] = value;
      }
      return result;
    },
    { dynamicHeaders: {}, fetchHeaders: {} } as {
      dynamicHeaders: Record<string, string>;
      fetchHeaders: Record<string, string>;
    },
  );
}

function toFetchBody(request: ExtensionFetchRequest): BodyInit | undefined {
  const { body, bodyType } = request;
  if (body === undefined || body === null) return undefined;
  if (bodyType === 'string') return String(body);
  if (bodyType === 'URLSearchParams') return new URLSearchParams(body as string[][]);
  if (bodyType === 'FormData') {
    const formData = new FormData();
    for (const [key, value] of body as string[][]) formData.append(key, value);
    return formData;
  }
  if (bodyType === 'object') return JSON.stringify(body);
  return body as BodyInit;
}

/**
 * Fetch from the extension service worker. Host access is granted by the
 * extension permission, while declarativeNetRequest supplies upstream-only
 * headers such as Referer and User-Agent that the web Fetch API forbids.
 */
export async function fetchWithExtensionAccess(request: ExtensionFetchRequest): Promise<{
  statusCode: number;
  headers: Record<string, string>;
  finalUrl: string;
  body: unknown;
}> {
  const url = new URL(request.url).toString();
  const ruleId = nextRuleId();
  const { dynamicHeaders, fetchHeaders } = splitHeaders(request.headers ?? {});

  await setDynamicRules({
    ruleId,
    targetDomains: [new URL(url).hostname],
    requestHeaders: dynamicHeaders,
  });

  try {
    const response = await fetch(url, {
      method: request.method ?? 'GET',
      headers: fetchHeaders,
      body: toFetchBody(request),
      credentials: request.credentials ?? 'omit',
    });
    const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
    const body = contentType.includes('application/json') ? await response.json() : await response.text();

    return {
      statusCode: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      finalUrl: response.url,
      body,
    };
  } finally {
    await removeDynamicRules([ruleId]).catch(() => undefined);
  }
}

/** Keep stream headers and CORS relaxation active while the page plays media. */
export async function prepareStream(request: PrepareStreamRequest): Promise<void> {
  if (request.targetDomains.length === 0) return;
  await setDynamicRules({
    ruleId: request.ruleId,
    targetDomains: request.targetDomains as [string, ...string[]],
    requestHeaders: request.requestHeaders,
    responseHeaders: request.responseHeaders,
  });
}
