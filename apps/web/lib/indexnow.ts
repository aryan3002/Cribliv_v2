/**
 * IndexNow client (https://www.indexnow.org/). Submitting changed URLs makes
 * Bing, Yandex, Naver, Seznam pick them up within minutes instead of weeks.
 *
 * Behaviour:
 *  - Reads INDEXNOW_KEY from env; no-op when unset (local/dev safe default).
 *  - Single-URL submissions use GET; batch uses POST.
 *  - Best-effort: timeouts & errors are swallowed so the caller never blocks
 *    on a search-engine endpoint.
 */

const ENDPOINT = "https://api.indexnow.org/indexnow";
const TIMEOUT_MS = 4000;

function getConfig() {
  return {
    key: process.env.INDEXNOW_KEY?.trim() ?? "",
    host:
      process.env.INDEXNOW_HOST?.trim() ??
      (process.env.NEXT_PUBLIC_SITE_URL ?? "https://cribliv.com").replace(/^https?:\/\//, "")
  };
}

export async function submitUrl(url: string): Promise<boolean> {
  const { key, host } = getConfig();
  if (!key || !url) return false;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const u = new URL(ENDPOINT);
    u.searchParams.set("url", url);
    u.searchParams.set("key", key);
    u.searchParams.set("host", host);
    const res = await fetch(u.toString(), { method: "GET", signal: controller.signal });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

export async function submitUrls(urls: string[]): Promise<boolean> {
  const { key, host } = getConfig();
  if (!key || urls.length === 0) return false;
  if (urls.length === 1) return submitUrl(urls[0]);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        host,
        key,
        keyLocation: `https://${host}/${key}.txt`,
        urlList: urls.slice(0, 10000)
      }),
      signal: controller.signal
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}
