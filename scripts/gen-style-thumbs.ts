/**
 * Generate style thumbnail images via Runware API.
 * Uses DeepSeek to pick the best-fit scene for each art style.
 * Usage: bun run scripts/gen-style-thumbs.ts
 */

const RUNWARE_URL = "https://api.runware.ai/v1";
const RUNWARE_KEY = process.env.IMAGE_API_KEY;
const LLM_URL = process.env.TEXT_BASE_URL;
const LLM_KEY = process.env.TEXT_API_KEY;
const LLM_MODEL = process.env.TEXT_MODEL;

if (!RUNWARE_KEY || !LLM_URL || !LLM_KEY || !LLM_MODEL) {
  console.error("Missing env vars. Source .env.local first.");
  process.exit(1);
}

const STYLE_MAP: Record<string, string> = {
  "京阿尼": "Kyoto Animation anime style inspired by Beyond the Boundary and Sound Euphonium, precise thin line art with uniform weight, meticulous real-world architectural backgrounds with photographic accuracy, warm golden-hour lighting with soft bokeh and lens diffusion, iridescent color accents and crystalline light effects, delicate translucent gradients on hair and eyes, emotionally nuanced character expressions with subtle micro-expressions, rich ambient occlusion in indoor scenes.",
  "新海诚": "Makoto Shinkai anime style, ultra-detailed photorealistic backgrounds with simplified anime characters, dramatic crepuscular rays and lens flare, vivid saturated sky gradients from deep blue to golden amber, volumetric cloud rendering, wet surface reflections, anamorphic bokeh highlights, cinematic widescreen composition.",
  "吉卜力": "Studio Ghibli anime style inspired by Spirited Away and Howl's Moving Castle, hand-painted background art with lush visible brushstrokes, expansive skies with billowing cumulus clouds, warm earthy palette of moss green, ochre, and terracotta, gentle rounded character forms with expressive eyes, richly detailed natural environments with swaying grass and dappled light, a sense of magical wonder woven into everyday life.",
  "3D 动画": "Cinematic 3D animated film style, Pixar-quality rendering with subsurface scattering on skin, volumetric god rays through atmospheric particles, physically-based material shading, warm filmic color grading, shallow depth of field with soft bokeh, expressive stylized character proportions.",
  "真实": "Photorealistic cinematic style, natural lighting with soft directional key light, shallow depth of field with anamorphic bokeh, fine film grain texture, lifelike skin with pore-level detail and subsurface scattering, physically-based material rendering, subtle teal-and-orange color grading, 35mm lens perspective.",
  "赛博朋克": "Cyberpunk anime illustration, neon-soaked urban nightscape, dominant palette of electric cyan, hot magenta, and deep indigo, hard-edged cel shading with sharp specular highlights, holographic signage reflections on wet asphalt, dense atmospheric haze with volumetric neon glow, high contrast between deep shadows and vivid accent lighting.",
  "哥特": "Gothic romance illustration, dramatic Baroque chiaroscuro with deep shadow pools, cold moonlit rim lighting, muted palette of desaturated indigo, ash grey, and bone white, misty atmospheric perspective, ornate filigree and pointed-arch architectural details, melancholic and hauntingly beautiful mood.",
  "废土": "Post-apocalyptic landscape illustration, weathered rough textures with rust, corrosion, and cracked concrete, muted dusty palette of burnt sienna, olive drab, and ash grey, hazy amber god-ray lighting through particulate atmosphere, overgrown vegetation reclaiming ruins, desolate yet strangely serene atmosphere.",
  "像素风": "Pixel art illustration, crisp aliased edges with no anti-aliasing, limited 32-color palette with dithering for gradients, 16-bit era SNES aesthetic, clean tile-based composition, small carefully-placed specular highlights, retro video game atmosphere with warm CRT color warmth.",
  "古典油画": "Classical oil painting in the academic tradition, rich impasto brushwork with visible palette-knife texture, dramatic Rembrandt lighting with warm chiaroscuro, sfumato blending at subject edges, Renaissance triangular composition, deep glaze layers producing luminous amber and umber tones, museum-quality varnished finish.",
  "莫奈": "Impressionist painting in the style of Claude Monet, broken-color technique with visible dab brushstrokes, vibrant dappled sunlight filtering through foliage, complementary color shadows of lavender and cobalt, soft atmospheric perspective, plein-air natural palette of cerulean, viridian, and cadmium yellow, shimmering water reflections.",
  "水彩": "Watercolor illustration on cold-pressed paper, wet-on-wet washes with soft pigment bleeding at edges, visible paper grain texture through translucent layers, granulation in cerulean and burnt sienna passages, intentional white paper reserves as highlights, gentle pastel tones with occasional saturated accents, dreamy luminous atmosphere.",
  "水墨": "Traditional Chinese ink wash painting, expressive calligraphic brushstrokes with flying-white dry-brush texture (feibai), bold ink splashes contrasted with delicate fine-line detail, monochrome sumi ink with subtle indigo washes, expansive negative space evoking mist and void, sparse poetic composition following the principle of leave-blank (liu bai).",
  "浮世绘": "Ukiyo-e Japanese woodblock print style, bold sumi-ink outlines with variable line weight, flat color areas with subtle wood-grain texture from printing, limited palette of indigo, vermilion, and ochre with key-block black, bokashi gradient shading technique, washi paper texture, elegant compositional asymmetry.",
  "彩铅": "Colored pencil illustration on toned paper, fine directional hatching and cross-hatching strokes with visible pencil grain, burnished blending in highlight areas, warm cream paper tone showing through, soft layered color build-up from light to dark, delicate hand-drawn warmth with slight imperfections.",
  "手绘素描": "Hand-drawn graphite pencil sketch, varied pressure producing light construction lines to deep tonal shading, visible eraser marks and smudge blending, off-white sketchbook paper texture, loose gestural composition with intentionally unfinished edges, raw artistic immediacy.",
  "黑白漫画": "Black and white Japanese manga illustration, bold variable-weight ink outlines, extreme high-contrast with dense hatching and cross-hatching for tonal shading, screentone dot patterns for mid-tones, dramatic speed lines for motion, cinematic dynamic angles, stark chiaroscuro with no color gradients.",
  "儿童绘本": "Children's picture book illustration, soft rounded shapes with friendly proportions, bright warm gouache-like palette of primary colors, clean even-weight outline art, simple readable compositions with clear focal points, whimsical cheerful atmosphere with gentle humor, inviting and safe visual tone.",
  "儿童涂鸦": "Child's crayon and marker drawing style, naive unsteady strokes with wax-crayon texture, bold unmixed primary and secondary colors, cheerfully wrong perspective and scale, figures and objects floating freely on the page, scribbled sky and ground bands, playful uninhibited composition radiating pure joy.",
  "黏土手工": "Claymation stop-motion animation style, soft rounded sculpted forms with visible fingerprint impressions and slight hand-sculpted imperfections, matte polymer clay texture with subtle surface grain, warm diffused three-point lighting on miniature set, tilt-shift shallow depth of field, charming handmade craft atmosphere.",
};

