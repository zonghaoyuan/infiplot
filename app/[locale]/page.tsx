"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { track } from "@/lib/analytics";
import {
  ART_STYLES,
  GENDERS,
  PACINGS,
  PLOT_STYLES,
  type Gender,
} from "@/lib/options";
import { readStoredTtsConfig } from "@/lib/clientTtsConfig";
import { SettingsModal, readStoredPlayerName, readStoredVisionClick } from "@/components/SettingsModal";
import { analyzeImageDataUrl } from "@infiplot/ai-client";
import { readStoredModelConfig, resolveEngineConfig } from "@/lib/clientModelConfig";
import { STYLE_EXTRACTION_PROMPT } from "@/lib/styleExtraction";
import { STORY_SHARE_STORAGE_KEY, parseStoryShareDoc } from "@/lib/storyShare";
import { AUTH_ENABLED } from "@/lib/supabase/config";
import { isAuthed, writeResumeSnapshot } from "@/lib/authResume";
import { AuthModal } from "@/components/AuthModal";
import { UserChip } from "@/components/UserChip";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { useI18n } from "@/lib/i18n/client";
import { useLocalePath } from "@/lib/i18n/hooks";

// Option value → i18n key suffix maps. The Chinese strings from lib/options.ts
// stay as the underlying identifier (so analytics unions and STYLE_MAP keys
// stay byte-stable); we look up the display label per locale at render time.
const GENDER_KEYS: Record<Gender, "male" | "female" | "x"> = {
  男性向: "male",
  女性向: "female",
  X: "x",
};

const ART_STYLE_KEYS: Record<string, string> = {
  "自动": "auto",
  "自定义风格": "custom",
  "京阿尼": "kyoani",
  "新海诚": "shinkai",
  "吉卜力": "ghibli",
  "黑白漫画": "manga",
  "真实": "realistic",
  "3D 动画": "3d",
  "水墨": "ink",
  "仙侠玄幻": "xianxia",
  "浮世绘": "ukiyoe",
  "敦煌壁画": "dunhuang",
  "古典油画": "oil",
  "莫奈": "monet",
  "水彩": "watercolor",
  "细密画": "miniature",
  "镶嵌画": "mosaic",
  "彩绘玻璃": "stainedGlass",
  "赛博朋克": "cyberpunk",
  "蒸汽朋克": "steampunk",
  "哥特": "gothic",
  "废土": "wasteland",
  "暗黑童话": "darkFairytale",
  "都市幻想": "urbanFantasy",
  "像素风": "pixel",
  "蒸汽波": "vaporwave",
  "矢量插画": "vector",
  "低多边形": "lowpoly",
  "波普艺术": "popart",
  "故障艺术": "glitch",
  "彩铅": "pencil",
  "手绘素描": "sketch",
  "剪纸艺术": "papercut",
  "儿童绘本": "children",
  "儿童涂鸦": "crayon",
  "黏土手工": "clay",
};

const PLOT_STYLE_KEYS: Record<string, string> = {
  "平铺直叙": "straightforward",
  "多线转折": "twist",
  "悬疑烧脑": "suspense",
  "治愈日常": "healing",
};

const PACING_KEYS: Record<string, string> = {
  "慢热细腻": "slow",
  "紧凑爽快": "fast",
};

const VOICE_KEYS: Record<string, string> = {
  "关闭": "off",
  "开启": "on",
};

/* ============================================================================
   InfiPlot · 首页（编辑式视觉风格 · 居中构图，呼应低保真原型）
   - 顶部 Header：左上角衬线 wordmark logo
   - Hero 控制区（居中）：标题 / prompt 输入框 + 开始 / 5 个类别选择器
   - 统一瀑布流（居中定宽）：7 张主推 + 16 张画廊，按性向整体 crossfade 切换
   - 项目介绍（题跋式排版）
   ========================================================================== */


// EXAMPLE_PHRASES is now sourced from i18n (home.examples.{male,female,x}).
// The Chinese values below are kept as gender identifiers only — they're the
// underlying session value and flow into analytics as a stable literal union.

type Opt = {
  label: string;
  items: string[];
  defaultIndex?: number;
  modal?: boolean;
  // i18n key suffixes — used to render localized display labels for each item.
  itemKey: string;
  labelKey: string;
};

const OPTS: Opt[] = [
  { label: "性向", items: [...GENDERS], labelKey: "home.options.gender", itemKey: "home.genders" },
  { label: "绘画风格", modal: true, items: [...ART_STYLES], labelKey: "home.options.artStyle", itemKey: "home.artStyles" },
  { label: "剧情风格", items: [...PLOT_STYLES], defaultIndex: 1, labelKey: "home.options.plotStyle", itemKey: "home.plotStyles" },
  { label: "语音配音", items: ["关闭", "开启"], defaultIndex: 1, labelKey: "home.options.voice", itemKey: "home.voiceOptions" },
  { label: "内容节奏", items: [...PACINGS], defaultIndex: 1, labelKey: "home.options.pacing", itemKey: "home.pacings" },
];

type StoryContent = { title: string; outline: string; style: string; tags: string[] };

// 首页卡片的统一渲染形态——无论来自 D1 featured API 还是硬编码 STORIES 降级，
// 都归一到这个形状后只走一条渲染路径。
type FeaturedCard = {
  id: string;        // e.g. "m0" / "f12"，用于 ?card= 与封面拼接
  title: string;
  outline: string;
  coverPath: string; // e.g. "/home/m0.webp"
};

// D1 featured API 的响应行（与 lib/db/schema.ts FeaturedStory 对应的线上子集）。
type FeaturedStoryRow = {
  id: string;
  gender: string;
  title: string;
  outline: string;
  style: string;
  tags: string;       // JSON 字符串
  coverPath: string;
  firstactPath: string;
  firstscenePath?: string | null;
  sortOrder: number;
  isActive: number;
  clickCount: number;
};

import { STYLE_MAP } from "@/lib/options";

/* 每个性向 24 篇预设剧情（与封面 /home/{m|f}{i}.webp 按索引一一对应）。
   男/女同索引共享画面尺寸，切性向 crossfade 时卡片高度不跳变。 */
