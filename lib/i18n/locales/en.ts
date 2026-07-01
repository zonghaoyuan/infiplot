// English (en) - Base English translations
// This is a manually translated reference file

export const en = {
  // ========== Layout ==========
  layout: {
    metadata: {
      title: "InfiPlot — AI Real-time Interactive Story Game",
      description: "InfiPlot is an interactive story game demo that uses AI to generate images, voice, and story branches in real-time.",
    },
  },

  // ========== Home Page ==========
  home: {
    examples: {
      male: [
        "My childhood friend suddenly blushes and confesses her feelings to me",
        "I wake up one day and find that all the girls in my class seem to have secretly fallen in love with me",
        "The three-year deadline has arrived. Turns out I'm a wealthy heir, and the time for revenge is now",
        "I travel back to the eve of the internet's birth with unlimited tokens...",
      ],
      female: [
        "Transmigrated as the useless daughter of a general's mansion, the cold regent only dotes on me",
        "Reborn on the night before our breakup, this time I'll be the one to let go first",
        "I wake up as a villainess in an otome game and must avoid all death endings",
      ],
      x: [
        "The spacetime rift opens, and versions of myself from parallel worlds suddenly appear",
        "In the memory palace, forgotten fragments are reassembling into a new story",
        "An infinite flow game begins—everyone has only one chance to clear it",
        "System notification: your choice will determine the fate of the entire universe",
      ],
    },

    options: {
      gender: "Orientation",
      artStyle: "Art Style",
      plotStyle: "Plot Style",
      voice: "Voice",
      pacing: "Pacing",
    },

    genders: {
      male: "Male-oriented",
      female: "Female-oriented",
      x: "Universal",
    },

    artStyles: {
      auto: "Auto",
      custom: "Custom Style",
      kyoani: "Kyoto Animation",
      shinkai: "Makoto Shinkai",
      ghibli: "Studio Ghibli",
      "3d": "3D Animation",
      cyberpunk: "Cyberpunk",
      gothic: "Gothic",
      wasteland: "Wasteland",
      pixel: "Pixel Art",
      realistic: "Realistic",
      oil: "Classical Oil",
      monet: "Monet",
      watercolor: "Watercolor",
      ink: "Ink Wash",
      ukiyoe: "Ukiyo-e",
      pencil: "Colored Pencil",
      sketch: "Hand-drawn Sketch",
      manga: "Black & White Manga",
      children: "Children's Picture Book",
      crayon: "Crayon Drawing",
      clay: "Clay Art",
      dunhuang: "Dunhuang Mural",
      miniature: "Miniature",
      mosaic: "Mosaic",
      stainedGlass: "Stained Glass",
      vaporwave: "Vaporwave",
      vector: "Vector Art",
      lowpoly: "Low Poly",
      popart: "Pop Art",
      glitch: "Glitch Art",
      papercut: "Papercut Art",
      steampunk: "Steampunk",
      xianxia: "Xianxia Fantasy",
      darkFairytale: "Dark Fairytale",
      urbanFantasy: "Urban Fantasy",
    },

    plotStyles: {
      straightforward: "Linear",
      twist: "Multi-branch",
      suspense: "Suspenseful",
      healing: "Slice-of-life",
    },

    voiceOptions: {
      off: "Off",
      on: "On",
    },

    pacings: {
      slow: "Slow-burn",
      fast: "Brisk",
    },

    stories: {
      sage_downfall: "Sage's Downfall",
      brush_sage: "Painter Sage",
      courtesan_blade: "Courtesan's Blade",
    },

    ui: {
      start: "Start",
      loadStory: "Load Story",
      settings: "Settings",
      myStories: "My Stories",
      searchPlaceholder: "Search styles…",
      noMatchingStyle: "No matching styles",
      close: "Close",
      back: "Back",
      save: "Save",
      cancel: "Cancel",
      saveAndSelect: "Save and Select",
      feedback: "Feedback",
      submitFeedback: "Submit Feedback",
    },

    styleModal: {
      title: "Select Art Style",
      subtitle: 'Default "Auto" · AI automatically matches the style to your story; select "Custom Style" to enter a description or upload a reference image',
      customTitle: "Custom Style",
      customPlaceholder: `Describe the visual style you want, for example:
Dreamy watercolor style with soft tones and nostalgic atmosphere

💡 Tip: Some image models work better with English prompts. Consider using an AI chatbot to generate professional English style descriptions first, then paste them here.`,
      uploadImage: "Upload Reference",
      changeImage: "Change Image",
      remove: "Remove",
      parsing: "Parsing…",
      importFromPreset: "Import from Preset…",
      uploadError: "Only image files are supported",
      visionError: "Vision model returned an empty style description",
      fileReadError: "Failed to read file",
      imageDecodeError: "Failed to decode image",
      parseError: "Failed to parse",
      refImageAlt: "Style reference image",
    },

    hero: {
      title: "What story do you want to experience today?",
      placeholder: " ",
      enterHint: "Enter to send · Shift+Enter for newline",
    },

    hint: {
      text: (params: { authEnabled?: boolean }) => {
        const authHint = params.authEnabled ? ' (login required during beta, free to play)' : '';
        return `Enter your ideas, configure styles, and click "Start" to play${authHint}. You can also pick a curated story from below to quickly experience <em class="not-italic text-ember-500">InfiPlot</em>. Click "<span class="inline-flex items-center gap-1 text-ember-500"><i class="fa-solid fa-gear text-[10px]"></i>Settings</span>" to enter your name and configure your own text, image, vision models and TTS keys—all stored locally in your browser for a more stable experience.`;
      },
      closeAriaLabel: "Don't show this hint again",
    },

    about: {
      title: "InfiPlot",
      description: "is an interactive story game that uses AI to generate content in real-time — images, voice, and story branches are all generated during gameplay.",
      team: "TEAM",
      teamText: "We are from universities including Tsinghua University and Lanzhou University, hoping to explore more possibilities of multimodal models beyond oneshot capabilities like direct image and video generation. This project is still in its early stages, and we are recruiting. If you're interested, please contact us—we look forward to your joining.",
      contact: "CONTACT",
      email: "Email",
      openSource: "OPEN SOURCE",
      feedbackDescription: "Your thoughts matter — tell us about your experience and suggestions.",
      betaUsers: "BETA USERS",
      qqGroupLabel: "QQ Group: ",
      qqGroupAlt: "InfiPlot Public Beta Group QR Code (Group ID: 575404333)",
      legalNotice: (params: { analyticsOn?: boolean }) => {
        const base = "During public beta, this product is free to use but stability may vary with concurrent user load.<br />Content generated during public beta is not saved on servers. To preserve your experience, use the export gallery or story sharing features after playing.<br />AI-generated content does not represent our team's stance.";
        if (params.analyticsOn) {
          return `${base}<br />This site uses open-source <a href="https://umami.is/" target="_blank" rel="noopener noreferrer">Umami</a> for privacy-friendly anonymous analytics: no cookies, no personal data collection, no transmission of your inputs, no cross-site tracking.`;
        }
        return base;
      },
      privacyPolicy: "Privacy Policy",
      terms: "Terms of Service",
      copyright: "© 2026 InfiPlot. All rights reserved.",
    },

    errors: {
      emptyFile: "This story file is empty.",
      fileTooLarge: "The story file is too large to load.",
      unpackFailed: "Failed to unpack the story file.",
      parseFailed: "Failed to parse the story file.",
      cardNotFound: "Curated story not found: {cardName}",
    },
  },

  // ========== Play Page ==========
  // NOTE: zh-CN uses " · " between every character as a stylistic effect.
  // Other locales MUST NOT use this dot separator — just plain words.
  play: {
    loading: {
      firstFrame: "Drawing the first scene",
      transitioning: "AI is painting the next scene",
      visionThinking: "AI is interpreting what you see",
      loadingFirst: "Awakening the first scene",
      awakening: "Loading",
    },

    freeform: {
      placeholder: "Enter what you want to say or do...",
      title: "Free Input",
      ariaLabel: "Free input",
    },

    choiceDisabled: "This branch is not included in the shared story",

    tooltips: {
      openSettings: "Open Settings",
      openHistory: "Story History",
      fullscreen: "Fullscreen (F)",
      enterFullscreen: "Enter Fullscreen",
      exportGallery: "Export current session as interactive gallery link (with voice; keeps only the 2 most recent gallery links)",
      exportGalleryLabel: "Export Interactive Gallery",
      shareStory: "Export current session as playable .infiplot story file (with voice)",
      shareStoryLabel: "Share Current Story",
      mute: "Mute",
      unmute: "Unmute",
      closeNudge: "Close hint",
      silenceNudge: "Poor quality/often silent? Try entering your own API Key",
      back: "Back",
    },

    imageAlt: "Generated scene",

    counter: {
      scene: "Scene {n}",
      beat: "Frame {n}",
      middle: " ",
    },

    buttons: {
      fullscreen: "Fullscreen",
      exportGallery: "Export Gallery",
      shareStory: "Share Story",
      muted: "Muted",
      sound: "Sound",
    },

    error: {
      title: "Something went wrong",
      back: "Back",
      retry: "Retry",
      close: "Close",
    },

    previousStep: "Previous action",

    settingsFooter: "After saving, the voice key takes effect immediately and uses your quota to synthesize voice for the current scene.",

    shareErrors: {
      notFound: "No story file found to load.",
      invalid: "Story share file has no playable content.",
      noImage: "Story share file is missing the first scene image.",
      noNextImage: "Story share file is missing the next scene image.",
      noMemory: "Story share file is missing initial story memory and cannot be loaded.",
      packFailed: "Failed to pack story share",
    },

    savedStoryNotFound: "Saved story not found",
    savedStoryCorrupted: "Story data is corrupted",

    exportProgress: {
      preparingVoice: "Preparing voice",
    },
  },

  // ========== Settings Modal ==========
  settings: {
    title: "Settings",
    subtitle: "Optional · These settings are saved only in your local browser",

    tabs: {
      general: "General",
      models: "Models",
    },

    general: {
      playerName: "Player Name",
      playerNamePlaceholder: "Leave empty to use 'You'",
      playerNameHint: "NPCs will address you by this name in dialogue. If left empty, 'You' will be used by default.",
      visionClick: "Click Image Recognition",
      visionOn: "On",
      visionOff: "Off",
      visionHint: "When enabled, clicking on the image at choice nodes will trigger AI vision recognition and generate new story branches.",
    },

    models: {
      corsNotice: "All API keys are stored locally in your browser and never uploaded to our server. Requests are sent directly from your browser to the API endpoint; if the endpoint does not support CORS, requests are automatically routed through our server — your key is used only for that single relay and is never logged or stored.",
      textModel: "Text Model",
      imageModel: "Image Model",
      visionModel: "Vision Model",
      baseUrl: "BASE URL",
      apiKey: "API Key",
      model: "Model",
      provider: "Provider (Optional)",
      providerHint: "Leave empty for the system to auto-detect the protocol based on the Base URL.",
      providerAuto: "Auto-detect (Recommended)",
      show: "Show",
      hide: "Hide",
    },

    tts: {
      title: "Voice Model",
      description: 'Enter your own <span class="text-clay-800">Xiaomi MiMo API Key</span>. Voice synthesis runs locally in your browser, and the key is saved locally and never sent to the server. MiMo TTS is currently <span class="text-clay-800">free for a limited time</span>—just apply to use it.',
      keyType: "Key Type",
      payg: "Pay-as-you-go",
      paygSub: "Starts with sk-",
      tokenPlan: "Token Plan",
      tokenPlanSub: "Starts with tp-",
      region: "Region Node",
      regionHint: "Select the node matching your subscription region (usually the one with lowest latency).",
      apiKeyPlaceholderPayg: "Paste sk- pay-as-you-go key",
      apiKeyPlaceholderToken: "Paste tp- token plan key",
      keyMismatchPayg: 'This key does not start with sk-. It may not match the selected "Pay-as-you-go" type. Please check if you entered it correctly.',
      keyMismatchToken: 'This key does not start with tp-. It may not match the selected "Token Plan" type. Please check if you entered it correctly.',
      tutorialLink: "How to get a free key? View tutorial",
    },

    actions: {
      save: "Save",
      clearAll: "Clear All",
    },
  },

  // ========== Auth Modal ==========
  auth: {
    steps: {
      pick: "Login to Continue",
      email: "Email Login",
      otp: "Verification Code",
    },

    googleLogin: "Continue with Google",
    githubLogin: "Continue with GitHub",
    emailLogin: "Email Verification Code",
    or: "or",

    emailPlaceholder: "your@email.com",
    sendCode: "Send Code",
    sending: "Sending...",

    codeSent: "Verification code sent to {email}",
    codePlaceholder: "6-digit code",
    verify: "Confirm",
    verifying: "Verifying...",
    resend: "Resend",

    back: "Back",

    close: "Close",
    ariaLabel: "Login",
  },

  // ========== Dialogue History Modal ==========
  history: {
    title: "Story History",
    close: "Close",
    closeAriaLabel: "Close story history",
    noHistory: "No history yet.",
    scene: "Scene {n}",
    choice: "Choice",
    action: "Action",
    ariaLabel: "Story history",
  },

  // ========== Custom Form ==========
  customForm: {
    world: "World",
    style: "Style",
    worldPlaceholder: "Example: A small county town in southern China in the late 1990s. The protagonist is a transfer student in senior year who meets a classmate always reading poetry on the rooftop during the rainy June. Slow-burn, subtle, slightly melancholic...",
    stylePlaceholder: "Example: Watercolor soft light, afternoon warmth, anime visual novel style, traditional dialogue panel...",
    status: {
      ready: "Ready",
      needMore: "Two more to go",
      starting: "Waking first frame…",
    },
    start: "Start",
  },

  // ========== Language Switcher ==========
  language: {
    title: "Language",
    current: "Current Language",
    select: "Select Language",
  },

  // ========== Stories Page (app/[locale]/stories/page.tsx) ==========
  stories: {
    title: "M y · S t o r i e s",
    loading: "L o a d i n g",
    emptyTitle: "No saved stories yet",
    emptyBack: "Go back home to start a new story",
    scenes: "{count} scenes",
    deleteLabel: "Delete",
    deleteConfirm: "Delete this story? This action cannot be undone.",
    deleteFailed: "Delete failed. Please try again later.",
    today: "Today",
    yesterday: "Yesterday",
    daysAgo: "{days} days ago",
    storiesCount: "{count} stories",
  },
} as const;

export type EnTranslations = typeof en;