const FILE_MAP: Record<string, string> = {
  "京阿尼": "kyoani", "新海诚": "shinkai", "吉卜力": "ghibli",
  "3D 动画": "3d", "真实": "real", "赛博朋克": "cyberpunk",
  "哥特": "gothic", "废土": "wasteland", "像素风": "pixel",
  "古典油画": "oil", "莫奈": "monet", "水彩": "watercolor",
  "水墨": "ink", "浮世绘": "ukiyoe", "彩铅": "pencil",
  "手绘素描": "sketch", "黑白漫画": "manga", "儿童绘本": "children",
  "儿童涂鸦": "crayon", "黏土手工": "clay",
};

const OUT_DIR = `${import.meta.dir}/../public/home/styles`;

async function generateScene(styleName: string, stylePrompt: string): Promise<string> {
  const res = await fetch(`${LLM_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${LLM_KEY}`,
    },
    body: JSON.stringify({
      model: LLM_MODEL,
      messages: [
        {
          role: "system",
          content: `You are an expert art director for InfiPlot, an AI-powered interactive fiction platform where users create and play through visual novel stories. Each story has illustrated scenes with characters in dramatic, emotional, or atmospheric moments.

Given an art style description, output a single short scene description (1-2 sentences, in English) that would best showcase this style AS A VISUAL NOVEL SCENE. The scene should:
- Feature 1-2 characters in a story moment (conversation, contemplation, action, emotional beat)
- Feel like a frame from a narrative — not a still life, pure landscape, or portrait
- Pick a setting, mood, and lighting that let the style's unique strengths shine
- Be visually striking at 512x512 thumbnail size

Output ONLY the scene description, nothing else.`,
        },
        {
          role: "user",
          content: `Art style name: ${styleName}\nStyle prompt: ${stylePrompt}\n\nWhat scene would best showcase this art style in a 512x512 thumbnail?`,
        },
      ],
      max_tokens: 512,
      temperature: 0.7,
    }),
  });

  const json = (await res.json()) as any;
  const scene = json.choices?.[0]?.message?.content?.trim();
  if (!scene) throw new Error(`LLM returned no scene for ${styleName}: ${JSON.stringify(json)}`);
  return scene;
}

