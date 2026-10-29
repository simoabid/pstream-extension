import { fetchWithExtensionAccess, prepareStream } from '~cineflix/fetch';
import { isCineflixMedia, listProviders, resolveEmbed, resolveMedia, resolveSource } from '~cineflix/runtime';
import type { CineflixMessage, CineflixResponse, ExtensionFetchRequest, PrepareStreamRequest } from '~cineflix/types';
import { isChrome } from '~utils/extension';
import { assertDomainWhitelist } from '~utils/storage';

// Both brave and firefox for some reason need this extension reload,
// If this isn't done, they will never load properly and will fail updateDynamicRules()
if (isChrome()) {
  chrome.runtime.onStartup.addListener(() => {
    chrome.runtime.reload();
  });
} else {
  browser.runtime.onStartup.addListener(() => {
    browser.runtime.reload();
  });
}

const CINEFLIX_CHANNEL = 'cineflix-runtime';

type RuntimeMessage = {
  channel?: unknown;
  type?: unknown;
  payload?: unknown;
};

function isRuntimeMessage(value: unknown): value is RuntimeMessage {
  return Boolean(value) && typeof value === 'object' && (value as RuntimeMessage).channel === CINEFLIX_CHANNEL;
}

function isPrepareStreamRequest(value: unknown): value is PrepareStreamRequest {
  if (!value || typeof value !== 'object') return false;
  const request = value as Partial<PrepareStreamRequest>;
  return (
    typeof request.ruleId === 'number' &&
    Number.isInteger(request.ruleId) &&
    request.ruleId > 0 &&
    Array.isArray(request.targetDomains) &&
    request.targetDomains.every((domain) => typeof domain === 'string' && domain.length > 0)
  );
}

function isExtensionFetchRequest(value: unknown): value is ExtensionFetchRequest {
  if (!value || typeof value !== 'object') return false;
  const request = value as Partial<ExtensionFetchRequest>;
  if (typeof request.url !== 'string') return false;
  try {
    const url = new URL(request.url);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function toFailure(error: unknown): CineflixResponse<never> {
  return {
    success: false,
    error: error instanceof Error ? error.message : String(error),
  };
}

/**
 * Content scripts run in an isolated world. This executes a tiny marker in the
 * page's main world so CINEFLIX can select its extension fetcher immediately.
 */
async function markPageExtensionReady(tabId: number): Promise<void> {
  if (!chrome.scripting) return;
  await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: () => {
      window.__CINEFLIX_EXTENSION_ACTIVE__ = true;
      window.dispatchEvent(new CustomEvent('cineflix-extension-ready'));
    },
  });
}

async function handleCineflixMessage(
  message: RuntimeMessage,
  sender: chrome.runtime.MessageSender,
): Promise<CineflixResponse<Record<string, unknown>>> {
  const type = message.type;
  if (type === 'CINEFLIX_BRIDGE_READY') {
    if (!sender.tab?.url || sender.tab.id === undefined) {
      throw new Error('The CINEFLIX bridge must be loaded from a browser tab.');
    }
    await assertDomainWhitelist(sender.tab.url);
    await markPageExtensionReady(sender.tab.id);
    return { success: true };
  }

  if (!sender.tab?.url) throw new Error('CINEFLIX requests must come from a browser tab.');
  await assertDomainWhitelist(sender.tab.url);

  const cineflixMessage: CineflixMessage = {
    type: type as CineflixMessage['type'],
    payload: message.payload as never,
  };

  switch (cineflixMessage.type) {
    case 'LIST_PROVIDERS':
      return { success: true, providers: listProviders() };
    case 'RESOLVE_MEDIA':
      if (!cineflixMessage.payload || !isCineflixMedia(cineflixMessage.payload.media)) {
        throw new Error('RESOLVE_MEDIA requires complete movie or show metadata.');
      }
      return { success: true, result: await resolveMedia(cineflixMessage.payload) };
    case 'RESOLVE_SOURCE':
      if (!cineflixMessage.payload || !isCineflixMedia(cineflixMessage.payload.media)) {
        throw new Error('RESOLVE_SOURCE requires complete movie or show metadata.');
      }
      return { success: true, result: await resolveSource(cineflixMessage.payload) };
    case 'RESOLVE_EMBED':
      if (
        !cineflixMessage.payload ||
        typeof cineflixMessage.payload.id !== 'string' ||
        typeof cineflixMessage.payload.url !== 'string'
      ) {
        throw new Error('RESOLVE_EMBED requires an embed id and URL.');
      }
      return { success: true, result: await resolveEmbed(cineflixMessage.payload) };
    case 'MAKE_REQUEST':
      if (!isExtensionFetchRequest(cineflixMessage.payload)) {
        throw new Error('MAKE_REQUEST requires an HTTP(S) URL.');
      }
      return { success: true, response: await fetchWithExtensionAccess(cineflixMessage.payload) };
    case 'PREPARE_STREAM':
      if (!isPrepareStreamRequest(cineflixMessage.payload)) {
        throw new Error('PREPARE_STREAM requires a valid rule id and target domains.');
      }
      await prepareStream(cineflixMessage.payload);
      return { success: true };
    default:
      throw new Error(`Unsupported Cineflix extension action: ${String(type)}`);
  }
}

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  if (!isRuntimeMessage(message)) return undefined;

  handleCineflixMessage(message, sender)
    .then((response) => sendResponse(response))
    .catch((error: unknown) => sendResponse(toFailure(error)));

  return true;
});
