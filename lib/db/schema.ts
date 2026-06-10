import { sqliteTable, text, integer, index, uniqueIndex } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

// ── Stories ──────────────────────────────────────────────────────────────
// User story sessions (REQ-4). Each story contains multiple scenes and characters.
export const stories = sqliteTable(
  "stories",
  {
    id: text("id").primaryKey(), // s_xxx session ID
    userId: text("user_id"), // nullable - Phase 1 uses anonymous sessionId
    worldSetting: text("world_setting").notNull(),
    styleGuide: text("style_guide").notNull(),
    styleReferenceImageKey: text("style_reference_image_key"), // R2 key (optional)
    orientation: text("orientation").notNull().default("landscape"), // "portrait" | "landscape"
    storyStateJson: text("story_state_json"), // JSON: StoryState
    status: text("status").notNull().default("active"), // "active" | "archived"
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`)
      .$onUpdate(() => new Date()),
  },
  (table) => ({
    userIdIdx: index("stories_user_id_idx").on(table.userId),
    createdAtIdx: index("stories_created_at_idx").on(table.createdAt),
  }),
);

// ── Scenes ───────────────────────────────────────────────────────────────
// Story scenes (REQ-4). Beats stored as JSON blob (not separate table).
export const scenes = sqliteTable(
  "scenes",
  {
    id: text("id").primaryKey(),
    storyId: text("story_id")
      .notNull()
      .references(() => stories.id, { onDelete: "cascade" }),
    sceneKey: text("scene_key"), // e.g. "classroom-dusk"
    sceneSummary: text("scene_summary"),
    sceneImageKey: text("scene_image_key"), // R2 key (optional)
    sceneImageUrl: text("scene_image_url"), // Runware CDN URL (primary)
    beatsJson: text("beats_json"), // JSON: Beat[] - whole scene beats graph
    sortOrder: integer("sort_order").notNull(), // scene sequence in story
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    storyIdIdx: index("scenes_story_id_idx").on(table.storyId),
  }),
);

// ── Characters ───────────────────────────────────────────────────────────
// Story characters (REQ-4). Each character belongs to a story.
export const characters = sqliteTable(
  "characters",
  {
    id: text("id").primaryKey(),
    storyId: text("story_id")
      .notNull()
      .references(() => stories.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    visualDescription: text("visual_description"),
    voiceDescription: text("voice_description"),
    basePortraitKey: text("base_portrait_key"), // R2 key (optional)
    basePortraitUrl: text("base_portrait_url"), // CDN URL (primary)
    basePortraitUuid: text("base_portrait_uuid"), // image service UUID
    voiceJson: text("voice_json"), // JSON: CharacterVoice
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    storyNameIdx: uniqueIndex("characters_story_name_idx").on(
      table.storyId,
      table.name,
    ),
  }),
);

// ── Featured Stories ─────────────────────────────────────────────────────
// Featured story cards displayed on homepage (REQ-5).
export const featuredStories = sqliteTable(
  "featured_stories",
  {
    id: text("id").primaryKey(), // e.g. "m0", "f12"
    gender: text("gender").notNull(), // "male" | "female"
    title: text("title").notNull(),
    outline: text("outline").notNull(),
    style: text("style").notNull(),
    tags: text("tags").notNull(), // JSON array
    coverPath: text("cover_path").notNull(), // e.g. "/home/m0.webp"
    firstactPath: text("firstact_path").notNull(), // e.g. "/home/firstact/m0.json"
    firstscenePath: text("firstscene_path"), // e.g. "/home/firstscene/m0.webp"
    sortOrder: integer("sort_order").notNull().default(0),
    isActive: integer("is_active").notNull().default(1), // 1 = active, 0 = inactive
    clickCount: integer("click_count").notNull().default(0),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    genderActiveIdx: index("featured_gender_active_idx").on(
      table.gender,
      table.isActive,
    ),
  }),
);

// ── Type exports ─────────────────────────────────────────────────────────
export type Story = typeof stories.$inferSelect;
export type NewStory = typeof stories.$inferInsert;

export type Scene = typeof scenes.$inferSelect;
export type NewScene = typeof scenes.$inferInsert;

export type Character = typeof characters.$inferSelect;
export type NewCharacter = typeof characters.$inferInsert;

export type FeaturedStory = typeof featuredStories.$inferSelect;
export type NewFeaturedStory = typeof featuredStories.$inferInsert;
