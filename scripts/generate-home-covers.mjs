#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = resolve(__dirname, "..");
const ENV_FILE = resolve(WEB_ROOT, ".env.local");
const OUT_DIR = resolve(WEB_ROOT, "public", "home");

const FORCE = process.argv.includes("--force");

/* ---------- env loading ---------- */
function loadEnv(path) {
  const txt = readFileSync(path, "utf8");
  const env = {};
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const k = line.slice(0, eq).trim();
    let v = line.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    env[k] = v;
  }
  return env;
}

const env = loadEnv(ENV_FILE);
const BASE_URL = env.IMAGE_BASE_URL;
const API_KEY = env.IMAGE_API_KEY;
const MODEL = env.IMAGE_MODEL;

if (!BASE_URL || !API_KEY || !MODEL) {
  console.error("Missing IMAGE_BASE_URL / IMAGE_API_KEY / IMAGE_MODEL in", ENV_FILE);
  process.exit(2);
}

const STYLE_PROMPTS = [
  "Dark fantasy oil painting style, a sprawling clockwork steampunk city built into a mountain range at twilight, immense gothic spires with glowing green lamps, complex gears and platforms. Richly detailed, impasto texture, dramatic academic lighting. A grand airship arrives at a high dock. Horizontal composition with massive clear dark sky for typography.",
  "Minimalist Chinese ink wash style, a lone immortal cultivator sitting on a precipice, facing an endless sea of clouds and distant jagged peaks. Ethereal, sparse composition with poetic brushstrokes, monochrome palette with subtle blue hints. Very large blank mist area for text placement.",
  "Ukiyo-e woodblock print style, a majestic red and gold phoenix with elaborate trailing feathers rising above a wave-crested dark blue sea, Mount Fuji visible through cherry branches. Bold outlines, flat colors with paper texture, ancient and mystical atmosphere. Central clear area in the sea and sky for typography.",
  "Dunhuang fresco style, a celestial apsaras flying with flowing scarves, holding a Lute, surrounded by stylized lotus flowers and floating geometric patterns on an aged stucco wall. Muted, oxidized mineral colors, delicate line art, historical and divine ambiance. Side vertical area cleared for titles.",
  "Byzantine mosaic style, an iconic portrait of a warrior saint with golden armor and a halo, composed of thousands of small, glittering glass tesseræ. Deep blues and golds, spiritual and ancient feel, flat background. Background field of gold tiles left blank for text.",
  "Stained glass style, a depiction of a griffin battling a serpent, framed by gothic archways and trefoils. Vibrant, translucent jewel colors, bold black leading lines. The image should look like an ancient window panel. Outer panels of plain blue glass left clear for text.",
  "Ghibli hand-painted watercolor style, a detailed concept art of a girl and her small companion creature running through a vast wildflower meadow toward a fantastical airship. Natural daylight, soft washes, nostalgic feel. Upper left sky area is negative space for typography.",
  "KyoAni anime style, fine line art, a detailed high school girl sitting by a library window during light rain, warm library light contrasting the cool moonlight outside. Deep emotional atmosphere, delicate expression. Empty right-side foreground area for title.",
  "Makoto Shinkai anime style, hyper-detailed, a wide panoramic night view of a glowing cherry tree under a dramatic starry sky with a comet trail, a lonely high school girl in a uniform looking up. Brilliant lighting effects, vivid colors. Significant blank space in the upper atmosphere for text.",
  "Cyberpunk anime style, cel-shaded animation, a tech-wear protagonist standing on a rainy rooftop, looking out at a dense, neon-drenched futuristic megacity with flying vehicles. Hard edges, high saturation, sharp contrast. Massive upper background sky area for title placement.",
  "High-quality Galgame CG illustration, a dreamlike beach scene with sparkling waves, a beautiful girl with pastel pink hair in a white summer dress smiling warmly. Pastel colors, bloom lighting, clean composition, soft focus. Significant negative space in the sky and sea area for text.",
  "Cinematic 3D animated film style (like Makoto Shinkai or Pixar), a high-resolution render of a young boy pilot fixing a small propeller plane in a rustic hangar at sunrise. Volumetric lighting, warm colors, deep textures, cinematic composition. Blank wall space and open doorway area for text.",
  "Vaporwave aesthetic, anime style, a nostalgic portrait of a character with purple hair wearing sunglasses, a geometric grid floor and palm trees, background sunset over a purple ocean. Glitch effects, soft neon pink and blue palette, retro feel. Blank foreground grid area for title.",
  "Pop Art style illustration, a close-up of a glamorous woman with red lips and a speech bubble with an exclamation point, rendered with comic book dots and bold outlines. High-saturation contrasting colors. Speech bubble and large background color blocks left blank for text.",
  "Glitch art style portrait, a character profile distorted by data corruption, pixel sorting, and digital artifacts in cyan, magenta, and yellow. Cybernetic, high-tech and moody atmosphere. Dark, uncorrupted negative space in the upper background for typography.",
  "Multilayered papercut art style, a 3D landscape of a deep forest and a fairytale castle, made of staggered paper layers with intricate cutouts. Backlighting, soft shadows, dimensional depth. Blank background layer cleared for title placement.",
  "Solar Punk art style, a wide view of a sustainable, futuristic city integrated with dense green rooftop gardens and vertical farms, illuminated by clean solar and wind energy. Bright, optimistic lighting, organic textures. Large foreground plaza area cleared for titles.",
  "Dark cosmic horror illustration, a lone explorer stands on a desolate shore, gazing at a massive, ancient, indescribable eldritch entity rising from a stormy sea. Moody, muted cool colors, dramatic lighting, visible brushstrokes. The dark, stormy sky quadrant left completely blank for text.",
  "Modern urban noir, a minimalist silhouette of a man in a trench coat, standing in a dark, wet alleyway under a single buzzing neon sign reflecting on puddles. High contrast, cinematic noir lighting, deep shadows. The wet cobblestone ground left mostly dark for typography.",
  "Cozy mystery book cover illustration, a charming, warm English village scene at night, snow on the thatched roofs, golden light from a bookstore window, and a single cat perched on a fence. Comforting and mysterious feel. Significant background sky and foreground pavement area for title.",
  "Gothic romance illustration, a wide panoramic view of a young woman in a flowing dark velvet dress, standing before the desolate, moonlit ruins of a grand gothic manor on a foggy cliff. Muted greys and blues, romantic and melancholic. The upper background cliff and sky for bold titles.",
  "Dark fairytale illustration, a wide shot of a small girl in a red cloak walking into a massive, dark, twisted ancient forest where the trees look like claws. Grimm's style, classical illustration, mood of awe and dread. The dark foreground forest ground left blank for text.",
  "Post-apocalyptic landscape illustration, a vast desert wasteland with the rusted remains of overgrown highway and a fallen Statue of Liberty in the distance under a dusty orange sky. Muted cool and warm colors. Significant clear ground and sky area for text.",
  "Urban fantasy concept art, a detailed view of a hidden, glowing magical pathway revealed underneath a busy modern pedestrian bridge in a rain-streaked metropolitan city. Contrast of mundane and magical. Minimal detail in the wet street foreground and upper sky for titles."
];

