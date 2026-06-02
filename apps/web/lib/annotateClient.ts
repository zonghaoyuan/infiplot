const TARGET_WIDTH = 768;

// Browser-side equivalent of the former engine/src/annotate.ts. Redraws the
// scene image with the player's click marker on a Canvas 2D and returns the
// raw PNG base64 (no `data:` prefix) — interpretClick wraps it back into a
// data URL before posting to the vision LLM.
//
// crossOrigin="anonymous" + the CDN's Access-Control-Allow-Origin header are
// both required to keep the canvas un-tainted; without them toDataURL throws
// SecurityError. Runware's image CDN supports anonymous CORS; data: URIs
// (MOCK_IMAGE mode) load without CORS.
export async function annotateClick(
  imageUrl: string,
  click: { x: number; y: number },
): Promise<string> {
  const img = await loadImage(imageUrl);

  const scale = Math.min(1, TARGET_WIDTH / img.naturalWidth);
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");

  ctx.drawImage(img, 0, 0, w, h);

  const cx = Math.round(click.x * w);
  const cy = Math.round(click.y * h);
  const r = Math.max(8, Math.round(Math.min(w, h) * 0.025));
  const stroke = Math.max(2, Math.round(r * 0.25));

  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255,40,40,0.55)";
  ctx.fill();
  ctx.lineWidth = stroke;
  ctx.strokeStyle = "rgba(255,255,255,0.95)";
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(cx, cy, Math.max(2, Math.round(r * 0.25)), 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255,255,255,1)";
  ctx.fill();

  const dataUrl = canvas.toDataURL("image/png");
  return dataUrl.replace(/^data:image\/png;base64,/, "");
}

// 10s timeout mirrors the old server-side annotator's 5s fetch budget +
// headroom for browser decode. Without it a hung CDN response would strand
// the player in `vision-thinking` forever.
function loadImage(
  url: string,
  timeoutMs = 10_000,
): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const timer = setTimeout(() => {
      // removeAttribute, not `src = ""` — setting empty string can trigger
      // a navigation to the current document URL in some browsers.
      img.removeAttribute("src");
      reject(new Error(`Image load timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    img.crossOrigin = "anonymous";
    img.onload = () => {
      clearTimeout(timer);
      resolve(img);
    };
    img.onerror = () => {
      clearTimeout(timer);
      reject(
        new Error(`Failed to load image for annotation: ${url.slice(0, 80)}`),
      );
    };
    img.src = url;
  });
}
