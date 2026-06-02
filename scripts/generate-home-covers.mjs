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

// 30 Male-Oriented Custom Prompts (focused on power, handsome heroes, and action)
const MALE_PROMPTS = [
  "Dark fantasy oil painting style, vertical composition. Close-up portrait of a fiercely handsome grand mage with silver-streaked hair and glowing green magical eyes, wearing a tattered velvet robe with heavy steel chains wrapped around his shoulders. Behind him, a towering, ruined magical academy under a stormy dark sky. Dramatic chiaroscuro lighting, rich impasto textures.",
  "Minimalist Chinese ink wash style, vertical composition. An elegantly handsome young scholar with flowing robes, holding a luminous glowing calligraphy brush, standing on a misty cliff. From his brushstrokes, a magnificent monochrome dragon emerges into the sky. Ethereal, sparse composition, monochrome palette with subtle blue hints, large blank mist area at the top.",
  "Ukiyo-e woodblock print style, vertical composition. A fiercely handsome young samurai with sharp facial contours and long tied black hair, wielding a glowing katana. Background features crashing waves, cherry blossoms, and a distant Mount Fuji under a dramatic blood-orange sky. Bold outlines, flat colors with paper texture.",
  "Dunhuang fresco style, vertical composition. A ruggedly handsome young archaeologist with sharp features, discovering a glowing mural of a celestial apsaras inside a dark Dunhuang cave. Magical warm light reflecting on his face and the ancient stone walls. Muted mineral colors, divine and ancient ambiance.",
  "Persian miniature style, vertical composition. An attractive young Persian scholar in ornate robes, sitting in a beautiful tiled garden under a cypress tree, playing a gold-plated chess set with mechanical automatons. Flattened perspective, intricate gold filigree, jeweled colors, decorative borders.",
  "Byzantine mosaic style, vertical composition. An iconic portrait of a fiercely handsome warrior saint with sharp cheekbones, a strong jawline, wearing heavy gold plate armor and holding a glowing silver spear, a divine golden halo behind him. Composed of thousands of glittering glass tiles. Gold background field left blank.",
  "Stained glass style, vertical composition. An angelic, armored knight with a flawless, handsome visage, gripping a shining broadsword as he slashes a dark shadow serpent. Intricate gothic archway framing, brilliant jewel-like colors, bold black leading lines. The image resembles a tall cathedral window.",
  "Ghibli hand-painted style, vertical composition. An adventurous young boy hero with messy brown hair and bright, expressive eyes, standing next to a large friendly forest spirit in a lush, grassy woodland during golden hour. Soft watercolor washes, warm sunlight filtering through the trees.",
  "KyoAni anime style, vertical composition. A handsome high school boy animator with messy black hair and detailed, expressive eyes, looking at a magical glowing sketchpad in a quiet classroom. Soft twilight coming through the window, detailed everyday elements, nostalgic and emotional feel.",
  "Makoto Shinkai anime style, vertical composition. A handsome young man looking up at a towering, brilliant starry sky with a descending pink comet trail, cherry blossoms falling around him. Vivid blue and violet hues, dramatic volumetric light shafts, deep emotional atmosphere.",
  "Cyberpunk anime style, vertical composition. A highly attractive, edgy tech-wear rogue hacker with a glowing cybernetic arm and tactical goggles, standing on a rainy neon-lit skyscraper roof. Giant holographic ads and rain streaks in the background. Cool blue and magenta lighting.",
  "Galgame CG style, vertical composition. A handsome, detailed male student with messy hair standing on a beach at sunset, looking back and smiling warmly, holding out his hand. Sparkling orange waves, soft focus background, warm summer breeze atmosphere.",
  "Cinematic 3D animated film style, vertical composition. A ruggedly handsome young pilot with messy hair and expressive eyes, repairing a tall propeller aircraft engine in a rustic wooden hangar. Warm sunrise light streaming through the large hangar doors, dusty volumetric rays.",
  "Vaporwave aesthetic, vertical composition. A nostalgic portrait of a stylish young man with retro sunglasses and purple hair, standing before a grid pattern floor that leads to a palm tree silhouette, neon pink sunset over a purple ocean in the background. Glitch lines, retro pastel colors.",
  "Minimalist vector illustration, vertical composition. A sharp silhouette of an elegant male assassin in a flowing cloak, standing on top of a giant sand dune under a massive, glowing red sun. Geometric forms, clean flat vector colors, minimal styling, massive sky for typography.",
  "Low poly art style, vertical composition. A fiercely handsome elven warrior with sharp, geometric facial features and glowing crystal armor, standing on a faceted mountain peak under a starry poly night sky. Sharp polygon edges, ambient cool colors.",
  "Digital double exposure portrait, vertical composition. A sharp profile silhouette of a handsome detective, merged seamlessly with tall pine trees and a stormy, rain-slicked city street with flashing yellow lights. High contrast black and white with subtle neon accents.",
  "Pop Art style illustration, vertical composition. A captivating, handsome retro superhero with a strong jawline and confident smile, alongside a tall speech bubble with an exclamation point. Dot patterns, bold outlines, highly saturated primary colors.",
  "Glitch art style, vertical composition. A dangerously handsome rogue hacker with synthetic red eyes and a sharp jawline, his portrait distorted by colorful data corruption and neon scan lines in cyan and yellow. Cybernetic, high-tech and dark atmosphere.",
  "Swiss typography poster style, vertical composition. A minimalist high-contrast silhouette of an attractive male face integrated with abstract architectural grids. Deep red, black, and white color blocks, clean geometric poster layout.",
  "Multilayered papercut art, vertical composition. A beautifully intricate silhouette of a handsome prince in armor standing in a dark forest before a towering gothic paper castle. Backlighting, soft paper shadows, deep dimensional layering.",
  "Solar Punk art style, vertical composition. A charismatic, smiling young eco-engineer with detailed, expressive facial features, standing before a towering vertical green city with solar panels and hanging gardens. Warm optimistic sunlight.",
  "Dark cosmic horror illustration, vertical composition. A rugged, handsome investigator with terrified, intense eyes, holding a lantern as he gazes up at a towering, multi-eyed eldritch shadow emerging from a stormy ocean under a pitch-black sky.",
  "Modern urban noir, vertical composition. A dangerously handsome detective in a trench coat, standing in a dark, wet brick alleyway under a vertical neon sign reflecting in rain puddles. Deep shadows, high-contrast cinematic lighting.",
  "Cozy mystery illustration, vertical composition. A handsome young amateur sleuth in a tweed coat, looking through a magnifying glass inside a warm, candlelit village library at night, snow falling outside the window. Comforting, mysterious mood.",
  "Gothic romance style, vertical composition. A pale, strikingly handsome gothic lord in a black velvet coat, standing before the moonlit ruins of his grand manor on a foggy cliff. Melancholic blue and grey tones, misty atmosphere.",
  "Dark fairytale style, vertical composition. A handsome young hunter in a dark leather hood, holding a silver crossbow as he walks into a dense, ominous forest with towering twisted trees. Grimm's style, mood of suspense and dread.",
  "Post-apocalyptic style, vertical composition. A ruggedly attractive, battle-scarred male survivor with piercing eyes and a perfectly grimy face, standing in front of a ruined vertical skyscraper under a dusty orange desert sky.",
  "Urban fantasy concept art, vertical composition. A charismatic, handsome modern mage in a tailored suit, casting a glowing cyan spell that reveals a magical spiral staircase ascending into the rain-slicked city streets.",
  "Abstract geometric poster layout, vertical composition. A minimalist line-art profile of a handsome male face integrated with intersecting gold circles and emerald green shapes on a deep dark blue background. Elegant, clean abstract design."
];

