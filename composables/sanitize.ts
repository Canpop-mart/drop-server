import DOMPurify from "isomorphic-dompurify";

/**
 * Sanitize HTML for use with `v-html`.
 *
 * We accept user-authored Markdown (game descriptions, news articles) and
 * render it to HTML via `micromark`. Micromark's own docs note that its
 * output "is safe by default" only against malicious Markdown — raw HTML
 * embedded inside Markdown passes straight through. So any `v-html` sink
 * that derives from user content MUST go through this function first.
 *
 * The config is intentionally conservative:
 *   - `ALLOW_DATA_ATTR: false` — drop data-* attrs, they're not needed by
 *     anything we render and can ferry payload data into scripts.
 *   - `USE_PROFILES: { html: true }` — uses DOMPurify's curated HTML profile
 *     which already strips <script>, event handlers, javascript: URIs,
 *     <iframe>, <object>, <embed>, etc.
 *   - `FORBID_TAGS: ['style']` — inline <style> can exfil via CSS selector
 *     attacks; we never want author-controlled stylesheets.
 *
 * Server-side render goes through jsdom (shipped with isomorphic-dompurify)
 * so first-paint HTML is already sanitized, not deferred to client hydration.
 */
export function sanitizeHtml(input: string): string {
  if (!input) return "";
  return DOMPurify.sanitize(input, {
    USE_PROFILES: { html: true },
    ALLOW_DATA_ATTR: false,
    FORBID_TAGS: ["style"],
  });
}
