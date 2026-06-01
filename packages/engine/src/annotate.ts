import sharp from "sharp";

const FETCH_TIMEOUT_MS = 5000;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MB

// Validate that an imageUrl is safe to fetch server-side.
// Only https: and data: URIs are allowed; http: is rejected to
// prevent SSRF via private IPs / cloud metadata endpoints.
function assertSafeUrl(url: string): void {
  if (url.startsWith("data:")) return;
  const parsed = new URL(url);
  if (parsed.protocol !== "https:") {
    throw new Error(
      `prevImageUrl must use https: or data: protocol, got ${parsed.protocol}`,
    );
  }
  const host = parsed.hostname;
  if (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "0.0.0.0" ||
    host.startsWith("192.168.") ||
    host.startsWith("10.") ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(host) ||
    host === "169.254.169.254"
  ) {
    throw new Error(
      `prevImageUrl resolves to a private/reserved IP: ${host}`,
    );
  }
}

// Pull the bytes from an image URL or data URI into a Buffer suitable for
// sharp. Data URIs are decoded inline (no network); https: URLs are fetched
// with a short timeout — if Runware's CDN is slow we'd rather fail the vision
// step quickly than tie up a 60s Vercel function on a single image read.
async function loadImageBuffer(imageUrl: string): Promise<Buffer> {
  assertSafeUrl(imageUrl);

  if (imageUrl.startsWith("data:")) {
    const comma = imageUrl.indexOf(",");
    if (comma === -1) throw new Error("Malformed data URI in prevImageUrl");
    const b64 = imageUrl.slice(comma + 1);
    return Buffer.from(b64, "base64");
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(imageUrl, { signal: ctrl.signal });
    if (!res.ok) {
      throw new Error(
        `Failed to fetch prevImageUrl (${res.status}): ${imageUrl.slice(0, 120)}`,
      );
    }
    const contentLength = res.headers.get("content-length");
    if (contentLength && Number(contentLength) > MAX_IMAGE_BYTES) {
      throw new Error(
        `prevImageUrl response too large (${contentLength} bytes, max ${MAX_IMAGE_BYTES})`,
      );
    }
    const arr = await res.arrayBuffer();
    if (arr.byteLength > MAX_IMAGE_BYTES) {
      throw new Error(
        `prevImageUrl response too large (${arr.byteLength} bytes, max ${MAX_IMAGE_BYTES})`,
      );
    }
    return Buffer.from(arr);
  } finally {
    clearTimeout(timer);
  }
}

// Marks the player's click point on the scene image so the vision LLM can see
// WHERE they tapped. Output is base64 because the vision LLM is called over
// the OpenAI-compatible chat endpoint, which only accepts image_url data URIs
// — we can't hand it a Runware CDN URL directly.
export async function annotateClick(
  imageUrl: string,
  click: { x: number; y: number },
): Promise<string> {
  const buf = await loadImageBuffer(imageUrl);

  const resized = await sharp(buf)
    .resize({ width: 768, withoutEnlargement: true, fit: "inside" })
    .png()
    .toBuffer();

  const meta = await sharp(resized).metadata();
  const w = meta.width ?? 768;
  const h = meta.height ?? 1152;

  const cx = Math.round(click.x * w);
  const cy = Math.round(click.y * h);
  const r = Math.max(8, Math.round(Math.min(w, h) * 0.025));
  const stroke = Math.max(2, Math.round(r * 0.25));

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="rgba(255,40,40,0.55)"
            stroke="rgba(255,255,255,0.95)" stroke-width="${stroke}" />
    <circle cx="${cx}" cy="${cy}" r="${Math.round(r * 0.25)}"
            fill="rgba(255,255,255,1)" />
  </svg>`;

  const out = await sharp(resized)
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .png({ compressionLevel: 9 })
    .toBuffer();

  return out.toString("base64");
}
