import type { PlasmoCSConfig } from 'plasmo';

export const config: PlasmoCSConfig = {
  matches: ['<all_urls>'],
  run_at: 'document_start',
};

const CINEFLIX_CHANNEL = 'cineflix-runtime';
const PAGE_TO_EXTENSION = 'cineflix-to-extension';
const EXTENSION_TO_PAGE = 'extension-to-cineflix';

type PageMessage = {
  direction?: unknown;
  requestId?: unknown;
  type?: unknown;
  payload?: unknown;
};

function postResponse(requestId: string, response: unknown): void {
  window.postMessage(
    {
      direction: EXTENSION_TO_PAGE,
      requestId,
      response,
    },
    window.location.origin,
  );
}

window.addEventListener('message', (event: MessageEvent<PageMessage>) => {
  if (event.source !== window || event.origin !== window.location.origin) return;
  const message = event.data;
  if (
    !message ||
    message.direction !== PAGE_TO_EXTENSION ||
    typeof message.requestId !== 'string' ||
    typeof message.type !== 'string'
  ) {
    return;
  }

  chrome.runtime.sendMessage(
    {
      channel: CINEFLIX_CHANNEL,
      type: message.type,
      payload: message.payload,
    },
    (response: unknown) => {
      if (chrome.runtime.lastError) {
        postResponse(message.requestId as string, {
          success: false,
          error: chrome.runtime.lastError.message ?? 'Extension request failed.',
        });
        return;
      }
      postResponse(message.requestId as string, response);
    },
  );
});

chrome.runtime.sendMessage({
  channel: CINEFLIX_CHANNEL,
  type: 'CINEFLIX_BRIDGE_READY',
});
