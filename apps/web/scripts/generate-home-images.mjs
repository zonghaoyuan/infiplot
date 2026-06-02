#!/usr/bin/env node
/**
 * One-off generator: produces the InfiPlot homepage story cards via Runware
 * FLUX.2 and writes them as PNGs under apps/web/public/home/.
 *
 * Flat per-gender layout: 32 male-oriented (m0..m31) + 32 female-oriented
 * (f0..f31). All cards are 832x1024 (≈4:5) to match the homepage StoryCard
 * aspect — m{i} and f{i} share dimensions so 性向 crossfade never jumps.
 *
 * Each prompt bakes its per-card art style (anime / cinematic-real / xianxia
 * ink / cyberpunk / steampunk / pixel / etc.) so the homepage feels visually
 * varied rather than uniformly anime. Stories are 红果-short-drama framed.
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

const W = 832;
const H = 1024;

// Style suffixes — kept in sync with apps/web/app/page.tsx STYLE_MAP so the
// homepage cover and the in-game styleGuide land on the same aesthetic.
const S = {
  二次元: "anime visual novel illustration, japanese galgame aesthetic, soft warm natural light",
  吉卜力: "studio ghibli watercolor style, hand-drawn animation, soft watercolor washes, warm healing tones",
  真实系: "cinematic photorealism, soft natural lighting, subtle film grain",
  超写实: "hyperrealistic portrait, cinematic studio lighting, perfect skin and fabric detail",
  水彩: "watercolor illustration, wet bleeding brushstrokes, paper texture",
  像素风: "16-bit pixel art, retro game palette, blocky geometric style",
  日系动画: "modern japanese anime cel-shading, hard shadow layers, cel anime style",
  "3D 渲染": "3D rendered toon style, soft subsurface scattering, clean cinematic lighting",
  蒸汽朋克: "steampunk aesthetic, brass gears and steam, industrial revolution atmosphere",
  玄幻: "chinese xianxia illustration, ethereal qi mist, distant misty mountains and mythic beasts",
  国风水墨: "chinese ink wash illustration, romantic xianxia colors, eastern aesthetic",
  赛博朋克: "cyberpunk city, neon reflections on wet streets, glowing cybernetic accents",
};

// 32 male-oriented cards (m0..m31), 红果 short-drama framing.
const MALE = [
  { name: "m0", prompt: `front gates of a glass-walled chinese wedding hall at dusk, a stoic man in a worn military overcoat standing alone outside facing the camera, behind him twenty black-suited bodyguards kneeling in two perfect rows on the marble steps, soft rain and faint smoke on the road, ${S["真实系"]}`, w: W, h: H },
  { name: "m1", prompt: `a young man in a clean grey shirt walking back into a small chinese mountain village at golden hour, an elderly farmer at the village entrance crying tears of joy and reaching out to him, terraced fields and warm cooking smoke from low houses, ${S["吉卜力"]}`, w: W, h: H },
  { name: "m2", prompt: `interior of a lavish chinese family banquet hall, a young man holding a teapot center frame surrounded by dozens of disdainful relatives glaring at him, through the open french doors behind him nine black rolls-royces lined up at the curb with chauffeurs bowing in unison, ${S["真实系"]}`, w: W, h: H },
  { name: "m3", prompt: `a young food delivery courier in a yellow uniform on a midnight neon-lit chinese street, his phone held up showing an incoming call labelled 'father', behind him a sleek black bentley pulling silently alongside the curb, ${S["二次元"]}`, w: W, h: H },
  { name: "m4", prompt: `a stoic ex-soldier in a dark hoodie standing protectively in front of a frightened young woman on a rainy small-town chinese street, a struck thug recoiling and falling back into a puddle behind, cold tense atmosphere, ${S["真实系"]}`, w: W, h: H },
  { name: "m5", prompt: `a young man kneeling on his bedroom floor at 4 am holding an open ring box, his girlfriend frozen in the half-open doorway with her suitcase, dawn light filtering through curtains, ${S["日系动画"]}`, w: W, h: H },
  { name: "m6", prompt: `a high school boy in summer uniform standing on a school rooftop at golden hour holding a folded exam paper, a girl in another uniform leaning over the far railing in the distance, summer cicadas and warm light, ${S["吉卜力"]}`, w: W, h: H },
  { name: "m7", prompt: `a young man kneeling at a stone grave in a chinese cemetery at twilight, soft white petals drifting around him, a barefoot young woman with the same face as the photo on the headstone standing behind the grave looking confused, ${S["二次元"]}`, w: W, h: H },
  { name: "m8", prompt: `a young man at 3 am in front of his bright phone screen flooded with an SSR character pull animation in his messy bedroom, a girl in his oversized T-shirt walking out of his bathroom rubbing sleepy eyes, ${S["3D 渲染"]}`, w: W, h: H },
  { name: "m9", prompt: `a young man at center frame surrounded by a holographic semicircle of seven beautiful women all turning to look at him in unison, a glowing red 30-second countdown floating overhead, ${S["二次元"]}`, w: W, h: H },
  { name: "m10", prompt: `interior of a dim chinese palace cold harem chamber, a thin young prince in disheveled white silk robes seated cross-legged on a stone floor, an old eunuch standing before him reading a death decree from a yellow imperial scroll, candlelight, ${S["国风水墨"]}`, w: W, h: H },
  { name: "m11", prompt: `a stylish silver-haired bishounen anime villain in a black school uniform standing in a cathedral school courtyard, the otome heroine timidly approaching him with a hand-written letter, falling petals, ${S["二次元"]}`, w: W, h: H },
  { name: "m12", prompt: `interior of a 1928 republican-era warlord mansion entrance hall, a young man in a dark military uniform lying on a red carpet with a slim trail of blood from his lips beside a half-drained porcelain cup, polished military boots and a shadowed figure approaching from the doorway, ${S["真实系"]}`, w: W, h: H },
  { name: "m13", prompt: `a young xianxia cultivator in tattered white robes standing atop a cloud-wreathed mountain peak, nine layers of crimson heavenly tribulation lightning crashing down, a silhouetted female figure standing inside the lightning clouds above shielding him, ${S["玄幻"]}`, w: W, h: H },
  { name: "m14", prompt: `a humble grey-robed temple sweeper holding a broom standing calmly in a chinese mountain monastery courtyard, an ornately armored demon lord recoiling backward from him while terrified senior monks kneel behind, swept leaves drifting between them, ${S["国风水墨"]}`, w: W, h: H },
  { name: "m15", prompt: `interior of a dim chinese college dormitory room at night, a young man recoiling on his bunk holding back another student whose pale veined face is biting at him, a single floating silver-blade-shaped droplet of blood suspended in mid-air between them, ${S["真实系"]}`, w: W, h: H },
  { name: "m16", prompt: `a soaked young man in a torn jacket standing on a rooftop of a ruined neon-lit asian metropolis during a thunderstorm, electricity arcing wildly between his clenched fist and the air, a horde of glowing-eyed infected silhouetted below, ${S["赛博朋克"]}`, w: W, h: H },
  { name: "m17", prompt: `interior of a luxurious dim-lit family banquet room, the protagonist seated calmly at the corner of a long table while seven imposing men in dark suits enter the doorway behind him and bow deeply in his direction, his father-in-law freezing mid-sentence at the head of the table, ${S["真实系"]}`, w: W, h: H },
  { name: "m18", prompt: `a quiet elderly chinese gentleman in a simple grey changshan standing in a noisy outdoor wet market holding a bunch of green onions, the vendor at his stall trembling and dropping the change, distant grey mountain ranges in the background, ${S["国风水墨"]}`, w: W, h: H },
  { name: "m19", prompt: `interior of a dim-lit luxurious chinese-style mansion at night, a man in a black silk shirt slowly lifting a red wedding veil to reveal the face of a young woman identical to his late sister, her eyes wide with fear, soft red lantern light, ${S["超写实"]}`, w: W, h: H },
  { name: "m20", prompt: `a 1930s republican-era man in a tailored grey suit and fedora standing in a smoke-filled shanghai bund alley between two doors marked in chinese characters, cigarette smoke and distant gramophone music, art deco neon glow, ${S["真实系"]}`, w: W, h: H },
  { name: "m21", prompt: `a humble grey-clothed sweeper carrying a tea tray walking through a chinese martial arts grand tournament hall, dozens of jianghu sect leaders frozen mid-strike with their raised swords trembling in the air around him, ${S["国风水墨"]}`, w: W, h: H },
  { name: "m22", prompt: `a tense high school senior in school uniform sitting at a desk under harsh fluorescent light, four serious men in dark suits standing behind him exchanging a sealed envelope across the desk, chalkboard with college entrance exam dates visible, ${S["日系动画"]}`, w: W, h: H },
  { name: "m23", prompt: `the wide marble entry of a luxury chinese wedding hall, a gaunt young man in a blood-stained hiking jacket and dusty backpack standing motionless at the doorway, a champagne glass shattering on the floor near a stunned tuxedoed groom in the background, ${S["真实系"]}`, w: W, h: H },
  { name: "m24", prompt: `a high school rooftop at golden hour, a fierce female transfer student in dishevelled uniform pinned with her bag torn open at her feet spilling a thick stack of pale blue love letters, the protagonist standing over her with a steady amused expression, ${S["日系动画"]}`, w: W, h: H },
  { name: "m25", prompt: `a sun-filled japanese classroom after school, a top student girl with neat braids slamming an exam paper down on the desk of the boy sitting behind her, his identical answers visible on his desk, soft afternoon dust rays, ${S["二次元"]}`, w: W, h: H },
  { name: "m26", prompt: `a grand fantasy hall during a class awakening ceremony, all classmates around in colored qi auras laughing and pointing at the protagonist who stands alone at center frame, a sudden blinding pillar of golden divine light bursting from him obliterating their auras, ${S["玄幻"]}`, w: W, h: H },
  { name: "m27", prompt: `a tiny stick-figure protagonist standing on lined notebook paper as a giant pink eraser descends from above, half of his pixel body already smudged and erased, blocky 16-bit world, ${S["像素风"]}`, w: W, h: H },
  { name: "m28", prompt: `a brass-and-wood airship deck above an endless sea of clouds, a one-eyed steampunk captain in a long coat handing a telescope to a young man whose hand is reaching out to take it, a distant black pirate balloon visible through the lens, ${S["蒸汽朋克"]}`, w: W, h: H },
  { name: "m29", prompt: `interior of a battered colony starship bridge, a 17-year-old protagonist in a torn pilot uniform climbing into a glowing main-cannon command chair, dozens of officers behind him saluting, a crimson alien planet glowing through the cracked viewport, ${S["赛博朋克"]}`, w: W, h: H },
  { name: "m30", prompt: `a young pilot in a worn flight suit standing on a brightly-lit mech arena platform at night, his stern coach pressing a captain's badge into his palm, the cockpit of a battered humanoid mech opening behind him, a holographic crowd fills the arena overhead, ${S["赛博朋克"]}`, w: W, h: H },
  { name: "m31", prompt: `a modern college campus plaza at golden hour, a beautiful girl standing opposite a wealthy young man holding flowers receiving her embrace, the protagonist watching from a few steps away with one hand in his coat pocket and a quiet smile, faint reflection of a black bentley parked at the curb behind him, ${S["真实系"]}`, w: W, h: H },
];

// 32 female-oriented cards (f0..f31), same trope categories — love-interest framing.
const FEMALE = [
  { name: "f0", prompt: `interior of an ornate ancient chinese general's manor courtyard, a delicate young noblewoman with a fresh red mark on her cheek kneeling on a stone tile, a stern handsome regent prince in dark silk court robes dismounting his horse outside the gate and striding toward her with murder in his eyes, ${S["国风水墨"]}`, w: W, h: H },
  { name: "f1", prompt: `a glamorous blonde-curl-haired villainess in a crimson ballgown sitting alone in a sun-drenched academy library reading an open game-design notebook with a faint smug smile, three handsome male love interests glaring at her in the background, ${S["二次元"]}`, w: W, h: H },
  { name: "f2", prompt: `a delicate hanfu-clad young woman holding a jade pendant standing alone at the entrance of an ancient ancestral hall under moonlight, the silhouette of the male protagonist watching from afar between distant cherry trees, ${S["玄幻"]}`, w: W, h: H },
  { name: "f3", prompt: `interior of an opulent imperial chinese palace throne hall, a regal young empress in gold-embroidered phoenix robes seated at the head, the emperor stepping down from the dragon throne and kneeling before her while three thousand court ladies gasp, ${S["国风水墨"]}`, w: W, h: H },
  { name: "f4", prompt: `a young bride in a white wedding dress writing a divorce paper at a vanity, her husband's handsome younger brother stepping into the bridal suite holding a fresh bouquet, both shocked, gilded chandelier above, ${S["二次元"]}`, w: W, h: H },
  { name: "f5", prompt: `a young woman calmly accepting a paper coffee cup from her boyfriend on a sunny city street with a small composed smile, her reflection in his sunglasses showing a streak of dark blood, ${S["真实系"]}`, w: W, h: H },
  { name: "f6", prompt: `a young woman in business attire holding a black umbrella stepping out from a luxury car onto a rainy city sidewalk and offering shelter to a startled young woman with a briefcase, neon shop reflections in the puddle, ${S["真实系"]}`, w: W, h: H },
  { name: "f7", prompt: `a poised young woman in a sharp white pantsuit standing in a glass-walled corporate boardroom signing a heavy contract while her surprised father watches from the doorway, downtown chinese skyline through the windows, ${S["真实系"]}`, w: W, h: H },
  { name: "f8", prompt: `interior of a luxurious dim-lit penthouse bridal suite at night, a delicate young bride in a white silk dress sitting on the edge of an enormous bed, a tall handsome man in an open black suit leaning down close to whisper into her ear, ${S["二次元"]}`, w: W, h: H },
  { name: "f9", prompt: `a young woman waking in an enormous luxury hotel bed clutching a gold-banded ring on her finger, the silhouette of a tall handsome man already fully dressed in a tailored suit standing at the floor-to-ceiling window adjusting his cufflinks, ${S["真实系"]}`, w: W, h: H },
  { name: "f10", prompt: `interior of a sleek modern penthouse kitchen at morning, a young woman in a silk robe holds half of a freshly torn-up divorce paper, her composed husband in a crisp white shirt holding the other half with a quiet smile, soft sunrise light, ${S["真实系"]}`, w: W, h: H },
  { name: "f11", prompt: `a school courtyard at twilight, a girl gaping in shock as her arch-rival classmate kneels on one knee before her offering a ring box, the rest of the class peeking around the corner in disbelief, ${S["二次元"]}`, w: W, h: H },
  { name: "f12", prompt: `a young woman at 4 am holding her phone bright with a UR-rarity gacha card showing the silhouette of a faceless CEO, behind her the same CEO from the card standing the next morning at her apartment doorway in a tailored suit holding a bouquet, ${S["3D 渲染"]}`, w: W, h: H },
  { name: "f13", prompt: `a tense high school hallway, the female protagonist pinned against a row of lockers by the school's coldest male character glaring down at her, a faint holographic system task panel hovering at the edge of her vision, ${S["二次元"]}`, w: W, h: H },
  { name: "f14", prompt: `a young woman standing at her open apartment doorway looking up in shock at a tall handsome CEO standing politely at her threshold holding a single suitcase, a faint holographic receipt with chinese characters floating above her shoulder, ${S["二次元"]}`, w: W, h: H },
  { name: "f15", prompt: `a young female streamer alone in her cozy bedroom at night facing her ring-light camera, a glowing top-donor badge with chinese characters floating prominently on the screen behind her, faint holographic image of a reclusive handsome CEO above the badge, ${S["日系动画"]}`, w: W, h: H },
  { name: "f16", prompt: `interior of a dim apartment at night, a frightened young woman gripping a chair backward against her front door while bloody hand-prints smear the door's glass panel from outside, a tense handsome man in a leather jacket with a pistol just inside her doorway looking back at her, ${S["真实系"]}`, w: W, h: H },
  { name: "f17", prompt: `the female protagonist standing in her apartment doorway hauling three large supply duffel bags, a tall standoffish handsome neighbor kneeling on the hallway floor in front of her holding up a half-eaten ration bar, ${S["真实系"]}`, w: W, h: H },
  { name: "f18", prompt: `a feared S-rank male esper in a long dark coat crouched on a girl's apartment doormat with puppy-dog eyes asking to be let in, faint flashes of supernatural ability suppressed at his fingertips, ${S["二次元"]}`, w: W, h: H },
  { name: "f19", prompt: `the female protagonist standing in her apartment doorway calmly closing it on a man frantically pounding from the outside, a different handsome man waiting calmly in her brightly-lit kitchen behind her holding two cups of coffee, ${S["真实系"]}`, w: W, h: H },
  { name: "f20", prompt: `a high school classroom at lunch, the female protagonist sitting at her desk opening her textbook to find a handwritten note slipped inside, a cold-faced top-of-class boy from the neighboring class watching from the doorway, ${S["二次元"]}`, w: W, h: H },
  { name: "f21", prompt: `a sun-flecked school hallway at golden hour, the long-admired campus prince walking up to the female protagonist with serious determination in his eyes, holding out a folded piece of paper with an address, ${S["吉卜力"]}`, w: W, h: H },
  { name: "f22", prompt: `a school's front gate at sunset, the female protagonist watching speechless as her ordinary-seeming class president is escorted into a black bentley by four men in dark suits, the class president turning back smiling and waving at her, ${S["二次元"]}`, w: W, h: H },
  { name: "f23", prompt: `a crowded school hallway between classes, the female protagonist's wrist firmly held by the school's coldest senior in a black uniform staring straight at her with quiet intensity, students freezing and watching, ${S["日系动画"]}`, w: W, h: H },
  { name: "f24", prompt: `interior of a 1930s republican-era shanghai mansion drawing room at dusk, a beautiful young woman in an embroidered cheongsam entering through a curtain doorway, a refined foreign-educated gentleman in a tailored grey suit calmly seated at the rosewood table pouring her father's tea, ${S["超写实"]}`, w: W, h: H },
  { name: "f25", prompt: `a 1930s shanghai bookshop interior at night, the female protagonist behind the counter looking up as a foreign-educated gentleman in a sharp tailored suit places a small wrapped parcel on the counter and meets her eyes with quiet urgency, ${S["真实系"]}`, w: W, h: H },
  { name: "f26", prompt: `interior of an ancient xianxia alchemy chamber, a female apprentice in pale robes accidentally tipping a master's bronze pill furnace as a brilliant pillar of golden qi erupts toward the ceiling, three elder masters bursting through the doorway in shock, ${S["玄幻"]}`, w: W, h: H },
  { name: "f27", prompt: `the entrance of a small chinese town at dusk, the female protagonist in dust-worn jianghu travel robes walking past the wooden archway, a tall young swordsman with a sealed letter in his hand kneeling at the foot of the gate looking up at her with three years of waiting in his eyes, ${S["国风水墨"]}`, w: W, h: H },
  { name: "f28", prompt: `a cozy modern apartment living room at night, a young woman sprawled on the sofa eating watermelon while watching a tv variety show on which a famous male celebrity smiles ambiguously about his wife, her phone exploding with thousands of incoming notifications, ${S["真实系"]}`, w: W, h: H },
  { name: "f29", prompt: `the doorway of a shared modern apartment at night, the female protagonist standing speechless as her year-long roommate places one hand on the doorframe beside her head leaning down with quiet sincerity, ${S["日系动画"]}`, w: W, h: H },
  { name: "f30", prompt: `interior of a dim underground bunker, the female protagonist crouched as a battered humanoid mech crashes through the metal door behind her, the cockpit opens and a young handsome man in pilot armor inside extends his hand toward her, sparks and emergency red light, ${S["赛博朋克"]}`, w: W, h: H },
  { name: "f31", prompt: `a brightly lit indoor basketball stadium overflowing with confetti at championship victory, a victorious handsome male player in jersey number 3 running across the court toward the camera holding up the gold trophy, the female protagonist standing courtside with hands over her mouth in tears of joy, ${S["日系动画"]}`, w: W, h: H },
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
