import sharp from "sharp";

let cachedDataUri: string | undefined;

// A static 16:9 placeholder used when MOCK_IMAGE=true, so we can exercise the
// TTS path without paying for image generation. Generated once, then memoized.
// Returned as a data URI so the rest of the pipeline can treat it as an
// `imageUrl` interchangeably with real Runware URLs (the client's <img src>
// accepts both, and we never feed a mock image to Runware's referenceImages
// because mockImage mode short-circuits the Painter entirely).
export async function mockImageDataUri(): Promise<string> {
  if (cachedDataUri) return cachedDataUri;

  const W = 1792;
  const H = 1024;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <rect width="${W}" height="${H}" fill="#161109"/>
    <rect x="2" y="2" width="${W - 4}" height="${H - 4}" fill="none"
          stroke="#5a4628" stroke-width="3" stroke-dasharray="14 10"/>
    <text x="50%" y="45%" fill="#b88f4a" font-family="Georgia, serif"
          font-size="72" letter-spacing="6" text-anchor="middle">MOCK IMAGE</text>
    <text x="50%" y="53%" fill="#6e5430" font-family="Georgia, serif"
          font-size="30" letter-spacing="3" text-anchor="middle">TTS TEST — image generation skipped</text>
  </svg>`;

  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  cachedDataUri = `data:image/png;base64,${png.toString("base64")}`;
  return cachedDataUri;
}
