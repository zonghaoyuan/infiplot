import "server-only";

import { eq, desc, sql, inArray } from "drizzle-orm";
import type { DbInstance } from "../client";
import { stories, scenes, characters } from "../schema";
import type { Session, Scene as EngineScene, Character as EngineCharacter, StoryState } from "@infiplot/types";

// ── Type Adapters ────────────────────────────────────────────────────────

/**
 * Input shape for saving a story session.
 * Mirrors Session but with explicit story-level fields.
 */
export type StorySaveInput = {
  id: string; // Session ID
  userId?: string; // nullable - Phase 1 uses anonymous sessionId
  worldSetting: string;
  styleGuide: string;
  styleReferenceImage?: string; // data URI or R2 key (TBD in save logic)
  orientation: "portrait" | "landscape";
  storyState?: StoryState;
  status?: "active" | "archived";
};

export type SceneSaveInput = {
  id: string;
  sceneKey?: string;
  sceneSummary?: string;
  imageUrl: string; // Runware CDN URL (primary)
  beats: EngineScene["beats"]; // Beat graph - will be serialized to beatsJson
  orientation?: "portrait" | "landscape";
  sortOrder: number; // scene sequence in story
};

export type CharacterSaveInput = {
  name: string;
  visualDescription?: string;
  voiceDescription?: string;
  portrait?: {
    url?: string;
    uuid?: string;
  };
  voice?: EngineCharacter["voice"];
};

/**
 * Story metadata for list views.
 */
export type StoryMeta = {
  id: string;
  userId: string | null;
  worldSetting: string;
  styleGuide: string;
  orientation: string;
  status: string;
  sceneCount: number;
  createdAt: Date;
  updatedAt: Date;
};

/**
 * Full story load result (maps back to Session structure).
 */
export type StoryLoadResult = {
  story: {
    id: string;
    userId: string | null;
    worldSetting: string;
    styleGuide: string;
    styleReferenceImage?: string;
    orientation: "portrait" | "landscape";
    storyState?: StoryState;
    status: string;
    createdAt: Date;
    updatedAt: Date;
  };
  scenes: Array<{
    id: string;
    sceneKey?: string;
    sceneSummary?: string;
    imageUrl: string;
    beats: EngineScene["beats"];
    orientation?: "portrait" | "landscape";
    sortOrder: number;
    createdAt: Date;
  }>;
  characters: Array<{
    name: string;
    visualDescription?: string;
    voiceDescription?: string;
    portrait?: {
      url?: string;
      uuid?: string;
    };
    voice?: EngineCharacter["voice"];
  }>;
};

// ── Repository ───────────────────────────────────────────────────────────

/**
 * Story Repository - encapsulates D1 access for story persistence.
 *
 * **Atomic save**: uses D1 batch transaction to ensure all-or-nothing writes.
 * **Cascade delete**: relies on schema FK ON DELETE CASCADE.
 * **Serialization**: beats and storyState are JSON-serialized to TEXT columns.
 */
export class StoryRepository {
  constructor(private db: DbInstance) {}

  /**
   * Save a complete story session (story + scenes + characters) atomically.
   * Uses D1 batch transaction - all writes succeed or all fail.
   *
   * @param input Story metadata
   * @param sceneInputs Scene list (beats will be serialized)
   * @param characterInputs Character list (voice will be serialized)
   * @returns storyId on success
   * @throws Error if D1 transaction fails
   */
  async save(
    input: StorySaveInput,
    sceneInputs: SceneSaveInput[],
    characterInputs: CharacterSaveInput[],
  ): Promise<{ storyId: string }> {
    const now = new Date();

    // Build story record
    const storyRecord = {
      id: input.id,
      userId: input.userId ?? null,
      worldSetting: input.worldSetting,
      styleGuide: input.styleGuide,
      styleReferenceImageKey: input.styleReferenceImage ?? null, // Phase 1: store data URI as-is; R2 upload TBD
      orientation: input.orientation,
      storyStateJson: input.storyState ? JSON.stringify(input.storyState) : null,
      status: input.status ?? "active",
      createdAt: now,
      updatedAt: now,
    };

    // Build scene records (serialize beats to JSON)
    const sceneRecords = sceneInputs.map((s, idx) => ({
      id: s.id,
      storyId: input.id,
      sceneKey: s.sceneKey ?? null,
      sceneSummary: s.sceneSummary ?? null,
      sceneImageKey: null, // Phase 1: R2 upload TBD
      sceneImageUrl: s.imageUrl,
      beatsJson: JSON.stringify(s.beats),
      sortOrder: s.sortOrder ?? idx,
      createdAt: now,
    }));

    // Build character records (serialize voice to JSON, ensure uniqueness per story+name)
    const characterRecords = characterInputs.map((c, idx) => ({
      id: `${input.id}_char_${idx}`, // synthetic ID
      storyId: input.id,
      name: c.name,
      visualDescription: c.visualDescription ?? null,
      voiceDescription: c.voiceDescription ?? null,
      basePortraitKey: null, // Phase 1: R2 upload TBD
      basePortraitUrl: c.portrait?.url ?? null,
      basePortraitUuid: c.portrait?.uuid ?? null,
      voiceJson: c.voice ? JSON.stringify(c.voice) : null,
      createdAt: now,
    }));

    // Execute atomic batch transaction
    await this.db.batch([
      this.db.insert(stories).values(storyRecord).onConflictDoUpdate({
        target: stories.id,
        set: {
          worldSetting: storyRecord.worldSetting,
          styleGuide: storyRecord.styleGuide,
          styleReferenceImageKey: storyRecord.styleReferenceImageKey,
          orientation: storyRecord.orientation,
          storyStateJson: storyRecord.storyStateJson,
          status: storyRecord.status,
          updatedAt: now,
        },
      }),
      // Clear old scenes/characters (will cascade delete via FK)
      this.db.delete(scenes).where(eq(scenes.storyId, input.id)),
      this.db.delete(characters).where(eq(characters.storyId, input.id)),
      // Insert new scenes/characters
      ...sceneRecords.map((r) => this.db.insert(scenes).values(r)),
      ...characterRecords.map((r) => this.db.insert(characters).values(r)),
    ]);

    return { storyId: input.id };
  }

