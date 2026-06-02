#!/usr/bin/env node
/**
 * One-off generator: produces the InfiPlot homepage "instant-play" first-act
 * JSONs by driving each curated card through the live engine (POST /api/start)
 * and saving the full StartResponse under public/home/firstact/.
 *
 * The /play page detects ?card=<name> and hydrates Session from the JSON
 * instead of calling /api/start, so click-to-play feels instant — only the
 * Runware-CDN background download + decode happens after navigation.
 *
 * Assumes a dev server is running at http://localhost:3000 (override with
 * BASE_URL env var). Idempotent: skips any card whose JSON already exists.
 * Pass --force to regenerate all 64.
 *
 * Run once:
 *   node scripts/prebake-firstacts.mjs
 *
 * Concurrency 4 to avoid LLM/Runware/MiMo provider rate limits.
 */

import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { existsSync, mkdirSync, writeFileSync, statSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = resolve(__dirname, "..");
const OUT_DIR = resolve(WEB_ROOT, "public", "home", "firstact");

const FORCE = process.argv.includes("--force");
const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
const CONCURRENCY = 4;

// Mirror of app/page.tsx STYLE_MAP — keep these in sync. The engine
// only needs the prose styleGuide string; this script maps card.style → that.
const STYLE_MAP = {
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

// Mirror of app/page.tsx STORIES, flat with name + gender. Indexes
// match the m0..m31 / f0..f31 cover filenames.
const CARDS = [
  // 男性向 m0..m31
  { name: "m0", gender: "男性向", title: "战神归来", style: "真实系", outline: "五年前我战死边境，灵柩送回家时她抱着儿子改嫁了。今天我站在他们的婚礼门口，新郎刚要骂人，跪在他面前的二十个保镖喊了我一声「上将」。" },
  { name: "m1", gender: "男性向", title: "神医归乡", style: "吉卜力", outline: "在城里被嘲笑成「江湖野医生」的我，回了一趟老家。村口的老人见到我直接哭了：「您终于回来了，您当年的师父…病了。」其实他们不知道，我现在是国手第一。" },
  { name: "m2", gender: "男性向", title: "赘婿亮剑", style: "真实系", outline: "岳父大寿，我端着茶被全场嫌弃，一句「废物」让我滚出去。门外停着九辆悬挂军牌的劳斯莱斯，下来的人朝我深深一鞠躬：「少爷，集团等您回去签字。」" },
  { name: "m3", gender: "男性向", title: "送外卖的少主", style: "二次元", outline: "你以为我是给你送了三个月外卖的那个小哥？昨晚有人对我说：「少主，您隐姓埋名的三年，到了。」——而你昨天还笑我连一杯咖啡都买不起。" },
  { name: "m4", gender: "男性向", title: "兵王食言", style: "真实系", outline: "退役那天我答应过队长：「这辈子不再开枪。」但你今天在我面前打了她一巴掌，那我食言一次。" },
  { name: "m5", gender: "男性向", title: "重生分手前夜", style: "日系动画", outline: "凌晨四点，我醒在我们分手的那个夜晚——她正打开门要走。这一次，我先把戒指递了出去：「分手，但戒指你拿好，下个月你会用到它。」" },
  { name: "m6", gender: "男性向", title: "重生回到高考前", style: "吉卜力", outline: "我重生回到高考前一周。这一次，我提前知道了每一道压轴题，也知道了——三天后，她会在天台上跳下去。" },
  { name: "m7", gender: "男性向", title: "墓前签到", style: "二次元", outline: "我每天去亡妻的墓地签到，第七天，系统弹出一行字：「奖励到账：未亡人 × 1。」墓碑后走出一个长得和她一模一样的姑娘：「你是…谁？」" },
  { name: "m8", gender: "男性向", title: "凌晨四点抽卡", style: "3D 渲染", outline: "凌晨三点，我十连抽 SSR 出货，光柱从屏幕里溢出来。客厅响起脚步声，一个穿着我 T 恤的女人揉着眼睛走出来：「老公，你也太晚了。」" },
  { name: "m9", gender: "男性向", title: "系统选妃", style: "二次元", outline: "系统给了我七个未婚妻候选，每错一个，地图上就有一座城被抹掉。倒计时 30 秒，她们七个同时朝我看过来。" },
  { name: "m10", gender: "男性向", title: "穿成废柴皇子", style: "国风水墨", outline: "睁眼是冷宫废柴皇子，太监正在念赐死圣旨。我笑了——上辈子读的那本《这就是大唐》，是我自己写的。" },
  { name: "m11", gender: "男性向", title: "穿成乙游男配", style: "二次元", outline: "我穿成了乙游里第一章就被处刑的反派男配。倒计时三个月。可女主她…昨天竟然主动来找我了。" },
  { name: "m12", gender: "男性向", title: "毒酒之后", style: "真实系", outline: "睁眼是 1928 年，我刚被亲弟弟下毒，倒在少帅府的红毯上。门外军靴声逼近——他来确认我是不是真死了。" },
  { name: "m13", gender: "男性向", title: "九重雷劫", style: "玄幻", outline: "修了三百年，今夜九重雷劫降下。第八道劫雷劈开时，我看见劫云之上，那个一直在偷偷护我的人，竟是她。" },
  { name: "m14", gender: "男性向", title: "山门扫地僧", style: "国风水墨", outline: "我在山门扫地三十年，谁都看不起我。今日魔尊踏破山门，宗主跪地求饶。我抬头：「让一让，我去扫他。」" },
  { name: "m15", gender: "男性向", title: "末世第一夜", style: "真实系", outline: "同寝的兄弟开始啃我的脖子。我抬手将他甩开——指尖滴下的血珠悬在半空，凝结成了一柄银白小剑。" },
  { name: "m16", gender: "男性向", title: "雷霆觉醒", style: "赛博朋克", outline: "雷劈不死的第七天，我握紧了拳头。掌心炸开一道闪电，把面前的丧尸群一齐劈成了灰。" },
  { name: "m17", gender: "男性向", title: "家宴镇压", style: "真实系", outline: "家宴上岳父冷笑：「你也敢上桌？」我手机震了一下，是父亲发来的：「儿，神州七大家主，已到楼下。」" },
  { name: "m18", gender: "男性向", title: "买葱归来", style: "国风水墨", outline: "二十年前那场天工大会上消失的人——今天回菜市场买葱，被小贩多收了两毛。他笑了：「这二十年的利息，连本带利，今晚一起还。」" },
  { name: "m19", gender: "男性向", title: "红盖头之下", style: "超写实", outline: "敌对家族送来一个新娘，遮着红盖头。我掀开那一刻，下面是和我死去的妹妹一模一样的脸。她抬眼：「哥…你别杀我。」" },
  { name: "m20", gender: "男性向", title: "上海双面谍", style: "真实系", outline: "1936 年。军统让我潜入日方，日方让我潜入军统。今晚——他们要见面，而我必须同时出现在两间房里。" },
  { name: "m21", gender: "男性向", title: "比武场的茶博士", style: "国风水墨", outline: "比武大会上，我端着茶水路过，宗主们的剑突然全都举不起来了。我抬眼：「老衲只是看不下去你们吵架。」" },
  { name: "m22", gender: "男性向", title: "高考前夜", style: "日系动画", outline: "全市模考垫底的我，高考前夜被四个西装男按在桌前：「这次，你必须考第一。」原来——我爸是教育部的人。" },
  { name: "m23", gender: "男性向", title: "失踪一年", style: "真实系", outline: "我被宣告死亡 12 个月后，背着血迹斑斑的包，站在了她婚礼现场的门口。新郎认出我，杯子摔到了地上。" },
  { name: "m24", gender: "男性向", title: "天台堵她", style: "日系动画", outline: "学校最不好惹的那位转学生，第一天就堵了我的天台。我把她书包一扯——里面掉出来一沓我从小写的情书。" },
  { name: "m25", gender: "男性向", title: "转学第一天", style: "二次元", outline: "转学第一天，年级第一坐我后桌。下课她把试卷拍在我面前：「这道题，你为什么写得和我答案一字不差？」" },
  { name: "m26", gender: "男性向", title: "无职觉醒", style: "玄幻", outline: "成年礼上全班觉醒职业，只有我天命「无职」。所有人嘲笑我的时候，光柱从我身上炸开——觉醒结果：「神」。" },
  { name: "m27", gender: "男性向", title: "草稿纸里的我", style: "像素风", outline: "睁眼发现自己是一张草稿纸上的火柴小人，住在 16-bit 的网格世界里。橡皮擦从天而降，正在抹掉这一行字——也包括我。" },
  { name: "m28", gender: "男性向", title: "云上的国家", style: "蒸汽朋克", outline: "齿轮轰鸣的飞艇甲板上，独眼船长把望远镜递到我手里：「云的那一头有个国家，专门关像你这样的人。」" },
  { name: "m29", gender: "男性向", title: "舰桥上的少年", style: "赛博朋克", outline: "殖民母舰只剩 30 秒，主炮指挥官的椅子是空的。舰长抬眼看着 17 岁的我：「上去。整个人类，就交给你了。」" },
  { name: "m30", gender: "男性向", title: "末节队长服", style: "赛博朋克", outline: "全联盟都骂我废柴，机甲赛决赛末节，教练把队长徽章按在我手里：「上去，把这局赢回来——这一台，是人类最后的机甲。」" },
  { name: "m31", gender: "男性向", title: "学长的真面目", style: "真实系", outline: "三年青梅当众接过富二代的玫瑰，转身扑进他怀里。我笑了笑——明天，是我接手父亲那个上市公司的日子。" },
  // 女性向 f0..f31
  { name: "f0", gender: "女性向", title: "废柴嫡女", style: "国风水墨", outline: "穿成将军府众人嫌弃的废柴嫡女，第一天就被打了一巴掌。门外冷面摄政王翻身下马，「我夫人的脸，谁敢动？」" },
  { name: "f1", gender: "女性向", title: "乙游恶役", style: "二次元", outline: "睁眼是乙游里五分钟必死的恶役千金，所有男主都恨我。我合上剧本笑了——上一世我是这游戏的主笔。" },
  { name: "f2", gender: "女性向", title: "白月光归来", style: "玄幻", outline: "穿成男主念念不忘的白月光，但全书她只有死亡这一种结局。我捏着男主送的玉佩走进祠堂——这一次，我不躲了。" },
  { name: "f3", gender: "女性向", title: "凤袍之下", style: "国风水墨", outline: "穿越来就是当朝皇后，三千佳丽看我笑话。皇上掀开龙袍跪在我面前：「皇后，朕想她想了三十年了。」" },
  { name: "f4", gender: "女性向", title: "嫁错重生", style: "二次元", outline: "嫁错了人毁了一辈子，重生回到婚礼前夜。这一次新娘休书我先写。新郎的弟弟突然走进来：「嫂子，要换人，换我。」" },
  { name: "f5", gender: "女性向", title: "那杯咖啡", style: "真实系", outline: "重生回到他亲手把我送进车祸的前夜。我笑着接过他递来的咖啡——这是一杯我前世死前最想泼他脸上的咖啡。" },
  { name: "f6", gender: "女性向", title: "雨中撑伞", style: "真实系", outline: "重生回到我亲手要了她命的前一天。她正抱着公文包路过我的车——这一次，我下车撑伞。" },
  { name: "f7", gender: "女性向", title: "三十亿合同", style: "真实系", outline: "重生回到我被父亲扫地出门的那个清晨。这一次，扫地出门前我把家族 30 亿的合同提前签了。" },
  { name: "f8", gender: "女性向", title: "替嫁霸总", style: "二次元", outline: "替姐姐嫁给那个传说眼瞎心冷的总裁。新婚夜他俯身在我耳边：「你姐没告诉你？我等了你三年了。」" },
  { name: "f9", gender: "女性向", title: "错嫁那一夜", style: "真实系", outline: "醉酒夜我闯进了错的酒店房间，醒来戒指已在手上。他穿好西装回头：「夫人，签字仪式三小时后。」" },
  { name: "f10", gender: "女性向", title: "撕了离婚书", style: "真实系", outline: "为了避税，我和那个最讨厌我的总裁假结婚一年。半年后他突然把离婚协议撕了——「续约。」" },
  { name: "f11", gender: "女性向", title: "死对头跪了", style: "二次元", outline: "天天和我互掐的死对头，今天跪在我面前。他递上戒指：「再吵下去要影响我们的孩子。」——什么孩子？！" },
  { name: "f12", gender: "女性向", title: "抽到的霸总", style: "3D 渲染", outline: "凌晨四点抽到 UR 卡——画面里是城里那个传说没人见过脸的盛家总裁。第二天他敲我家门：「我来报到。」" },
  { name: "f13", gender: "女性向", title: "攻略任务", style: "二次元", outline: "系统说：「攻略他，否则你死。」可他是这本书里唯一恨我入骨的人。今天他亲手把我堵在了墙角。" },
  { name: "f14", gender: "女性向", title: "商城上架", style: "二次元", outline: "系统商城上架了「市值 800 亿盛总 × 1」。我咬牙刷光积蓄。下一秒，他出现在我家门口：「夫人，我已购入。」" },
  { name: "f15", gender: "女性向", title: "老公赞助", style: "日系动画", outline: "直播间打赏榜第一名连续 30 天，备注写着「老公赞助」。我点开他的资料——城里那位传说从不出门的盛少。" },
  { name: "f16", gender: "女性向", title: "门外的他", style: "真实系", outline: "末世第一夜，门外是丧尸群的撕咬声。隔壁刚搬来的男人撞开我家门：「我能进来吗？我有一把枪。」" },
  { name: "f17", gender: "女性向", title: "末世空间", style: "真实系", outline: "末世爆发的第一天，我意外觉醒了储物空间。屯了三车物资回家，发现那个总欺负我的高冷邻居跪在我门口。" },
  { name: "f18", gender: "女性向", title: "异能撒娇", style: "二次元", outline: "末世里所有男人都怕的那位 S 级异能者，今天蹲在我家门口：「姐姐，能让我进去吗？外面…丧尸太可怕了。」" },
  { name: "f19", gender: "女性向", title: "末世重生", style: "真实系", outline: "重生回到末世爆发前一周。这一次，那个抛弃我的男人——我先把他赶出门，把上一世救我的人接回家。" },
  { name: "f20", gender: "女性向", title: "课桌里的纸条", style: "二次元", outline: "隔壁班那个高冷年级第一，今天把一本日记塞进我课桌。第一页写着：「她笑起来的时候，三角函数都没那么复杂。」" },
  { name: "f21", gender: "女性向", title: "校草八年", style: "吉卜力", outline: "暗恋了八年的校草，今天突然走到我面前：「跟我走，我已经查清楚了——把你妹妹接走的那个人在哪。」" },
  { name: "f22", gender: "女性向", title: "班长的秘密", style: "二次元", outline: "天天和我同桌的班长，今天被四个保镖按在校门口接走。临走前他回头喊：「老婆，我先回总部一趟。」" },
  { name: "f23", gender: "女性向", title: "走廊的手腕", style: "日系动画", outline: "走廊上人最多的时候，全校最不好惹的学长抓住了我的手腕：「我等了你三年，今天给我一个回应。」" },
  { name: "f24", gender: "女性向", title: "上海公馆", style: "超写实", outline: "1936，我是父亲遗产的唯一继承人，全上海都在等看我嫁谁。今晚我推开门——那个传说不要女人的留洋先生，在喝我父亲的茶。" },
  { name: "f25", gender: "女性向", title: "书店里的他", style: "真实系", outline: "我是租界一家书店的老板娘。今晚穿西装的他第三次坐在窗边，第一次开口：「小姐，可以借您的店…藏一个东西吗？」" },
  { name: "f26", gender: "女性向", title: "炼丹意外", style: "玄幻", outline: "我是仙门最废柴的炼丹弟子，三年没炼出一颗丹。今天偶然撞翻师尊的丹炉——一道光柱直冲云霄，惊动了三大长老。" },
  { name: "f27", gender: "女性向", title: "江湖归人", style: "国风水墨", outline: "我一个人闯江湖三年，今天回到那座小镇。门口的少年抬头：「师姐，你说过五年就回，我等了三年又两个月。」" },
  { name: "f28", gender: "女性向", title: "顶流的西瓜", style: "真实系", outline: "顶流男星上节目被问感情，他笑了笑：「我老婆？她现在大概在家里啃我刚买的西瓜。」全网爆炸——我正趴在沙发上看直播。" },
  { name: "f29", gender: "女性向", title: "同居一年", style: "日系动画", outline: "和合租室友同居一年了，今晚他突然把我堵在门口：「你说，我们…要不要别再装陌生人了？」" },
  { name: "f30", gender: "女性向", title: "机甲撞门", style: "赛博朋克", outline: "丧尸潮第七夜，全城断电。地下室的门被撞开，一架满是弹痕的机甲低下头，舱门弹开——里面坐着我那个失联三年的他。" },
  { name: "f31", gender: "女性向", title: "三分绝杀", style: "日系动画", outline: "决赛最后一秒，他在场边看了我一眼，转身投出那一记三分。哨声响时，他把奖杯举过头顶，朝我跑来。" },
];

// Same construction as page.tsx onCardClick. Locked plotStyle/pace at the
// canonical "多线转折 / 紧凑爽快" defaults — the prebake is one frozen pour
// of the story; the user's selector still applies on the homepage for
// custom typed-prompt sessions, just not for these curated cards.
function buildPayload(card) {
  const worldSetting = [
    `这是一款面向【${card.gender}】观众的 AI 交互剧情游戏，整体走红果短视频式的强戏剧冲突与快速反转。`,
    `剧情风格：多线转折。内容节奏：紧凑爽快。`,
    `精选剧情《${card.title}》的开场设定：${card.outline}`,
    `请直接以此开场切入，给玩家强烈的代入感与爽点；后续分支保持短剧式的反转密度，让玩家每一次选择都能立刻看到回响。`,
  ].join("\n");
  const styleGuide = STYLE_MAP[card.style] ?? STYLE_MAP["二次元"];
  return { worldSetting, styleGuide };
}

async function bakeOne(card) {
  const out = resolve(OUT_DIR, `${card.name}.json`);
  if (!FORCE && existsSync(out)) {
    const size = statSync(out).size;
    if (size > 1024) return { name: card.name, status: "skip", size };
  }
  const payload = buildPayload(card);
  const t = Date.now();
  const res = await fetch(`${BASE_URL}/api/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  const data = await res.json();
  // Tag the JSON with the curated card identity so the /play page can show
  // the right "lastExitLabel"-style chrome without us having to re-look it up.
  data.cardName = card.name;
  data.cardTitle = card.title;
  data.cardGender = card.gender;
  // StartResponse doesn't echo the inputs back — but the /play page needs to
  // seed Session.worldSetting / Session.styleGuide so subsequent /api/scene
  // calls (read on the server) see the right story bible + visual anchor.
  data.worldSetting = payload.worldSetting;
  data.styleGuide = payload.styleGuide;
  writeFileSync(out, JSON.stringify(data));
  return { name: card.name, status: "ok", ms: Date.now() - t, size: statSync(out).size };
}

/* ---------- main: bounded-concurrency runner ---------- */

if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

const t0 = Date.now();
console.log(`[prebake] ${CARDS.length} cards → ${OUT_DIR} (concurrency=${CONCURRENCY})`);

let cursor = 0;
let done = 0;
let skipped = 0;
let failed = 0;

async function worker(id) {
  while (true) {
    const i = cursor++;
    if (i >= CARDS.length) return;
    const card = CARDS[i];
    const label = `[${i + 1}/${CARDS.length}] ${card.name}`;
    try {
      const r = await bakeOne(card);
      done++;
      if (r.status === "skip") {
        skipped++;
        console.log(`${label} skip (${r.size} B)`);
      } else {
        console.log(`${label} ok ${(r.size / 1024).toFixed(0)} KB in ${(r.ms / 1000).toFixed(1)}s`);
      }
    } catch (e) {
      failed++;
      console.log(`${label} FAIL: ${e.message}`);
    }
  }
}

await Promise.all(Array.from({ length: CONCURRENCY }, (_, i) => worker(i)));

console.log(
  `\n[prebake] done in ${Math.round((Date.now() - t0) / 1000)}s — wrote ${
    done - skipped
  } / skipped ${skipped} / failed ${failed}`,
);
process.exit(failed ? 1 : 0);