async function generateImage(name: string, fullPrompt: string): Promise<void> {
  const slug = FILE_MAP[name];
  if (!slug) throw new Error(`No file mapping for "${name}"`);

  const task = {
    taskType: "imageInference",
    taskUUID: crypto.randomUUID(),
    model: "runware:400@6",
    positivePrompt: fullPrompt,
    width: 512,
    height: 512,
    steps: 4,
    CFGScale: 3.5,
    numberResults: 1,
    outputType: "URL",
    outputFormat: "WEBP",
    includeCost: true,
  };

  const res = await fetch(RUNWARE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${RUNWARE_KEY}`,
    },
    body: JSON.stringify([task]),
  });

  const json = (await res.json()) as any;
  if (json.errors?.length) {
    throw new Error(`Runware error for ${name}: ${JSON.stringify(json.errors)}`);
  }

  const imageUrl = json.data?.[0]?.imageURL;
  if (!imageUrl) throw new Error(`No image URL for ${name}: ${JSON.stringify(json)}`);

  const imgRes = await fetch(imageUrl);
  const buf = await imgRes.arrayBuffer();
  const outPath = `${OUT_DIR}/${slug}.webp`;
  await Bun.write(outPath, buf);

  const cost = json.data?.[0]?.cost ?? "?";
  console.log(`  ✓ image saved → ${slug}.webp (${(buf.byteLength / 1024).toFixed(1)}KB, cost: ${cost})`);
}

async function processStyle(name: string, stylePrompt: string): Promise<void> {
  console.log(`\n[${name}]`);

  // Step 1: LLM picks the best scene
  const scene = await generateScene(name, stylePrompt);
  console.log(`  scene: ${scene}`);

  // Step 2: Combine style + scene → generate image
  const fullPrompt = `${stylePrompt} ${scene}`;
  await generateImage(name, fullPrompt);
}

async function main() {
  const onlyArg = process.argv.find((a) => a.startsWith("--only="));
  const onlyNames = onlyArg ? onlyArg.replace("--only=", "").split(",") : null;

  const entries = Object.entries(STYLE_MAP).filter(
    ([name]) => !onlyNames || onlyNames.includes(name),
  );

  if (entries.length === 0) {
    console.error("No matching styles found.");
    process.exit(1);
  }

  console.log(`Generating ${entries.length} style thumbnails (LLM scene selection + Runware)...`);

  const CONCURRENCY = 4;
  for (let i = 0; i < entries.length; i += CONCURRENCY) {
    const batch = entries.slice(i, i + CONCURRENCY);
    await Promise.all(batch.map(([name, prompt]) => processStyle(name, prompt)));
  }

  console.log(`\n✅ Done! ${entries.length} thumbnails saved to ${OUT_DIR}/`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
