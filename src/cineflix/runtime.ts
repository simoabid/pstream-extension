import { fetchWithExtensionAccess } from './fetch';
import type { CineflixMedia, ResolveEmbedRequest, ResolveMediaRequest, ResolveSourceRequest } from './types';
import { vidrockScraper } from './vidrock';
import {
  type EmbedOutput,
  type Fetcher,
  type FetcherResponse,
  type ProviderControls,
  type RunOutput,
  type SourcererOutput,
  buildProviders,
  getBuiltinEmbeds,
  getBuiltinExternalSources,
  getBuiltinSources,
  targets,
} from '../../../src/lib/providers/engine';
import { makeFullUrl } from '../../../src/lib/providers/engine/fetchers/common';
import type { DefaultedFetcherOptions } from '../../../src/lib/providers/engine/fetchers/types';

function makeExtensionFetcher(): Fetcher {
  return async <T>(url: string, options: DefaultedFetcherOptions): Promise<FetcherResponse<T>> => {
    const response = await fetchWithExtensionAccess({
      url: makeFullUrl(url, options),
      method: options.method,
      headers: options.headers,
      readHeaders: options.readHeaders,
      body: options.body,
      bodyType: inferBodyType(options.body),
      credentials: options.credentials,
    });

    const headers = new Headers();
    for (const name of options.readHeaders) {
      const value = response.headers[name.toLowerCase()];
      if (value) headers.set(name, value);
    }

    return {
      body: response.body as T,
      finalUrl: response.finalUrl,
      headers,
      statusCode: response.statusCode,
    };
  };
}

function inferBodyType(
  body: DefaultedFetcherOptions['body'],
): 'string' | 'object' | 'URLSearchParams' | 'FormData' | undefined {
  if (body === undefined) return undefined;
  if (typeof body === 'string') return 'string';
  if (body instanceof URLSearchParams) return 'URLSearchParams';
  if (typeof FormData !== 'undefined' && body instanceof FormData) return 'FormData';
  return 'object';
}

function makeControls(): ProviderControls {
  const fetcher = makeExtensionFetcher();
  const builder = buildProviders()
    .setFetcher(fetcher)
    .setProxiedFetcher(fetcher)
    .setTarget(targets.BROWSER_EXTENSION)
    .enableConsistentIpForRequests();

  for (const source of [...getBuiltinSources(), ...getBuiltinExternalSources()]) {
    // The former browser-engine implementation required /api/vidrock/encrypt.
    // Replace it with the current CinePro Web Crypto provider below.
    if (source.id !== vidrockScraper.id) builder.addSource(source);
  }
  for (const embed of getBuiltinEmbeds()) builder.addEmbed(embed);
  return builder.addSource(vidrockScraper).build();
}

let controls: ProviderControls | undefined;

function getControls(): ProviderControls {
  controls ??= makeControls();
  return controls;
}

export function listProviders() {
  const providerControls = getControls();
  return {
    sources: providerControls.listSources(),
    embeds: providerControls.listEmbeds(),
  };
}

export async function resolveMedia(request: ResolveMediaRequest): Promise<RunOutput | null> {
  return withLocalMetadata(request.media, () =>
    getControls().runAll({
      media: request.media,
      sourceOrder: request.sourceOrder,
      embedOrder: request.embedOrder,
      disableOpensubtitles: true,
    }),
  );
}

export async function resolveSource(request: ResolveSourceRequest): Promise<SourcererOutput> {
  return withLocalMetadata(request.media, () =>
    getControls().runSourceScraper({
      id: request.id,
      media: request.media,
      disableOpensubtitles: true,
    }),
  );
}

export async function resolveEmbed(request: ResolveEmbedRequest): Promise<EmbedOutput> {
  return getControls().runEmbedScraper({
    id: request.id,
    url: request.url,
    disableOpensubtitles: true,
  });
}

export function isCineflixMedia(value: unknown): value is CineflixMedia {
  if (!value || typeof value !== 'object') return false;
  const media = value as {
    type?: unknown;
    tmdbId?: unknown;
    title?: unknown;
    releaseYear?: unknown;
    season?: { number?: unknown; tmdbId?: unknown; title?: unknown };
    episode?: { number?: unknown; tmdbId?: unknown };
  };
  if (media.type !== 'movie' && media.type !== 'show') return false;
  if (typeof media.tmdbId !== 'string' || typeof media.title !== 'string') return false;
  if (typeof media.releaseYear !== 'number') return false;
  if (media.type === 'movie') return true;
  return (
    typeof media.season?.number === 'number' &&
    typeof media.season.tmdbId === 'string' &&
    typeof media.season.title === 'string' &&
    typeof media.episode?.number === 'number' &&
    typeof media.episode.tmdbId === 'string'
  );
}

let resolverQueue: Promise<void> = Promise.resolve();

/**
 * A few legacy browser-engine sources request the main app's `/api/tmdb` proxy.
 * The extension already receives the media title from the connected catalogue,
 * so respond locally instead of making a server request. Requests are serialized
 * while this lightweight compatibility adapter is installed.
 */
async function withLocalMetadata<T>(media: CineflixMedia, task: () => Promise<T>): Promise<T> {
  let release: (() => void) | undefined;
  const previous = resolverQueue;
  resolverQueue = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;

  const nativeFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (/^\/?api\/tmdb\/(?:movie|tv)\//.test(url)) {
      const requestedLanguage = new URL(url, 'https://cineflix.local').searchParams.get('language') ?? 'en-US';
      const title = media.translatedTitles?.[requestedLanguage] ?? media.title;
      return new Response(
        JSON.stringify({ title, name: title, original_title: media.title, original_name: media.title }),
        { headers: { 'Content-Type': 'application/json' } },
      );
    }
    return nativeFetch(input, init);
  };

  try {
    return await task();
  } finally {
    globalThis.fetch = nativeFetch;
    release?.();
  }
}