const BASE_QUALITY = "masterpiece, best quality, highly detailed, cinematic lighting, soft warm color grading, intricate background, no text, no watermark";

const W = 1792;
const H = 1024;

async function generate(prompt) {
  const body = [
    {
      taskType: "imageInference",
      taskUUID: crypto.randomUUID(),
      model: MODEL,
      positivePrompt: `${prompt}, ${BASE_QUALITY}`,
      width: W,
      height: H,
      steps: 4,
      CFGScale: 3.5,
      numberResults: 1,
      outputType: "base64Data",
      outputFormat: "PNG",
    },
  ];

  const res = await fetch(BASE_URL.replace(/\/$/, ""), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
  }

  if (json.errors?.length) {
    const e = json.errors[0];
    throw new Error(`Runware [${e.code ?? "?"}]: ${e.message ?? "no msg"}`);
  }

  const b64 = json.data?.[0]?.imageBase64Data;
  if (!b64) throw new Error(`No image data in response: ${text.slice(0, 200)}`);
  return Buffer.from(b64, "base64");
}

async function main() {
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

  console.log(`[covers] Starting image generation for 48 covers (24 male, 24 female)...`);
  const t0 = Date.now();

  for (let i = 0; i < STYLE_PROMPTS.length; i++) {
    const stylePrompt = STYLE_PROMPTS[i];

    // Male Cover (m{i})
    const malePngName = `m${i}.png`;
    const malePngPath = resolve(OUT_DIR, malePngName);
    const maleWebpPath = resolve(OUT_DIR, `m${i}.webp`);
    if (!FORCE && (existsSync(malePngPath) || existsSync(maleWebpPath))) {
      console.log(`[covers] Skip m${i} (already exists)`);
    } else {
      console.log(`[covers] Generating m${i} ... `);
      try {
        const buf = await generate(stylePrompt);
        writeFileSync(malePngPath, buf);
        console.log(`[covers] m${i} successfully generated! size: ${buf.length} B`);
      } catch (e) {
        console.error(`[covers] FAIL generating m${i}: ${e.message}`);
      }
    }

    // Female Cover (f{i})
    const femalePngName = `f${i}.png`;
    const femalePngPath = resolve(OUT_DIR, femalePngName);
    const femaleWebpPath = resolve(OUT_DIR, `f${i}.webp`);
    if (!FORCE && (existsSync(femalePngPath) || existsSync(femaleWebpPath))) {
      console.log(`[covers] Skip f${i} (already exists)`);
    } else {
      console.log(`[covers] Generating f${i} ... `);
      try {
        const buf = await generate(stylePrompt);
        writeFileSync(femalePngPath, buf);
        console.log(`[covers] f${i} successfully generated! size: ${buf.length} B`);
      } catch (e) {
        console.error(`[covers] FAIL generating f${i}: ${e.message}`);
      }
    }
  }

  console.log(`[covers] Finished generating all covers in ${((Date.now() - t0)/1000).toFixed(1)}s.`);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
