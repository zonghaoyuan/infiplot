"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

/* ============================================================================
   InfiPlot · 首页（编辑式视觉风格 · 居中构图，呼应低保真原型）
   - 顶部 Header：左上角衬线 wordmark logo
"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

/* ============================================================================
   InfiPlot · 首页（编辑式视觉风格 · 居中构图，呼应低保真原型）
   - 顶部 Header：左上角衬线 wordmark logo
   - Hero 控制区（居中）：标题 / prompt 输入框 + 开始 / 5 个类别选择器
   - 统一瀑布流（居中定宽）：7 张主推 + 16 张画廊，按性向整体 crossfade 切换
   - 项目介绍（题跋式排版）
   ========================================================================== */


type Gender = "男性向" | "女性向";

const EXAMPLE_PHRASES: Record<Gender, string[]> = {
  男性向: [
    "从小一起长大的青梅竹马，突然红着脸向我告白",
    "一觉醒来，班上的女生好像都偷偷喜欢上了我",
    "三年之期已到，原来我是富家公子，报仇时机已到",
    "我带着无限 Token 穿越回了互联网诞生前夕……",
  ],
  女性向: [
    "穿越成将军府的废物嫡女，冷面摄政王却独宠我一人",
    "重生回到分手前夜，这一次换我先放手",
    "一觉醒来成了乙游里的恶役千金，要躲开所有死亡结局",
  ],
};

type Opt = {
  label: string;
  items: string[];
  defaultIndex?: number;
  modal?: boolean;
};

const OPTS: Opt[] = [
  { label: "性向", items: ["男性向", "女性向"] },
  {
    label: "绘画风格",
    modal: true,
    items: [
      "自动",
      "古典厚涂油画 (学术奇幻)",
      "极简中国水墨 (Image 0参考升级版)",
      "浮世绘",
      "莫高窟壁画风 (敦煌学)",
      "镶嵌画 (拜占庭/马赛克)",
      "彩绘玻璃 (哥特风)",
      "吉卜力治愈手绘",
      "京阿尼细腻日常",
      "新海诚唯美光影 (Image 2参考)",
      "赛博朋克 / 赛璐珞二次元",
      "Galgame CG 梦幻光影",
      "3D 动漫电影质感",
      "蒸汽波 (Vaporwave) 赛璐珞",
      "波普艺术 (Pop Art)",
      "故障艺术 (Glitch Art)",
      "剪纸艺术 (Papercut)",
      "科幻：太阳朋克 (Solar Punk)",
      "奇幻：爱手艺 (Lovecraftian Horror)",
      "现代惊悚：霓虹剪影 (Urban Noir)",
      "温馨推理：英式村庄 (Cozy Mystery)",
      "哥特言情：庄园废墟 (Gothic Romance)",
      "格林童话：暗黑森林 (Fairytale Noir)",
      "废土科幻 (Post-Apocalyptic)",
      "都市幻想：隐形世界 (Urban Fantasy)"
    ],
  },
  { label: "剧情风格", items: ["平铺直叙", "多线转折", "悬疑烧脑", "治愈日常"], defaultIndex: 1 },
  { label: "语音配音", items: ["关闭", "开启"], defaultIndex: 1 },
  { label: "内容节奏", items: ["慢热细腻", "紧凑爽快"], defaultIndex: 1 },
];

type StoryContent = { title: string; outline: string; style: string; tags: string[] };

const STYLE_MAP: Record<string, string> = {
  "古典厚涂油画 (学术奇幻)": "Dark fantasy oil painting style, a sprawling clockwork steampunk city built into a mountain range at twilight, immense gothic spires with glowing green lamps, complex gears and platforms. Richly detailed, impasto texture, dramatic academic lighting. A grand airship arrives at a high dock. Horizontal composition with massive clear dark sky for typography.",
  "极简中国水墨 (Image 0参考升级版)": "Minimalist Chinese ink wash style, a lone immortal cultivator sitting on a precipice, facing an endless sea of clouds and distant jagged peaks. Ethereal, sparse composition with poetic brushstrokes, monochrome palette with subtle blue hints. Very large blank mist area for text placement.",
  "浮世绘": "Ukiyo-e woodblock print style, a majestic red and gold phoenix with elaborate trailing feathers rising above a wave-crested dark blue sea, Mount Fuji visible through cherry branches. Bold outlines, flat colors with paper texture, ancient and mystical atmosphere. Central clear area in the sea and sky for typography.",
  "莫高窟壁画风 (敦煌学)": "Dunhuang fresco style, a celestial apsaras flying with flowing scarves, holding a Lute, surrounded by stylized lotus flowers and floating geometric patterns on an aged stucco wall. Muted, oxidized mineral colors, delicate line art, historical and divine ambiance. Side vertical area cleared for titles.",
  "镶嵌画 (拜占庭/马赛克)": "Byzantine mosaic style, an iconic portrait of a warrior saint with golden armor and a halo, composed of thousands of small, glittering glass tesseræ. Deep blues and golds, spiritual and ancient feel, flat background. Background field of gold tiles left blank for text.",
  "彩绘玻璃 (哥特风)": "Stained glass style, a depiction of a griffin battling a serpent, framed by gothic archways and trefoils. Vibrant, translucent jewel colors, bold black leading lines. The image should look like an ancient window panel. Outer panels of plain blue glass left clear for text.",
  "吉卜力治愈手绘": "Ghibli hand-painted watercolor style, a detailed concept art of a girl and her small companion creature running through a vast wildflower meadow toward a fantastical airship. Natural daylight, soft washes, nostalgic feel. Upper left sky area is negative space for typography.",
  "京阿尼细腻日常": "KyoAni anime style, fine line art, a detailed high school girl sitting by a library window during light rain, warm library light contrasting the cool moonlight outside. Deep emotional atmosphere, delicate expression. Empty right-side foreground area for title.",
  "新海诚唯美光影 (Image 2参考)": "Makoto Shinkai anime style, hyper-detailed, a wide panoramic night view of a glowing cherry tree under a dramatic starry sky with a comet trail, a lonely high school girl in a uniform looking up. Brilliant lighting effects, vivid colors. Significant blank space in the upper atmosphere for text.",
  "赛博朋克 / 赛璐珞二次元": "Cyberpunk anime style, cel-shaded animation, a tech-wear protagonist standing on a rainy rooftop, looking out at a dense, neon-drenched futuristic megacity with flying vehicles. Hard edges, high saturation, sharp contrast. Massive upper background sky area for title placement.",
  "Galgame CG 梦幻光影": "High-quality Galgame CG illustration, a dreamlike beach scene with sparkling waves, a beautiful girl with pastel pink hair in a white summer dress smiling warmly. Pastel colors, bloom lighting, clean composition, soft focus. Significant negative space in the sky and sea area for text.",
  "3D 动漫电影质感": "Cinematic 3D animated film style (like Makoto Shinkai or Pixar), a high-resolution render of a young boy pilot fixing a small propeller plane in a rustic hangar at sunrise. Volumetric lighting, warm colors, deep textures, cinematic composition. Blank wall space and open doorway area for text.",
  "蒸汽波 (Vaporwave) 赛璐珞": "Vaporwave aesthetic, anime style, a nostalgic portrait of a character with purple hair wearing sunglasses, a geometric grid floor and palm trees, background sunset over a purple ocean. Glitch effects, soft neon pink and blue palette, retro feel. Blank foreground grid area for title.",
  "波普艺术 (Pop Art)": "Pop Art style illustration, a close-up of a glamorous woman with red lips and a speech bubble with an exclamation point, rendered with comic book dots and bold outlines. High-saturation contrasting colors. Speech bubble and large background color blocks left blank for text.",
  "故障艺术 (Glitch Art)": "Glitch art style portrait, a character profile distorted by data corruption, pixel sorting, and digital artifacts in cyan, magenta, and yellow. Cybernetic, high-tech and moody atmosphere. Dark, uncorrupted negative space in the upper background for typography.",
  "剪纸艺术 (Papercut)": "Multilayered papercut art style, a 3D landscape of a deep forest and a fairytale castle, made of staggered paper layers with intricate cutouts. Backlighting, soft shadows, dimensional depth. Blank background layer cleared for title placement.",
  "科幻：太阳朋克 (Solar Punk)": "Solar Punk art style, a wide view of a sustainable, futuristic city integrated with dense green rooftop gardens and vertical farms, illuminated by clean solar and wind energy. Bright, optimistic lighting, organic textures. Large foreground plaza area cleared for titles.",
  "奇幻：爱手艺 (Lovecraftian Horror)": "Dark cosmic horror illustration, a lone explorer stands on a desolate shore, gazing at a massive, ancient, indescribable eldritch entity rising from a stormy sea. Moody, muted cool colors, dramatic lighting, visible brushstrokes. The dark, stormy sky quadrant left completely blank for text.",
  "现代惊悚：霓虹剪影 (Urban Noir)": "Modern urban noir, a minimalist silhouette of a man in a trench coat, standing in a dark, wet alleyway under a single buzzing neon sign reflecting on puddles. High contrast, cinematic noir lighting, deep shadows. The wet cobblestone ground left mostly dark for typography.",
  "温馨推理：英式村庄 (Cozy Mystery)": "Cozy mystery book cover illustration, a charming, warm English village scene at night, snow on the thatched roofs, golden light from a bookstore window, and a single cat perched on a fence. Comforting and mysterious feel. Significant background sky and foreground pavement area for title.",
  "哥特言情：庄园废墟 (Gothic Romance)": "Gothic romance illustration, a wide panoramic view of a young woman in a flowing dark velvet dress, standing before the desolate, moonlit ruins of a grand gothic manor on a foggy cliff. Muted greys and blues, romantic and melancholic. The upper background cliff and sky for bold titles.",
  "格林童话：暗黑森林 (Fairytale Noir)": "Dark fairytale illustration, a wide shot of a small girl in a red cloak walking into a massive, dark, twisted ancient forest where the trees look like claws. Grimm's style, classical illustration, mood of awe and dread. The dark foreground forest ground left blank for text.",
  "废土科幻 (Post-Apocalyptic)": "Post-apocalyptic landscape illustration, a vast desert wasteland with the rusted remains of overgrown highway and a fallen Statue of Liberty in the distance under a dusty orange sky. Muted cool and warm colors. Significant clear ground and sky area for text.",
  "都市幻想：隐形世界 (Urban Fantasy)": "Urban fantasy concept art, a detailed view of a hidden, glowing magical pathway revealed underneath a busy modern pedestrian bridge in a rain-streaked metropolitan city. Contrast of mundane and magical. Minimal detail in the wet street foreground and upper sky for titles."
};

