"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

/* ============================================================================
   InfiPlot · 首页（云梦编辑式视觉风格 · 居中构图，呼应低保真原型）
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
      "二次元",
      "吉卜力",
      "真实系",
      "超写实",
      "水彩",
      "像素风",
      "日系动画",
      "3D 渲染",
      "蒸汽朋克",
      "玄幻",
      "国风水墨",
      "赛博朋克",
    ],
  },
  { label: "剧情风格", items: ["平铺直叙", "多线转折", "悬疑烧脑", "治愈日常"], defaultIndex: 1 },
  { label: "语音配音", items: ["关闭", "开启"], defaultIndex: 1 },
  { label: "内容节奏", items: ["慢热细腻", "紧凑爽快"], defaultIndex: 1 },
];

type StoryContent = { title: string; outline: string };

/* 每个性向 30 篇预设剧情，与图片 /home/{m|f}{i}.webp 按索引一一对应。
   男/女同索引共享画面尺寸，切性向 crossfade 时卡片高度不跳变。 */
const STORIES: Record<Gender, StoryContent[]> = {
  男性向: [
    { title: "樱の约定", outline: "樱花纷飞的黄昏，他终于鼓起勇气，向并肩走过六年的青梅竹马说出那句话……" },
    { title: "锈色边境", outline: "漫天黄沙的废土，机械心脏在胸腔中沉重轰鸣。我从钢铁山中挖出一个完好的休眠舱……" },
    { title: "云海仙踪", outline: "凡骨少年偶得神秘残碑，登顶云海仙山，神魔同修之路自此开启。" },
    { title: "六月雨季", outline: "南方县城的多雨六月，转学第一天，注意到那个总在天台读诗的同学。雨水打湿了未送出的伞……" },
    { title: "雨夜霓虹", outline: "2087 年东亚特区的酸雨之夜，丢失了三天记忆的我，手腕终端响起一通匿名警告：「他们来找你了」。" },
    { title: "学院秘闻", outline: "深夜图书馆地下密室，清冷孤僻的班长跪在圆环阵法前，吟诵着不属于人类的咒词。" },
    { title: "异界召唤", outline: "再睁眼，没有班主任，只有昏暗的魔法阵与一位哭得梨花带雨的圣女：「勇者大人，请拯救这个世界。」" },
    { title: "花火之夜", outline: "夏祭的夜空下，浴衣女孩与你约定，今晚最后一发烟火，要一起看完。" },
    { title: "霓虹之外", outline: "漂浮的飞车与古老方块字的全息广告——这是赛博东亚的另一种黎明。" },
    { title: "放学后的车站", outline: "夕阳染红的乡间月台，无人列车迟迟未来，你和她沉默并立。" },
    { title: "星辰咒语", outline: "古老图书馆深处，星纹长袍下的法师女孩低声念出禁咒。" },
    { title: "战姬启动", outline: "紧急警报红光中，少女握紧操纵杆——决战时刻已到。" },
    { title: "街灯之下", outline: "午夜独行的女侦探，雨雾中藏着尚未揭晓的真相。" },
    { title: "全息伞下", outline: "霓虹雨夜，两人共撑全息伞——这一次，是道别还是开始？" },
    { title: "竹林之约", outline: "竹林深处的快意一战，落叶纷飞——谁先收剑？" },
    { title: "暗夜王座", outline: "烛光摇曳的古老王座之上，公主等待着她唯一的回信。" },
    { title: "放学独白", outline: "阳光斜射的空教室，最后一个学生在笔记本上写着什么？" },
    { title: "第七封信", outline: "樱花树下展开的信纸，淡淡的笔迹，字字千钧。" },
    { title: "月神降临", outline: "银发倾泻、极光环绕——传说中的月神，今夜降临凡间。" },
    { title: "血月武士", outline: "血色满月之下，刀光与樱瓣同时落下。" },
    { title: "森林女巫", outline: "烛光摇曳的森林小屋，女巫熬制着能改变命运的魔药。" },
    { title: "夏日海岸", outline: "粉橙色的夕阳，两个挚友坐在海岸边，把秘密轻轻放进海风里。" },
    { title: "屏幕之间", outline: "霓虹青光映在脸上，全屏代码下藏着被遗忘的真相。" },
    { title: "雨夜客栈", outline: "雨夜投宿的破败客栈，邻桌蒙面女子的剑匣里，似乎封着一段江湖恩怨。" },
    { title: "深空警报", outline: "殖民舰舰桥警报骤响，舷窗外那颗未知行星正泛起诡异的红光。" },
    { title: "上海滩暗号", outline: "1936 年的上海滩，留声机旋律里，舞女递来一张写着暗号的牌。" },
    { title: "三长两短", outline: "末世第 173 天，卷帘门外的抓挠声停了，取而代之的是规律的敲门——三长两短。" },
    { title: "正午对决", outline: "正午烈日下的无人小镇，唯一的酒馆门口，一个陌生枪手正等着与我决斗。" },
    { title: "万米之城", outline: "潜水钟沉入万米海沟，探照灯扫过的不是岩壁，而是一座沉睡的远古之城。" },
    { title: "云上海盗", outline: "齿轮轰鸣的飞空艇甲板，云海之上，海盗的黑色气球正逼近舷侧。" },
  ],
  女性向: [
    { title: "摄政王独宠", outline: "穿越成将军府的废物嫡女，冷面摄政王却把整个京城最名贵的红玉镯，亲手戴在了我的腕上……" },
    { title: "重生前夕", outline: "重生回到分手前夜，他还没说出那句「对不起」。这一次，让我先转身。" },
    { title: "恶役千金", outline: "一觉醒来，竟成了乙游里被命运钦点的恶役千金，要躲开所有 BAD END……" },
    { title: "天台之上", outline: "南方多雨的六月，转学第一天，我把伞悄悄递给了那个在天台读诗的少年。" },
    { title: "登基之夜", outline: "登基大典上群臣俯首，而我只想看那个一直立在阴影里的人，今夜会不会上前一步。" },
    { title: "江湖玉颜", outline: "江湖传言，那位执剑女侠从不动情。可那个雨夜，她为他收剑而立。" },
    { title: "学长的告白", outline: "夕阳染红了天台，那个总在篮球场被全校女生围观的学长，第一次叫住了我。" },
    { title: "夏祭灯影", outline: "夏祭的夜空下，他替你挡开人潮，低声说：最后一发烟火，只想和你一起看完。" },
    { title: "雨夜车站", outline: "末班电车迟迟未至，他脱下外套披在你肩上，霓虹在积水里碎成星河。" },
    { title: "黄昏并肩", outline: "夕阳染红的乡间月台，他终于停下脚步回头看你——那句话堵在喉咙里很久了。" },
    { title: "禁书之约", outline: "图书馆最深处，清冷的学生会长合上禁书，抬眼时眸色温柔得不像他。" },
    { title: "骑士誓约", outline: "红色警报响彻舰桥，他单膝跪在你面前：以剑起誓，此生只为你出鞘。" },
    { title: "雨巷追影", outline: "午夜雨巷，他撑伞追上独行的你：这条路太黑，我送你回去。" },
    { title: "共伞之间", outline: "霓虹雨夜，他把全息伞偏向你这侧，自己半边肩膀已被雨打湿。" },
    { title: "竹影收剑", outline: "竹林深处刀光骤停，他为你收剑而立，落叶落在你们之间。" },
    { title: "深宫回眸", outline: "烛影摇红的宫宴上，冷面摄政王越过群臣，只朝你伸出了手。" },
    { title: "空教室", outline: "夕照斜斜铺满空教室，他把写满字的笔记本推到你面前，耳尖泛红。" },
    { title: "樱下情书", outline: "樱花树下，他递来第七封信，这一次落款不再是匿名。" },
    { title: "月下倾心", outline: "银发垂落、极光环绕，传说中的月神俯身，指尖轻触你的脸颊。" },
    { title: "血月相护", outline: "血色满月之下，他挡在你身前，刀光与樱瓣同时落下。" },
    { title: "魔药之约", outline: "森林小屋烛火摇曳，他为你熬一剂改写命运的魔药，只求换你一笑。" },
    { title: "海岸絮语", outline: "粉橙色夕阳里，他和你并肩坐在堤岸，把没说出口的心事交给海风。" },
    { title: "屏光之后", outline: "幽蓝屏光映在他脸上，敲下最后一行代码，他转头：我找到你了。" },
    { title: "龙王契约", outline: "古龙巢穴深处，化为人形的银发龙王单膝跪地，将一枚龙鳞戒指推到我面前。" },
    { title: "洋场先生", outline: "1936 年的上海公馆，那位留洋先生替我挡下流弹，西装袖口洇开一片猩红。" },
    { title: "最后一颗子弹", outline: "末世第 173 天，他用最后一颗子弹打穿破门的丧尸，转身把我护在身后。" },
    { title: "古堡伯爵", outline: "雾锁古堡的舞会上，苍白俊美的伯爵俯身吻过我的手背，唇下却没有一丝温度。" },
    { title: "鞍前", outline: "黄沙漫天的西部小镇，沉默的赏金猎人翻身上马，伸手把我拉上他的鞍前。" },
    { title: "深海王子", outline: "潜入万米海沟的遗迹，发光的人鱼王子环住我的腰，带我穿过沉睡的古城。" },
    { title: "只属于我们的航线", outline: "飞空艇甲板上，独眼船长把望远镜递到我眼前：「看，那是只属于我们的航线。」" },
  ],
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
  image,
  placeholderRatio = 4 / 5,
  onClick,
}: {
  title: string;
  outline: string;
  image: string;
  placeholderRatio?: number;
  onClick: () => void;
}) {
  // 卡片高度 = 图片真实宽高比。加载前先用 placeholderRatio 占好位（按该类卡片
  // 的典型比例），加载后用 naturalWidth/Height 锁死真实比例——绝不塌成 0、也绝不
  // 在 lazy 图加载或性向换图时跳变高度。运行时读取，故换任意图都自动适配。
  const [ratio, setRatio] = useState<number>();
  return (
    <button
      type="button"
      onClick={onClick}
      style={{ aspectRatio: ratio ?? placeholderRatio }}
      className="group relative block w-full mb-4 md:mb-5 break-inside-avoid overflow-hidden rounded-sm border border-clay-900/10 bg-cream-100 text-left transition-transform duration-300 ease-out hover:-translate-y-1"
    >
      <img
        src={image}
        alt={title}
        loading="lazy"
        onLoad={(e) => {
          const el = e.currentTarget;
          if (el.naturalWidth && el.naturalHeight) {
            setRatio(el.naturalWidth / el.naturalHeight);
          }
        }}
        className="absolute inset-0 h-full w-full object-cover"
      />
      {/* hover 浮层：卡片高度已由图片比例锁定，磨砂带占比恒定，hover 前后零回流。 */}
      <div className="absolute inset-x-0 bottom-0">
        <div className="relative px-4 pt-10 pb-4">
          {/* 毛玻璃底：backdrop-blur 0→md（不走 opacity，避免比文字慢半拍）；上沿 mask 羽化，避免生硬分界 */}
          <div className="absolute inset-0 backdrop-blur-0 transition-[backdrop-filter] duration-300 ease-out group-hover:backdrop-blur-md [mask-image:linear-gradient(to_top,black_62%,transparent)] [-webkit-mask-image:linear-gradient(to_top,black_62%,transparent)]" />
          {/* 暗色渐变：opacity 淡入（自带 to-transparent 上沿，无需额外 mask） */}
          <div className="absolute inset-0 opacity-0 transition-opacity duration-300 ease-out group-hover:opacity-100 bg-gradient-to-t from-clay-900/92 via-clay-900/60 to-transparent" />
          <div className="relative opacity-0 transition-opacity duration-300 ease-out group-hover:opacity-100">
            <h4 className="font-serif text-cream-50 text-base md:text-lg leading-snug mb-1 [text-shadow:0_1px_8px_rgba(20,10,4,0.6)]">
              {title}
            </h4>
            <p className="font-serif italic text-cream-50/95 text-xs md:text-[13px] leading-relaxed line-clamp-4 [text-shadow:0_1px_6px_rgba(20,10,4,0.55)]">
              {outline}
            </p>
          </div>
        </div>
      </div>
    </button>
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

  // 顶部使用提示：默认展示，用户可点 × 永久关闭（localStorage:yume:hintClosed）。
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
      if (localStorage.getItem("yume:hintClosed") === "1") setHintClosed(true);
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
      localStorage.setItem("yume:hintClosed", "1");
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

    const styleMap: Record<string, string> = {
      二次元: "唯美二次元动漫插画，日系 galgame 精致质感，柔和温暖的自然光照。",
      吉卜力: "吉卜力工作室风格，手绘动画质感，柔和水彩底色，温暖治愈的氛围。",
      真实系: "真实电影感，柔和自然光照，胶片颗粒。",
      超写实: "超写实人像与场景，电影级布光，皮肤与材质细节精致。",
      水彩: "水彩插画，湿润晕染笔触，纸纹底色。",
      像素风: "像素风格，复古游戏 16-bit 调色，方块化几何造型。",
      日系动画: "现代日系动画 cel-shading，硬光阴影分层，赛璐璐风。",
      "3D 渲染": "3D 渲染卡通风格，柔和次表面散射，干净的电影级布光。",
      蒸汽朋克: "蒸汽朋克美学，铜色齿轮与蒸汽，工业革命氛围。",
      玄幻: "国风玄幻插画，仙气缭绕，群山烟雨与神兽萦绕。",
      国风水墨: "国潮唯美古风插画，水墨微晕渲染，仙侠浪漫色彩，极具东方神韵。",
      赛博朋克: "赛博朋克都市，霓虹反射湿润街道，电子义体高光。",
    };
    // 「自动」→ fall back to 二次元 (project default). Plain prompts like
    // "由模型自动判断画风" are not understood by FLUX — it just paints them
    // literally, so we'd rather lock in a sensible default.
    // TODO(自动路由): 后续实现真正的「自动」——由模型依据世界观 / 玩家 prompt
    // 选出最合适的画风，再映射到对应风格提示词，而非固定回退到二次元。届时
    // 同步更新风格弹窗副标题（「由模型根据 prompt 判断风格」）使文案与行为一致。
    const effectiveStyle = artStyle === "自动" ? "二次元" : artStyle;
    const styleGuide = styleMap[effectiveStyle] ?? styleMap["二次元"]!;
    const audioEnabled = voice === "开启";

    sessionStorage.setItem(
      "yume:custom",
      JSON.stringify({ worldSetting, styleGuide, audioEnabled }),
    );
    router.push("/play?custom=1");
  };

  const onCardClick = (seed?: string) => {
    if (seed) setPrompt(seed);
    inputRef.current?.focus();
  };

  const stories = STORIES[galleryGender];
  const imgPrefix = galleryGender === "女性向" ? "f" : "m";

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

          {/* 使用提示：可被用户永久关闭（localStorage:yume:hintClosed） */}
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
          <div className="columns-2 md:columns-3 xl:columns-4 gap-4 md:gap-5">
            {stories.map((c, i) => (
              <StoryCard
                key={`${imgPrefix}-${i}`}
                title={c.title}
                outline={c.outline}
                image={`/home/${imgPrefix}${i}.webp`}
                onClick={() => onCardClick(c.outline)}
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
            <p className="font-serif italic text-clay-500 text-base leading-relaxed">
              群二维码 / 邀请链接（待补充）
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
