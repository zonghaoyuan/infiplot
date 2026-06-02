export type Preset = {
  id: string;
  title: string;
  blurb: string;
  worldSetting: string;
  styleGuide: string;
};

export const PRESETS: Preset[] = [
  {
    id: "highschool",
    title: "六月雨季",
    blurb: "县城高中，转学生，未送出的伞。",
    worldSetting:
      "故事发生在 1990 年代末的中国南方县城高中。主角是高三转学生，在多雨的六月遇到一个总在天台读诗的同学。剧情慢热、含蓄、带点伤感。",
    styleGuide:
      "Anime visual novel style, soft watercolor lighting, warm afternoon palette, classic Japanese galgame dialogue panel.",
  },
  {
    id: "cyberpunk",
    title: "雨夜霓虹",
    blurb: "失忆的私家侦探，一通陌生来电。",
    worldSetting:
      "2087 年的雨夜东亚特区。主角是一个刚从昏迷中醒来、丢失了三天记忆的私家侦探。他的电话响了，对面是一个声称认识他的女人。",
    styleGuide:
      "Cinematic cyberpunk realism, neon reflections on wet streets, blade-runner palette, transparent neon HUD interface elements.",
  },
  {
    id: "stickfigure",
    title: "火柴人冒险",
    blurb: "一支铅笔，一个世界，全靠涂改。",
    worldSetting:
      "你是一个用铅笔画在格子本上的火柴人，刚意识到自己活在一个学生的草稿纸里。本子的边缘正在被橡皮擦逐渐抹去，你必须想办法逃出去。",
    styleGuide:
      "Hand-drawn pencil sketch on grid paper, stick figures, rough doodle UI elements, eraser smudges, notebook aesthetic.",
  },
];
