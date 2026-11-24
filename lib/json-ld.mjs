const ESCAPES = { '<': '\\u003c', '>': '\\u003e', '&': '\\u0026' };

/**
 * JSON for an inline <script type="application/ld+json">: <, > and & become \u escapes
 * so data can never close the script tag. JSON.parse reads them back unchanged.
 */
export function jsonLd(value) {
  return JSON.stringify(value).replace(/[<>&]/g, (c) => ESCAPES[c]);
}
