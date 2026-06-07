import JSZip from "jszip";

export type ImageZipFile = {
  url: string;
  name: string;
};

export type ImageZipDownloadResult = {
  downloaded: number;
  failed: ImageZipFile[];
};

type DownloadOptions = {
  concurrency?: number;
  timeoutMs?: number;
};

const DEFAULT_CONCURRENCY = 4;
const DEFAULT_TIMEOUT_MS = 20_000;

export function inferImageExtension(url: string): string {
  const dataMatch = /^data:image\/([^;,]+)/i.exec(url);
  if (dataMatch?.[1]) {
    const sub = dataMatch[1].toLowerCase();
    if (sub === "svg+xml") return "svg";
    return sub === "jpeg" ? "jpg" : sub;
  }

  try {
    const base =
      typeof window !== "undefined" ? window.location.href : "http://localhost";
    const ext = new URL(url, base).pathname.split(".").pop()?.toLowerCase();
    if (ext && ["jpg", "jpeg", "png", "webp", "gif", "svg"].includes(ext)) {
      return ext === "jpeg" ? "jpg" : ext;
    }
  } catch {
    // Fall through to the historical default used by gallery downloads.
  }

  return "jpg";
}

export async function downloadImagesAsZip(
  files: ImageZipFile[],
  zipName: string,
  options: DownloadOptions = {},
): Promise<ImageZipDownloadResult> {
  const filtered = files.filter((file) => file.url && file.name);
  if (filtered.length === 0) return { downloaded: 0, failed: [] };

  const blobs = await fetchImageBlobs(filtered, options);
  const zip = new JSZip();
  const usedPaths = new Set<string>();
  const failed: ImageZipFile[] = [];
  let downloaded = 0;

  for (let i = 0; i < filtered.length; i++) {
    const file = filtered[i]!;
    const blob = blobs[i];
    if (!blob) {
      failed.push(file);
      continue;
    }
    zip.file(uniqueZipPath(file.name, usedPaths), blob, { date: new Date() });
    downloaded++;
  }

  if (downloaded === 0) return { downloaded, failed };

  const blob = await zip.generateAsync({ type: "blob", compression: "STORE" });
  triggerBrowserDownload(blob, normalizeZipName(zipName));
  return { downloaded, failed };
}

export async function downloadImagesIndividually(
  files: ImageZipFile[],
  options: DownloadOptions = {},
): Promise<ImageZipDownloadResult> {
  const filtered = files.filter((file) => file.url && file.name);
  if (filtered.length === 0) return { downloaded: 0, failed: [] };

  const blobs = await fetchImageBlobs(filtered, options);
  const failed: ImageZipFile[] = [];
  let downloaded = 0;

  for (let i = 0; i < filtered.length; i++) {
    const file = filtered[i]!;
    const blob = blobs[i];
    if (!blob) {
      failed.push(file);
      continue;
    }
    triggerBrowserDownload(blob, file.name);
    downloaded++;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  return { downloaded, failed };
}

async function fetchImageBlobs(
  files: ImageZipFile[],
  options: DownloadOptions,
): Promise<(Blob | null)[]> {
  const concurrency = Math.max(1, options.concurrency ?? DEFAULT_CONCURRENCY);
  const timeoutMs = Math.max(1000, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const queue = files.map((file, index) => ({ file, index }));
  const blobs = new Array<Blob | null>(files.length).fill(null);

  await Promise.all(
    Array.from({ length: Math.min(concurrency, files.length) }, async () => {
      while (queue.length > 0) {
        const next = queue.shift();
        if (!next) break;
        blobs[next.index] = await fetchImageBlob(next.file.url, timeoutMs);
      }
    }),
  );

  return blobs;
}

async function fetchImageBlob(url: string, timeoutMs: number): Promise<Blob | null> {
  if (!url) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const init: RequestInit = { signal: ctrl.signal };
    if (!url.startsWith("data:")) init.mode = "cors";
    const response = await fetch(url, init);
    if (!response.ok) return null;
    const blob = await response.blob();
    return blob.size > 0 ? blob : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function triggerBrowserDownload(blob: Blob, fileName: string): void {
  const blobUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = blobUrl;
  a.download = fileName;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  const delayMs = blob.size > 5_000_000 ? 60_000 : 1_500;
  setTimeout(() => URL.revokeObjectURL(blobUrl), delayMs);
}

function normalizeZipName(name: string): string {
  const trimmed = name.trim() || "images.zip";
  return trimmed.toLowerCase().endsWith(".zip") ? trimmed : `${trimmed}.zip`;
}

function uniqueZipPath(name: string, usedPaths: Set<string>): string {
  const clean = sanitizeZipPath(name);
  if (!usedPaths.has(clean)) {
    usedPaths.add(clean);
    return clean;
  }

  const dot = clean.lastIndexOf(".");
  const base = dot > 0 ? clean.slice(0, dot) : clean;
  const ext = dot > 0 ? clean.slice(dot) : "";
  for (let n = 2; n < 10_000; n++) {
    const candidate = `${base}-${n}${ext}`;
    if (!usedPaths.has(candidate)) {
      usedPaths.add(candidate);
      return candidate;
    }
  }
  const fallback = `${base}-${Date.now()}${ext}`;
  usedPaths.add(fallback);
  return fallback;
}

function sanitizeZipPath(name: string): string {
  const parts = name
    .replace(/\\/g, "/")
    .split("/")
    .map((part) => part.replace(/[^\w.\-\u4e00-\u9fff]/g, "_"))
    .filter((part) => part && part !== "." && part !== "..");

  return parts.join("/") || "image.jpg";
}