  /**
   * Load a complete story by ID, reconstructing Session shape.
   *
   * @param storyId Story primary key
   * @returns StoryLoadResult with deserialized beats/storyState, or null if not found
   */
  async findById(storyId: string): Promise<StoryLoadResult | null> {
    const [storyRow] = await this.db
      .select()
      .from(stories)
      .where(eq(stories.id, storyId))
      .limit(1);

    if (!storyRow) return null;

    const sceneRows = await this.db
      .select()
      .from(scenes)
      .where(eq(scenes.storyId, storyId))
      .orderBy(scenes.sortOrder);

    const characterRows = await this.db
      .select()
      .from(characters)
      .where(eq(characters.storyId, storyId));

    return {
      story: {
        id: storyRow.id,
        userId: storyRow.userId,
        worldSetting: storyRow.worldSetting,
        styleGuide: storyRow.styleGuide,
        styleReferenceImage: storyRow.styleReferenceImageKey ?? undefined,
        orientation: storyRow.orientation as "portrait" | "landscape",
        storyState: storyRow.storyStateJson
          ? (JSON.parse(storyRow.storyStateJson) as StoryState)
          : undefined,
        status: storyRow.status,
        createdAt: storyRow.createdAt,
        updatedAt: storyRow.updatedAt,
      },
      scenes: sceneRows.map((s) => ({
        id: s.id,
        sceneKey: s.sceneKey ?? undefined,
        sceneSummary: s.sceneSummary ?? undefined,
        imageUrl: s.sceneImageUrl ?? "", // CR-5: nullable column, fallback to empty string
        beats: s.beatsJson ? JSON.parse(s.beatsJson) : [],
        orientation: s.sceneImageUrl ? undefined : undefined, // Phase 1: no per-scene orientation in schema
        sortOrder: s.sortOrder,
        createdAt: s.createdAt,
      })),
      characters: characterRows.map((c) => ({
        name: c.name,
        visualDescription: c.visualDescription ?? undefined,
        voiceDescription: c.voiceDescription ?? undefined,
        portrait: c.basePortraitUrl
          ? { url: c.basePortraitUrl, uuid: c.basePortraitUuid ?? undefined }
          : undefined,
        voice: c.voiceJson ? JSON.parse(c.voiceJson) : undefined,
      })),
    };
  }

  /**
   * List story metadata for a given user, ordered by most recent first.
   *
   * @param userId User ID (or anonymous sessionId in Phase 1)
   * @param limit Max stories to return (default 50)
   * @returns Array of StoryMeta
   */
  async listByUser(userId: string, limit = 50): Promise<StoryMeta[]> {
    const storyRows = await this.db
      .select()
      .from(stories)
      .where(eq(stories.userId, userId))
      .orderBy(desc(stories.updatedAt))
      .limit(limit);

    if (storyRows.length === 0) return [];

    // CR-10: batch scene count in 2 queries total (not N+1)
    const storyIds = storyRows.map((r) => r.id);
    const countRows = await this.db
      .select({ storyId: scenes.storyId, count: sql<number>`count(*)` })
      .from(scenes)
      .where(inArray(scenes.storyId, storyIds))
      .groupBy(scenes.storyId);

    const countMap = new Map(countRows.map((r) => [r.storyId, r.count]));

    return storyRows.map((row) => ({
      id: row.id,
      userId: row.userId,
      worldSetting: row.worldSetting,
      styleGuide: row.styleGuide,
      orientation: row.orientation,
      status: row.status,
      sceneCount: countMap.get(row.id) ?? 0,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }));
  }

  /**
   * Delete a story and all associated scenes/characters (cascade via FK).
   *
   * @param storyId Story primary key
   * @returns true if deleted, false if not found
   */
  async delete(storyId: string): Promise<boolean> {
    const result = await this.db.delete(stories).where(eq(stories.id, storyId));
    // Drizzle D1 delete returns { success, meta: { changes }, results }
    return ((result as any).meta?.changes ?? 0) > 0;
  }
}
