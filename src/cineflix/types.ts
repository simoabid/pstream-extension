/**
 * Public, browser-safe request types for the Cineflix resolver.
 *
 * The core server accepted a TMDB id and looked the title up with its private
 * API key. An extension cannot safely ship that key, so callers pass metadata
 * they already have from their catalogue page instead.
 */
export type CineflixMovie = {
  type: 'movie';
  tmdbId: string;
  title: string;
  releaseYear: number;
  imdbId?: string;
  /** Optional caller-provided localizations, keyed by BCP 47 language tag. */
  translatedTitles?: Record<string, string>;
};

export type CineflixShow = {
  type: 'show';
  tmdbId: string;
  title: string;
  releaseYear: number;
  imdbId?: string;
  translatedTitles?: Record<string, string>;
  season: {
    number: number;
    tmdbId: string;
    title: string;
    episodeCount?: number;
  };
  episode: {
    number: number;
    tmdbId: string;
  };
};

export type CineflixMedia = CineflixMovie | CineflixShow;

export type ResolveMediaRequest = {
  media: CineflixMedia;
  /** Prefer these sources first. Remaining sources keep their ranked order. */
  sourceOrder?: string[];
  /** Prefer these embeds first. Remaining embeds keep their ranked order. */
  embedOrder?: string[];
};

export type ResolveSourceRequest = {
  id: string;
  media: CineflixMedia;
};

export type ResolveEmbedRequest = {
  id: string;
  url: string;
};

export type ExtensionFetchRequest = {
  url: string;
  method?: 'HEAD' | 'GET' | 'POST';
  headers?: Record<string, string>;
  readHeaders?: string[];
  body?: unknown;
  bodyType?: 'string' | 'object' | 'URLSearchParams' | 'FormData';
  credentials?: RequestCredentials;
};

export type PrepareStreamRequest = {
  ruleId: number;
  targetDomains: string[];
  requestHeaders?: Record<string, string>;
  responseHeaders?: Record<string, string>;
};

export type CineflixMessage =
  | { type: 'LIST_PROVIDERS'; payload?: undefined }
  | { type: 'RESOLVE_MEDIA'; payload: ResolveMediaRequest }
  | { type: 'RESOLVE_SOURCE'; payload: ResolveSourceRequest }
  | { type: 'RESOLVE_EMBED'; payload: ResolveEmbedRequest }
  | { type: 'MAKE_REQUEST'; payload: ExtensionFetchRequest }
  | { type: 'PREPARE_STREAM'; payload: PrepareStreamRequest }
  | { type: 'CINEFLIX_BRIDGE_READY'; payload?: undefined };

export type CineflixSuccess<T> = { success: true } & T;
export type CineflixFailure = { success: false; error: string };
export type CineflixResponse<T> = CineflixSuccess<T> | CineflixFailure;