// 30 Female-Oriented Custom Prompts (focused on elegant heroines, romantic elements, and beautiful emotional settings)
const FEMALE_PROMPTS = [
  "Dark fantasy oil painting style, vertical composition. A breathtakingly beautiful young bride in a white lace veil and gothic gown, sitting inside an ornate carved stone sarcophagus. Kneeling beside her is a pale, mesmerizingly handsome undead prince with a golden crown, gently holding her hand. Soft glowing embers rise around them in the dark mausoleum. Moody academic lighting, fine impasto textures.",
  "Minimalist Chinese ink wash style, vertical composition. A beautiful, serene young female artisan with long black hair, sitting on a mossy stone. Wrapping gently around her shoulders is a majestic, ethereal monochrome dragon with glowing blue eyes, looking down at her protectively. Ink splash details, poetic brushstrokes, soft mist background.",
  "Ukiyo-e woodblock print style, vertical composition. A breathtakingly beautiful Japanese woman (bijin) in an ornate, flowing silk kimono with exquisite cherry blossom patterns. She has an elegant, captivating face and traditional hair ornaments, holding a paper umbrella (wagasa) in a falling blossom shower under Mount Fuji. Flat colors, bold lines.",
  "Dunhuang fresco style, vertical composition. A breathtakingly beautiful celestial apsaras with delicate, mesmerizing facial features, flying upwards with flowing scarves, holding a Lute. Surrounded by stylized lotus flowers and floating geometric patterns on an aged stucco wall. Muted, oxidized mineral colors, divine and graceful ambiance.",
  "Persian miniature style, vertical composition. An exquisitely beautiful princess in a flowered silk tunic, dancing gracefully in an ornate palace courtyard surrounded by roses and cypress trees, a handsome prince watching her admiringly from a tiled balcony. High detail, flat perspective, brilliant jewel-like colors.",
  "Byzantine mosaic style, vertical composition. A stunningly beautiful mosaic portrait of a royal empress with large, captivating eyes, a crown of rubies and pearls, and a glittering golden halo. Composed of thousands of sparkling glass tesseræ in deep blues and golds. Majestic, spiritual, and ancient ambiance.",
  "Stained glass style, vertical composition. A breathtakingly beautiful angelic female knight with long flowing silver hair and a serene expression, wielding a glowing sword framed by a gothic archway. Translucent jewel-colored panels, bold black leading lines. The light shines through like a cathedral window.",
  "Ghibli hand-painted watercolor style, vertical composition. A charming, highly expressive young heroine with large, bright, attractive eyes and wind-blown hair, running up a wildflower meadow hill toward a fantastical airship in the sky. Natural daylight, soft washes, nostalgic and warm mood.",
  "KyoAni anime style, vertical composition. An incredibly beautiful high school girl with delicate, expressive facial features and lustrous hair, sitting by a tall library window during light rain. Warm library light contrasting the cool moonlight outside, deep emotional atmosphere. Soft focus, delicate linework.",
  "Makoto Shinkai anime style, vertical composition. A gorgeous young girl with luminous, tear-filled eyes and a highly attractive, detailed face, looking up at a towering, dramatic starry sky with a descending comet trail. Glowing cherry tree branches, brilliant lighting effects, vivid colors, deep romantic atmosphere.",
  "Cyberpunk anime style, vertical composition. An exquisitely beautiful female scientist with glowing cyan eyes, gently touching the cheek of a flawless, handsome male android she designed. Behind them, rain-slicked neon streets and soft glowing city lights. Atmospheric lighting, warm and futuristic mood.",
  "High-quality Galgame CG illustration, vertical composition. An exquisitely beautiful girl with perfectly detailed facial features, mesmerizing eyes, and pastel pink hair in a white summer dress smiling warmly. Dreamlike beach scene with sparkling waves rolling in. Pastel colors, bloom lighting, clean composition, soft focus.",
  "Cinematic 3D animated film style, vertical composition. An adorable, beautifully rendered young female mechanic with bright green eyes and messy hair, holding a glowing magical wrench, smiling next to a cute floating repair robot in a futuristic hangar at sunset. Soft volumetric light, warm tones.",
  "Vaporwave aesthetic, vertical composition. A gorgeous, highly stylized character with purple hair and striking facial contours, looking over lowered sunglasses in a retro summer setting. Geometric pink grid floor, palm trees, purple ocean sunset. Glitch filters, retro neon pink and cyan palette.",
  "Minimalist vector illustration, vertical composition. A stylized, elegant silhouette of a beautiful heroine with a flowing cape and dynamic, attractive posture, climbing a massive sand dune towards a giant rising sun. Geometric shapes, flat colors, clean lines, vast sky area.",
  "Low poly art style, vertical composition. A majestic, fiercely attractive elven princess with sharp, geometric facial features and a flowing gown, standing alongside a glowing white stag on a faceted crystal ridge under a towering starry night sky. Polygon facets, ambient blue lighting.",
  "Digital double exposure portrait, vertical composition. A vertical silhouette profile of a strikingly beautiful woman with elegant, sharp facial contours, merged seamlessly with blooming roses and a starry galaxy inside her hair. Soft pastel color grading, elegant, mysterious and romantic.",
  "Pop Art style illustration, vertical composition. A captivating, classically gorgeous retro woman with intense, alluring eyes, red lips, and dramatic makeup, alongside a tall speech bubble with an exclamation point. Rendered with comic book dots and bold outlines, high-saturation contrasting colors.",
  "Glitch art style, vertical composition. An incredibly beautiful female hacker with synthetic cyan eyes and a sharp jawline, her portrait distorted by data corruption and glowing holographic glitches. Intricate high-tech neon background, dark moody atmosphere.",
  "Modern Swiss graphic design style, vertical composition. A vertical minimalist composition featuring a high-contrast, stylized silhouette of a striking, attractive female face integrated with tall abstract geometric shapes and lines. Black, white, and red color palette, modern poster layout.",
  "Multilayered papercut art style, vertical composition. A beautifully intricate silhouette of a captivating fairytale princess with delicate, expressive features in the foreground. Behind her, a towering 3D landscape of a deep forest and a tall gothic castle, made of staggered paper layers. Backlighting, soft shadows.",
  "Solar Punk art style, vertical composition. A vibrant, highly attractive female botanist with a charismatic smile, tending to glowing bioluminescent plants in a vertical city greenhouse with hanging gardens and wind turbines. Bright, optimistic, warm morning light.",
  "Dark cosmic horror illustration, vertical composition. A brave, beautiful female explorer with intense, determined eyes, standing on a desolate shore, holding a glowing lantern to light up a massive, ancient, eldritch shadow entity in a dark stormy sea. Moody cool colors.",
  "Modern urban noir, vertical composition. A beautiful, mysterious woman in a dark red trench coat and a wide-brimmed hat, standing under a glowing neon sign in a rain-slicked dark alleyway. Deep dramatic shadows, wet brick textures, high-contrast cinematic lighting.",
  "Cozy mystery book cover, vertical composition. A charming, elegantly dressed female sleuth with a highly attractive, curious face, looking out from a tall bookstore window filled with old books. Outside, a warm English village scene at night, snow falling from a dark sky. Cozy, mysterious feel.",
  "Gothic romance illustration, vertical composition. A pale, breathtakingly beautiful young woman with piercing, sorrowful eyes, wearing a flowing dark velvet gown, standing before the towering, moonlit ruins of a grand gothic manor on a foggy cliff. Muted greys and blues, melancholic atmosphere.",
  "Dark fairytale illustration, vertical composition. A striking, fiercely beautiful young woman in a red cloak with intense, captivating eyes, gripping a silver blade as she walks into a massive, dark forest with towering twisted ancient trees. Grimm's style, mood of awe and dread.",
  "Post-apocalyptic style, vertical composition. A beautiful, battle-hardened female survivor with intense eyes and a perfectly grimy face, looking at the camera, standing in a vast desert wasteland with a ruined skyscraper and a dusty orange sunset sky behind. Muted warm colors.",
  "Urban fantasy concept art, vertical composition. A beautiful modern sorceress in a glowing tailored coat, casting a spiral magical ward that illuminates a rain-streaked metropolitan alleyway at night. Rich magical blue and purple lighting, mysterious atmosphere.",
  "Abstract geometric book poster layout, vertical composition. An elegant, attractive female silhouette minimalist line-art seamlessly integrated into a vertical arrangement of intersecting lines, circles, and curves in a gradient of emerald green and deep blue. Dark background, elegant abstract design."
];