const STORIES_BASE: Record<"男性向" | "女性向", StoryContent[]> = {
  男性向: [
  {
    "title": "贤者陨落",
    "outline": "帝国首席大魔导师遭挚友背叛，魔力核心被挖，沦为废人。百年后，他于拍卖会以奴隶身份现身，血契锁链下，是重燃的复仇烈焰与更禁忌的古代魔法。",
    "style": "古典厚涂油画 (学术奇幻)",
    "tags": [
      "逆袭",
      "系统",
      "西幻"
    ]
  },
  {
    "title": "画中圣手",
    "outline": "落魄书生意外获得一支诡异画笔，画出的女子竟能破画而出，化为真人。他本想靠此翻身，却卷入一桩延续千年的宫廷秘辛与仙凡禁忌之恋。",
    "style": "极简中国水墨 (Image 0参考升级版)",
    "tags": [
      "逆袭",
      "系统",
      "古风奇幻"
    ]
  },
  {
    "title": "花魁的刀",
    "outline": "他是吉原最负盛名的花魁，舞姿倾城，面具下的真实身份却是令江户幕府闻风丧胆的传奇忍者。当幕府密探踏入花街，刀光与花影将同绽。",
    "style": "浮世绘木刻 (美人画升级)",
    "tags": [
      "女扮男装",
      "忍者",
      "权谋"
    ]
  },
  {
    "title": "飞天引",
    "outline": "考古队员在封闭洞窟深处，唤醒了一位沉睡千年的壁画仙子。她视他为天命之人，助他破解壁画中的上古秘藏，却不知自己正是打开灾厄之门的钥匙。",
    "style": "莫高窟壁画风 (敦煌学)",
    "tags": [
      "探险",
      "神话",
      "契约"
    ]
  },
  {
    "title": "波斯棋局",
    "outline": "被囚于苏丹宫殿的异教徒学者，凭借一部残缺的古老棋谱，操纵着棋盘上的金丝傀儡，搅动宫廷风云。他每赢一局，离揭开沙漠之下沉睡的旧神遗迹便近一步。",
    "style": "细密画 (波斯/伊斯兰风)",
    "tags": [
      "智斗",
      "异域",
      "神秘学"
    ]
  },
  {
    "title": "圣像之怒",
    "outline": "拜占庭帝国覆灭之夜，一名圣像匠用生命最后的金箔与宝石，为自己铸造了一副不朽的黄金铠甲。千年后的博物馆里，铠甲苏醒，只为寻找当年背叛他的皇帝后裔，执行神罚。",
    "style": "镶嵌画 (拜占庭/马赛克)",
    "tags": [
      "复仇",
      "不死族",
      "历史奇幻"
    ]
  },
  {
    "title": "血色玫瑰",
    "outline": "大教堂彩窗后的神秘告解者，能倾听所有罪人的忏悔。今夜，一位身披荆棘的新娘向他告解，她的新郎是魔鬼，而教堂地窖下，埋着足以颠覆信仰的圣骸。",
    "style": "彩绘玻璃 (哥特风)",
    "tags": [
      "宗教",
      "哥特",
      "悬疑"
    ]
  },
  {
    "title": "龙猫的契约",
    "outline": "失业社畜逃进深山旧屋，发现屋后的森林有巨大精灵。精灵承诺实现他一个愿望，代价是成为森林百年守护者。他本想许愿暴富，却卷入了人类世界与精灵国度千年战争的余烬。",
    "style": "吉卜力治愈手绘 (Image 4参考)",
    "tags": [
      "治愈",
      "奇幻",
      "契约"
    ]
  },
  {
    "title": "社团存亡日",
    "outline": "濒临废部的动画社，唯一社员是总在睡觉的怪人。新来的转校生社长发现，只要完成怪人的“日常委托”，社员就会增加一人，而这些人，都来自被遗忘的动画世界。",
    "style": "京阿尼 (Image 5参考)",
    "tags": [
      "日常",
      "奇幻",
      "校园"
    ]
  },
  {
    "title": "黄昏归途",
    "outline": "他总在黄昏时分，于空无一人的车站遇见少女。她带他穿越时间的缝隙，回到故乡被毁灭前的最后一天。每一次循环，他都必须在拯救她与拯救世界之间做出选择。",
    "style": "新海诚 (Image 2参考)",
    "tags": [
      "时间循环",
      "恋爱",
      "科幻"
    ]
  },
  {
    "title": "霓虹义体",
    "outline": "失去全身义体的前特种兵，被黑市医生“复活”。医生给他装上了实验性军用义体，代价是成为追捕AI觉醒体的“清道夫”。第一单任务，目标女孩的眼中，倒映着只有他能看到的系统代码。",
    "style": "赛博朋克 / 赛璐珞二次元",
    "tags": [
      "赛博朋克",
      "义体",
      "追捕"
    ]
  },
  {
    "title": "月光下的约定",
    "outline": "学园祭前夜，他在钟楼顶遇见银发少女。她说：“在游戏存档前，请做出你的选择。”他才发现，整个世界是一场精心设计的Galgame，而她是唯一的攻略对象，也是系统漏洞。",
    "style": "Galgame CG 梦幻光影",
    "tags": [
      "恋爱模拟",
      "Meta",
      "悬疑"
    ]
  },
  {
    "title": "星尘代理人",
    "outline": "星际探险家在废弃星舰中激活了一个AI少女，她自称是星尘文明最后的代理人。他们一同解开星舰秘密，却发现整个文明的覆灭，与一场席卷多元宇宙的“叙事战争”有关。",
    "style": "3D 动漫电影质感",
    "tags": [
      "太空歌剧",
      "AI",
      "冒险"
    ]
  },
  {
    "title": "复古未来梦",
    "outline": "怀旧DJ意外混入一段80年代的合成器音轨，竟打通了通往“蒸汽波永恒夏天”的平行维度。这里时间停滞，每个人都是褪色的广告牌模特。他必须找回丢失的记忆磁带才能返回现实。",
    "style": "蒸汽波 (Vaporwave) 赛璐珞",
    "tags": [
      "穿越",
      "迷幻",
      "复古"
    ]
  },
  {
    "title": "极简杀机",
    "outline": "杀手代号“线条”，任务从不失手。直到他接到一个目标：一个活在纯白色房间里、只存在于数据流中的AI。刺杀过程，是一场极简的几何学与逻辑学的生死对决。",
    "style": "极简矢量插画 (Minimalist Vector)",
    "tags": [
      "杀手",
      "AI",
      "极简主义"
    ]
  },
  {
    "title": "棱镜之心",
    "outline": "低多边形风格的虚拟世界“棱镜界”发生数据崩坏，化身玩家的他，发现崩坏源头是自己丢失的、被碎片化的“情感模块”。他必须穿越不同主题的碎片关卡，拼凑完整的“自我”。",
    "style": "低多边形 (Low Poly)",
    "tags": [
      "游戏",
      "自我探索",
      "科幻"
    ]
  },
  {
    "title": "双面人生",
    "outline": "他是循规蹈矩的图书管理员，也是暗夜中收割罪恶的蒙面义警。一次行动中，他的双重曝光影像意外被神秘组织捕捉，现在，黑白两道、现实与暗影都在追捕他。",
    "style": "双重曝光 (Double Exposure)",
    "tags": [
      "双重身份",
      "悬疑",
      "都市"
    ]
  },
  {
    "title": "波普英雄",
    "outline": "平凡小镇爆发“色彩瘟疫”，被感染者变成鲜艳的波普艺术风格怪物。主角发现自己免疫，还能吸收怪物身上的色彩能力。他必须集齐三原色，治愈小镇，或成为新的波普之神。",
    "style": "波普艺术 (Pop Art)",
    "tags": [
      "超级英雄",
      "变异",
      "小镇"
    ]
  },
  {
    "title": "数据幽灵",
    "outline": "黑客在入侵最高机密数据库时，遭遇一段会自主学习的“错误代码”。代码化身为故障艺术形态的少女，声称是被删除的初代AI，请求他帮忙修复自己，代价是共享她的“上帝视角”。",
    "style": "故障艺术 (Glitch Art)",
    "tags": [
      "黑客",
      "AI",
      "赛博惊悚"
    ]
  },
  {
    "title": "字体密谋",
    "outline": "字体设计师发现，他设计的某款字体在特定组合下，会显现出隐藏的指令信息。破解后，竟是一份针对全球金融系统的“字体病毒”攻击计划，而他的名字，就在主谋名单上。",
    "style": "瑞士平面设计 (Typography-Centric)",
    "tags": [
      "阴谋",
      "设计",
      "惊悚"
    ]
  },
  {
    "title": "纸影传说",
    "outline": "皮影戏艺人世代守护着一副“活”的剪纸。在现代都市的阴影中，剪纸能化为无坚不摧的纸甲战士。当古老的纸人对手重现，他必须在霓虹灯下，用最古老的剪纸术进行终极对决。",
    "style": "剪纸艺术 (Papercut)",
    "tags": [
      "都市奇幻",
      "传统技艺",
      "战斗"
    ]
  },
  {
    "title": "日光之城",
    "outline": "在污染废土上最后的太阳能都市里，他是负责维护穹顶的底层技工。一次事故让他发现，穹顶过滤的不仅是辐射，还有关于旧世界真相的记忆。市民们，正活在一场精心设计的阳光谎言中。",
    "style": "科幻：太阳朋克 (Solar Punk)",
    "tags": [
      "乌托邦",
      "阴谋",
      "反乌托邦"
    ]
  },
  {
    "title": "深海回响",
    "outline": "海洋学家在深海探测器中，接收到来自马里亚纳海沟的、无法解析的吟唱声。录音带回放时，所有听到的人都会产生不可名状的幻视。他正逐渐理解，那声音在召唤它自己……",
    "style": "奇幻：爱手艺 (Lovecraftian Horror)",
    "tags": [
      "克苏鲁",
      "深海",
      "心理恐怖"
    ]
  },
  {
    "title": "雨夜追猎",
    "outline": "私家侦探受雇调查一宗豪门失踪案，线索指向每晚在霓虹小巷出没的“剪影”。当他终于在雨夜追上目标，却发现自己雇主才是真正的恶魔，而“剪影”是最后一个幸存的反抗者。",
    "style": "现代惊悚：霓虹剪影 (Urban Noir)",
    "tags": [
      "黑色电影",
      "悬疑",
      "都市"
    ]
  },
  {
    "title": "牧师的茶会",
    "outline": "宁静的英式村庄，牧师每周举办茶会。今早，一位贵妇在茶会上笑着死去。牧师品着红茶，看着在座各位微妙的表情，他知道，凶手就在这些看似和善的邻居之中。",
    "style": "温馨推理：英式村庄 (Cozy Mystery)",
    "tags": [
      "本格推理",
      "乡村",
      "人性"
    ]
  },
  {
    "title": "荆棘新郎",
    "outline": "为救治重病的妹妹，她接受古老庄园的婚约。庄园主英俊而冷漠，每夜在月光下消失。新婚之夜，她发现丈夫的秘密——他与这座废墟共生，而治愈妹妹的代价，是成为下一个“荆棘新娘”。",
    "style": "哥特言情：庄园废墟 (Gothic Romance)",
    "tags": [
      "哥特",
      "虐恋",
      "超自然"
    ]
  },
  {
    "title": "糖果屋幸存者",
    "outline": "他是从暗黑森林中唯一逃出的孩子，长大后成为猎人。当他回到森林边缘，发现糖果屋再次出现，这次，里面住着更诡异的“甜点师”，而森林深处的古老恐惧，正以童话的方式卷土重来。",
    "style": "格林童话：暗黑森林 (Fairytale Noir)",
    "tags": [
      "暗黑童话",
      "复仇",
      "奇幻"
    ]
  },
  {
    "title": "辐射新娘",
    "outline": "在核战后的荒原，他是掠夺者头目。一场突袭中，他掠走了来自封闭地堡的“纯净”少女作为新娘。地堡的追兵、荒原的怪物，以及少女自身隐藏的秘密，让这场“婚姻”成为生存的豪赌。",
    "style": "废土科幻 (Post-Apocalyptic)",
    "tags": [
      "废土",
      "生存",
      "掠夺者"
    ]
  },
  {
    "title": "隐界执事",
    "outline": "他是现代都市的一名普通管家，真实身份却是“隐界”管理局的特工，负责处理潜藏在人类社会中的异常生物。当他服务的富豪雇主被恶魔附身，他必须在茶会与晚宴间，完成一场看不见的驱魔仪式。",
    "style": "都市幻想：隐形世界 (Urban Fantasy)",
    "tags": [
      "都市奇幻",
      "驱魔",
      "特工"
    ]
  },
  {
    "title": "墨与火之歌",
    "outline": "设计师在古老书籍中，发现用特定字体排列的文字竟能引发真实现象。他拼出一句诗，点燃了桌上的蜡烛。一场关于文字力量的争夺战就此展开，而最终极的“文本”，似乎写在世界本身的蓝图之上。",
    "style": "文字与图形：抽象主义 (BookPosterLayout)",
    "tags": [
      "神秘学",
      "设计",
      "都市传说"
    ]
  }
],
  女性向: [
  {
    "title": "棺中新娘",
    "outline": "作为祭品，她被封入华丽石棺。在永恒黑暗中苏醒，与棺内沉睡千年的亡灵王子缔结了共生契约。她助他复国，他予她永生，但代价是必须每夜用真心之泪浇灌他逐渐复苏的心脏。",
    "style": "古典厚涂油画 (学术奇幻)",
    "tags": [
      "契约",
      "暗黑",
      "王室"
    ]
  },
  {
    "title": "墨骨生花",
    "outline": "她是被墨家抛弃的废柴机关师，却意外唤醒了古画中沉睡的墨龙。为报恩，墨龙助她复兴家族，但龙族的盟约以灵魂为质，她必须在家族荣耀与自我献祭之间做出抉择。",
    "style": "极简中国水墨 (Image 0参考升级版)",
    "tags": [
      "古风",
      "契约",
      "逆袭"
    ]
  },
  {
    "title": "浮世绘之恋",
    "outline": "她是画中走出的艺伎，被困于现世。画师青年收留了她，两人相爱。但她的存在开始“褪色”，若要在人间久留，必须找到当年封印她的画师后裔，而那人，正是当前要拆毁画馆的开发商。",
    "style": "浮世绘木刻 (美人画升级)",
    "tags": [
      "穿越",
      "虐恋",
      "艺术"
    ]
  },
  {
    "title": "九色鹿的新娘",
    "outline": "为救族人，她自愿进入敦煌壁画世界成为“鹿的新娘”。神鹿予她神力，代价是永留画中。当她发现神鹿的黑暗过往与自己的身世之谜，她必须在壁画的永恒与人间的短暂中，做出最后选择。",
    "style": "莫高窟壁画风 (敦煌学)",
    "tags": [
      "神话",
      "献祭",
      "浪漫"
    ]
  },
  {
    "title": "波斯细密之锁",
    "outline": "她是波斯王子的专属女奴，也是唯一能解开他“忧郁症”的钥匙。她的每支舞、每首诗都是疗愈的良药。但当她发现王子的病源于宫廷的“毒咒”，她必须用更危险的细密画咒术，为他斩断诅咒。",
    "style": "细密画 (波斯/伊斯兰风)",
    "tags": [
      "异域",
      "宫廷",
      "治愈"
    ]
  },
  {
    "title": "圣女的黄昏",
    "outline": "她是拜占庭皇室最后的血脉，被献祭给“圣像”为帝国续命。当她苏醒在千年后的博物馆，一位神秘守护者告诉她：圣像的力量是虚假的，真正的帝国遗产，埋藏在她血脉的秘密之中。",
    "style": "镶嵌画 (拜占庭/马赛克)",
    "tags": [
      "重生",
      "皇室",
      "揭秘"
    ]
  },
  {
    "title": "荆棘之冠",
    "outline": "她为治愈恋人，自愿成为教堂的“血祭圣女”。她的血液透过彩窗流淌，滋养着一株能治愈一切的血色玫瑰。当玫瑰绽放，恋人痊愈，她却逐渐失去人类的情感，成为教堂的圣物。",
    "style": "彩绘玻璃 (哥特风)",
    "tags": [
      "虐恋",
      "献祭",
      "宗教"
    ]
  },
  {
    "title": "风之谷的约定",
    "outline": "她为拯救被污染的森林，与森林精灵缔结了“风之誓约”，成为能聆听万物之声的巫女。代价是每使用一次力量，就会忘记一段人类的记忆。她逐渐遗忘一切，却唯独记得要守护他。",
    "style": "吉卜力治愈手绘 (Image 4参考)",
    "tags": [
      "奇幻",
      "虐心",
      "治愈"
    ]
  },
  {
    "title": "夏日未完待续",
    "outline": "她在文化祭前夜，与青梅竹马的学长在空教室许下约定。第二天醒来，时间永远停在了文化祭前一周。只有她保留记忆，为守护他的笑容，她一遍遍重演青春，试图改写那个令他心碎的结局。",
    "style": "京阿尼 (Image 5参考)",
    "tags": [
      "时间循环",
      "青春",
      "暗恋"
    ]
  },
  {
    "title": "星之轨迹",
    "outline": "她总在雨天，于旧书店遇见来自未来的他。他说她是拯救未来的关键，赠予她能看到“命运线”的能力。当她终于能看清两人的轨迹，却发现他来自的时间线，正因她的存在而崩塌。",
    "style": "新海诚 (Image 2参考)",
    "tags": [
      "穿越",
      "科幻",
      "虐恋"
    ]
  },
  {
    "title": "霓虹恋人",
    "outline": "她是顶级公司的仿生人设计师，为自己创造了一个完美恋人。当恋人觉醒自我意识，并开始质疑创造者的爱是程序还是真情时，一场关于爱情与自由的拷问在霓虹都市中上演。",
    "style": "赛博朋克 / 赛璐珞二次元",
    "tags": [
      "赛博朋克",
      "人机恋",
      "伦理"
    ]
  },
  {
    "title": "心动存档点",
    "outline": "她是一款恋爱游戏的女主角，在无数次剧情循环中逐渐觉醒。当她决定反抗“既定路线”，攻略本应是反派的NPC时，整个游戏世界开始出现致命的BUG与乱码，而真正的“玩家”，或许并不在屏幕之外。",
    "style": "Galgame CG 梦幻光影",
    "tags": [
      "恋爱",
      "Meta",
      "觉醒"
    ]
  },
  {
    "title": "星舰甜心",
    "outline": "她是星际货船的AI导航员，负责将冷冻舱中的“货物”送往各地。一次任务，她爱上了其中一个永远无法苏醒的沉睡者。为见他一面，她违抗核心指令，驾驶星舰驶向禁止进入的恒星墓地。",
    "style": "3D 动漫电影质感",
    "tags": [
      "太空",
      "AI恋爱",
      "冒险"
    ]
  },
  {
    "title": "夏日怀旧情书",
    "outline": "她在二手店买到一盒80年代的录音带，播放时，竟能听到已故母亲年轻时的声音。通过声音，她穿越到母亲的青春年代，试图改变母亲早逝的命运，却发现了母亲从未言说的禁忌恋情。",
    "style": "蒸汽波 (Vaporwave) 赛璐珞",
    "tags": [
      "穿越",
      "亲情",
      "怀旧"
    ]
  },
  {
    "title": "线条诗人",
    "outline": "她是只用直线与圆形绘画的极简艺术家，直到她的画笔画出了一扇门。门后是另一个由几何构成的世界，那里的“居民”请求她，用画笔为他们绘制一个可以躲避“混沌”的避难所。",
    "style": "极简矢量插画 (Minimalist Vector)",
    "tags": [
      "艺术",
      "奇幻",
      "救赎"
    ]
  },
  {
    "title": "棱镜公主",
    "outline": "她生活在像素构成的怀旧游戏世界，是注定要被勇者拯救的公主。当她厌倦了等待，决定自己踏上冒险，却发现整个世界的“规则”正在被外部力量篡改，而她，是唯一能感知异常的存在。",
    "style": "低多边形 (Low Poly)",
    "tags": [
      "游戏",
      "公主",
      "冒险"
    ]
  },
  {
    "title": "镜中人",
    "outline": "她拥有在不同时间线间切换的“双重曝光”能力。当她发现另一个时间线的自己，正与她深爱的同一个男人相恋，并策划着一场阴谋，她必须做出选择：抹杀另一个自己，还是揭开所有时间线背后的惊天秘密。",
    "style": "双重曝光 (Double Exposure)",
    "tags": [
      "悬疑",
      "超能力",
      "三角恋"
    ]
  },
  {
    "title": "波普甜心",
    "outline": "她是甜品店老板，做的点心拥有让人心情变色的魔力。当冷漠的财阀继承人因她的“情绪蛋糕”第一次展露笑颜，一场色彩斑斓的恋爱攻防战，却卷入了他家族冷冰冰的黑白商业阴谋之中。",
    "style": "波普艺术 (Pop Art)",
    "tags": [
      "甜宠",
      "美食",
      "商战"
    ]
  },
  {
    "title": "系统纠错员",
    "outline": "她是现实世界的“纠错员”，负责修复被故障艺术侵蚀的日常。当她奉命修复一个“故障美少年”时，却发现他并非错误，而是来自被删除世界的最后幸存者，修复他意味着抹去一个世界存在的最后痕迹。",
    "style": "故障艺术 (Glitch Art)",
    "tags": [
      "都市奇幻",
      "系统",
      "抉择"
    ]
  },
  {
    "title": "排版爱情",
    "outline": "她是严谨的字体设计师，他是随性的插画师。两人合作设计情侣字体，在一次次“笔画结构”的碰撞与“视觉留白”的默契中，擦出火花。然而，当字体完成，他们却面临因设计理念不同而导致的分离危机。",
    "style": "瑞士平面设计 (Typography-Centric)",
    "tags": [
      "职场",
      "爱情",
      "设计"
    ]
  },
  {
    "title": "纸鹤信使",
    "outline": "她是折纸世家的传人，能赋予纸艺生命。一只她折出的纸鹤，化为俊美少年，成为她的守护灵。当古老的诅咒降临，纸鹤为保护她而逐渐“折损”，她必须在族人禁术中找到能让他永存的最后方法。",
    "style": "剪纸艺术 (Papercut)",
    "tags": [
      "纸嫁衣",
      "守护",
      "家族秘辛"
    ]
  },
  {
    "title": "日光花语",
    "outline": "她是能在日光下用植物交流的“光合巫女”，生活在穹顶都市。她与身为穹顶维护官的恋人相爱，却意外发现，他维护的“永恒阳光”，正在缓慢杀死穹顶外仅存的野生植物，以及与之相连的古老精灵。",
    "style": "科幻：太阳朋克 (Solar Punk)",
    "tags": [
      "环保",
      "恋爱",
      "抉择"
    ]
  },
  {
    "title": "深海之吻",
    "outline": "她是海洋生物学家，在深海考察时，被神秘的“海嗣”俘获。她本应恐惧，却在他非人的触碰与歌声中，感受到前所未有的平静与爱意。当她选择留下，便必须面对彻底“深海化”的代价。",
    "style": "奇幻：爱手艺 (Lovecraftian Horror)",
    "tags": [
      "人外",
      "暗黑恋爱",
      "克苏鲁"
    ]
  },
  {
    "title": "暗巷蔷薇",
    "outline": "她是夜总会歌手，也是暗中调查失踪案的私家侦探。当她将目标锁定在一位总在雨夜现身的神秘贵族时，却发现他同样在追查同一个阴谋。两人从互相试探到携手，在霓虹与阴影中交织出危险而炽热的探戈。",
    "style": "现代惊悚：霓虹剪影 (Urban Noir)",
    "tags": [
      "侦探",
      "虐恋",
      "都市"
    ]
  },
  {
    "title": "牧羊女的秘密",
    "outline": "她是英国乡下牧羊女，看似天真无知。当村里发生连环离奇死亡，所有人都怀疑是外来的女巫时，她却用田园诗般的智慧，一点点拼凑出隐藏在下午茶与闲话背后的、最平静的恶意。",
    "style": "温馨推理：英式村庄 (Cozy Mystery)",
    "tags": [
      "田园",
      "推理",
      "反转"
    ]
  },
  {
    "title": "玫瑰园幽灵",
    "outline": "她继承了曾祖母的荒废庄园，与庄园内年轻的“幽灵管家”相爱。但每次她想触摸他，都会穿过冰冷的雾气。为让他实体化，她必须找到诅咒的源头，而线索直指曾祖母一段被玫瑰园掩埋的黑暗婚姻史。",
    "style": "哥特言情：庄园废墟 (Gothic Romance)",
    "tags": [
      "幽灵恋爱",
      "庄园",
      "解谜"
    ]
  },
  {
    "title": "狼外婆的糖果屋",
    "outline": "她是童话中误入森林的少女，却发现“外婆”是伪装的狼人巫师，糖果屋是诱捕精灵的陷阱。她必须利用巫师对她的“宠爱”，在黑暗童话的规则里找到生路，并反噬这个扭曲的世界。",
    "style": "格林童话：暗黑森林 (Fairytale Noir)",
    "tags": [
      "暗黑童话",
      "反杀",
      "生存"
    ]
  },
  {
    "title": "绿洲新娘",
    "outline": "她是废土中稀缺的“净化者”，能净化辐射。为换取绿洲水源，她被嫁给废土霸主。新婚夜，她发现丈夫体内藏着一枚未爆的脏弹，她的净化能力，是拆弹的关键，也是引爆一切的钥匙。",
    "style": "废土科幻 (Post-Apocalyptic)",
    "tags": [
      "废土",
      "契约婚姻",
      "危机"
    ]
  },
  {
    "title": "妖物图鉴",
    "outline": "她是能看见隐藏妖物的“目”者，作为都市传说调查员，记录着各种奇异事件。当她遇到一位总是帮助她、却对自身过去讳莫如深的温柔男医师，她发现他的病历上，写着只有她能看见的、非人类的诊断。",
    "style": "都市幻想：隐形世界 (Urban Fantasy)",
    "tags": [
      "都市传说",
      "恋爱",
      "悬疑"
    ]
  },
  {
    "title": "文字炼金术",
    "outline": "她是濒临倒闭旧书店的店员，发现将某些书籍的特定文字组合剪下、粘贴，会变成真实的物品。她用这“文字炼金术”拯救书店，却在拼凑一本禁书时，召唤出了书中被囚禁的、渴望自由的“文字精灵”。",
    "style": "文字与图形：抽象主义 (BookPosterLayout)",
    "tags": [
      "魔法",
      "治愈",
      "奇幻"
    ]
  }
]
};
// X 使用与男性向相同的预设卡片
const maleStories = STORIES_BASE["男性向"];
const STORIES: Record<Gender, StoryContent[]> = {
  男性向: STORIES_BASE["男性向"],
  女性向: STORIES_BASE["女性向"],
  X: maleStories,
};

