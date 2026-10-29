# CINEFLIX Browser Resolver Extension

Resolve and prepare CINEFLIX streams entirely in the user's browser.

This extension is the browser-only counterpart to `cineflix-core`: it executes
the CINEFLIX provider engine in its service worker, uses browser-granted host
access for provider requests, and configures playback headers with
`declarativeNetRequest`. No CinePro/Core HTTP server, remote CORS proxy, or
server-side stream resolver is required.

## About

The extension is an optional browser capability for CINEFLIX. Once a site is
enabled in the popup, it can use the same browser provider catalogue as the
main app, including source and embed resolution, ranked fallbacks, captions
returned by providers, stream-header preparation, and CORS-safe provider
fetches.

The extension deliberately does not include API secrets. The calling page must
pass the title, year, TMDB id, and (for shows) season and episode metadata it
already has. This keeps the whole resolve flow local to the browser.

## CINEFLIX page bridge

The content script exposes a small `window.postMessage` bridge to the enabled
page. Requests must include `direction: 'cineflix-to-extension'`, a unique
`requestId`, an action type, and a payload. Responses use
`direction: 'extension-to-cineflix'` and the same `requestId`.

Available actions:

- `LIST_PROVIDERS` — lists the enabled source and embed metadata.
- `RESOLVE_MEDIA` — runs ranked source/embed fallbacks for a full media object.
- `RESOLVE_SOURCE` — runs one named source.
- `RESOLVE_EMBED` — resolves one embed URL.
- `MAKE_REQUEST` — performs an extension-hosted HTTP request with provider
  headers applied through declarative net request rules.
- `PREPARE_STREAM` — keeps required playback headers and CORS relaxation active
  for stream CDN domains.

The bridge is restricted to sites explicitly enabled in the popup. The
extension sets `window.__CINEFLIX_EXTENSION_ACTIVE__` in the page's main world
as soon as the content script connects, so the CINEFLIX client selects its
extension fetcher.

In simple terms: it acts as a local proxy. Imagine it opens an invisible tab to extract (scrape) the stream from the desired website. The only difference is that the extension can send specific headers, cookies, and is locally based. Some sources have restrictions that block scrapers; the extension helps us bypass that, such as IP restrictions, where the stream needs to be loaded on the same IP that it was originally scraped from.

In more complex terms: It uses the declarativeNetRequest API to connect to third party sites and fetch their html content. Because browsers have Cross Origin Resource Security (CORS) that protects sites from fetching content from other sites, a proxy is needed. This extension acts as a local proxy to bypass CORS and fetch the content.

During the onboarding process (/onboarding) the user can select between 3 options:
- Extension - This gives the user the most sources —sometimes with the best quality. (This extension)
- Custom Proxy - The user can host their own remote proxy on a service like Netlify to bypass restrictions, however, it can't do everything the extension can.
- Default Setup - This is the default and requires no user action, just pick it and watch. The site comes with default proxies already configured. The downsides are you are sharing bandwidth with other users and there are fewer sources.

### Why does the extension ask to "Access Data on All Sites"?
- This project (movie-web) is designed to be 100% self-hostable and is completely open-source. Hard coding a set list of sites that it asks for permission would prevent the extension from working on self-hosted sites. The user would need to edit the code to manually add their site to the permission list.
- Because we scrape from many sites, it would be tedious to allow every site.

## Safety
- It's **not required** to use P-Stream, it's entirely optional. 
- It doesn't track the user in any way or send data to any site besides the site you intend to use it with.
- **All of the code is open-source and anyone can inspect it.** 
- The extension **must** be enabled on a per site basis, otherwise the connecting site cannot talk to the extension (using runtime.sendMessage). 
> Previously offical sites were hardcoded to automatically be enabled on, but due to concerns about how this could be abused, that has been removed. **We do not believe this was ever exploited.**

### Will this ever work with Safari?
TL:DR: No, Apple's restrictions make it impossible currently.

1. Problem's with WebKit’s declarativeNetRequest API:
The extension is a local CORS proxy used to change request headers so we can scrape content. However, WebKit’s implementation is “incomplete”… Half of the headers that we need to change, simply don’t work because Apple has blacklisted many, and some are simply half-baked. https://bugs.webkit.org/show_bug.cgi?id=290922

2. Orion (A Webkit browser with extension support) had 2 issues: 
Firstly, Orion is using WebKit’s DNR API, which is the main problem. Technically it’s possible for them to use Firefox’s for example, but it hasn’t been done yet. Secondly, the runtime.sendMessage API is currently broken in Orion. So the extension literally cannot talk to the website and vice verca. 
https://orionfeedback.org/d/8053-extensions-support-for-declarativenetrequest-redirects/11

These can both be fixed, and I’m surprised WebKit’s APIs are so under-baked but it is what it is. 

## Running for development

We use pnpm with the latest version of NodeJS.

```sh
pnpm i
pnpm dev
```

## Building for production

```sh
pnpm i
pnpm build
or
pnpm build:firefox
```
