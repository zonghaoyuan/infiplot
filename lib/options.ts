// Single source of truth for the home-page selector option sets. Kept as
// `as const` so each list also yields a literal-union type: the play-start
// UI (app/page.tsx) renders from the arrays, and the analytics schema
// (lib/analytics.ts) types its payload fields from the unions. That shared
// origin is what keeps the "content-free" events honest — an event field can
// only ever be one of these fixed labels, never free-form player text.

export const GENDERS = ["男性向", "女性向"] as const;

export const ART_STYLES = [
  // 特殊选项
  "自动",
  "自定义风格",
  // 日系动画
  "京阿尼",
  "新海诚",
  "吉卜力",
  "黑白漫画",
  // 影视写实
  "真实",
  "3D 动画",
  // 东方传统
  "水墨",
  "仙侠玄幻",
  "浮世绘",
  "敦煌壁画",
  // 西方传统
  "古典油画",
  "莫奈",
  "水彩",
  "细密画",
  "镶嵌画",
  "彩绘玻璃",
  // 题材氛围
  "赛博朋克",
  "蒸汽朋克",
  "哥特",
  "废土",
  "暗黑童话",
  "都市幻想",
  // 数字现代
  "像素风",
  "蒸汽波",
  "矢量插画",
  "低多边形",
  "波普艺术",
  "故障艺术",
  // 手绘手工
  "彩铅",
  "手绘素描",
  "剪纸艺术",
  "儿童绘本",
  "儿童涂鸦",
  "黏土手工",
] as const;

export const PLOT_STYLES = ["平铺直叙", "多线转折", "悬疑烧脑", "治愈日常"] as const;

export const PACINGS = ["慢热细腻", "紧凑爽快"] as const;

export type Gender = (typeof GENDERS)[number];
export type ArtStyle = (typeof ART_STYLES)[number];
export type PlotStyle = (typeof PLOT_STYLES)[number];
export type Pacing = (typeof PACINGS)[number];

export const STYLE_MAP: Record<string, string> = {
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
  "敦煌壁画": "Dunhuang cave fresco style inspired by Mogao Grotto murals, figures rendered with flowing ribbon-like outlines and mineral pigment textures, muted oxidized palette of cinnabar red, malachite green, azurite blue, and ochre gold on aged stucco surface, warm torchlit ambiance with divine golden halos, flattened perspective with ornamental cloud and lotus motifs, celestial apsara grace and Buddhist iconographic composition, sacred and timelessly ancient atmosphere.",
  "细密画": "Persian miniature painting style, ultra-fine brushwork with hair-thin outlines on ivory-smooth ground, flattened isometric perspective with no vanishing point, jewel-toned palette of lapis lazuli blue, ruby red, emerald green, and burnished gold leaf accents, intricate geometric and floral border ornamentation, cypress trees and tiled courtyard motifs, luminous and gem-like opulence.",
  "镶嵌画": "Byzantine mosaic art style, image composed of thousands of tiny glass tesserae and gold smalti tiles, shimmering iridescent surface with visible tile gaps and grout lines, rich palette of deep cobalt blue, imperial purple, and radiant gold leaf backgrounds, figures rendered with large solemn frontal-facing eyes and flat iconic proportions, divine golden halos, sacred and monumental atmosphere.",
  "彩绘玻璃": "Gothic stained glass window style, translucent jewel-colored panels of ruby red, sapphire blue, and emerald green glowing with backlit luminosity, bold black lead came lines dividing the composition into intricate segments, pointed-arch and rose-window framing, light streaming through glass casting prismatic color refractions, medieval cathedral craftsmanship, sacred and ethereally luminous atmosphere.",
  "蒸汽波": "Vaporwave retro-digital aesthetic, nostalgic lo-fi palette of pastel pink, electric cyan, and soft lavender with neon magenta accents, grid-pattern floors receding into a synthetic purple sunset horizon, palm tree silhouettes and classical marble bust motifs, VHS scan-line artifacts and chromatic aberration glitches, smooth gradient skies with geometric shapes, dreamy retro-futuristic and melancholic nostalgia.",
  "矢量插画": "Minimalist flat vector illustration, clean geometric shapes with crisp mathematically-perfect edges, bold even-weight outlines with no texture or brush artifacts, limited flat color palette with strategic use of negative space, strong silhouette-driven composition, subtle shadow layers for depth without gradients, modern graphic design sensibility with editorial illustration clarity.",
  "低多边形": "Low poly 3D art style, faceted geometric surfaces built from flat triangular and polygonal faces with visible hard edges, simplified crystalline forms with ambient occlusion at polygon intersections, cool-toned palette of icy blue, soft teal, and muted violet with warm accent highlights, clean luminous rendering with soft environmental lighting, elegant digital origami aesthetic.",
  "波普艺术": "Pop Art illustration in the style of Roy Lichtenstein and Andy Warhol, bold black outlines with flat high-saturation primary colors, Ben-Day halftone dot patterns for shading and skin tones, comic-book panel composition with speech-bubble framing, stark complementary color contrasts of red-yellow-blue, screen-printed repetition aesthetic, ironic and energetically vibrant commercial art atmosphere.",
  "故障艺术": "Glitch art digital aesthetic, image corrupted with horizontal scan-line displacement and RGB channel splitting, vivid neon artifacts in electric cyan, hot magenta, and acid yellow against dark backgrounds, pixel-sorting streaks and data-moshing distortion bands, fragmented composition with broken grid alignment, CRT monitor phosphor glow, unsettling digital decay with a hypnotic cybernetic beauty.",
  "剪纸艺术": "Multilayered papercut art style, intricate silhouette shapes cut from layered paper with visible paper edge thickness, soft diffused backlighting casting graduated shadows between layers, subtle paper fiber texture on cut surfaces, limited palette with depth created through staggered layer parallax, delicate negative-space filigree details, warm intimate craft atmosphere with three-dimensional shadow play.",
  "蒸汽朋克": "Steampunk Victorian-industrial aesthetic, intricate brass clockwork gears, copper pipes, and riveted iron plating as core visual motifs, warm amber and burnished bronze palette with verdigris patina accents, gaslight and oil-lamp warm directional lighting with steam-diffused atmosphere, elaborate mechanical augmentation on characters, aged leather and polished wood textures, retro-futuristic Industrial Revolution grandeur.",
  "仙侠玄幻": "Chinese xianxia fantasy illustration, ethereal qi energy rendered as luminous flowing wisps and aura effects, distant layered mountain silhouettes dissolving into celestial mist, palette of jade green, imperial gold, cinnabar red, and moonlit silver-blue, dynamic flowing robes and hair with wind-swept motion, celestial cloud formations and mythic creature motifs, mystical and transcendent atmosphere of cultivation and immortality.",
  "暗黑童话": "Dark fairytale illustration in the Grimm Brothers tradition, towering twisted ancient trees with gnarled bark and claw-like branches, deep shadow-drenched forest with narrow shafts of pale moonlight, muted palette of moss black, bruised violet, and sickly yellow-green, ink-wash atmospheric fog at ground level, sinister hidden faces in bark and foliage textures, hauntingly beautiful atmosphere of dread and dark enchantment.",
  "都市幻想": "Urban fantasy concept art, modern metropolitan cityscape with hidden magical elements bleeding through reality, glowing arcane sigils and spell circles overlaid on rain-streaked glass and concrete surfaces, palette blending cool urban greys and steel blue with warm magical amber and ethereal violet accents, characters in contemporary clothing channeling visible energy from their hands, liminal threshold between mundane and supernatural, mysterious and electrifying atmosphere of a secret world beneath the ordinary.",
};
