import { flags } from '../../../src/lib/providers/engine/entrypoint/utils/targets';
import { type SourcererOutput, makeSourcerer } from '../../../src/lib/providers/engine/providers/base';
import type { Caption } from '../../../src/lib/providers/engine/providers/captions';
import type { MovieScrapeContext, ShowScrapeContext } from '../../../src/lib/providers/engine/utils/context';
import { NotFoundError } from '../../../src/lib/providers/engine/utils/errors';

type VidrockStream = {
  url: string | null;
  language?: string | null;
  type?: string | null;
};

type VidrockStreams = Record<string, VidrockStream>;

const API_BASE = 'https://vidrock.ru/api';
const SUBTITLE_BASE = 'https://sub.vdrk.site';
const REFERER = 'https://vidrock.ru/';
const HEADERS = {
  Accept: 'application/json, text/javascript, */*; q=0.01',
  'Accept-Language': 'en-US,en;q=0.9',
  Origin: 'https://vidrock.ru',
  Referer: REFERER,
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
};

const KEY_HEX = '7f3e9c2a8b5d1f4e6a9c3b7d2e5f8a1c4b6d9e2f5a8c1b4d7e9f2a5c8b1d4e7f';

let decryptionKey: CryptoKey | undefined;

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

function base64UrlToBytes(value: string): Uint8Array {
  const padded = value
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(Math.ceil(value.length / 4) * 4, '=');
  const decoded = atob(padded);
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
}

function copyBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

async function getDecryptionKey(): Promise<CryptoKey> {
  if (!decryptionKey) {
    decryptionKey = await crypto.subtle.importKey('raw', copyBuffer(hexToBytes(KEY_HEX)), { name: 'AES-GCM' }, false, [
      'decrypt',
    ]);
  }
  return decryptionKey;
}

async function decryptUrl(ciphertext: string): Promise<string> {
  const payload = base64UrlToBytes(ciphertext);
  if (payload.byteLength < 28) throw new Error('VidRock ciphertext is too short.');
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: copyBuffer(payload.slice(0, 12)) },
    await getDecryptionKey(),
    copyBuffer(payload.slice(12)),
  );
  return new TextDecoder().decode(plain);
}

function apiUrl(media: MovieScrapeContext['media'] | ShowScrapeContext['media']): string {
  if (media.type === 'movie') return `${API_BASE}/movie/${encodeURIComponent(media.tmdbId)}`;
  return `${API_BASE}/tv/${encodeURIComponent(media.tmdbId)}/${media.season.number}/${media.episode.number}`;
}

async function getCaptions(ctx: MovieScrapeContext | ShowScrapeContext): Promise<Caption[]> {
  const subtitleUrl =
    ctx.media.type === 'movie'
      ? `${SUBTITLE_BASE}/v2/movie/${encodeURIComponent(ctx.media.tmdbId)}`
      : `${SUBTITLE_BASE}/v2/tv/${encodeURIComponent(ctx.media.tmdbId)}/${ctx.media.season.number}/${ctx.media.episode.number}`;

  try {
    const subtitles = await ctx.proxiedFetcher<Array<{ label?: string; file?: string }>>(subtitleUrl, {
      headers: { ...HEADERS, Referer: REFERER },
    });
    if (!Array.isArray(subtitles)) return [];
    return subtitles
      .filter((subtitle): subtitle is { label?: string; file: string } => typeof subtitle.file === 'string')
      .map((subtitle) => ({
        id: subtitle.file,
        url: subtitle.file,
        language: subtitle.label ?? 'Unknown',
        type: 'vtt' as const,
        hasCorsRestrictions: true,
      }));
  } catch {
    return [];
  }
}

async function scrapeVidrock(ctx: MovieScrapeContext | ShowScrapeContext): Promise<SourcererOutput> {
  const response = await ctx.proxiedFetcher<VidrockStreams>(apiUrl(ctx.media), { headers: HEADERS });
  if (!response || typeof response !== 'object' || Array.isArray(response)) {
    throw new NotFoundError('VidRock returned no stream list.');
  }

  const captions = await getCaptions(ctx);
  const streams = await Promise.all(
    Object.entries(response).map(async ([server, stream]) => {
      if (!stream?.url) return null;
      try {
        const url = await decryptUrl(stream.url);
        if (!/^https?:\/\//i.test(url)) return null;
        const isFile = stream.type === 'mp4' || (stream.type !== 'hls' && url.includes('.mp4'));
        return isFile
          ? {
              id: server,
              type: 'file' as const,
              qualities: { unknown: { type: 'mp4' as const, url } },
              captions,
              flags: [flags.CORS_ALLOWED],
              headers: HEADERS,
              skipValidation: true,
            }
          : {
              id: server,
              type: 'hls' as const,
              playlist: url,
              captions,
              flags: [flags.CORS_ALLOWED],
              headers: HEADERS,
              skipValidation: true,
            };
      } catch {
        return null;
      }
    }),
  );

  const validStreams = streams.filter((stream): stream is NonNullable<typeof stream> => stream !== null);
  if (validStreams.length === 0) throw new NotFoundError('VidRock returned no decryptable streams.');
  return { embeds: [], stream: validStreams };
}

/** Browser-native implementation of the current CinePro VidRock provider. */
export const vidrockScraper = makeSourcerer({
  id: 'vidrock',
  name: 'VidRock',
  rank: 270,
  flags: [],
  scrapeMovie: scrapeVidrock,
  scrapeShow: scrapeVidrock,
});