const BASE_QUALITY = "masterpiece, best quality, highly detailed, cinematic lighting, soft warm color grading, intricate background, no text, no watermark";

const W = 1024;
const H = 1792;

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

  // Persist the 60 prompts alongside the images so we can replay them
  // (e.g. to seed first-act prebake with the cover's exact visual anchor).
  const promptsManifest = {};
  for (let i = 0; i < MALE_PROMPTS.length; i++) {
    promptsManifest[`m${i}`] = MALE_PROMPTS[i];
    promptsManifest[`f${i}`] = FEMALE_PROMPTS[i];
  }
  writeFileSync(
    resolve(OUT_DIR, "prompts.json"),
    JSON.stringify(promptsManifest, null, 2),
  );
  console.log(`[covers] Wrote ${Object.keys(promptsManifest).length} prompts → home/prompts.json`);

  console.log(`[covers] Starting image generation for 60 gender-differentiated covers (30 male, 30 female)...`);
  const t0 = Date.now();

  for (let i = 0; i < MALE_PROMPTS.length; i++) {
    // 1. Male Cover (m{i})
    const malePngName = `m${i}.png`;
    const malePngPath = resolve(OUT_DIR, malePngName);
    console.log(`[covers] Generating m${i} ... `);
    try {
      const buf = await generate(MALE_PROMPTS[i]);
      writeFileSync(malePngPath, buf);
      console.log(`[covers] m${i} successfully generated! size: ${buf.length} B`);
    } catch (e) {
      console.error(`[covers] FAIL generating m${i}: ${e.message}`);
    }

    // 2. Female Cover (f{i})
    const femalePngName = `f${i}.png`;
    const femalePngPath = resolve(OUT_DIR, femalePngName);
    console.log(`[covers] Generating f${i} ... `);
    try {
      const buf = await generate(FEMALE_PROMPTS[i]);
      writeFileSync(femalePngPath, buf);
      console.log(`[covers] f${i} successfully generated! size: ${buf.length} B`);
    } catch (e) {
      console.error(`[covers] FAIL generating f${i}: ${e.message}`);
    }
  }

  console.log(`[covers] Finished generating all covers in ${((Date.now() - t0)/1000).toFixed(1)}s.`);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
