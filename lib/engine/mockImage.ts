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

const W = 1792;
const H = 1024;
const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <rect width="${W}" height="${H}" fill="#161109"/>
  <rect x="2" y="2" width="${W - 4}" height="${H - 4}" fill="none" stroke="#5a4628" stroke-width="3" stroke-dasharray="14 10"/>
  <text x="50%" y="45%" fill="#b88f4a" font-family="Georgia, serif" font-size="72" letter-spacing="6" text-anchor="middle">MOCK IMAGE</text>
  <text x="50%" y="53%" fill="#6e5430" font-family="Georgia, serif" font-size="30" letter-spacing="3" text-anchor="middle">TTS TEST — image generation skipped</text>
</svg>`;

const DATA_URI = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(SVG)}`;

export async function mockImageDataUri(): Promise<string> {
  return DATA_URI;
}
