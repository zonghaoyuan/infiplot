import type { Orientation } from "@infiplot/types";

// Static SVG placeholder used when MOCK_IMAGE=true, so we can exercise the
// TTS path without paying for image generation. Returned as a data URI so the
// rest of the pipeline can treat it as an `imageUrl` interchangeably with
// real Runware URLs (the client's <img src> accepts both, and we never feed
// a mock image to Runware's referenceImages because mockImage mode
// short-circuits the Painter entirely).
//
// Previously rendered to PNG via sharp; switched to a self-describing SVG
// data URI so the engine has zero Node-native dependencies and runs on
// Cloudflare Workers. SVG also stays crisp at any display size.

function buildDataUri(w: number, h: number): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
  <rect width="${w}" height="${h}" fill="#161109"/>
  <rect x="2" y="2" width="${w - 4}" height="${h - 4}" fill="none" stroke="#5a4628" stroke-width="3" stroke-dasharray="14 10"/>
  <text x="50%" y="45%" fill="#b88f4a" font-family="Georgia, serif" font-size="72" letter-spacing="6" text-anchor="middle">MOCK IMAGE</text>
  <text x="50%" y="53%" fill="#6e5430" font-family="Georgia, serif" font-size="30" letter-spacing="3" text-anchor="middle">TTS TEST — image generation skipped</text>
</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

// Mirror the real Painter's dimensions per orientation so mock mode exercises
// the same portrait/landscape layout the client renders for real images.
const LANDSCAPE = buildDataUri(1792, 1024);
const PORTRAIT = buildDataUri(1024, 1792);

export async function mockImageDataUri(
  orientation: Orientation = "landscape",
): Promise<string> {
  return orientation === "portrait" ? PORTRAIT : LANDSCAPE;
}
