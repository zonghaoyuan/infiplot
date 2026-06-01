#!/usr/bin/env node
/**
 * One-off generator: produces the InfiPlot homepage story cards via Runware
 * FLUX.2 and writes them as PNGs under apps/web/public/home/.
 *
 * Flat per-gender layout: 30 male-oriented (m0..m29) + 30 female-oriented
 * (f0..f29). Same index shares aspect ratio across genders so the 性向
 * crossfade never jumps card height.
 *
 * Reads IMAGE_BASE_URL / IMAGE_API_KEY / IMAGE_MODEL from apps/web/.env.local.
 *
 * Run once:
 *   node apps/web/scripts/generate-home-images.mjs
 *
 * Idempotent: skips any card whose .png or .webp already exists. Pass --force
 * to regenerate everything.
 */

import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { readFileSync, existsSync, mkdirSync, writeFileSync, statSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = resolve(__dirname, "..");
const ENV_FILE = resolve(WEB_ROOT, ".env.local");
const OUT_DIR = resolve(WEB_ROOT, "public", "home");

const FORCE = process.argv.includes("--force");

/* ---------- env loading (tiny .env parser) ---------- */
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
if (!BASE_URL.includes("runware.ai")) {
  console.error("This script assumes Runware. Got:", BASE_URL);
  process.exit(2);
}

/* ---------- prompts ---------- */

const BASE_QUALITY =
  "masterpiece, best quality, highly detailed, cinematic lighting, soft warm color grading, intricate background, no text, no watermark";

// 30 male-oriented cards (m0..m29). m0..m6 flagship moods, m7..m22 broad
// genre sweep, m23..m29 added range (wuxia / space opera / republican-era /
// apocalypse / western / deep sea / steampunk).
const MALE = [
  {
    name: "m0",
    prompt:
      "anime visual novel cover art, two high school students standing under cherry blossom petals at dusk, warm golden sunset light, soft watercolor texture, japanese galgame illustration, widescreen composition",
    w: 1024,
    h: 640,
  },
  {
    name: "m1",
    prompt:
      "post-apocalyptic wasteland anime, lone scavenger silhouette against rusted mecha mountain, golden dust storm sweeping across the dunes, cinematic widescreen, anime concept art, dramatic backlight",
    w: 1024,
    h: 640,
  },
  {
    name: "m2",
    prompt:
      "anime xianxia cultivator boy in flowing white robes standing on a floating mountain peak above a sea of clouds, vermillion banners fluttering, vertical poster composition, chinese mythology, galgame illustration",
    w: 768,
    h: 1024,
  },
  {
    name: "m3",
    prompt:
      "anime visual novel scene, southern chinese small town in june rain, a transfer student looking back from a rainy classroom window, ceiling fan in background, soft warm afternoon tones, slice of life galgame illustration",
    w: 1024,
    h: 832,
  },
  {
    name: "m4",
    prompt:
      "cyberpunk anime portrait, amnesiac detective standing in neon-soaked rainy alley of an east-asian metropolis in 2087, holographic signs reflecting on wet pavement, vertical composition, blade runner palette, anime illustration",
    w: 768,
    h: 1024,
  },
  {
    name: "m5",
    prompt:
      "anime mystery scene, late-night high school library underground chamber, flickering candlelight, a class president kneeling before a glowing rune circle on the stone floor, gothic galgame style, mysterious teal-green glow",
    w: 1024,
    h: 640,
  },
  {
    name: "m6",
    prompt:
      "anime isekai cathedral scene, silver-haired holy maiden with tearful eyes kneeling before a glowing magic summoning circle, golden cathedral light streaming through stained glass, summoned hero just appearing in modern school uniform, warm galgame illustration",
    w: 1024,
    h: 640,
  },
  {
    name: "m7",
    prompt:
      "anime girl in summer yukata watching fireworks at a japanese festival night, warm bokeh lanterns, vertical composition, soft watercolor, slice of life galgame",
    w: 768,
    h: 1024,
  },
  {
    name: "m8",
    prompt:
      "cyberpunk neon city skyline at rainy night, flying vehicles, holographic billboards in chinese characters, anime widescreen, cinematic",
    w: 1024,
    h: 640,
  },
  {
    name: "m9",
    prompt:
      "anime two students standing on empty rural train platform after school, golden hour, slice of life galgame illustration, cinematic widescreen, warm tones",
    w: 1024,
    h: 832,
  },
  {
    name: "m10",
    prompt:
      "anime mage girl in star-embroidered robes casting starlight spell, ancient fantasy library, vertical composition, magical particles, painterly illustration",
    w: 768,
    h: 1024,
  },
  {
    name: "m11",
    prompt:
      "anime mecha pilot girl strapped in cockpit, holographic interfaces around her, dramatic red emergency lighting, intense expression, mecha anime style",
    w: 1024,
    h: 640,
  },
  {
    name: "m12",
    prompt:
      "anime detective girl in long trench coat under a flickering streetlamp at midnight, noir mood, vertical composition, rain mist, cinematic anime",
    w: 768,
    h: 1024,
  },
  {
    name: "m13",
    prompt:
      "anime cyberpunk couple sharing a quiet moment in a neon-lit rainy alley, holographic umbrella, electric blue and pink reflections, romantic galgame illustration",
    w: 1024,
    h: 832,
  },
  {
    name: "m14",
    prompt:
      "anime sword duel between two xianxia cultivators in a bamboo grove, motion blur on swords, falling bamboo leaves, dynamic action composition",
    w: 1024,
    h: 640,
  },
  {
    name: "m15",
    prompt:
      "anime princess in ornate eastern gown seated on an ancient carved throne, candlelight, intricate background tapestries, vertical poster composition, fantasy galgame",
    w: 768,
    h: 1024,
  },
  {
    name: "m16",
    prompt:
      "anime classroom afternoon, sun streaming through windows onto empty desks, a single uniformed student writing in a notebook, slice of life watercolor, nostalgic",
    w: 1024,
    h: 640,
  },
  {
    name: "m17",
    prompt:
      "anime girl reading a folded letter under a cherry blossom tree, melancholic expression, petals drifting, soft warm watercolor, slice of life galgame",
    w: 1024,
    h: 832,
  },
  {
    name: "m18",
    prompt:
      "anime moon goddess descending from a starlit sky, silver hair flowing, ethereal aurora glow, dreamy painterly illustration, vertical composition",
    w: 768,
    h: 1024,
  },
  {
    name: "m19",
    prompt:
      "anime samurai standing alone under a blood red full moon, sakura petals carried on the wind, katana drawn, dramatic backlight, cinematic widescreen",
    w: 1024,
    h: 640,
  },
  {
    name: "m20",
    prompt:
      "anime witch girl brewing a glowing potion in a candlelit forest hut, hanging dried herbs, magical sparks rising from the cauldron, vertical composition",
    w: 768,
    h: 1024,
  },
  {
    name: "m21",
    prompt:
      "anime beach summer scene, two girlfriends sitting on the sand watching a pink-orange sunset, gentle waves, slice of life galgame illustration",
    w: 1024,
    h: 640,
  },
  {
    name: "m22",
    prompt:
      "anime hacker girl in a dim apartment surrounded by glowing screens, neon cyan reflections on her face, intense focus, cyberpunk galgame style",
    w: 1024,
    h: 832,
  },
  {
    name: "m23",
    prompt:
      "anime wuxia scene, a lone swordsman in a rundown rainy-night tavern, a mysterious masked woman at the next table with a sword case beside her, warm lantern light, jianghu atmosphere, vertical composition, galgame illustration",
    w: 768,
    h: 1024,
  },
  {
    name: "m24",
    prompt:
      "anime space opera scene, the bridge of a deep-space colony ship with red alert lights flashing, an unknown planet glowing ominous crimson through the viewport, sci-fi galgame illustration, cinematic widescreen",
    w: 1024,
    h: 640,
  },
  {
    name: "m25",
    prompt:
      "anime 1930s old Shanghai bund scene, art deco ballroom, a dancer handing a coded playing card to the viewer, gramophone and warm amber lighting, republican era China, cinematic galgame illustration",
    w: 1024,
    h: 832,
  },
  {
    name: "m26",
    prompt:
      "anime post-apocalyptic survival scene, interior of a barricaded convenience store at night, a lone survivor tense at the rolling shutter door listening to a rhythmic knock, dim emergency light, vertical composition, galgame illustration",
    w: 768,
    h: 1024,
  },
  {
    name: "m27",
    prompt:
      "anime wild west scene, a deserted frontier town at high noon, a lone gunslinger standing outside the saloon ready for a duel, dust and harsh sunlight, cinematic widescreen, anime illustration",
    w: 1024,
    h: 640,
  },
  {
    name: "m28",
    prompt:
      "anime deep sea exploration scene, a diving bell descending into an abyssal trench, searchlight revealing an ancient sunken city, eerie blue glow, bioluminescence, vertical composition, galgame illustration",
    w: 768,
    h: 1024,
  },
  {
    name: "m29",
    prompt:
      "anime steampunk airship deck scene, brass gears and billowing steam above a sea of clouds, a black pirate balloon approaching the starboard side, dramatic adventure mood, cinematic widescreen, anime illustration",
    w: 1024,
    h: 832,
  },
];

// 30 female-oriented cards (f0..f29). Same index + aspect ratio as MALE so the
// 女性向 masonry mirrors slot heights; otome / josei love-interest framing.
const FEMALE = [
  {
    name: "f0",
    prompt:
      "anime josei otome game illustration, beautiful female protagonist in ornate eastern hanfu silk robes, behind her a tall stoic regent prince in dark embroidered robes leaning down to clasp a red jade bracelet on her wrist, ancient chinese palace interior, soft candlelight, romantic widescreen composition",
    w: 1024,
    h: 640,
  },
  {
    name: "f1",
    prompt:
      "anime modern romance scene, young woman in pajamas sitting on a bed at dawn, golden light through curtains, looking at her phone in shock as if she has just been pulled back in time, soft warm tones, melancholic otome illustration, widescreen",
    w: 1024,
    h: 640,
  },
  {
    name: "f2",
    prompt:
      "anime villainess otome game character, beautiful young noblewoman with elaborate golden ringlet hair and crimson ballgown, standing alone in a baroque royal academy ballroom while other noble girls glare from the background, dramatic chandelier light, vertical poster composition, otome game cover art",
    w: 768,
    h: 1024,
  },
  {
    name: "f3",
    prompt:
      "anime visual novel scene, female high school transfer student standing on a rainy southern chinese town rooftop, sharing her umbrella with a moody boy reading poetry on the railing, soft warm afternoon palette, slice of life otome illustration",
    w: 1024,
    h: 832,
  },
  {
    name: "f4",
    prompt:
      "anime josei coronation scene, beautiful young empress in ornate ceremonial robes seated on a high eastern throne, head turned to glance at a handsome attendant standing in the shadowed pillars below, vertical composition, opulent silks and gold, otome game illustration",
    w: 768,
    h: 1024,
  },
  {
    name: "f5",
    prompt:
      "anime wuxia swordswoman in flowing light hanfu, jade hairpin, white sword raised mid-stance, cherry blossoms swirling around her, mountain pavilion in the background at golden hour, dynamic widescreen otome wuxia illustration",
    w: 1024,
    h: 640,
  },
  {
    name: "f6",
    prompt:
      "anime visual novel scene, female high school student standing on a sunset rooftop looking up at a tall handsome senior in school uniform, warm orange sky, golden hour, romantic galgame otome cover art, widescreen",
    w: 1024,
    h: 640,
  },
  {
    name: "f7",
    prompt:
      "anime otome game illustration, handsome boy in summer yukata shielding a girl from the festival crowd, both watching the last firework bloom in the night sky, warm lantern bokeh, vertical composition, soft watercolor, romantic galgame",
    w: 768,
    h: 1024,
  },
  {
    name: "f8",
    prompt:
      "anime josei romance, handsome young man draping his coat over a girl's shoulders on a rainy train platform at night, neon signs shattering into reflections in the puddles, cinematic widescreen, warm melancholic tones, otome illustration",
    w: 1024,
    h: 640,
  },
  {
    name: "f9",
    prompt:
      "anime otome scene, a boy stopping and turning back to look at the girl on an empty rural train platform at golden hour dusk, unspoken words between them, slice of life galgame illustration, warm tones, cinematic widescreen",
    w: 1024,
    h: 832,
  },
  {
    name: "f10",
    prompt:
      "anime otome game, cold aloof student council president closing a forbidden tome in the depths of an old library, lifting his gaze with unexpectedly gentle eyes toward the viewer, dust motes in candlelight, vertical composition, painterly illustration",
    w: 768,
    h: 1024,
  },
  {
    name: "f11",
    prompt:
      "anime otome romance, a handsome knight kneeling on one knee swearing an oath with his sword before the viewer, red emergency alert lighting on a starship bridge, dramatic devotion, otome game illustration, widescreen",
    w: 1024,
    h: 640,
  },
  {
    name: "f12",
    prompt:
      "anime otome scene, handsome young man catching up under a single umbrella to a girl walking alone in a midnight rainy alley, offering to walk her home, noir streetlamp glow, rain mist, vertical composition, romantic galgame",
    w: 768,
    h: 1024,
  },
  {
    name: "f13",
    prompt:
      "anime otome romance, a boy tilting a glowing holographic umbrella toward the girl while his own shoulder gets soaked in the neon rain, electric blue and pink reflections, intimate quiet moment, galgame illustration",
    w: 1024,
    h: 832,
  },
  {
    name: "f14",
    prompt:
      "anime wuxia otome, a handsome swordsman sheathing his blade to stand protectively before a girl in a bamboo grove, falling bamboo leaves drifting between them, golden light, dynamic romantic composition, widescreen",
    w: 1024,
    h: 640,
  },
  {
    name: "f15",
    prompt:
      "anime otome game, a cold regent prince crossing a candlelit ancient palace banquet hall, reaching out his hand only toward the viewer while courtiers bow, opulent silks and gold, vertical poster composition, fantasy otome illustration",
    w: 768,
    h: 1024,
  },
  {
    name: "f16",
    prompt:
      "anime otome scene, a boy with reddened ears shyly pushing his notebook across a desk toward the girl in a sunset-lit empty classroom, warm orange light, tender romantic moment, slice of life galgame, widescreen",
    w: 1024,
    h: 640,
  },
  {
    name: "f17",
    prompt:
      "anime otome romance, a handsome boy handing a love letter to the viewer under a cherry blossom tree, petals drifting in the air, tender expression, soft warm watercolor, slice of life galgame illustration",
    w: 1024,
    h: 832,
  },
  {
    name: "f18",
    prompt:
      "anime otome fantasy, a silver-haired ethereal moon god leaning down, fingertip gently touching the viewer's cheek, aurora glow and drifting starlight, dreamy painterly illustration, vertical composition",
    w: 768,
    h: 1024,
  },
  {
    name: "f19",
    prompt:
      "anime otome wuxia, a handsome swordsman shielding the girl with his body under a blood red full moon, sword light and sakura petals falling together, dramatic backlight, cinematic widescreen",
    w: 1024,
    h: 640,
  },
  {
    name: "f20",
    prompt:
      "anime otome fantasy, a handsome young sorcerer brewing a glowing fate-changing potion for the viewer in a candlelit forest hut, hanging dried herbs, magical sparks rising, warm romantic mood, vertical composition",
    w: 768,
    h: 1024,
  },
  {
    name: "f21",
    prompt:
      "anime otome scene, a boy sitting beside the girl on a seaside embankment under a pink-orange sunset, sharing unspoken feelings carried off on the sea breeze, gentle waves, slice of life galgame illustration, widescreen",
    w: 1024,
    h: 640,
  },
  {
    name: "f22",
    prompt:
      "anime otome cyberpunk, a handsome hacker boy bathed in blue screen glow turning to look at the viewer after typing the last line of code, neon cyan reflections on his face, intense tender gaze, galgame illustration",
    w: 1024,
    h: 832,
  },
  {
    name: "f23",
    prompt:
      "anime otome fantasy, a silver-haired dragon king in humanoid form kneeling on one knee deep in an ancient dragon lair, offering a dragon-scale ring toward the viewer, glowing treasure hoard, vertical composition, otome game illustration",
    w: 768,
    h: 1024,
  },
  {
    name: "f24",
    prompt:
      "anime otome josei, 1930s old Shanghai mansion, an elegant refined young gentleman in a western suit shielding the viewer from a stray bullet, crimson blooming on his sleeve cuff, warm amber lighting, cinematic widescreen, otome illustration",
    w: 1024,
    h: 640,
  },
  {
    name: "f25",
    prompt:
      "anime otome apocalypse, a handsome rugged survivor firing his last bullet at a zombie breaking through a door, then turning to shield the girl behind him, dim ruined interior, dramatic devotion, otome game illustration, widescreen",
    w: 1024,
    h: 832,
  },
  {
    name: "f26",
    prompt:
      "anime otome gothic romance, a pale handsome vampire count bowing to kiss the back of the viewer's hand at a candlelit masquerade ball in a fog-shrouded castle, cold elegant beauty, vertical composition, otome illustration",
    w: 768,
    h: 1024,
  },
  {
    name: "f27",
    prompt:
      "anime otome wild west, a silent handsome bounty hunter on horseback in a dusty frontier town reaching down to pull the girl up onto his saddle, golden dust and harsh sunlight, cinematic widescreen, otome illustration",
    w: 1024,
    h: 640,
  },
  {
    name: "f28",
    prompt:
      "anime otome fantasy, a luminous handsome merman prince wrapping his arm around the girl's waist, guiding her through a sleeping ancient underwater city, glowing bioluminescent ruins, vertical composition, otome game illustration",
    w: 768,
    h: 1024,
  },
  {
    name: "f29",
    prompt:
      "anime otome steampunk, a dashing one-eyed airship captain on the deck handing a telescope to the viewer, brass gears and a sea of clouds behind, adventurous romantic mood, cinematic widescreen, otome illustration",
    w: 1024,
    h: 832,
  },
];

const ALL = [...MALE, ...FEMALE];

/* ---------- Runware caller ---------- */

async function generate({ prompt, w, h }) {
  const body = [
    {
      taskType: "imageInference",
      taskUUID: crypto.randomUUID(),
      model: MODEL,
      positivePrompt: `${prompt}, ${BASE_QUALITY}`,
      width: w,
      height: h,
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
  if (!b64) throw new Error(`No image data: ${text.slice(0, 200)}`);
  return Buffer.from(b64, "base64");
}

/* ---------- main loop ---------- */

if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

const total = ALL.length;
let done = 0;
let skipped = 0;
let failed = 0;
const t0 = Date.now();

console.log(`[gen] ${total} cards → ${OUT_DIR}`);

for (const card of ALL) {
  const out = resolve(OUT_DIR, `${card.name}.png`);
  const webpOut = resolve(OUT_DIR, `${card.name}.webp`);
  if (!FORCE && (existsSync(out) || existsSync(webpOut))) {
    const path = existsSync(out) ? out : webpOut;
    const size = statSync(path).size;
    if (size > 1024) {
      skipped++;
      done++;
      console.log(`[${done}/${total}] skip ${card.name} (${size} B)`);
      continue;
    }
  }
  const label = `[${++done}/${total}] ${card.name}`;
  process.stdout.write(`${label} … `);
  const t = Date.now();
  try {
    const buf = await generate(card);
    writeFileSync(out, buf);
    process.stdout.write(`ok ${buf.length} B in ${Math.round((Date.now() - t) / 100) / 10}s\n`);
  } catch (e) {
    failed++;
    process.stdout.write(`FAIL: ${e.message}\n`);
  }
}

console.log(
  `\n[gen] done in ${Math.round((Date.now() - t0) / 1000)}s — generated ${
    done - skipped - failed
  } / skipped ${skipped} / failed ${failed}`,
);
process.exit(failed ? 1 : 0);