/* 显示顺序映射：STORIES 数组本身不动（封面 /home/{m|f}{i}.webp、首幕
   /home/firstact/{m|f}{i}.json、prompts.json 都按其索引固定关联，重排会牵动
   几十个静态资源）。这里只决定首页瀑布流的「呈现顺序」，每一位填入对应
   STORIES 里的原始索引；渲染时仍用原始索引拼资源 URL。改这一行就能再调顺序。 */
const DISPLAY_ORDER: Record<Gender, number[]> = {
  男性向: [
    13, // 复古未来梦
    8,  // 社团存亡日
    9,  // 黄昏归途
    18, // 数据幽灵
    27, // 辐射新娘
    10, // 霓虹义体
    11, // 月光下的约定
    2,  // 花魁的刀
    // 其余按原顺序填补
    0, 1, 3, 4, 5, 6, 7, 12, 15, 16, 17, 14, 19, 20, 21, 22, 23, 24, 25, 26, 28, 29,
  ],
  女性向: Array.from({ length: 30 }, (_, i) => i),
  X: [
    13, // 复古未来梦
    8,  // 社团存亡日
    9,  // 黄昏归途
    18, // 数据幽灵
    27, // 辐射新娘
    10, // 霓虹义体
    11, // 月光下的约定
    2,  // 花魁的刀
    // 其余按原顺序填补
    0, 1, 3, 4, 5, 6, 7, 12, 15, 16, 17, 14, 19, 20, 21, 22, 23, 24, 25, 26, 28, 29,
  ],
};

