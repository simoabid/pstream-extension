/**
 * The provider engine only needs the browser FormData constructor. Aliasing the
 * Node `form-data` package avoids pulling its stream and crypto dependencies
 * into a Manifest V3 service worker bundle.
 */
const BrowserFormData = globalThis.FormData;

export default BrowserFormData;