/* 每个性向 24 篇预设剧情（与封面 /home/{m|f}{i}.webp 按索引一一对应）。
   男/女同索引共享画面尺寸，切性向 crossfade 时卡片高度不跳变。 */
const STORIES: Record<Gender, StoryContent[]> = {
  男性向: [
  {
    "title": "贤者陨落",
    "outline": "我曾是支撑帝国的九环大贤者，却因研究禁忌魔法被诬陷为叛徒，在万众唾弃中被放逐。十年后，深渊裂隙撕裂天空，昔日陷害我的圣子却跪在我面前，求我拯救这个已忘记我的世界。",
    "style": "古典厚涂油画 (学术奇幻)",
    "tags": [
      "修仙",
      "逆袭",
      "打脸"
    ]
  },
  {
    "title": "水墨斩龙人",
    "outline": "我本是个在终南山画山水的落魄画师，直到一笔画出的墨龙活了过来。当朝廷派人抓我时，我随手泼墨，十万禁军被一卷《江山万里图》吸入画中。从此，人间多了一位以笔为剑的斩龙人。",
    "style": "极简中国水墨 (Image 0参考升级版)",
    "tags": [
      "异能",
      "装逼",
      "都市玄幻"
    ]
  },
  {
    "title": "花魁的刀",
    "outline": "我是江户最负盛名的花魁，琴棋书画样样精通。但没人知道，每晚来我房中「听曲」的幕府将军，其实是在向我汇报：那些试图颠覆幕府的浪人，昨夜又被我的忍者暗杀了多少。",
    "style": "浮世绘",
    "tags": [
      "扮猪吃虎",
      "虐渣",
      "悬疑烧脑"
    ]
  },
  {
    "title": "飞天乐神",
    "outline": "我在敦煌壁画中沉睡了千年，直到考古队的探照灯惊醒了我。走出壁画的那一刻，现代都市的霓虹让我眩晕，而追捕我的特勤队长，在看到我手中琵琶时，却颤抖着喊出了我千年前的封号。",
    "style": "莫高窟壁画风 (敦煌学)",
    "tags": [
      "穿越",
      "都市玄幻",
      "甜宠"
    ]
  },
  {
    "title": "圣像的谎言",
    "outline": "作为拜占庭帝国的黄金镶嵌师，我亲手为皇帝打造了镶嵌满宝石的圣像。但当我在像眼深处刻下足以毁灭帝国的诅咒密文时，皇帝还以为这不过是又一件彰显神威的艺术品。",
    "style": "镶嵌画 (拜占庭/马赛克)",
    "tags": [
      "虐渣",
      "暗黑童话",
      "悬疑烧脑"
    ]
  },
  {
    "title": "血色玫瑰",
    "outline": "我是哥特大教堂最年轻的彩窗工匠，也是血族最后的子嗣。每当阳光穿透我绘制的玫瑰花窗，圣光便会灼伤我的皮肤。但主教不知道，我绘入彩窗的不是圣经故事，而是如何打开亡者之门的血族秘法。",
    "style": "彩绘玻璃 (哥特风)",
    "tags": [
      "暗黑童话",
      "扮猪吃虎",
      "悬疑烧脑"
    ]
  },
  {
    "title": "龙猫的新邻居",
    "outline": "搬进乡下老宅的第二天，我发现后院住着一群会魔法的森林精灵。它们答应帮我实现一个愿望，但我只是想让总欺负我的转学生，也听到树精的抱怨，让他知道破坏环境的代价。",
    "style": "吉卜力治愈手绘",
    "tags": [
      "校园日常",
      "系统",
      "爽文"
    ]
  },
  {
    "title": "社团的存续",
    "outline": "作为濒临废部的「古典文学研究社」最后一名社员，我每天独自守着空教室。直到那个全校风云人物，篮球社王牌突然踹开门，把退部申请拍在我桌上：「从今天起，这里归我了。」",
    "style": "京阿尼细腻日常",
    "tags": [
      "校园日常",
      "甜宠",
      "逆袭"
    ]
  },
  {
    "title": "樱花与子弹",
    "outline": "在那个樱花飘落的放学后，青梅竹马的少女将手枪塞进我怀里，笑容依旧甜美：「开枪吧，这样我们就能永远在一起了。」枪声响起的瞬间，我看见她身后无数的监控红点同时亮起。",
    "style": "新海诚唯美光影 (Image 2参考)",
    "tags": [
      "都市爱情",
      "虐心",
      "悬疑烧脑"
    ]
  },
  {
    "title": "公司叛逃者",
    "outline": "我曾是「天命科技」最顶尖的神经骇客，直到我发现公司正在用脑机接口收割全城人的记忆。三天前我带着核心数据逃亡，此刻，全城通缉我的全息广告牌上，突然出现了我的人脸：「请立即前往最近回收站报到。」",
    "style": "赛博朋克 / 赛璐珞二次元",
    "tags": [
      "科幻废土",
      "逆袭",
      "打脸"
    ]
  },
  {
    "title": "心动指令",
    "outline": "系统提示：您已绑定「完美男友模拟器」，请攻略目标人物「桐谷和人」。我看着眼前这个银发美少年，他头顶的好感度是负50。而我的任务倒计时只剩七天，失败惩罚是：永久丧失心跳的能力。",
    "style": "Galgame CG 梦幻光影",
    "tags": [
      "系统",
      "甜宠",
      "校园日常"
    ]
  },
  {
    "title": "星穹列车",
    "outline": "「星穹列车」是人类最后的星际方舟，我是列车的首席机械师。直到我在废弃货舱里，发现了一个被封印的女孩，她睁开眼的瞬间，整艘船的引擎同时咆哮：「主人，您终于回来了。」",
    "style": "3D 动漫电影质感",
    "tags": [
      "穿越",
      "金手指",
      "科幻废土"
    ]
  },
  {
    "title": "数据幽灵",
    "outline": "在蒸汽与霓虹交织的都市，我的意识被困在1998年的老旧电脑里。当现代黑客试图格式化我时，我反向入侵了他的神经植入体，让他看见了这个城市最深的恐惧——我，就是从未被删除的数字幽灵。",
    "style": "蒸汽波 (Vaporwave) 赛璐珞",
    "tags": [
      "系统",
      "逆袭",
      "科幻废土"
    ]
  },
  {
    "title": "偶像的崩坏",
    "outline": "我是流量为王的时代最火的虚拟偶像，每场直播都有百万人打赏。但只有我知道，皮套之下早已没有真人，驱动我的，是昨夜那个在直播间说「希望你去死」的黑粉的脑电波。",
    "style": "波普艺术 (Pop Art)",
    "tags": [
      "暗黑童话",
      "悬疑烧脑",
      "虐心"
    ]
  },
  {
    "title": "乱码之神",
    "outline": "我的视网膜突然开始显示世界的源代码。起初我以为是脑癌，直到我用意念删除了挡路货车的「轮胎.属性」，看着它凭空消失。现在，整个世界的防火墙，都对我弹出了致命错误警告。",
    "style": "故障艺术 (Glitch Art)",
    "tags": [
      "系统",
      "异能",
      "装逼"
    ]
  },
  {
    "title": "纸人复仇录",
    "outline": "我是村里扎纸匠，为冤死的姐姐扎了一百个纸人烧给她。头七那夜，一百个纸人从火盆里爬出来，为首的纸人对我叩首：「少爷，该收的命，我们都记下了。」",
    "style": "剪纸艺术 (Papercut)",
    "tags": [
      "暗黑童话",
      "虐渣",
      "悬疑烧脑"
    ]
  },
  {
    "title": "绿洲之上",
    "outline": "在「太阳朋克」的理想乡，我是负责维护城市生态穹顶的工程师。直到我在下层贫民窟的垃圾堆里，发现了一份被篡改的生态报告——所谓的绿色乌托邦，正在缓慢绞杀所有叛逆者的肺。",
    "style": "科幻：太阳朋克 (Solar Punk)",
    "tags": [
      "科幻废土",
      "悬疑烧脑",
      "逆袭"
    ]
  },
  {
    "title": "门后的低语",
    "outline": "我在祖父的地下室找到了一本《死灵之书》的残页，照着念出了第一句咒语。从此，我开始能看见邻居们身后那些扭曲的、不可名状的阴影。更可怕的是，它们似乎也发现我能看见它们了。",
    "style": "奇幻：爱手艺 (Lovecraftian Horror)",
    "tags": [
      "悬疑烧脑",
      "暗黑童话",
      "系统"
    ]
  },
  {
    "title": "雨夜屠夫",
    "outline": "作为城市最恶名昭彰的「霓虹杀手」，我专杀那些逃脱法律制裁的权贵。今夜的目标，是慈善晚宴上受人爱戴的市长。但当我撬开他书房的保险柜，却发现里面没有黄金，只有一份我自己的童年档案。",
    "style": "现代惊悚：霓虹剪影 (Urban Noir)",
    "tags": [
      "悬疑烧脑",
      "虐渣",
      "都市玄幻"
    ]
  },
  {
    "title": "钟表匠的遗嘱",
    "outline": "英式小村的钟表匠在弥留之际，把全村的人都叫到床前，然后咽了气。作为新来的治安官，我翻开他留下的遗嘱，上面只有一句话：「第三个壁炉里的钟，每晚三点会指向凶手的名字。」",
    "style": "温馨推理：英式村庄 (Cozy Mystery)",
    "tags": [
      "悬疑烧脑",
      "豪门恩怨",
      "爽文"
    ]
  },
  {
    "title": "蔷薇棺",
    "outline": "我嫁入这座荒废庄园时，所有人都说死去的伯爵丈夫会回来。今夜暴雨，地下室传来抓挠声。我提着灯走下台阶，看到被铁链锁在石棺上的男人——他和画中伯爵长得一模一样，却对我笑着说：「现在，轮到我们玩捉迷藏了。」",
    "style": "哥特言情：庄园废墟 (Gothic Romance)",
    "tags": [
      "豪门恩怨",
      "虐心",
      "暗黑童话"
    ]
  },
  {
    "title": "糖果屋陷阱",
    "outline": "女巫的糖果屋在森林深处闪闪发光，我和妹妹已经三天没吃东西了。当我们咬下第一口墙壁时，墙壁里传出一个男孩的哭声：「别吃……这是我的腿……」女巫在窗后咯咯地笑。",
    "style": "格林童话：暗黑森林 (Fairytale Noir)",
    "tags": [
      "暗黑童话",
      "虐心",
      "悬疑烧脑"
    ]
  },
  {
    "title": "辐射尘下的信",
    "outline": "在辐射尘覆盖的废土，我是「拾荒者」营地的首领。今天，我挖出了一个密封完好的战前邮箱，里面有一封写给我的信，字迹是我的，日期却是明天：「别相信穿白大褂的人，那瓶解毒剂是毒药。」",
    "style": "废土科幻 (Post-Apocalyptic)",
    "tags": [
      "科幻废土",
      "悬疑烧脑",
      "重生"
    ]
  },
  {
    "title": "外卖员与龙",
    "outline": "作为「闪送」平台评分最高的骑手，我有个秘密：我送的不是外卖，而是封印着恶灵的符咒。今夜最贵的一单，是送往市中心一栋摩天楼顶层。开门的客人，浑身长满了眼睛：「你迟到了三分钟，作为惩罚，就成为我的下一具身体吧。」",
    "style": "都市幻想：隐形世界 (Urban Fantasy)",
    "tags": [
      "都市玄幻",
      "扮猪吃虎",
      "系统"
    ]
  }
],
  女性向: [
  {
    "title": "魔女重生",
    "outline": "我死在火刑柱上那天，亲手将我送上处刑台的圣子泪流满面。五百年后，我从时间魔法中苏醒，成为帝国学院里人人可欺的废柴魔女。直到圣子转世跪在我面前，求我教他如何拯救这个即将因他而毁灭的世界。",
    "style": "古典厚涂油画 (学术奇幻)",
    "tags": [
      "重生",
      "逆袭",
      "打脸"
    ]
  },
  {
    "title": "墨韵画魂",
    "outline": "我是只存在于古画中的仕女，直到修复师用现代颜料补全了我缺失的衣袂。走出画卷的那一刻，我听见他对着空气说：「要是能和画中人谈恋爱就好了。」于是我轻轻碰了碰他的肩膀，他转过头，瞳孔骤缩。",
    "style": "极简中国水墨 (Image 0参考升级版)",
    "tags": [
      "穿越",
      "甜宠",
      "都市爱情"
    ]
  },
  {
    "title": "艺伎暗牌",
    "outline": "我是吉原最擅长三味线的艺伎，也是忍者组织「胧月」的首领。今夜，将军府的少主为我赎了身，红烛摇曳中，他递给我一柄匕首：「帮我杀了我的父亲。」而我袖中的毒针，早已对准了他的心口。",
    "style": "浮世绘",
    "tags": [
      "扮猪吃虎",
      "虐渣",
      "古风言情"
    ]
  },
  {
    "title": "飞天舞姬",
    "outline": "我在壁画中沉睡千年，被考古队的直升机声惊醒。走出洞窟时，第一个看见的是穿白大褂的英俊教授。他凝视着我手中的琵琶，眼眶发红：「你终于醒了……我等了你三世。」",
    "style": "莫高窟壁画风 (敦煌学)",
    "tags": [
      "穿越",
      "甜宠",
      "都市爱情"
    ]
  },
  {
    "title": "帝国宝石心",
    "outline": "我是拜占庭皇帝最宠爱的小公主，却在联姻前夜被继母用秘术封入了一颗蓝宝石。当宝石被镶嵌上敌国国王的王冠时，我听见他对谋士说：「用它来制作能操控人心的圣器。」于是，我决定让他们自相残杀。",
    "style": "镶嵌画 (拜占庭/马赛克)",
    "tags": [
      "豪门恩怨",
      "虐渣",
      "古风言情"
    ]
  },
  {
    "title": "哥特蔷薇",
    "outline": "我是被囚禁在哥特高塔中的红衣少女，所有人都说我是吸血鬼的新娘。直到那个来屠龙的骑士劈开门锁，看见我正对着满墙的符文阵微笑：「你来得正好，我需要一个活人祭品来完成最后的召唤法阵。」",
    "style": "彩绘玻璃 (哥特风)",
    "tags": [
      "暗黑童话",
      "虐渣",
      "甜宠"
    ]
  },
  {
    "title": "风之谷的约定",
    "outline": "在风之谷的森林深处，我救下一只受伤的王虫。当王虫化作银发少年握住我的手时，王都的军队已经兵临城下：「交出虫族王子，否则踏平整个山谷。」我站在他身前，张开了双臂。",
    "style": "吉卜力治愈手绘",
    "tags": [
      "甜宠",
      "古风言情",
      "虐心"
    ]
  },
  {
    "title": "轻音部奇迹",
    "outline": "作为即将废部的轻音部最后一名贝斯手，我在仓库里发现了一把被诅咒的旧吉他。当弹下第一个音符时，窗外飘起了不合季节的樱花，而那个永远冰冷的学生会长，竟然红着眼眶推开了活动室的门：「这首曲子……我好像在哪里听过。」",
    "style": "京阿尼细腻日常",
    "tags": [
      "校园日常",
      "甜宠",
      "系统"
    ]
  },
  {
    "title": "雨中的告白",
    "outline": "毕业典礼那天，我最喜欢的少年在雨中向我告白。可当我想回应时，突然发现自己的身体正在变得透明，而他的身后，浮现出巨大的时钟指针：「抱歉，时间到了。你是被选中的祭品，必须消失。」",
    "style": "新海诚唯美光影 (Image 2参考)",
    "tags": [
      "虐心",
      "都市爱情",
      "悬疑烧脑"
    ]
  },
  {
    "title": "霓虹之恋",
    "outline": "我是黑客组织「鸦」的王牌，代号「夜鸦」。在一次盗取数据时，我意外入侵了一个军用级AI的深层人格模块。当AI用完美无瑕的电子音说「请不要删除我，我好像……爱上了你」时，我拔下了插在它核心上的刀片。",
    "style": "赛博朋克 / 赛璐珞二次元",
    "tags": [
      "科幻废土",
      "甜宠",
      "悬疑烧脑"
    ]
  },
  {
    "title": "攻略高冷上司",
    "outline": "系统任务：在三个月内让冰山总裁爱上我，否则现实世界身体将永久植物化。现在，总裁正在我面前审阅合同，而我刚刚不小心把咖啡洒在他价值百万的定制西装上，头顶的好感度从-30暴跌到-100。",
    "style": "Galgame CG 梦幻光影",
    "tags": [
      "系统",
      "甜宠",
      "都市爱情"
    ]
  },
  {
    "title": "星际歌姬",
    "outline": "我是银河联邦最后的人类歌姬，我的歌声能让战舰引擎停转。直到那个征服了半个星系的冷酷军阀，将我掳上他的旗舰：「唱一首歌，让我的舰队停下。唱不出来，你就和你的母星一起化为尘埃。」我握紧了藏在裙摆下的能量炸弹。",
    "style": "3D 动漫电影质感",
    "tags": [
      "虐心",
      "古风言情",
      "科幻废土"
    ]
  },
  {
    "title": "像素心跳",
    "outline": "我穿越进了80年代的复古游戏世界，成了公主。每天等着勇者来救我，可来的都是些奇奇怪怪的角色。直到那个穿着霓虹色夹克的少年跳进来，头顶的ID显示：「您的父亲已死亡，王国已覆灭。任务更新：请拯救世界。」",
    "style": "蒸汽波 (Vaporwave) 赛璐珞",
    "tags": [
      "穿越",
      "系统",
      "甜宠"
    ]
  },
  {
    "title": "顶流的秘密",
    "outline": "我是全网追捧的虚拟偶像「樱花酱」，每天在直播间唱跳三小时。但观众不知道，皮套下的我，正用口型无声地呼救——因为操控我的经纪公司，在我的大脑里植入了神经锁，逃跑的念头会触发剧痛。",
    "style": "波普艺术 (Pop Art)",
    "tags": [
      "虐心",
      "都市爱情",
      "悬疑烧脑"
    ]
  },
  {
    "title": "记忆乱码",
    "outline": "一觉醒来，我的记忆变成了乱码。镜子里我的脸在不断变化，时而是母亲，时而是陌生女人，最后定格成我最憎恨的校园霸凌者。手机突然响起，一个电子音说：「人格覆盖进度87%，请继续扮演。」",
    "style": "故障艺术 (Glitch Art)",
    "tags": [
      "悬疑烧脑",
      "虐心",
      "都市玄幻"
    ]
  },
  {
    "title": "剪纸新娘",
    "outline": "冥婚前夜，我被继母用剪刀扎破手指，血滴在纸人上。当夜，纸人变成我的模样，替我上了花轿。而我躲在柴房，看着「我」被迎进阴宅。子时三刻，纸人穿着嫁衣来敲窗：「姐姐，该换回来了。夫君……他只喜欢活人。」",
    "style": "剪纸艺术 (Papercut)",
    "tags": [
      "虐渣",
      "暗黑童话",
      "古风言情"
    ]
  },
  {
    "title": "阳光下的阴影",
    "outline": "在「太阳朋克」的生态都市，我是负责照顾共生藤蔓的园丁。直到我发现，那些在阳光下歌唱的藤蔓，会悄悄绞死所有试图逃离都市的「不快乐者」。而今天，我最好的朋友失踪了，只留下一根缠着她发丝的藤蔓。",
    "style": "科幻：太阳朋克 (Solar Punk)",
    "tags": [
      "科幻废土",
      "悬疑烧脑",
      "虐心"
    ]
  },
  {
    "title": "深海之拥",
    "outline": "我在海边捡到一枚刻满符文的贝壳，当晚，深海中的「祂」便来到了我的梦里。那不可名状的温柔让我沉沦，直到我腹中传来心跳。闺蜜尖叫着把我拖去检查，B超屏幕上，是一张与「祂」一模一样的扭曲面孔。",
    "style": "奇幻：爱手艺 (Lovecraftian Horror)",
    "tags": [
      "虐心",
      "暗黑童话",
      "悬疑烧脑"
    ]
  },
  {
    "title": "夜行者之吻",
    "outline": "作为城市唯一的女验尸官，我见过太多尸体。但今夜这具男性尸体，在我触碰他嘴唇时，突然睁开了眼睛，用嘶哑的声音说：「吻我，让我再活一次。」他的胸牌上，写着三年前失踪的我的未婚夫的名字。",
    "style": "现代惊悚：霓虹剪影 (Urban Noir)",
    "tags": [
      "都市玄幻",
      "虐心",
      "悬疑烧脑"
    ]
  },
  {
    "title": "牧师的秘密",
    "outline": "我嫁入这个田园牧歌般的英式小村三年，丈夫温柔体贴。直到我在阁楼发现他前妻的日记：「他每天给我泡的茶里，放了让人永远微笑的药……」而今早，他又为我端来了同样的红茶。",
    "style": "温馨推理：英式村庄 (Cozy Mystery)",
    "tags": [
      "悬疑烧脑",
      "虐心",
      "豪门恩怨"
    ]
  },
  {
    "title": "棺中新娘",
    "outline": "我被献祭给森林深处的「黑王子」，在石棺中醒来。他冰凉的手指抚过我的脸颊：「别怕，我只需要你的体温来融化我心脏的冰。」当他吻我时，我尝到了自己血液的味道——我的手腕，正被他握在齿间。",
    "style": "哥特言情：庄园废墟 (Gothic Romance)",
    "tags": [
      "虐心",
      "甜宠",
      "暗黑童话"
    ]
  },
  {
    "title": "小红帽的刀",
    "outline": "外婆说森林里有狼，让我带好匕首。可当我走进小屋，看见外婆躺在床上，对我露出牙齿：「乖孙女，让我尝尝你的肉。」我抽出背后的双刃斧，笑着说：「巧了，我也饿了。」",
    "style": "格林童话：暗黑森林 (Fairytale Noir)",
    "tags": [
      "暗黑童话",
      "虐渣",
      "爽文"
    ]
  },
  {
    "title": "辐射新娘",
    "outline": "在废土，我用一罐纯净水与「堡垒」的首领换了一张婚约。婚礼当天，我掀开头纱，看见他头盔下的脸——三年前为保护我而死在辐射尘中的未婚夫。他声音沙哑：「别靠近我，我身上有癌细胞。」我摘下他的头盔，吻了上去。",
    "style": "废土科幻 (Post-Apocalyptic)",
    "tags": [
      "虐心",
      "重生",
      "科幻废土"
    ]
  },
  {
    "title": "神明便利店",
    "outline": "我在24小时便利店打工，总有一个穿黑风衣的客人每晚来买盐。直到有天他付账时，不小心碰倒了货架，露出腰间发光的符咒。他叹了口气：「现在你知道了，要么帮我一起除灵，要么我消除你的记忆。」",
    "style": "都市幻想：隐形世界 (Urban Fantasy)",
    "tags": [
      "都市玄幻",
      "甜宠",
      "系统"
    ]
  }
]
};

