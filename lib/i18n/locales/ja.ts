// Japanese — auto-translated from zh-CN by scripts/translate-i18n.mjs (review for quality).
// Extracted from components: page.tsx, layout.tsx, CustomForm.tsx, SettingsModal.tsx, PlayCanvas.tsx, AuthModal.tsx, DialogueHistoryModal.tsx

export const ja = {
  // ========== Layout ==========
  layout: {
    metadata: {
      title: "InfiPlot — AIリアルタイムインタラクティブストーリーゲーム",
      description: "InfiPlotは、AIを用いて画像、音声、ストーリー分岐をリアルタイムに生成するインタラクティブ・ストーリーゲームのデモです。",
    },
  },

  // ========== Home Page (page.tsx) ==========
  home: {
    // Example phrases for typewriter
    examples: {
      male: [
        "幼い頃から一緒に育った幼馴染が、突然顔を赤くして私に告白してきた",
        "目が覚めたら、クラスの女子たちがみんな密かに俺のことを好きになっているみたいだ",
        "三年の期は満ちた。実は私が御曹司だったとは。復讐の時が来た。",
        "無限のTokenを手に、インターネット誕生の前夜へとタイムスリップした……",
      ],
      female: [
        "将軍家の落ちこぼれ嫡女に転生したのに、冷徹な摂政王は私だけを溺愛する",
        "別れの前夜に巻き戻り、今度は私から手を放す",
        "目が覚めたら乙女ゲームの悪役令嬢になっていた。すべての死亡エンドを回避しなくては",
      ],
      x: [
        "時空の裂け目が開き、複数の平行世界の自分が突如目の前に現れた",
        "記憶の宮殿で、忘れ去られた断片が新たな物語へと再構成されている。",
        "無限流ゲームが始まる。全員に与えられたクリアの機会は、ただ一度きり。",
        "システム提示：あなたの選択が全宇宙の運命を左右します。",
      ],
    },

    // Option labels
    options: {
      gender: "性的指向",
      artStyle: "画風",
      plotStyle: "シナリオスタイル",
      voice: "ボイス",
      pacing: "コンテンツのペース",
    },

    // Option values - genders
    genders: {
      male: "男性向け",
      female: "女性向け",
      x: "X",
    },

    // Option values - art styles
    artStyles: {
      auto: "オート",
      custom: "カスタムスタイル",
      kyoani: "京アニ",
      shinkai: "新海誠",
      ghibli: "ジブリ",
      "3d": "3Dアニメーション",
      cyberpunk: "サイバーパンク",
      gothic: "ゴシック",
      wasteland: "ポストアポカリプス",
      pixel: "ドット絵風",
      realistic: "現実",
      oil: "古典油絵",
      monet: "モネ",
      watercolor: "水彩",
      ink: "水墨",
      ukiyoe: "浮世絵",
      pencil: "色鉛筆",
      sketch: "手描きスケッチ",
      manga: "モノクロ漫画",
      children: "子ども向け絵本",
      crayon: "子どもの落書き",
      clay: "粘土細工",
      dunhuang: "敦煌壁画",
      miniature: "細密画",
      mosaic: "モザイク画",
      stainedGlass: "ステンドグラス",
      vaporwave: "ヴェイパーウェイヴ",
      vector: "ベクターイラスト",
      lowpoly: "ローポリゴン",
      popart: "ポップアート",
      glitch: "グリッチアート",
      papercut: "切り絵",
      steampunk: "スチームパンク",
      xianxia: "仙侠ファンタジー",
      darkFairytale: "暗黒童話",
      urbanFantasy: "都市幻想",
    },

    // Option values - plot styles
    plotStyles: {
      straightforward: "ストレートな展開",
      twist: "複数ルート分岐",
      suspense: "サスペンス",
      healing: "癒やし系日常",
    },

    // Option values - voice
    voiceOptions: {
      off: "オフ",
      on: "オン",
    },

    // Option values - pacing
    pacings: {
      slow: "じっくり繊細",
      fast: "テンポよく",
    },

    // Story cards (samples - in production these would come from presets.ts)
    stories: {
      // A few representative titles
     贤者陨落: "賢者の終焉",
      画中圣手: "画中の名手",
      花魁的刀: "花魁の刀",
      // ... (full list would be presets.ts stories)
    },

    // UI labels
    ui: {
      start: "スタート",
      loadStory: "シナリオ読み込み",
      settings: "設定",
      searchPlaceholder: "スタイルを検索…",
      noMatchingStyle: "一致するスタイルがありません",
      close: "閉じる",
      back: "戻る",
      save: "保存",
      cancel: "キャンセル",
      saveAndSelect: "保存して適用",
    },

    // Style modal
    styleModal: {
      title: "画風を選択",
      subtitle: 'デフォルトは「自動」で、AIがストーリーに基づいて画風を自動的にマッチングします。「カスタムスタイル」を選択すると、説明の入力や参考画像のアップロードが可能です。',
      customTitle: "カスタムスタイル",
      customPlaceholder: `希望する画像スタイルを入力してください。例えば：
幻想的な水彩画風、柔らかな色調、ノスタルジックな雰囲気

💡 ヒント：一部の画像生成モデルは英語のプロンプトの方が効果が高いため、事前にAIチャットツール等で専門的な英語のスタイル記述を生成し、ここに貼り付けることをお勧めします。`,
      uploadImage: "参考画像をアップロード",
      changeImage: "別の画像にする",
      remove: "削除",
      parsing: "解析中…",
      importFromPreset: "プリセットスタイルからインポート…",
      uploadError: "画像ファイルのみ対応しています",
      visionError: "視覚モデルが空のスタイル説明を返しました",
      fileReadError: "ファイルの読み込みに失敗しました",
      imageDecodeError: "画像をデコードできません",
      parseError: "解析に失敗しました",
      refImageAlt: "画風参考画像",
    },

    // Hero section
    hero: {
      title: "今日はどんな物語を体験したいですか？",
      placeholder: " ",
      enterHint: "Enterで送信 Shift+Enterで改行",
    },

    // Usage hint
    hint: {
      text: (params: { authEnabled?: boolean }) => {
        const authHint = params.authEnabled ? '（テスト期間中、ログインするだけで無料でプレイできます）' : '';
        return `アイデアを入力し、スタイルを設定して、「開始」をクリックするだけでプレイできます${authHint}。また、下の厳選ストーリー集から1つ選んで、すぐに <em class="not-italic text-ember-500">InfiPlot</em> を体験することもできます。「<span class="inline-flex items-center gap-1 text-ember-500"><i class="fa-solid fa-gear text-[10px]"></i>設定</span>」をクリックすると、あなたの名前や、ご自身のテキスト、画像生成、画像認識モデル、そしてボイス Key を入力することもできます。これらはすべてローカルブラウザにのみ保存されるため、より安定して体験できます。`;
      },
      closeAriaLabel: "今後このメッセージを表示しない",
    },

    // About section
    about: {
      title: "InfiPlot",
      description: "AIでコンテンツをリアルタイムに生成するインタラクティブ・ストーリーゲームです——画像、音声、ストーリーの分岐がプレイ中にその場で生成されます。",
      team: "チーム",
      teamText: "私たちは清華大学や蘭州大学などの大学の出身で、マルチモーダルモデルにおける「画像や動画の直接生成」といったoneshot機能の枠を超えた、さらなる可能性を模索しています。本プロジェクトは現在まだ初期段階にあり、メンバーを募集中です。もしご興味がございましたら、ぜひご連絡ください。皆様のご参加を心よりお待ちしております。",
      contact: "連絡先",
      email: "メールアドレス",
      openSource: "ソースコード",
      betaUsers: "クローズドβユーザーグループ",
      qqGroupLabel: "QQグループ番号：",
      qqGroupAlt: "InfiPlot オープンβ交流QQグループ QRコード（グループ番号 575404333）",
      legalNotice: (params: { analyticsOn?: boolean }) => {
        const base = `公開テスト期間中、本製品は無料でご利用いただけますが、同時接続ユーザー数によって動作の安定性が変動する場合があります。<br />公開テスト期間中に生成されたコンテンツはサーバーに保存されません。保存が必要な場合は、プレイ終了後に図集のエクスポートまたはストーリー共有機能を使用して、プレイ体験を保存してください。<br />AIによって生成されたコンテンツは、当チームの立場を代表するものではありません。`;
        if (params.analyticsOn) {
          return `${base}<br />当サイトは、オープンソースの <a href="https://umami.is/" target="_blank" rel="noopener noreferrer">Umami</a> を使用して、プライバシーに配慮した匿名のアクセスおよびインタラクション統計を行っています：Cookieは使用せず、個人情報は収集せず、入力された内容は一切送信せず、クロスサイトトラッキングも行いません。`;
        }
        return base;
      },
      privacyPolicy: "プライバシーポリシー",
      terms: "利用規約",
      copyright: "© 2026 InfiPlot. All rights reserved.",
    },

    // Story import errors
    errors: {
      emptyFile: "このシナリオファイルは空です。",
      fileTooLarge: "シナリオファイルが大きすぎるため、ロードできません。",
      unpackFailed: "シナリオファイルのアンパックに失敗しました。",
      parseFailed: "シナリオファイルの解析に失敗しました。",
      cardNotFound: "おすすめストーリーが見つかりません：{cardName}",
    },
  },

  // ========== Play Page (PlayCanvas.tsx & play/page.tsx) ==========
  play: {
    // Loading states
    loading: {
      firstFrame: "第一幕を描画中",
      transitioning: "AIが次の幕を描画中",
      visionThinking: "AIはあなたが何を見たか考えています",
      loadingFirst: "第一幕を起動中",
      awakening: "ロード中",
    },

    // Freeform input
    freeform: {
      placeholder: "言いたいことややりたいことを入力...",
      title: "自由入力",
      ariaLabel: "自由入力",
    },

    // Choice disabled title
    choiceDisabled: "共有されたストーリーにこの分岐は含まれていません",

    // Tooltips
    tooltips: {
      openSettings: "設定を開く",
      openHistory: "シナリオ巻き戻し",
      fullscreen: "フルスクリーン (F)",
      enterFullscreen: "全画面表示",
      exportGallery: "このプレイをインタラクティブギャラリーのリンクとしてエクスポート（ボイス付き。直近2回分のリンクのみが保持されます）",
      exportGalleryLabel: "インタラクティブな図表をエクスポート",
      shareStory: "このプレイを続きからプレイ可能なシナリオ .infiplot（ボイス付き）としてエクスポート",
      shareStoryLabel: "現在のストーリーをシェア",
      mute: "ミュート",
      unmute: "ミュート解除",
      closeNudge: "ヒントを閉じる",
      silenceNudge: "効果に満足できない/よく音が出ない？ご自身の API Key を入力してみてください",
      back: "戻る",
    },

    // Image alt
    imageAlt: "Generated scene",

    // Scene/beat counter
    counter: {
      scene: "第 {n} 幕",
      beat: "{n} 拍",
      middle: " ",
    },

    // Button labels
    buttons: {
      fullscreen: "Fキーで全画面",
      exportGallery: "図集のエクスポート",
      shareStory: "ストーリーを共有",
      muted: "消音",
      sound: "ボイスあり",
    },

    // Error state
    error: {
      title: "問題が発生しました",
      back: "戻る",
    },

    // Previous action
    previousStep: "前のアクション",

    // Settings footer note
    settingsFooter: "保存後、ボイス Key はすぐに有効になり、ご自身のクレジットを使用して現在のシーンのボイスを合成します。",

    // Share file errors
    shareErrors: {
      notFound: "読み込むシナリオファイルが見つかりませんでした。",
      invalid: "シナリオ共有ファイルにロード可能なシナリオがありません。",
      noImage: "シナリオ共有ファイルに第一幕の画像がありません。",
      noNextImage: "シナリオ共有ファイルに次のシーンの画像が不足しています。",
      noMemory: "シナリオ共有ファイルに初期シナリオ記憶が不足しているため、ロードできません。",
      packFailed: "シナリオ共有のパッケージ化に失敗しました",
    },

    // Export progress
    exportProgress: {
      preparingVoice: "ボイスを準備中",
    },
  },

  // ========== Settings Modal (SettingsModal.tsx) ==========
  settings: {
    title: "設定",
    subtitle: "任意：これらの設定はローカルブラウザにのみ保存されます",

    // Tabs
    tabs: {
      general: "一般",
      models: "モデル",
    },

    // General tab
    general: {
      playerName: "プレイヤー名",
      playerNamePlaceholder: "未入力の場合は「あなた」を使用します",
      playerNameHint: "NPCは会話の中でこの名前であなたを呼びます。入力しない場合はデフォルトで「あなた」と呼びます。",
      visionClick: "画面をクリックして認識",
      visionOn: "有効にする",
      visionOff: "閉じる",
      visionHint: "有効にすると、選択ノードで画面をクリックした際にAI画像認識がトリガーされ、新しいシナリオ分岐が生成されます。",
    },

    // Models tab
    models: {
      corsNotice: "すべての API キーはブラウザのローカルにのみ保存され、サーバーにアップロードされることはありません。リクエストはブラウザから API エンドポイントへ直接送信されます。エンドポイントが CORS に対応していない場合は、自動的にサーバー経由で中継されます——キーはその一回の中継にのみ使用され、記録・保存されることはありません。",
      textModel: "テキストモデル",
      imageModel: "描画モデル",
      visionModel: "画像認識モデル",
      baseUrl: "BASE URL",
      apiKey: "API Key",
      model: "Model",
      provider: "プロバイダー（任意）",
      providerHint: "空欄の場合、システムは Base URL に基づいてプロトコルを自動的に推測します。",
      providerAuto: "自動判定（推奨）",
      show: "表示",
      hide: "非表示",
    },

    // TTS section
    tts: {
      title: "ボイスモデル",
      description: 'ご自身の <span class="text-clay-800">Xiaomi MiMo API Key</span> を入力すると、ボイスはブラウザのローカルで合成されます。Keyはローカルにのみ保存され、サーバーを経由することはありません。MiMo TTSは現在<span class="text-clay-800">期間限定で無料</span>となっており、申請すればすぐに使用できます。',
      keyType: "Key タイプ",
      payg: "従量課金",
      paygSub: "sk-で始まる",
      tokenPlan: "トークンプラン",
      tokenPlanSub: "tp- で始まる",
      region: "エリアノード",
      regionHint: "ご契約プランの地域と一致するノードを選択してください（通常、最も遅延が少ないノードです）。",
      apiKeyPlaceholderPayg: "sk-で始まる従量課金 Key を貼り付け",
      apiKeyPlaceholderToken: "tp-で始まるプランKeyを貼り付け",
      keyMismatchPayg: 'このKeyはsk-で始まっていません。選択した「従量課金 Pay-as-you-go」タイプと一致しない可能性があります。入力内容に誤りがないかご確認ください。',
      keyMismatchToken: 'この Key は tp- で始まっていないため、選択された「プラン Token Plan」のタイプと一致しない可能性があります。入力内容に誤りがないかご確認ください。',
      tutorialLink: "無料でKeyを申請するには？図解チュートリアルを見る",
    },

    // Actions
    actions: {
      save: "保存",
      clearAll: "すべてクリア",
    },
  },

  // ========== Auth Modal (AuthModal.tsx) ==========
  auth: {
    // Steps
    steps: {
      pick: "ログインして続行",
      email: "メールアドレスでログイン",
      otp: "認証コード",
    },

    // Buttons
    googleLogin: "Google ログイン",
    githubLogin: "GitHubでログイン",
    emailLogin: "メール認証コードでログイン",
    or: "または",

    // Email input
    emailPlaceholder: "your@email.com",
    sendCode: "認証コードを送信",
    sending: "送信中...",

    // OTP verification
    codeSent: "認証コードを{email}に送信しました",
    codePlaceholder: "6桁の認証コード",
    verify: "確認",
    verifying: "検証中...",
    resend: "再送信",

    // Navigation
    back: "戻る",

    // Close
    close: "閉じる",

    // Aria labels
    ariaLabel: "ログイン",
  },

  // ========== Dialogue History Modal ==========
  history: {
    title: "シナリオ回想",
    close: "閉じる",
    closeAriaLabel: "シナリオ回想を閉じる",
    noHistory: "履歴はありません。",
    scene: "第 {n} 幕",
    choice: "選択",
    action: "行動",
    ariaLabel: "シナリオ巻き戻し",
  },

  // ========== Custom Form (CustomForm.tsx) ==========
  customForm: {
    world: "世界観",
    style: "画風",
    worldPlaceholder: "例：1990年代末の中国南部の地方都市。主人公は高校3年生の転校生。雨の多い6月に、いつも屋上で詩を読んでいる同級生と出会う。ストーリーはスロースタートで、控えめ、どこか切ない…",
    stylePlaceholder: "例：水彩風の柔らかな光、午後の温もり、アニメ風ビジュアルノベル画風、従来の会話パネル…",
    status: {
      ready: "準備完了",
      needMore: "2つの段落でスタート",
      starting: "最初のフレームを呼び出し中…",
    },
    start: "スタート",
  },

  // ========== Language Switcher ==========
  language: {
    title: "言語",
    current: "現在の言語",
    select: "言語の選択",
  },
} as const;

export type JaTranslations = typeof ja;
