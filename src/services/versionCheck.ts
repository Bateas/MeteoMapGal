/**
 * Is a newer deploy published than the one this tab is running?
 *
 * The page itself is always fresh (the service worker fetches navigations from the network),
 * but a tab or installed app that stays open keeps the code it loaded, and nothing told it a
 * newer one existed: on 25-sep a field report came in from a build three releases old, with
 * the old report box. Every build has its own hashed entry script, so comparing the one this
 * tab loaded with the one the published page references answers the question without any
 * version file to keep in sync.
 */

const MAIN_RE = /\/assets\/(main-[A-Za-z0-9_-]+\.js)/;

/** Entry bundle name referenced by an HTML document, or null if it has none. */
export function mainBundleOf(html: string): string | null {
  return MAIN_RE.exec(html)?.[1] ?? null;
}

/** True only when both bundles are known and differ. Unknown on either side is never "new":
 *  an error page or a dev server must not ask anyone to reload. */
export function isNewerDeploy(loadedSrc: string | null, publishedHtml: string): boolean {
  const loaded = loadedSrc ? mainBundleOf(loadedSrc) : null;
  const published = mainBundleOf(publishedHtml);
  return loaded !== null && published !== null && loaded !== published;
}