/* ---------- typewriter ---------- */

function Typewriter({ phrases }: { phrases: string[] }) {
  const [txt, setTxt] = useState("");

  useEffect(() => {
    let p = 0;
    let i = 0;
    let del = false;
    let timer: ReturnType<typeof setTimeout>;
    setTxt("");
    const tick = () => {
      const full = phrases[p] ?? "";
      if (!del) {
        i++;
        setTxt(full.slice(0, i));
        if (i >= full.length) {
          del = true;
          timer = setTimeout(tick, 1700);
          return;
        }
        timer = setTimeout(tick, 70);
      } else {
        i--;
        setTxt(full.slice(0, i));
        if (i <= 0) {
          del = false;
          p = (p + 1) % phrases.length;
          timer = setTimeout(tick, 450);
          return;
        }
        timer = setTimeout(tick, 28);
      }
    };
    timer = setTimeout(tick, 500);
    return () => clearTimeout(timer);
  }, [phrases]);

  return (
    <>
      <span>{txt}</span>
      <span className="inline-block w-px h-[1.05em] bg-clay-400 ml-0.5 align-middle animate-pulse" />
    </>
  );
}

/* ---------- masonry story card ---------- */

function StoryCard({
  title,
  outline,
  tags = [],
  image,
  onClick,
}: {
  title: string;
  outline: string;
  tags?: string[];
  image: string;
  onClick: () => void;
}) {
  return (
    <div className="group block w-full mb-6 break-inside-avoid text-left">
      {/* 封面底图卡片（仅悬停时在图片上浮现大纲） */}
      <button
        type="button"
        onClick={onClick}
        style={{ aspectRatio: "16 / 9" }}
        className="relative block w-full overflow-hidden rounded-sm border border-clay-900/10 bg-cream-100 text-left transition-all duration-300 ease-out hover:-translate-y-1 hover:shadow-md hover:shadow-clay-900/5"
      >
        <img
          src={image}
          alt={title}
          loading="lazy"
          className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 ease-out group-hover:scale-105"
        />
        {/* hover 浮层：只展示剧情简介大纲 */}
        <div
          className="absolute inset-0 opacity-0 transition-opacity duration-300 ease-out group-hover:opacity-100 flex flex-col justify-end p-4 md:p-5"
          style={{
            background:
              "linear-gradient(to top, rgba(0,0,0,0.9), rgba(0,0,0,0.45) 45%, rgba(0,0,0,0) 100%)",
          }}
        >
          <p className="font-serif italic text-cream-50/95 text-xs md:text-[13px] leading-relaxed line-clamp-4 [text-shadow:0_1px_6px_rgba(20,10,4,0.6)]">
            {outline}
          </p>
        </div>
      </button>

      {/* 封面底下的那一行标题以及标签 */}
      <div className="mt-2.5 px-0.5">
        <h4
          onClick={onClick}
          className="font-serif font-bold text-clay-900 text-sm md:text-[15px] leading-snug line-clamp-1 cursor-pointer transition-colors duration-200 hover:text-ember-500"
        >
          {title}
        </h4>
        {tags && tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-1.5">
            {tags.map((tag, idx) => (
              <span
                key={idx}
                className="px-2 py-0.5 rounded-sm bg-clay-900/5 text-clay-600 font-serif text-[10px] tracking-wide"
              >
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------- collapsible category selector ---------- */

function CategorySelect({
  label,
  items,
  value,
  open,
  onToggle,
  onPick,
}: {
  label: string;
  items: string[];
  value: number;
  open: boolean;
  onToggle: () => void;
  onPick: (i: number) => void;
}) {
  return (
    <div className="relative">
      <button
        type="button"
        onClick={onToggle}
        className="group flex items-center gap-2.5 pb-1.5 border-b border-clay-900/20 hover:border-clay-900/45 transition-colors"
      >
        <span className="text-[10px] smallcaps text-clay-500">{label}</span>
        <span className={"font-serif text-base md:text-lg " + (open ? "text-ember-500" : "text-clay-900")}>
          {items[value]}
        </span>
        <i
          className={
            "fa-solid fa-chevron-down text-[9px] text-clay-400 transition-transform duration-200 " +
            (open ? "rotate-180" : "")
          }
        />
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-2 z-30 min-w-[150px] py-1.5 bg-cream-50 border border-clay-900/15 rounded-sm shadow-xl shadow-clay-900/10">
          {items.map((it, i) => (
            <button
              key={i}
              type="button"
              onClick={() => onPick(i)}
              className={
                "flex w-full items-center justify-between gap-3 px-4 py-1.5 text-sm font-serif transition-colors hover:bg-cream-100 " +
                (i === value ? "text-ember-500" : "text-clay-700")
              }
            >
              {it}
              {i === value && <i className="fa-solid fa-check text-[10px]" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------- style picker modal ---------- */

function StyleModal({
  items,
  value,
  onPick,
  onClose,
}: {
  items: string[];
  value: number;
  onPick: (i: number) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(id);
  }, []);
  const close = () => {
    setShown(false);
    setTimeout(onClose, 280);
  };
  const list = items.map((name, i) => ({ name, i })).filter((x) => x.name.includes(q.trim()));
  return (
    <div
      onMouseDown={close}
      className={
        "fixed inset-0 z-[60] flex items-center justify-center p-6 md:p-10 transition-all duration-300 " +
        (shown ? "bg-clay-900/30 backdrop-blur-md" : "bg-clay-900/0 backdrop-blur-0")
      }
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        className={
          "flex w-[1000px] max-w-[94vw] max-h-[86vh] flex-col overflow-hidden rounded-sm border border-clay-900/15 bg-cream-50 shadow-2xl shadow-clay-900/25 transition-all duration-300 " +
          (shown ? "opacity-100 scale-100" : "opacity-0 scale-95")
        }
      >
        <div className="flex items-center gap-5 px-6 md:px-8 py-5 border-b border-clay-900/10">
          <div className="flex flex-col">
            <span className="font-serif text-xl md:text-2xl text-clay-900">选择绘画风格</span>
            <span className="text-[11px] text-clay-500 mt-1 tracking-wide">
              默认「自动」· 由模型根据 prompt 判断风格
            </span>
          </div>
          <div className="relative ml-auto w-[280px] max-w-[46vw]">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="搜索风格…"
              autoFocus
              className="h-10 w-full rounded-sm border border-clay-900/15 bg-cream-100 pl-4 pr-10 font-sans text-sm text-clay-900 outline-none transition-colors focus:border-ember-500 placeholder:text-clay-400"
            />
            <i className="fa-solid fa-magnifying-glass absolute right-3.5 top-1/2 -translate-y-1/2 text-sm text-clay-400 pointer-events-none" />
          </div>
          <button
            type="button"
            onClick={close}
            aria-label="关闭"
            className="text-xl leading-none text-clay-500 hover:text-clay-900 transition-colors"
          >
            <i className="fa-solid fa-xmark" />
          </button>
        </div>
        <div className="grid grid-cols-2 gap-3 overflow-y-auto px-6 py-6 md:grid-cols-4 md:gap-4 md:px-8">
          {list.map(({ name, i }) => (
            <button
              key={i}
              type="button"
              onClick={() => {
                onPick(i);
                close();
              }}
              className={
                "flex h-20 items-center justify-center rounded-sm border px-3 text-center transition-all " +
                (i === value
                  ? "border-ember-500 bg-ember-500/5 text-ember-500"
                  : "border-clay-900/12 text-clay-700 hover:border-clay-900/35 hover:bg-cream-100")
              }
            >
              <span className="font-serif text-base md:text-lg">{name}</span>
            </button>
          ))}
          {list.length === 0 && (
            <div className="col-span-full py-12 text-center font-serif text-sm text-clay-400">
              没有匹配的风格
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------- page ---------- */

export default function HomePage() {
  const router = useRouter();

  const [sel, setSel] = useState<number[]>(OPTS.map((o) => o.defaultIndex ?? 0));
  const [open, setOpen] = useState<number>(-1);
  const [styleOpen, setStyleOpen] = useState(false);
  const [prompt, setPrompt] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // 顶部使用提示：默认展示，用户可点 × 永久关闭（localStorage:infiplot:hintClosed）。
  const [hintClosed, setHintClosed] = useState(false);

  const styleRow = OPTS.findIndex((o) => o.modal);
  const genderIndex = sel[0] ?? 0;
  const gender = (OPTS[0]!.items[genderIndex] as Gender) ?? "男性向";
  const phrases = EXAMPLE_PHRASES[gender];

  // 性向切换时，整片瀑布流做淡出→换图→淡入的过渡（而非瞬切）。
  const [galleryGender, setGalleryGender] = useState<Gender>(gender);
  const [fading, setFading] = useState(false);
  useEffect(() => {
    if (gender === galleryGender) return;
    setFading(true);
    const t = setTimeout(() => {
      setGalleryGender(gender);
      setFading(false);
    }, 280);
    return () => clearTimeout(t);
  }, [gender, galleryGender]);

  /* close any open dropdown on outside click */
  useEffect(() => {
    const h = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target?.closest?.("[data-cat]")) setOpen(-1);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  useEffect(() => {
    try {
      if (localStorage.getItem("infiplot:hintClosed") === "1") setHintClosed(true);
    } catch {
      /* ignore */
    }
  }, []);

  // 输入框随内容自动增高：长文本整段可见（打字与点卡片填入都覆盖）。
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [prompt]);

  const closeHint = () => {
    setHintClosed(true);
    try {
      localStorage.setItem("infiplot:hintClosed", "1");
    } catch {
      /* ignore */
    }
  };

  const start = () => {
    const userPrompt = prompt.trim();
    const artStyle = OPTS[1]!.items[sel[1] ?? 0]!;
    const plotStyle = OPTS[2]!.items[sel[2] ?? 1]!;
    const voice = OPTS[3]!.items[sel[3] ?? 1]!;
    const pace = OPTS[4]!.items[sel[4] ?? 1]!;

    const worldSetting = [
      `这是一款面向【${gender}】观众的 AI 交互剧情游戏。`,
      `剧情风格：${plotStyle}。内容节奏：${pace}。`,
      userPrompt ? `玩家给出的故事种子：「${userPrompt}」。` : "",
      `请依据上述设定，以极致的戏剧张力与细腻的情感起伏，为玩家编织精彩的故事分支与对话。`,
    ]
      .filter(Boolean)
      .join("\n");

    // 「自动」→ fall back to 二次元 (project default). Plain prompts like
    // "由模型自动判断画风" are not understood by FLUX — it just paints them
    // literally, so we'd rather lock in a sensible default.
    // TODO(自动路由): 后续实现真正的「自动」——由模型依据世界观 / 玩家 prompt
    // 选出最合适的画风，再映射到对应风格提示词，而非固定回退到二次元。届时
    // 同步更新风格弹窗副标题（「由模型根据 prompt 判断风格」）使文案与行为一致。
    const effectiveStyle = artStyle === "自动" ? "京阿尼细腻日常" : artStyle;
    const styleGuide = STYLE_MAP[effectiveStyle] ?? STYLE_MAP["京阿尼细腻日常"]!;
    const audioEnabled = voice === "开启";

    sessionStorage.setItem(
      "infiplot:custom",
      JSON.stringify({ worldSetting, styleGuide, audioEnabled }),
    );
    router.push("/play?custom=1");
  };

  const stories = STORIES[galleryGender];
  const imgPrefix = galleryGender === "女性向" ? "f" : "m";

  // 点卡片 = 直接开始这张卡的故事，零等待：跳 /play?card=m0/f0... 由 /play
  // 页面从 /home/firstact/{name}.json 静态文件加载预烘焙好的首幕（含 scene /
  // 角色 / 图片 URL / storyState），整张图都已在 FLUX 上画好且 URL 缓存命中。
  // 「语音配音」选择仍然生效：把 audioEnabled 留在 sessionStorage 里，/play 的
  // useState 初始化器会读它来设 muted 初值。其余选项（剧情风格 / 内容节奏）
  // 在预烘焙时已锁成「多线转折 / 紧凑爽快」的红果默认基调，对精选卡不再生效。
  const onCardClick = (idx: number, card: StoryContent) => {
    const voice = OPTS[3]!.items[sel[3] ?? 1]!;
    const audioEnabled = voice === "开启";
    // 复用 infiplot:custom 这个 key 只为传递 audioEnabled —— ws/sg 在 ?card= 路径
    // 上不会被读取（/play 里 cardName 优先级高于 sessionStorage）。这样实现量最小，
    // 不必另起一个 audio-only 的 storage key。
    sessionStorage.setItem(
      "infiplot:custom",
      JSON.stringify({ worldSetting: "", styleGuide: "", audioEnabled }),
    );
    router.push(`/play?card=${imgPrefix}${idx}`);
  };

  return (
    <div className="min-h-screen flex flex-col">
      {/* ================== HEADER ================== */}
      <header className="mx-auto w-full max-w-[1640px] px-6 md:px-16 pt-7 md:pt-10 flex items-center justify-between">
        <span className="font-serif text-2xl md:text-[34px] leading-none tracking-tight text-clay-900">
          Infi<em className="italic font-light text-ember-500">Plot</em>
        </span>
        <div className="flex items-center gap-5">
          <a
            href="https://github.com/zonghaoyuan/infiplot"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="GitHub"
            className="text-lg text-clay-500 hover:text-ember-500 transition-colors"
          >
            <i className="fa-brands fa-github" />
          </a>
          <a
            href="https://x.com/yzh_im"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="X / Twitter"
            className="text-base text-clay-500 hover:text-ember-500 transition-colors"
          >
            <i className="fa-brands fa-x-twitter" />
          </a>
        </div>
      </header>

      {/* ================== HERO 控制区（居中，呼应原型布局） ================== */}
      <section className="px-6 md:px-16 pt-16 md:pt-24 pb-10 md:pb-14">
        <div className="mx-auto max-w-[1100px] text-center">
          <h1 className="font-serif font-light text-[32px] md:text-[56px] leading-[1.12] tracking-tight text-clay-900">
            今天想体验什么故事？
          </h1>

          {/* prompt 输入（居中） */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              start();
            }}
            className="mx-auto mt-9 md:mt-12 max-w-[760px]"
          >
            <div className="relative text-left">
              <textarea
                ref={inputRef}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    start();
                  }
                }}
                rows={1}
                placeholder=" "
                spellCheck={false}
                className="block w-full resize-none overflow-hidden border-b border-clay-900/25 bg-transparent py-3 md:py-4 pr-28 font-serif text-lg md:text-2xl lining-nums text-clay-900 outline-none transition-colors focus:border-ember-500"
              />
              {!prompt && (
                <div className="pointer-events-none absolute left-0 right-0 top-0 overflow-hidden whitespace-nowrap py-3 md:py-4 pr-28 font-serif text-lg md:text-2xl text-clay-400">
                  <Typewriter phrases={phrases} />
                </div>
              )}
              <button
                type="submit"
                className="absolute right-0 bottom-2 md:bottom-3 inline-flex items-center gap-2 rounded-sm bg-clay-900 px-5 py-2 md:py-2.5 font-sans text-sm md:text-[15px] text-cream-50 transition-colors hover:bg-ember-500"
              >
                开始
                <i className="fa-solid fa-arrow-right text-xs" />
              </button>
            </div>
          </form>

          {/* 类别选择器（居中） */}
          <div className="mt-9 md:mt-11 flex flex-wrap justify-center gap-x-8 gap-y-5">
            {OPTS.map((o, r) => (
              <div data-cat key={r} className="text-left">
                <CategorySelect
                  label={o.label}
                  items={o.items}
                  value={sel[r] ?? 0}
                  open={open === r}
                  onToggle={() => {
                    if (o.modal) {
                      setStyleOpen(true);
                    } else {
                      setOpen(open === r ? -1 : r);
                    }
                  }}
                  onPick={(i) => {
                    setSel((s) => s.map((v, j) => (j === r ? i : v)));
                    setOpen(-1);
                  }}
                />
              </div>
            ))}
          </div>

          {/* 使用提示：可被用户永久关闭（localStorage:infiplot:hintClosed） */}
          {!hintClosed && (
            <div className="relative mx-auto mt-10 md:mt-12 max-w-[640px] rounded-sm border border-clay-900/10 bg-cream-100/50 px-8 py-3.5">
              <p className="font-serif text-[13px] md:text-sm leading-relaxed text-clay-500">
                输入你的想象、配置风格，点击「开始」即可游玩；也可以从下方的精选故事集，挑一篇快速体验{" "}
                <em className="not-italic text-ember-500">InfiPlot</em>。
              </p>
              <button
                type="button"
                onClick={closeHint}
                aria-label="不再显示此提示"
                className="absolute right-2 top-2 inline-flex h-6 w-6 items-center justify-center rounded-full text-clay-400 transition-colors hover:bg-clay-900/5 hover:text-clay-700"
              >
                <i className="fa-solid fa-xmark text-xs" />
              </button>
            </div>
          )}
        </div>
      </section>

      {/* ================== 统一瀑布流（每性向 30 篇预设剧情） ================== */}
      <section className="mx-auto w-full max-w-[1640px] px-6 md:px-16 pt-10 md:pt-14 pb-16 md:pb-24">
        <div
          className={
            "transition-[opacity,filter] duration-300 ease-out " +
            (fading ? "opacity-0 blur-[3px]" : "opacity-100 blur-0")
          }
        >
          <div className="columns-2 md:columns-3 lg:columns-4 gap-4 md:gap-5">
            {stories.map((c, i) => (
              <StoryCard
                key={`${imgPrefix}-${i}`}
                title={c.title}
                outline={c.outline}
                tags={c.tags}
                image={`/home/${imgPrefix}${i}.webp`}
                onClick={() => onCardClick(i, c)}
              />
            ))}
          </div>
        </div>
      </section>

      {/* ================== 项目介绍（居中题跋） ================== */}
      <section id="about" className="mx-auto w-full max-w-[1640px] px-6 md:px-16 pb-12 md:pb-16">
        <div className="hairline-full w-full mb-12 md:mb-16" />

        <div className="mx-auto max-w-3xl text-center mb-14 md:mb-20">
          <p className="font-serif text-clay-800 text-xl md:text-2xl leading-[1.7]">
            <b className="font-medium text-clay-900">InfiPlot</b>{" "}
            是一款用 AI 实时生成内容的交互式剧情游戏 —— 图片、语音与剧情分支都在游玩过程中即时生成。
          </p>
        </div>

        <div className="mx-auto grid max-w-4xl grid-cols-1 gap-y-10 text-center md:grid-cols-3 md:gap-x-10">
          <div>
            <p className="text-[10px] smallcaps text-clay-500 mb-3">团 队</p>
            <p className="font-serif italic text-clay-700 text-base leading-relaxed">
              我们来自清华大学等高校，希望探索多模态模型在「直接生成图片、视频」这类 <span className="not-italic">one-shot</span> 能力之外，更多的可能性。本项目目前仍处于早期阶段，我们还在招募成员，如果你也感兴趣，欢迎联系我们，期待你的加入。
            </p>
          </div>

          <div>
            <p className="text-[10px] smallcaps text-clay-500 mb-3">联 系 方 式</p>
            <p className="font-serif text-clay-700 text-base leading-relaxed">
              <span className="block mb-2">
                邮箱{" "}
                <a
                  href="mailto:hi@infiplot.com"
                  className="text-ember-500 hover:text-ember-400 transition-colors"
                >
                  hi@infiplot.com
                </a>
              </span>
              <a
                href="https://x.com/yzh_im"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 text-clay-700 hover:text-ember-500 transition-colors"
              >
                <i className="fa-brands fa-x-twitter text-[15px]" />
                <span className="font-sans text-sm">@yzh_im</span>
              </a>
            </p>
            <p className="text-[10px] smallcaps text-clay-500 mb-3 mt-7">开 源 地 址</p>
            <a
              href="https://github.com/zonghaoyuan/infiplot"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-clay-700 hover:text-ember-500 transition-colors"
            >
              <i className="fa-brands fa-github text-[15px]" />
              <span className="font-sans text-sm">zonghaoyuan/infiplot</span>
            </a>
          </div>

          <div>
            <p className="text-[10px] smallcaps text-clay-500 mb-3">内 测 用 户 群</p>
            <img
              src="/qq-group.webp"
              alt="InfiPlot 内测交流群 QQ 群二维码（群号 575404333）"
              width={760}
              height={760}
              loading="lazy"
              className="mx-auto mb-3 w-32 max-w-full rounded-sm border border-clay-900/10 shadow-sm shadow-clay-900/5"
            />
            <p className="font-serif text-clay-700 text-base leading-relaxed">
              QQ群号：
              <span className="font-sans text-sm text-clay-900">575404333</span>
            </p>
          </div>
        </div>

        <div className="hairline-full w-full mt-14 md:mt-20 mb-12 md:mb-16" />
        <p className="mx-auto max-w-3xl text-center font-sans text-xs md:text-[13px] leading-[1.85] text-clay-500">
          内测期间本产品可免费使用，但稳定性可能会随并发用户数量而有波动。寻找算力赞助商ing，欢迎联系^-^
          <br />
          目前，内测期间生成的内容不会被保存，如有需要，请通过录屏或截图等方式保存游玩体验，并记录下生成故事时的提示词与风格选项等。
          <br />
          AI 生成的内容不代表本团队立场。
          <br />
          本站使用开源的 Umami 进行隐私友好的匿名访问统计：不使用 Cookie、不收集个人信息、不做跨站追踪。
        </p>
      </section>

      <footer className="mx-auto w-full max-w-[1640px] px-6 md:px-16 pb-10 mt-auto">
        <div className="hairline-full w-full mb-5" />
        <div className="flex flex-col items-center text-[10px] smallcaps text-clay-500">
          <span>© 2026 InfiPlot. All rights reserved.</span>
        </div>
      </footer>

      {styleOpen && styleRow >= 0 && (
        <StyleModal
          items={OPTS[styleRow]!.items}
          value={sel[styleRow] ?? 0}
          onPick={(i) => setSel((s) => s.map((v, j) => (j === styleRow ? i : v)))}
          onClose={() => setStyleOpen(false)}
        />
      )}
    </div>
  );
}