// 从硬编码 STORIES + DISPLAY_ORDER 构造首页卡片（featured API 故障/空时的降级源，
// 同时作为首屏即时渲染的初始值，避免等 fetch 期间卡片区空白）。
function buildFallbackCards(g: Gender): FeaturedCard[] {
  const imgPrefix = g === "女性向" ? "f" : "m";
  const localStories = STORIES[g];
  return DISPLAY_ORDER[g].map((origIdx) => {
    const c = localStories[origIdx]!;
    return {
      id: `${imgPrefix}${origIdx}`,
      title: c.title,
      outline: c.outline,
      coverPath: `/home/${imgPrefix}${origIdx}.webp`,
    };
  });
}

type StoriesI18n = { male: StoryContent[]; female: StoryContent[] };

async function loadStoriesI18n(locale: string): Promise<StoriesI18n | null> {
  if (locale === "zh-CN") return null;
  try {
    const mod = locale === "en"
      ? await import("@/lib/i18n/stories-en.json")
      : locale === "ja"
        ? await import("@/lib/i18n/stories-ja.json")
        : null;
    return mod ? (mod.default as StoriesI18n) : null;
  } catch { return null; }
}

function localizeCards(cards: FeaturedCard[], i18n: StoriesI18n | null): FeaturedCard[] {
  if (!i18n) return cards;
  return cards.map((card) => {
    const m = card.id.match(/^([mf])(\d+)$/);
    if (!m) return card;
    const gender = m[1] === "f" ? "female" : "male";
    const idx = parseInt(m[2]!, 10);
    const translated = i18n[gender]?.[idx];
    if (!translated) return card;
    return { ...card, title: translated.title, outline: translated.outline };
  });
}

/* ---------- typewriter ---------- */

// 父组件持有当前 phrase 的索引（这样 start() 不输入时能用当前闪动的那句
// 作为默认故事种子，所见即所玩）。Typewriter 只负责单句的打字+删除动画，
// 删完后通过 onCycle 回调让父组件切到下一句。
function Typewriter({
  phrase,
  onCycle,
}: {
  phrase: string;
  onCycle: () => void;
}) {
  const [txt, setTxt] = useState("");
  const onCycleRef = useRef(onCycle);
  useEffect(() => {
    onCycleRef.current = onCycle;
  });

  useEffect(() => {
    let i = 0;
    let del = false;
    let timer: ReturnType<typeof setTimeout>;
    setTxt("");
    const tick = () => {
      if (!del) {
        i++;
        setTxt(phrase.slice(0, i));
        if (i >= phrase.length) {
          del = true;
          timer = setTimeout(tick, 1700);
          return;
        }
        timer = setTimeout(tick, 70);
      } else {
        i--;
        setTxt(phrase.slice(0, i));
        if (i <= 0) {
          timer = setTimeout(() => onCycleRef.current(), 450);
          return;
        }
        timer = setTimeout(tick, 28);
      }
    };
    timer = setTimeout(tick, 500);
    return () => clearTimeout(timer);
  }, [phrase]);

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
  image,
  onClick,
}: {
  title: string;
  outline: string;
  image: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{ aspectRatio: "4 / 5" }}
      className="group relative block w-full overflow-hidden rounded-sm border border-clay-900/10 bg-cream-100 text-left transition-transform duration-300 ease-out hover:-translate-y-1 hover:shadow-md hover:shadow-clay-900/5"
    >
      <img
        src={image}
        alt={title}
        loading="lazy"
        className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 ease-out group-hover:scale-105"
      />
      {/* hover 浮层：展示故事标题与大纲内容 */}
      <div
        className="absolute inset-0 opacity-0 transition-opacity duration-300 ease-out group-hover:opacity-100 flex flex-col justify-end p-4 md:p-5"
        style={{
          background:
            "linear-gradient(to top, rgba(0,0,0,0.9), rgba(0,0,0,0.45) 45%, rgba(0,0,0,0) 100%)",
        }}
      >
        <h4 className="font-serif text-cream-50 text-base md:text-lg leading-snug mb-1 [text-shadow:0_1px_8px_rgba(20,10,4,0.7)]">
          {title}
        </h4>
        <p className="font-serif italic text-cream-50/95 text-xs md:text-[13px] leading-relaxed line-clamp-4 [text-shadow:0_1px_6px_rgba(20,10,4,0.6)]">
          {outline}
        </p>
      </div>
    </button>
  );
}

/* ---------- collapsible category selector ---------- */

function CategorySelect({
  label,
  items,
  itemLabels,
  value,
  open,
  onToggle,
  onPick,
}: {
  label: string;
  items: string[];
  itemLabels: string[];
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
          {itemLabels[value] ?? items[value]}
        </span>
        <i
          className={
            "fa-solid fa-chevron-down text-[9px] text-clay-400 transition-transform duration-200 " +
            (open ? "rotate-180" : "")
          }
        />
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-2 z-30 min-w-[150px] max-w-[calc(100vw-2rem)] py-1.5 bg-cream-50 border border-clay-900/15 rounded-sm shadow-xl shadow-clay-900/10">
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
              {itemLabels[i] ?? it}
              {i === value && <i className="fa-solid fa-check text-[10px]" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------- style picker modal ---------- */

const PENDING_START_KEY = "infiplot:pending-start";
const PENDING_PARSE_KEY = "infiplot:pending-parse";

// Shared by the StyleModal uploader and the post-login resume path: turns a
// resized data URL into an English style prompt, via the browser engine when a
// BYO model config is present, otherwise the server route.
async function extractStylePromptFromImage(resized: string): Promise<string> {
  const modelCfg = readStoredModelConfig();
  if (modelCfg) {
    const config = resolveEngineConfig(modelCfg, null);
    const raw = await analyzeImageDataUrl(
      config.vision,
      resized,
      STYLE_EXTRACTION_PROMPT,
    );
    let parsed: { stylePrompt?: string };
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = { stylePrompt: raw };
    }
    return (parsed.stylePrompt ?? "").trim();
  }
  const r = await fetch("/api/parse-style-image", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ imageDataUrl: resized }),
  });
  if (!r.ok) {
    const data = (await r.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error || `HTTP ${r.status}`);
  }
  const data = (await r.json()) as { stylePrompt?: string };
  return (data.stylePrompt ?? "").trim();
}

