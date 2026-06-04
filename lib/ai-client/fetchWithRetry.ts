type RetryInit = RequestInit & { retries?: number; retryDelayMs?: number };

export async function fetchWithRetry(
  url: string,
  init: RetryInit,
): Promise<Response> {
  const { retries = 2, retryDelayMs = 1500, ...fetchInit } = init;
  if (!fetchInit.redirect) fetchInit.redirect = "manual";

  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, fetchInit);
      if (res.ok) return res;
      // Don't retry 4xx (client errors won't fix themselves)
      if (res.status >= 400 && res.status < 500) return res;
      // 5xx: retry if we have budget left
      if (attempt < retries) {
        await sleep(retryDelayMs * (attempt + 1));
        continue;
      }
      return res;
    } catch (err) {
      lastError = err;
      const isAbort =
        err instanceof DOMException && err.name === "AbortError";
      if (isAbort) throw err;
      if (attempt < retries) {
        await sleep(retryDelayMs * (attempt + 1));
        continue;
      }
      throw err;
    }
  }
  throw lastError;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
