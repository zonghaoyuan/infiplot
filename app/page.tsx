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

type StoryContent = { title: string; outline: string; style: string };

const STYLE_MAP: Record<string, string> = {
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

/* 每个性向 32 篇预设剧情（红果短视频式开场钩子）。与封面 /home/{m|f}{i}.webp 按索引
   一一对应；style 字段决定点卡片进入 /play 时使用的画风（对应 styleMap 的 12 种风格）。
   男/女同索引共享画面尺寸，切性向 crossfade 时卡片高度不跳变。 */
const STORIES: Record<Gender, StoryContent[]> = {
  男性向: [
    { title: "战神归来", outline: "五年前我战死边境，灵柩送回家时她抱着儿子改嫁了。今天我站在他们的婚礼门口，新郎刚要骂人，跪在他面前的二十个保镖喊了我一声「上将」。", style: "真实系" },
    { title: "神医归乡", outline: "在城里被嘲笑成「江湖野医生」的我，回了一趟老家。村口的老人见到我直接哭了：「您终于回来了，您当年的师父…病了。」其实他们不知道，我现在是国手第一。", style: "吉卜力" },
    { title: "赘婿亮剑", outline: "岳父大寿，我端着茶被全场嫌弃，一句「废物」让我滚出去。门外停着九辆悬挂军牌的劳斯莱斯，下来的人朝我深深一鞠躬：「少爷，集团等您回去签字。」", style: "真实系" },
    { title: "送外卖的少主", outline: "你以为我是给你送了三个月外卖的那个小哥？昨晚有人对我说：「少主，您隐姓埋名的三年，到了。」——而你昨天还笑我连一杯咖啡都买不起。", style: "二次元" },
    { title: "兵王食言", outline: "退役那天我答应过队长：「这辈子不再开枪。」但你今天在我面前打了她一巴掌，那我食言一次。", style: "真实系" },
    { title: "重生分手前夜", outline: "凌晨四点，我醒在我们分手的那个夜晚——她正打开门要走。这一次，我先把戒指递了出去：「分手，但戒指你拿好，下个月你会用到它。」", style: "日系动画" },
    { title: "重生回到高考前", outline: "我重生回到高考前一周。这一次，我提前知道了每一道压轴题，也知道了——三天后，她会在天台上跳下去。", style: "吉卜力" },
    { title: "墓前签到", outline: "我每天去亡妻的墓地签到，第七天，系统弹出一行字：「奖励到账：未亡人 × 1。」墓碑后走出一个长得和她一模一样的姑娘：「你是…谁？」", style: "二次元" },
    { title: "凌晨四点抽卡", outline: "凌晨三点，我十连抽 SSR 出货，光柱从屏幕里溢出来。客厅响起脚步声，一个穿着我 T 恤的女人揉着眼睛走出来：「老公，你也太晚了。」", style: "3D 渲染" },
    { title: "系统选妃", outline: "系统给了我七个未婚妻候选，每错一个，地图上就有一座城被抹掉。倒计时 30 秒，她们七个同时朝我看过来。", style: "二次元" },
    { title: "穿成废柴皇子", outline: "睁眼是冷宫废柴皇子，太监正在念赐死圣旨。我笑了——上辈子读的那本《这就是大唐》，是我自己写的。", style: "国风水墨" },
    { title: "穿成乙游男配", outline: "我穿成了乙游里第一章就被处刑的反派男配。倒计时三个月。可女主她…昨天竟然主动来找我了。", style: "二次元" },
    { title: "毒酒之后", outline: "睁眼是 1928 年，我刚被亲弟弟下毒，倒在少帅府的红毯上。门外军靴声逼近——他来确认我是不是真死了。", style: "真实系" },
    { title: "九重雷劫", outline: "修了三百年，今夜九重雷劫降下。第八道劫雷劈开时，我看见劫云之上，那个一直在偷偷护我的人，竟是她。", style: "玄幻" },
    { title: "山门扫地僧", outline: "我在山门扫地三十年，谁都看不起我。今日魔尊踏破山门，宗主跪地求饶。我抬头：「让一让，我去扫他。」", style: "国风水墨" },
    { title: "末世第一夜", outline: "同寝的兄弟开始啃我的脖子。我抬手将他甩开——指尖滴下的血珠悬在半空，凝结成了一柄银白小剑。", style: "真实系" },
    { title: "雷霆觉醒", outline: "雷劈不死的第七天，我握紧了拳头。掌心炸开一道闪电，把面前的丧尸群一齐劈成了灰。", style: "赛博朋克" },
    { title: "家宴镇压", outline: "家宴上岳父冷笑：「你也敢上桌？」我手机震了一下，是父亲发来的：「儿，神州七大家主，已到楼下。」", style: "真实系" },
    { title: "买葱归来", outline: "二十年前那场天工大会上消失的人——今天回菜市场买葱，被小贩多收了两毛。他笑了：「这二十年的利息，连本带利，今晚一起还。」", style: "国风水墨" },
    { title: "红盖头之下", outline: "敌对家族送来一个新娘，遮着红盖头。我掀开那一刻，下面是和我死去的妹妹一模一样的脸。她抬眼：「哥…你别杀我。」", style: "超写实" },
    { title: "上海双面谍", outline: "1936 年。军统让我潜入日方，日方让我潜入军统。今晚——他们要见面，而我必须同时出现在两间房里。", style: "真实系" },
    { title: "比武场的茶博士", outline: "比武大会上，我端着茶水路过，宗主们的剑突然全都举不起来了。我抬眼：「老衲只是看不下去你们吵架。」", style: "国风水墨" },
    { title: "高考前夜", outline: "全市模考垫底的我，高考前夜被四个西装男按在桌前：「这次，你必须考第一。」原来——我爸是教育部的人。", style: "日系动画" },
    { title: "失踪一年", outline: "我被宣告死亡 12 个月后，背着血迹斑斑的包，站在了她婚礼现场的门口。新郎认出我，杯子摔到了地上。", style: "真实系" },
    { title: "天台堵她", outline: "学校最不好惹的那位转学生，第一天就堵了我的天台。我把她书包一扯——里面掉出来一沓我从小写的情书。", style: "日系动画" },
    { title: "转学第一天", outline: "转学第一天，年级第一坐我后桌。下课她把试卷拍在我面前：「这道题，你为什么写得和我答案一字不差？」", style: "二次元" },
    { title: "无职觉醒", outline: "成年礼上全班觉醒职业，只有我天命「无职」。所有人嘲笑我的时候，光柱从我身上炸开——觉醒结果：「神」。", style: "玄幻" },
    { title: "草稿纸里的我", outline: "睁眼发现自己是一张草稿纸上的火柴小人，住在 16-bit 的网格世界里。橡皮擦从天而降，正在抹掉这一行字——也包括我。", style: "像素风" },
    { title: "云上的国家", outline: "齿轮轰鸣的飞艇甲板上，独眼船长把望远镜递到我手里：「云的那一头有个国家，专门关像你这样的人。」", style: "蒸汽朋克" },
    { title: "舰桥上的少年", outline: "殖民母舰只剩 30 秒，主炮指挥官的椅子是空的。舰长抬眼看着 17 岁的我：「上去。整个人类，就交给你了。」", style: "赛博朋克" },
    { title: "末节队长服", outline: "全联盟都骂我废柴，机甲赛决赛末节，教练把队长徽章按在我手里：「上去，把这局赢回来——这一台，是人类最后的机甲。」", style: "赛博朋克" },
    { title: "学长的真面目", outline: "三年青梅当众接过富二代的玫瑰，转身扑进他怀里。我笑了笑——明天，是我接手父亲那个上市公司的日子。", style: "真实系" },
  ],
  女性向: [
    { title: "废柴嫡女", outline: "穿成将军府众人嫌弃的废柴嫡女，第一天就被打了一巴掌。门外冷面摄政王翻身下马，「我夫人的脸，谁敢动？」", style: "国风水墨" },
    { title: "乙游恶役", outline: "睁眼是乙游里五分钟必死的恶役千金，所有男主都恨我。我合上剧本笑了——上一世我是这游戏的主笔。", style: "二次元" },
    { title: "白月光归来", outline: "穿成男主念念不忘的白月光，但全书她只有死亡这一种结局。我捏着男主送的玉佩走进祠堂——这一次，我不躲了。", style: "玄幻" },
    { title: "凤袍之下", outline: "穿越来就是当朝皇后，三千佳丽看我笑话。皇上掀开龙袍跪在我面前：「皇后，朕想她想了三十年了。」", style: "国风水墨" },
    { title: "嫁错重生", outline: "嫁错了人毁了一辈子，重生回到婚礼前夜。这一次新娘休书我先写。新郎的弟弟突然走进来：「嫂子，要换人，换我。」", style: "二次元" },
    { title: "那杯咖啡", outline: "重生回到他亲手把我送进车祸的前夜。我笑着接过他递来的咖啡——这是一杯我前世死前最想泼他脸上的咖啡。", style: "真实系" },
    { title: "雨中撑伞", outline: "重生回到我亲手要了她命的前一天。她正抱着公文包路过我的车——这一次，我下车撑伞。", style: "真实系" },
    { title: "三十亿合同", outline: "重生回到我被父亲扫地出门的那个清晨。这一次，扫地出门前我把家族 30 亿的合同提前签了。", style: "真实系" },
    { title: "替嫁霸总", outline: "替姐姐嫁给那个传说眼瞎心冷的总裁。新婚夜他俯身在我耳边：「你姐没告诉你？我等了你三年了。」", style: "二次元" },
    { title: "错嫁那一夜", outline: "醉酒夜我闯进了错的酒店房间，醒来戒指已在手上。他穿好西装回头：「夫人，签字仪式三小时后。」", style: "真实系" },
    { title: "撕了离婚书", outline: "为了避税，我和那个最讨厌我的总裁假结婚一年。半年后他突然把离婚协议撕了——「续约。」", style: "真实系" },
    { title: "死对头跪了", outline: "天天和我互掐的死对头，今天跪在我面前。他递上戒指：「再吵下去要影响我们的孩子。」——什么孩子？！", style: "二次元" },
    { title: "抽到的霸总", outline: "凌晨四点抽到 UR 卡——画面里是城里那个传说没人见过脸的盛家总裁。第二天他敲我家门：「我来报到。」", style: "3D 渲染" },
    { title: "攻略任务", outline: "系统说：「攻略他，否则你死。」可他是这本书里唯一恨我入骨的人。今天他亲手把我堵在了墙角。", style: "二次元" },
    { title: "商城上架", outline: "系统商城上架了「市值 800 亿盛总 × 1」。我咬牙刷光积蓄。下一秒，他出现在我家门口：「夫人，我已购入。」", style: "二次元" },
    { title: "老公赞助", outline: "直播间打赏榜第一名连续 30 天，备注写着「老公赞助」。我点开他的资料——城里那位传说从不出门的盛少。", style: "日系动画" },
    { title: "门外的他", outline: "末世第一夜，门外是丧尸群的撕咬声。隔壁刚搬来的男人撞开我家门：「我能进来吗？我有一把枪。」", style: "真实系" },
    { title: "末世空间", outline: "末世爆发的第一天，我意外觉醒了储物空间。屯了三车物资回家，发现那个总欺负我的高冷邻居跪在我门口。", style: "真实系" },
    { title: "异能撒娇", outline: "末世里所有男人都怕的那位 S 级异能者，今天蹲在我家门口：「姐姐，能让我进去吗？外面…丧尸太可怕了。」", style: "二次元" },
    { title: "末世重生", outline: "重生回到末世爆发前一周。这一次，那个抛弃我的男人——我先把他赶出门，把上一世救我的人接回家。", style: "真实系" },
    { title: "课桌里的纸条", outline: "隔壁班那个高冷年级第一，今天把一本日记塞进我课桌。第一页写着：「她笑起来的时候，三角函数都没那么复杂。」", style: "二次元" },
    { title: "校草八年", outline: "暗恋了八年的校草，今天突然走到我面前：「跟我走，我已经查清楚了——把你妹妹接走的那个人在哪。」", style: "吉卜力" },
    { title: "班长的秘密", outline: "天天和我同桌的班长，今天被四个保镖按在校门口接走。临走前他回头喊：「老婆，我先回总部一趟。」", style: "二次元" },
    { title: "走廊的手腕", outline: "走廊上人最多的时候，全校最不好惹的学长抓住了我的手腕：「我等了你三年，今天给我一个回应。」", style: "日系动画" },
    { title: "上海公馆", outline: "1936，我是父亲遗产的唯一继承人，全上海都在等看我嫁谁。今晚我推开门——那个传说不要女人的留洋先生，在喝我父亲的茶。", style: "超写实" },
    { title: "书店里的他", outline: "我是租界一家书店的老板娘。今晚穿西装的他第三次坐在窗边，第一次开口：「小姐，可以借您的店…藏一个东西吗？」", style: "真实系" },
    { title: "炼丹意外", outline: "我是仙门最废柴的炼丹弟子，三年没炼出一颗丹。今天偶然撞翻师尊的丹炉——一道光柱直冲云霄，惊动了三大长老。", style: "玄幻" },
    { title: "江湖归人", outline: "我一个人闯江湖三年，今天回到那座小镇。门口的少年抬头：「师姐，你说过五年就回，我等了三年又两个月。」", style: "国风水墨" },
    { title: "顶流的西瓜", outline: "顶流男星上节目被问感情，他笑了笑：「我老婆？她现在大概在家里啃我刚买的西瓜。」全网爆炸——我正趴在沙发上看直播。", style: "真实系" },
    { title: "同居一年", outline: "和合租室友同居一年了，今晚他突然把我堵在门口：「你说，我们…要不要别再装陌生人了？」", style: "日系动画" },
    { title: "机甲撞门", outline: "丧尸潮第七夜，全城断电。地下室的门被撞开，一架满是弹痕的机甲低下头，舱门弹开——里面坐着我那个失联三年的他。", style: "赛博朋克" },
    { title: "三分绝杀", outline: "决赛最后一秒，他在场边看了我一眼，转身投出那一记三分。哨声响时，他把奖杯举过头顶，朝我跑来。", style: "日系动画" },
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
  onClick,
}: {
  title: string;
  outline: string;
  image: string;
  onClick: () => void;
}) {
  // 全卡片统一 4:5 portrait 比例。原来按图片真实 naturalWidth/Height 动态设 aspectRatio
  // 会跟懒加载顺序耦合：视口下方还没加载的卡停在 placeholder 比例，上方已加载的卡变成
  // 图片真实比例（可能是 1.6 横图或 0.75 竖图），视觉差异巨大；刷新后图从缓存读，
  // onLoad 几乎同步触发，看起来又恢复正常 —— 用户感知到的「偶尔尺寸不一样」就是这个。
  // 改为固定比例后所有卡片视觉一致，object-cover 让不同长宽比的图自动裁切适配。
  return (
    <button
      type="button"
      onClick={onClick}
      style={{ aspectRatio: "4 / 5" }}
      className="group relative block w-full mb-4 md:mb-5 break-inside-avoid overflow-hidden rounded-sm border border-clay-900/10 bg-cream-100 text-left transition-transform duration-300 ease-out hover:-translate-y-1"
    >
      <img
        src={image}
        alt={title}
        loading="lazy"
        className="absolute inset-0 h-full w-full object-cover"
      />
      {/* hover 浮层：照参考项目（yunmeng0530/yume）的写法——满卡片单元素，纯 rgba
          黑色 linear-gradient + opacity 过渡。完全不用 backdrop-filter / mask-image，
          从根上消除 Chromium 上「矩形磨砂 → 渐变磨砂」的跳变（这两个属性的合成顺序
          是真正的元凶；只要不用它们，就不会有这个 bug）。
          - bottom 0.9 → 45% 处 0.45 → top 0：自然羽化，底部聚焦文字、顶部完全透出图。 */}
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
    const effectiveStyle = artStyle === "自动" ? "二次元" : artStyle;
    const styleGuide = STYLE_MAP[effectiveStyle] ?? STYLE_MAP["二次元"]!;
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
          <div className="columns-2 md:columns-3 xl:columns-4 gap-4 md:gap-5">
            {stories.map((c, i) => (
              <StoryCard
                key={`${imgPrefix}-${i}`}
                title={c.title}
                outline={c.outline}
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