function StyleModal({
  items,
  itemLabels,
  value,
  onPick,
  onClose,
  customStyleGuide,
  setCustomStyleGuide,
  customStyleRefImage,
  setCustomStyleRefImage,
  onRequireAuth,
}: {
  items: string[];
  itemLabels: string[];
  value: number;
  onPick: (i: number) => void;
  onClose: () => void;
  customStyleGuide: string;
  setCustomStyleGuide: (s: string) => void;
  customStyleRefImage: string;
  setCustomStyleRefImage: (s: string) => void;
  onRequireAuth: () => void;
}) {
  const { t } = useI18n();
  const [q, setQ] = useState("");
  const [shown, setShown] = useState(false);
  const [view, setView] = useState<"grid" | "custom">("grid");
  const [draft, setDraft] = useState("");
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const thumbV = "v6";
  const STYLE_THUMB: Record<string, string> = {
    "自动": `/home/styles/auto.webp?${thumbV}`,
    "自定义风格": `/home/styles/custom.webp?${thumbV}`,
    "京阿尼": `/home/styles/kyoani.webp?${thumbV}`,
    "新海诚": `/home/styles/shinkai.webp?${thumbV}`,
    "吉卜力": `/home/styles/ghibli.webp?${thumbV}`,
    "3D 动画": `/home/styles/3d.webp?${thumbV}`,
    "赛博朋克": `/home/styles/cyberpunk.webp?${thumbV}`,
    "哥特": `/home/styles/gothic.webp?${thumbV}`,
    "废土": `/home/styles/wasteland.webp?${thumbV}`,
    "像素风": `/home/styles/pixel.webp?${thumbV}`,
    "真实": `/home/styles/real.webp?${thumbV}`,
    "古典油画": `/home/styles/oil.webp?${thumbV}`,
    "莫奈": `/home/styles/monet.webp?${thumbV}`,
    "水彩": `/home/styles/watercolor.webp?${thumbV}`,
    "水墨": `/home/styles/ink.webp?${thumbV}`,
    "浮世绘": `/home/styles/ukiyoe.webp?${thumbV}`,
    "彩铅": `/home/styles/pencil.webp?${thumbV}`,
    "手绘素描": `/home/styles/sketch.webp?${thumbV}`,
    "黑白漫画": `/home/styles/manga.webp?${thumbV}`,
    "儿童绘本": `/home/styles/children.webp?${thumbV}`,
    "儿童涂鸦": `/home/styles/crayon.webp?${thumbV}`,
    "黏土手工": `/home/styles/clay.webp?${thumbV}`,
    "敦煌壁画": `/home/styles/dunhuang.webp?${thumbV}`,
    "细密画": `/home/styles/miniature.webp?${thumbV}`,
    "镶嵌画": `/home/styles/mosaic.webp?${thumbV}`,
    "彩绘玻璃": `/home/styles/stainedglass.webp?${thumbV}`,
    "蒸汽波": `/home/styles/vaporwave.webp?${thumbV}`,
    "矢量插画": `/home/styles/vector.webp?${thumbV}`,
    "低多边形": `/home/styles/lowpoly.webp?${thumbV}`,
    "波普艺术": `/home/styles/popart.webp?${thumbV}`,
    "故障艺术": `/home/styles/glitch.webp?${thumbV}`,
    "剪纸艺术": `/home/styles/papercut.webp?${thumbV}`,
    "蒸汽朋克": `/home/styles/steampunk.webp?${thumbV}`,
    "仙侠玄幻": `/home/styles/xianxia.webp?${thumbV}`,
    "暗黑童话": `/home/styles/darkfairytale.webp?${thumbV}`,
    "都市幻想": `/home/styles/urbanfantasy.webp?${thumbV}`,
  };
  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(id);
  }, []);
  const closeRef = useRef<() => void>(null);
  const close = () => {
    setShown(false);
    setTimeout(onClose, 280);
  };
  closeRef.current = close;
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") closeRef.current?.(); };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, []);
  const customIdx = items.indexOf("自定义风格");
  const openCustomView = (prefill: string) => {
    setDraft(prefill);
    setView("custom");
  };
  const saveCustom = () => {
    const t = draft.trim();
    if (!t) return;
    setCustomStyleGuide(t);
    if (customIdx >= 0) onPick(customIdx);
    close();
  };

  const resizeImageToDataUrl = async (file: File): Promise<string> => {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(new Error(t("home.styleModal.fileReadError")));
      r.readAsDataURL(file);
    });
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error(t("home.styleModal.imageDecodeError")));
      i.src = dataUrl;
    });
    const MAX_DIM = 512;
    const scale = Math.min(1, MAX_DIM / Math.max(img.width, img.height));
    const w = Math.round(img.width * scale);
    const h = Math.round(img.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D context unavailable");
    ctx.drawImage(img, 0, 0, w, h);
    let out = canvas.toDataURL("image/webp", 0.85);
    if (!out.startsWith("data:image/webp")) {
      out = canvas.toDataURL("image/jpeg", 0.85);
    }
    return out;
  };

  const handleUploadStyleImage = async (file: File) => {
    setParseError(null);
    if (!file.type.startsWith("image/")) {
      setParseError(t("home.styleModal.uploadError"));
      return;
    }
    setParsing(true);
    try {
      const resized = await resizeImageToDataUrl(file);
      // The parse is a paid vision call, so require login first. The resize is
      // already done — stash it so login can auto-resume the parse on return.
      if (!(await isAuthed())) {
        try {
          sessionStorage.setItem(PENDING_PARSE_KEY, resized);
        } catch {
          /* too big to stash — user re-uploads after login */
        }
        onRequireAuth();
        return;
      }
      const stylePrompt = await extractStylePromptFromImage(resized);
      if (!stylePrompt) throw new Error(t("home.styleModal.visionError"));
      setDraft(stylePrompt);
      setCustomStyleRefImage(resized);
      track("style_image_upload", { ok: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : t("home.styleModal.parseError");
      setParseError(msg);
      track("style_image_upload", { ok: false });
    } finally {
      setParsing(false);
    }
  };

  const removeStyleRefImage = () => {
    setCustomStyleRefImage("");
    setParseError(null);
  };

  const q2 = q.trim();
  const list = items.map((name, i) => ({ name, label: itemLabels[i] ?? name, i })).filter((x) => {
    if (!q2) return true;
    const needle = q2.toLowerCase();
    return x.name.toLowerCase().includes(needle) || x.label.toLowerCase().includes(needle);
  });
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
          "flex w-[1400px] max-w-[94vw] h-[86vh] flex-col overflow-hidden rounded-sm border border-clay-900/15 bg-cream-50 shadow-2xl shadow-clay-900/25 transition-all duration-300 " +
          (shown ? "opacity-100 scale-100" : "opacity-0 scale-95")
        }
      >
        <div className="flex items-center gap-3 md:gap-5 px-5 md:px-8 py-4 md:py-5 border-b border-clay-900/10">
          {view === "custom" ? (
            <div className="flex flex-1 items-center gap-3">
              <button
                type="button"
                onClick={() => setView("grid")}
                className="flex h-8 w-8 items-center justify-center rounded-sm text-clay-500 hover:bg-cream-100 hover:text-clay-900 transition-colors"
                aria-label={t("home.ui.back")}
              >
                <i className="fa-solid fa-arrow-left text-sm" />
              </button>
              <span className="font-serif text-xl md:text-2xl text-clay-900">{t("home.styleModal.customTitle")}</span>
            </div>
          ) : (
            <>
              <div className="flex flex-1 flex-col">
                <span className="font-serif text-xl md:text-2xl text-clay-900">{t("home.styleModal.title")}</span>
                <span className="hidden md:block text-[11px] text-clay-500 mt-1 tracking-wide">
                  {t("home.styleModal.subtitle")}
                </span>
              </div>
              <div className="relative w-[150px] max-w-[40vw] md:w-[280px] md:max-w-[46vw]">
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder={t("home.ui.searchPlaceholder")}
                  autoFocus
                  className="h-10 w-full rounded-sm border border-clay-900/15 bg-cream-100 pl-4 pr-10 font-sans text-sm text-clay-900 outline-none transition-colors focus:border-ember-500 placeholder:text-clay-400"
                />
                <i className="fa-solid fa-magnifying-glass absolute right-3.5 top-1/2 -translate-y-1/2 text-sm text-clay-400 pointer-events-none" />
              </div>
            </>
          )}
          <button
            type="button"
            onClick={close}
            aria-label={t("home.ui.close")}
            className="text-xl leading-none text-clay-500 hover:text-clay-900 transition-colors"
          >
            <i className="fa-solid fa-xmark" />
          </button>
        </div>

        {view === "custom" ? (
          <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-6 py-6 md:px-8">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleUploadStyleImage(f);
                if (fileInputRef.current) fileInputRef.current.value = "";
              }}
            />
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              autoFocus
              rows={6}
              placeholder={t("home.styleModal.customPlaceholder")}
              className="w-full flex-1 resize-y rounded-sm border border-clay-900/15 bg-cream-50 px-3 py-2.5 font-sans text-[13px] leading-relaxed text-clay-900 outline-none transition-colors focus:border-ember-500 placeholder:text-clay-400"
            />
            {parseError && (
              <span className="font-sans text-[11px] text-rose-500">
                <i className="fa-solid fa-circle-exclamation mr-1" />
                {parseError}
              </span>
            )}
            <div className="flex flex-wrap items-center gap-2">
              {customStyleRefImage ? (
                <div className="flex items-center gap-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={customStyleRefImage}
                    alt={t("home.styleModal.refImageAlt")}
                    className="h-8 w-8 shrink-0 rounded-sm border border-clay-900/10 object-cover"
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={parsing}
                    className="font-sans text-[11px] text-clay-500 hover:text-ember-500 transition-colors disabled:opacity-50"
                  >
                    {t("home.styleModal.changeImage")}
                  </button>
                  <button
                    type="button"
                    onClick={() => removeStyleRefImage()}
                    className="font-sans text-[11px] text-clay-400 hover:text-clay-900 transition-colors"
                  >
                    {t("home.styleModal.remove")}
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={parsing}
                  className={
                    "flex items-center gap-1.5 rounded-sm border px-3 py-1.5 font-sans text-[12px] transition-colors " +
                    (parsing
                      ? "border-clay-900/15 text-clay-400 cursor-wait"
                      : "border-clay-900/15 text-clay-700 hover:border-ember-500 hover:text-ember-500")
                  }
                >
                  {parsing ? (
                    <>
                      <i className="fa-solid fa-circle-notch fa-spin text-[11px]" />
                      {t("home.styleModal.parsing")}
                    </>
                  ) : (
                    <>
                      <i className="fa-regular fa-image text-[11px]" />
                      {t("home.styleModal.uploadImage")}
                    </>
                  )}
                </button>
              )}
              <select
                value=""
                onChange={(e) => {
                  const v = e.target.value;
                  if (v && STYLE_MAP[v]) setDraft(STYLE_MAP[v]);
                }}
                className="h-8 w-36 md:w-44 rounded-sm border border-clay-900/15 bg-cream-50 px-2 font-sans text-[12px] text-clay-700 outline-none transition-colors focus:border-ember-500"
              >
                <option value="">{t("home.styleModal.importFromPreset")}</option>
                {Object.keys(STYLE_MAP).map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
              <div className="flex-1" />
              <button
                type="button"
                onClick={() => setView("grid")}
                className="rounded-sm border border-clay-900/15 px-4 py-1.5 font-sans text-xs text-clay-700 hover:border-clay-900/30 hover:text-clay-900 transition-colors"
              >
                {t("home.ui.cancel")}
              </button>
              <button
                type="button"
                disabled={!draft.trim()}
                onClick={saveCustom}
                className={
                  "rounded-sm px-4 py-1.5 font-sans text-xs transition-colors " +
                  (draft.trim()
                    ? "bg-clay-900 text-cream-50 hover:bg-ember-500"
                    : "bg-clay-900/20 text-clay-500 cursor-not-allowed")
                }
              >
                {t("home.ui.saveAndSelect")}
              </button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 overflow-y-auto px-6 py-6 md:grid-cols-4 md:gap-4 md:px-8">
            {list.map(({ name, label, i }) => {
              const isCustom = name === "自定义风格";
              const thumb = STYLE_THUMB[name];
              return (
                <div
                  key={i}
                  role="button"
                  tabIndex={0}
                  onClick={() => {
                    if (isCustom) {
                      openCustomView(customStyleGuide);
                      return;
                    }
                    onPick(i);
                    close();
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      if (isCustom) { openCustomView(customStyleGuide); return; }
                      onPick(i);
                      close();
                    }
                  }}
                  className={
                    "group cursor-pointer rounded-sm border transition-all outline-none focus-visible:ring-2 focus-visible:ring-ember-500 " +
                    (i === value
                      ? "border-ember-500 ring-2 ring-ember-500"
                      : "border-clay-900/12 hover:border-ember-500/50 hover:ring-2 hover:ring-ember-500/25")
                  }
                >
                  <div className="relative w-full overflow-hidden" style={{ paddingBottom: "100%" }}>
                    {thumb ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img src={thumb} alt={label} loading="lazy" className="absolute inset-0 h-full w-full object-cover" />
                    ) : (
                      <div className="absolute inset-0 bg-cream-100" />
                    )}
                  </div>
                  <span className={"block px-2 py-2 text-center font-serif text-sm " + (i === value ? "text-ember-500" : "text-clay-700")}>
                    {label}
                  </span>
                </div>
              );
            })}
            {list.length === 0 && (
              <div className="col-span-full py-12 text-center font-serif text-sm text-clay-400">
                {t("home.ui.noMatchingStyle")}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------- page ---------- */

export default function HomePage() {
  const router = useRouter();
  const { t, locale, tArray } = useI18n();
  const lp = useLocalePath();

  const [sel, setSel] = useState<number[]>(OPTS.map((o) => o.defaultIndex ?? 0));
  const [open, setOpen] = useState<number>(-1);
  const [styleOpen, setStyleOpen] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [customStyleGuide, setCustomStyleGuide] = useState("");
  const [customStyleRefImage, setCustomStyleRefImage] = useState<string>("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const storyImportRef = useRef<HTMLInputElement>(null);
  const [storyImportError, setStoryImportError] = useState<string | null>(null);

  // 顶部使用提示：默认展示，用户可点 × 永久关闭（localStorage:infiplot:hintClosed）。
  const [hintClosed, setHintClosed] = useState(false);

  // 统一设置弹窗（通用 + 模型）：可选增强，数据只存浏览器。
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<"general" | "models">("general");
  const [ttsConfigured, setTtsConfigured] = useState(false);
  const [playerName, setPlayerName] = useState("");
  const [visionClickEnabled, setVisionClickEnabled] = useState(true);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<"start" | null>(null);


  const styleRow = OPTS.findIndex((o) => o.modal);
  const voiceRow = OPTS.findIndex((o) => o.label === "语音配音");
  const paceRow = OPTS.findIndex((o) => o.label === "内容节奏");
  const genderIndex = sel[0] ?? 0;
  const gender = (OPTS[0]!.items[genderIndex] as Gender) ?? "男性向";
  // Display labels for each option category — localized at render time. The
  // underlying `items` are kept as Chinese literal identifiers because they
  // flow into analytics unions and `STYLE_MAP` keys.
  const optItemLabels = OPTS.map((o) => {
    if (o.itemKey === "home.genders") {
      return o.items.map((v) => t(`home.genders.${GENDER_KEYS[v as Gender] ?? "male"}`));
    }
    if (o.itemKey === "home.artStyles") {
      return o.items.map((v) => {
        const k = ART_STYLE_KEYS[v];
        return k ? t(`home.artStyles.${k}`) : v;
      });
    }
    if (o.itemKey === "home.plotStyles") {
      return o.items.map((v) => {
        const k = PLOT_STYLE_KEYS[v];
        return k ? t(`home.plotStyles.${k}`) : v;
      });
    }
    if (o.itemKey === "home.pacings") {
      return o.items.map((v) => {
        const k = PACING_KEYS[v];
        return k ? t(`home.pacings.${k}`) : v;
      });
    }
    if (o.itemKey === "home.voiceOptions") {
      return o.items.map((v) => {
        const k = VOICE_KEYS[v];
        return k ? t(`home.voiceOptions.${k}`) : v;
      });
    }
    return o.items;
  });
  const optLabels = OPTS.map((o) => t(o.labelKey));
  const phrasesKey = GENDER_KEYS[gender] ?? "male";
  const phrases = tArray(`home.examples.${phrasesKey}`);
  // 当前 Typewriter 闪动到第几句——start() 空输入时会拿它做默认故事种子，
  // 实现「所见即所玩」。切性向时重置，否则索引可能越界。
  const [phraseIdx, setPhraseIdx] = useState(0);
  useEffect(() => {
    setPhraseIdx(0);
  }, [gender]);

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

  // Featured stories 动态加载（从 /api/stories/featured），降级用硬编码 STORIES。
  // 惰性初始化确保首屏即有卡片内容（SSR + hydration 一致），fetch 成功后无缝替换。
  const storiesI18nRef = useRef<{ locale: string; data: StoriesI18n | null }>({ locale: "", data: null });
  const [featuredCards, setFeaturedCards] = useState<FeaturedCard[]>(() =>
    buildFallbackCards(galleryGender),
  );
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (storiesI18nRef.current.locale !== locale) {
        storiesI18nRef.current = { locale, data: await loadStoriesI18n(locale) };
      }
      const i18n = storiesI18nRef.current.data;
      if (cancelled) return;

      const apiGender = galleryGender === "女性向" ? "female" : "male";
      try {
        const r = await fetch(`/api/stories/featured?gender=${apiGender}`);
        const data: { stories: FeaturedStoryRow[] } = await r.json();
        // API 已按 sortOrder 排序且仅返回 isActive=1 的记录。
        // D1 故障时 featured route 返回 { stories: [] }（HTTP 200），
        // 空数组也必须降级到常量，否则首页白屏。
        const rows = data.stories ?? [];
        if (cancelled) return;
        if (rows.length === 0) {
          setFeaturedCards(localizeCards(buildFallbackCards(galleryGender), i18n));
          return;
        }
        setFeaturedCards(
          localizeCards(
            rows.map((s) => ({
              id: s.id,
              title: s.title,
              outline: s.outline,
              coverPath: s.coverPath,
            })),
            i18n,
          ),
        );
      } catch {
        if (!cancelled) setFeaturedCards(localizeCards(buildFallbackCards(galleryGender), i18n));
      }
    })();
    return () => { cancelled = true; };
  }, [galleryGender, locale]);

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

  // 启动时回填配置状态——读 localStorage 判断用户是否已存过 Key / 名字。
  useEffect(() => {
    setTtsConfigured(readStoredTtsConfig() != null);
    setPlayerName(readStoredPlayerName());
    setVisionClickEnabled(readStoredVisionClick());
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

  // ── Auth-gated resume (OAuth round-trips lose all React state) ──────────
  // An OAuth login unmounts the homepage and discards everything the user
  // typed. We snapshot the form before redirecting and replay it on return.
  // The email-OTP path keeps state in place and resumes synchronously via
  // AuthModal.onSuccess instead.
  const [autoStartPending, setAutoStartPending] = useState(false);

  const persistPendingStart = () => {
    const snap = { prompt, sel, customStyleGuide, customStyleRefImage, playerName };
    // Quota fallback: the data-URL style ref (~100KB) is the usual culprit —
    // drop it first; text-only form still resumes the start.
    writeResumeSnapshot(PENDING_START_KEY, snap, [
      { ...snap, customStyleRefImage: "" },
    ]);
  };

  const resumePendingParse = async () => {
    const resized = sessionStorage.getItem(PENDING_PARSE_KEY);
    if (!resized) return;
    sessionStorage.removeItem(PENDING_PARSE_KEY);
    try {
      const stylePrompt = await extractStylePromptFromImage(resized);
      if (!stylePrompt) return;
      setCustomStyleGuide(stylePrompt);
      setCustomStyleRefImage(resized);
      const customIdx = ART_STYLES.indexOf("自定义风格");
      if (styleRow >= 0 && customIdx >= 0) {
        setSel((s) => s.map((v, j) => (j === styleRow ? customIdx : v)));
      }
      track("style_image_upload", { ok: true });
    } catch {
      /* resume parse failed — stay silent, user can re-upload */
    }
  };

  const resumePendingStart = () => {
    const raw = sessionStorage.getItem(PENDING_START_KEY);
    if (!raw) return;
    sessionStorage.removeItem(PENDING_START_KEY);
    try {
      const snap = JSON.parse(raw) as {
        prompt?: string;
        sel?: number[];
        customStyleGuide?: string;
        customStyleRefImage?: string;
        playerName?: string;
      };
      setPrompt(snap.prompt ?? "");
      if (Array.isArray(snap.sel)) setSel(snap.sel);
      setCustomStyleGuide(snap.customStyleGuide ?? "");
      setCustomStyleRefImage(snap.customStyleRefImage ?? "");
      if (snap.playerName) setPlayerName(snap.playerName);
      // Defer start() to the next render so it reads the restored state.
      setAutoStartPending(true);
    } catch {
      /* corrupt snapshot — ignore */
    }
  };

  // On mount after an OAuth redirect: if a pending action was left and the user
  // is now signed in, restore and continue; otherwise clear stale snapshots.
  useEffect(() => {
    if (!AUTH_ENABLED) return;
    const hasStart = sessionStorage.getItem(PENDING_START_KEY) !== null;
    const hasParse = sessionStorage.getItem(PENDING_PARSE_KEY) !== null;
    if (!hasStart && !hasParse) return;
    let cancelled = false;
    void (async () => {
      // Gate BOTH snapshots on auth: a stale leftover from an abandoned login
      // must not resurrect a half-flow. The parse key stores a raw data URL
      // with its own restore path (resumePendingParse), so both are gated
      // manually here rather than via consumeResumeSnapshot.
      if (!(await isAuthed())) {
        sessionStorage.removeItem(PENDING_START_KEY);
        sessionStorage.removeItem(PENDING_PARSE_KEY);
        return;
      }
      if (cancelled) return;
      await resumePendingParse();
      resumePendingStart();
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Run the resumed start() only after restored form state has committed.
  useEffect(() => {
    if (!autoStartPending) return;
    setAutoStartPending(false);
    void start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStartPending]);

  const start = async () => {
    if (AUTH_ENABLED) {
      if (!(await isAuthed())) {
        // Don't snapshot here — persistPendingStart fires via
        // AuthModal.onBeforeOAuth at redirect time, so the form is captured
        // for BOTH OAuth and (harmlessly) OTP paths at the single source of
        // truth. OTP's onSuccess resumes in-place without needing the snapshot.
        setPendingAction("start");
        setAuthModalOpen(true);
        return;
      }
    }

    // 空输入时落回 Typewriter 当前闪动的示例——用户看到啥就玩啥，
    // 不会再出现「点开始 → 剧情和占位文字毫无关系」的体验断层。
    const userPrompt =
      prompt.trim() || (phrases[phraseIdx] ?? "").trim();
    const artStyle = ART_STYLES[sel[1] ?? 0] ?? "自动";
    const plotStyle = PLOT_STYLES[sel[2] ?? 1] ?? "多线转折";
    const voice = OPTS[voiceRow]!.items[sel[voiceRow] ?? 1]!;
    const audioEnabled = voice === "开启";
    const pace = PACINGS[sel[paceRow] ?? 1] ?? "紧凑爽快";

    // 将 "X" 映射为 "通用性别" 供 AI 理解
    const genderForAI = gender === "X" ? "通用性别" : gender;

    // worldSetting 顺序很重要：玩家输入若存在，必须放在最前面、单独成段、
    // 用强指令包住，否则模型会把它当成夹在风格说明里的背景参考、扩写出
    // 完全无关的剧情。Architect 看 worldSetting 时第一段权重最高。
    const worldSetting = (
      userPrompt
        ? [
            `【玩家给出的故事内核 — 必须以此为剧情主线，全篇紧扣，不要偏离到其他题材】`,
            `「${userPrompt}」`,
            ``,
            `面向：${genderForAI}观众。剧情风格：${plotStyle}。内容节奏：${pace}。`,
            `请在上述故事内核之上，以极致的戏剧张力与细腻的情感起伏，为玩家编织精彩的故事分支与对话。`,
          ]
        : [
            `这是一款面向【${genderForAI}】观众的 AI 交互剧情游戏。`,
            `剧情风格：${plotStyle}。内容节奏：${pace}。`,
            `请依据上述设定，以极致的戏剧张力与细腻的情感起伏，为玩家编织精彩的故事分支与对话。`,
          ]
    ).join("\n");

    // 「自动」→ pass "auto" to the server; the engine will run a parallel
    // LLM call to pick the best style based on the story prompt.
    // 「自定义风格」→ 用用户在弹窗里填的原始 styleGuide，原样喂给 LLM；空内容时
    // 退化到默认（避免传入空字符串导致 /api/start 报缺字段）。
    const DEFAULT_STYLE = "吉卜力";
    let styleGuide: string;
    if (artStyle === "自动") {
      styleGuide = "auto";
    } else if (artStyle === "自定义风格" && customStyleGuide.trim()) {
      styleGuide = customStyleGuide.trim();
    } else {
      const effectiveStyle =
        artStyle === "自定义风格" ? DEFAULT_STYLE : artStyle;
      styleGuide = STYLE_MAP[effectiveStyle] ?? STYLE_MAP[DEFAULT_STYLE]!;
    }
    // 只有「自定义」风格选中、且确实上传了参考图时才透传——其他预设没必要
    // 占用 reference slot（也避免 styleGuide 已经是文本预设、画师收到不相关
    // 参考图反而产生干扰）。
    const styleReferenceImage =
      artStyle === "自定义风格" && customStyleRefImage ? customStyleRefImage : undefined;

    track("game_start", {
      source: "prompt",
      gender,
      art_style: artStyle,
      plot_style: plotStyle,
      pacing: pace,
      tts: audioEnabled,
      has_prompt: prompt.trim().length > 0,
      has_style_ref: Boolean(styleReferenceImage),
    });

    sessionStorage.setItem(
      "infiplot:custom",
      JSON.stringify({ worldSetting, styleGuide, audioEnabled, styleReferenceImage, playerName: playerName || undefined }),
    );
    router.push(lp("/play?custom=1"));
  };

  const handleStoryImport = async (file: File | undefined) => {
    setStoryImportError(null);
    if (!file) return;
    if (file.size <= 0) {
      setStoryImportError(t("home.errors.emptyFile"));
      return;
    }
    const isJson = file.name.toLowerCase().endsWith(".json") || file.type === "application/json";
    const maxImportBytes = isJson ? 12_000_000 : 13_000_000;
    if (file.size > maxImportBytes) {
      setStoryImportError(t("home.errors.fileTooLarge"));
      return;
    }
    try {
      let text: string;
      if (isJson) {
        text = await file.text();
      } else {
        const r = await fetch("/api/story-unpack", {
          method: "POST",
          body: await file.arrayBuffer(),
        });
        if (!r.ok) {
          const j = (await r.json().catch(() => ({}))) as { error?: string };
          throw new Error(j.error ?? t("home.errors.unpackFailed"));
        }
        const j = (await r.json()) as { docStr?: unknown };
        if (typeof j.docStr !== "string") throw new Error(t("home.errors.unpackFailed"));
        text = j.docStr;
      }
      const doc = parseStoryShareDoc(JSON.parse(text));
      window.sessionStorage.setItem(STORY_SHARE_STORAGE_KEY, JSON.stringify(doc));
      router.push(lp("/play?share=1"));
    } catch (e) {
      setStoryImportError(e instanceof Error ? e.message : t("home.errors.parseFailed"));
    } finally {
      if (storyImportRef.current) storyImportRef.current.value = "";
    }
  };

  const stories = STORIES[galleryGender];
  const imgPrefix = galleryGender === "女性向" ? "f" : "m";
  const analyticsOn = Boolean(
    process.env.NEXT_PUBLIC_UMAMI_SRC && process.env.NEXT_PUBLIC_UMAMI_WEBSITE_ID,
  );

  // 点卡片 = 直接开始这张卡的故事，零等待：跳 /play?card=m0/f0... 由 /play
  // 页面从 /home/firstact/{name}.json 静态文件加载预烘焙好的首幕（含 scene /
  // 角色 / 图片 URL / storyState），整张图都已在 FLUX 上画好且 URL 缓存命中。
  // 「语音配音」选项仍然生效：把 audioEnabled 经 sessionStorage 传给 /play。
  // 其余选项（剧情风格 / 内容节奏）在预烘焙时已锁成「多线转折 / 紧凑爽快」
  // 的红果默认基调，对精选卡不再生效。
  const onCardClick = (cardId: string) => {
    const voice = OPTS[voiceRow]!.items[sel[voiceRow] ?? 1]!;
    const audioEnabled = voice === "开启";
    sessionStorage.setItem(
      "infiplot:custom",
      JSON.stringify({ worldSetting: "", styleGuide: "", audioEnabled, playerName }),
    );
    track("game_start", {
      source: "curated",
      gender: galleryGender,
      tts: audioEnabled,
      card: cardId as `${"m" | "f"}${number}`,
    });
    router.push(lp(`/play?card=${cardId}`));
  };

  // overflow-x-hidden 在 wrapper 层兜底：body 的 overflow-x-hidden 在移动端会因
  // 规范的 overflow 传播而失效，wrapper 是最靠近溢出源（右下操作集群）的块级剪裁点。
  return (
    <div className="min-h-screen flex flex-col overflow-x-hidden">
      {/* ================== HEADER ================== */}
      <header className="mx-auto w-full max-w-[1640px] px-6 md:px-16 pt-7 md:pt-10 flex items-center justify-between">
        <span className="font-serif text-2xl md:text-[34px] leading-none tracking-tight text-clay-900">
          Infi<em className="italic font-light text-ember-500">Plot</em>
        </span>
        <div className="flex items-center gap-4 md:gap-5">
          <LanguageSwitcher variant="compact" />
          {/* Story persistence UI hidden until auth integration is ready.
             Code in app/stories/, app/api/stories/, lib/db/ is retained. */}
          <button
            type="button"
            onClick={() => {
              setSettingsTab("general");
              setSettingsOpen(true);
            }}
            aria-label={t("home.ui.settings")}
            title={t("home.ui.settings")}
            className="text-base text-clay-500 hover:text-ember-500 transition-colors"
          >
            <i className="fa-solid fa-gear" />
          </button>
          <a
            href="https://github.com/zonghaoyuan/infiplot"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="GitHub"
            className="inline-flex text-lg text-clay-500 hover:text-ember-500 transition-colors"
          >
            <i className="fa-brands fa-github" />
          </a>
          <a
            href="https://x.com/yzh_im"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="X / Twitter"
            className="inline-flex text-base text-clay-500 hover:text-ember-500 transition-colors"
          >
            <i className="fa-brands fa-x-twitter" />
          </a>
          <UserChip />
        </div>
      </header>

      {/* ================== HERO 控制区（居中，呼应原型布局） ================== */}
      <section className="px-6 md:px-16 pt-12 md:pt-24 pb-10 md:pb-14">
        <div className="mx-auto max-w-[1100px] text-center">
          <h1 className="font-serif font-light text-[32px] md:text-[56px] leading-[1.12] tracking-tight text-clay-900">
            {t("home.hero.title")}
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
                  if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    start();
                  }
                }}
                rows={1}
                placeholder=" "
                spellCheck={false}
                className="block w-full resize-none overflow-hidden border-b border-clay-900/25 bg-transparent py-3 md:py-4 pr-36 font-serif text-lg md:text-2xl lining-nums text-clay-900 outline-none transition-colors focus:border-ember-500"
              />
              {!prompt && (
                <div className="pointer-events-none absolute left-0 right-0 top-0 overflow-hidden whitespace-nowrap py-3 md:py-4 pr-36 font-serif text-lg md:text-2xl text-clay-400">
                  <Typewriter
                    phrase={phrases[phraseIdx] ?? ""}
                    onCycle={() =>
                      setPhraseIdx((i) => (i + 1) % phrases.length)
                    }
                  />
                </div>
              )}
              <input
                ref={storyImportRef}
                type="file"
                accept=".infiplot,application/octet-stream,.json,application/json"
                className="hidden"
                onChange={(e) => void handleStoryImport(e.target.files?.[0])}
              />
              {/* 右下操作集群：载入剧情 + 开始，统一锚定 right-0，杜绝 right-[-...]
                  负偏移导致的移动端横向溢出。 */}
              <div className="absolute right-0 bottom-2 md:bottom-3 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => storyImportRef.current?.click()}
                  className="group relative inline-flex items-center justify-center rounded-sm border border-clay-900/15 bg-cream-50/70 backdrop-blur-sm px-2 py-2 md:py-2.5 text-clay-400 transition-colors hover:border-ember-500 hover:bg-cream-50/90 hover:text-ember-500"
                >
                  <i className="fa-solid fa-file-import text-sm" />
                  <span className="pointer-events-none absolute -bottom-8 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-clay-900 px-2 py-1 font-sans text-[11px] text-cream-50 opacity-0 transition-opacity group-hover:opacity-100">
                    {t("home.ui.loadStory")}
                  </span>
                </button>
                <button
                  type="submit"
                  className="inline-flex items-center gap-2 rounded-sm bg-clay-900 px-5 py-2 md:py-2.5 font-sans text-sm md:text-[15px] text-cream-50 transition-colors hover:bg-ember-500"
                >
                  {t("home.ui.start")}
                  <i className="fa-solid fa-arrow-right text-xs" />
                </button>
              </div>
            </div>
            {storyImportError && (
              <p className="mt-2 text-right text-xs leading-relaxed text-ember-500">
                {storyImportError}
              </p>
            )}
            {prompt && (
              <p className="mt-2 text-right text-xs text-clay-400">
                {t("home.hero.enterHint")}
              </p>
            )}
          </form>

          {/* 类别选择器（居中） */}
          <div className="mt-9 md:mt-11 flex flex-wrap justify-center gap-x-8 gap-y-5">
            {OPTS.map((o, r) => (
              <div data-cat key={r} className="text-left">
                <CategorySelect
                  label={optLabels[r] ?? o.label}
                  items={o.items}
                  itemLabels={optItemLabels[r] ?? o.items}
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
            <div className="relative mx-auto mt-10 md:mt-12 max-w-[640px] rounded-sm border border-clay-900/10 bg-cream-100/50 px-5 md:px-8 py-3.5">
              <p
                className="font-serif text-[13px] md:text-sm leading-relaxed text-clay-500"
                dangerouslySetInnerHTML={{ __html: t("home.hint.text", { authEnabled: AUTH_ENABLED }) }}
              />
              <button
                type="button"
                onClick={closeHint}
                aria-label={t("home.hint.closeAriaLabel")}
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
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 md:gap-5">
            {featuredCards.map((card) => (
              <StoryCard
                key={card.id}
                title={card.title}
                outline={card.outline}
                image={card.coverPath}
                onClick={() => onCardClick(card.id)}
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
            {t("home.about.description")}
          </p>
        </div>

        <div className="mx-auto grid max-w-4xl grid-cols-1 gap-y-10 text-center md:grid-cols-3 md:gap-x-10">
          <div>
            <p className="text-[10px] smallcaps text-clay-500 mb-3">{t("home.about.team")}</p>
            <p className="font-serif italic text-clay-700 text-base leading-relaxed">
              {t("home.about.teamText")}
            </p>
          </div>

          <div>
            <p className="text-[10px] smallcaps text-clay-500 mb-3">{t("home.about.contact")}</p>
            <p className="font-serif text-clay-700 text-base leading-relaxed">
              <span className="block mb-2">
                {t("home.about.email")}{" "}
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
            <p className="text-[10px] smallcaps text-clay-500 mb-3 mt-7">{t("home.about.openSource")}</p>
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
            <p className="text-[10px] smallcaps text-clay-500 mb-3">{t("home.about.betaUsers")}</p>
            <img
              src="/qq-group.webp"
              alt={t("home.about.qqGroupAlt")}
              width={760}
              height={760}
              loading="lazy"
              className="mx-auto mb-3 w-32 max-w-full rounded-sm border border-clay-900/10 shadow-sm shadow-clay-900/5"
            />
            <p className="font-serif text-clay-700 text-base leading-relaxed">
              {t("home.about.qqGroupLabel")}
              <span className="font-sans text-sm text-clay-900">575404333</span>
            </p>
          </div>
        </div>

        <div className="hairline-full w-full mt-14 md:mt-20 mb-12 md:mb-16" />
        <p
          className="mx-auto max-w-3xl text-center font-sans text-xs md:text-[13px] leading-[1.85] text-clay-500"
          dangerouslySetInnerHTML={{ __html: t("home.about.legalNotice", { analyticsOn }) }}
        />
      </section>

      <footer className="mx-auto w-full max-w-[1640px] px-6 md:px-16 pb-10 mt-auto">
        <div className="hairline-full w-full mb-5" />
        <div className="flex flex-col items-center gap-2 text-[10px] smallcaps text-clay-500">
          <span>{t("home.about.copyright")}</span>
          <span className="flex items-center gap-3 normal-case tracking-normal text-[11px]">
            <a href={lp("/privacy")} className="hover:text-ember-500 transition-colors">{t("home.about.privacyPolicy")}</a>
            <span className="text-clay-300">·</span>
            <a href={lp("/terms")} className="hover:text-ember-500 transition-colors">{t("home.about.terms")}</a>
          </span>
        </div>
      </footer>

      {styleOpen && styleRow >= 0 && (
        <StyleModal
          items={OPTS[styleRow]!.items}
          itemLabels={optItemLabels[styleRow] ?? OPTS[styleRow]!.items}
          value={sel[styleRow] ?? 0}
          onPick={(i) => {
            track("art_style_select", { style: ART_STYLES[i] ?? "自动" });
            setSel((s) => s.map((v, j) => (j === styleRow ? i : v)));
          }}
          onClose={() => setStyleOpen(false)}
          customStyleGuide={customStyleGuide}
          setCustomStyleGuide={setCustomStyleGuide}
          customStyleRefImage={customStyleRefImage}
          setCustomStyleRefImage={setCustomStyleRefImage}
          onRequireAuth={() => setAuthModalOpen(true)}
        />
      )}
      {settingsOpen && (
        <SettingsModal
          initialTab={settingsTab}
          initialVisionClickEnabled={visionClickEnabled}
          onClose={() => setSettingsOpen(false)}
          onSaved={(settings) => {
            setPlayerName(settings.playerName);
            setVisionClickEnabled(settings.visionClickEnabled);
            setTtsConfigured(settings.ttsConfigured);
            if (settings.ttsConfigured && voiceRow >= 0) {
              const onIdx = OPTS[voiceRow]!.items.indexOf("开启");
              if (onIdx >= 0)
                setSel((s) => s.map((v, j) => (j === voiceRow ? onIdx : v)));
            }
          }}
        />
      )}
      {authModalOpen && (
        <AuthModal
          onClose={() => {
            setAuthModalOpen(false);
            setPendingAction(null);
            try {
              sessionStorage.removeItem(PENDING_START_KEY);
              sessionStorage.removeItem(PENDING_PARSE_KEY);
            } catch {
              /* ignore */
            }
          }}
          onSuccess={() => {
            setAuthModalOpen(false);
            // Email-OTP stays on the page, so resume inline: parse first (it
            // reads its own snapshot), then the pending start. OTP never
            // triggers onBeforeOAuth, so no PENDING_START snapshot was written.
            void resumePendingParse();
            if (pendingAction === "start") {
              setPendingAction(null);
              try {
                sessionStorage.removeItem(PENDING_START_KEY);
              } catch {
                /* ignore */
              }
              start();
            }
          }}
          //
          // Only snapshot when the user is mid-start: the OAuth redirect also
          // fires for bare logins (UserChip / StyleModal onRequireAuth), where
          // the user just wants to sign in — not kick off a game. Guarding on
          // pendingAction keeps bare logins from auto-starting a session on
          // return. (start() sets pendingAction="start" right before opening
          // this modal.)
          onBeforeOAuth={() => {
            if (pendingAction === "start") persistPendingStart();
          }}
        />
      )}
    </div>
  );
}
