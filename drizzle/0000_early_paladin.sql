CREATE TABLE `characters` (
	`id` text PRIMARY KEY NOT NULL,
	`story_id` text NOT NULL,
	`name` text NOT NULL,
	`visual_description` text,
	`voice_description` text,
	`base_portrait_key` text,
	`base_portrait_url` text,
	`base_portrait_uuid` text,
	`voice_json` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`story_id`) REFERENCES `stories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `characters_story_name_idx` ON `characters` (`story_id`,`name`);--> statement-breakpoint
CREATE TABLE `featured_stories` (
	`id` text PRIMARY KEY NOT NULL,
	`gender` text NOT NULL,
	`title` text NOT NULL,
	`outline` text NOT NULL,
	`style` text NOT NULL,
	`tags` text NOT NULL,
	`cover_path` text NOT NULL,
	`firstact_path` text NOT NULL,
	`firstscene_path` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`is_active` integer DEFAULT 1 NOT NULL,
	`click_count` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `featured_gender_active_idx` ON `featured_stories` (`gender`,`is_active`);--> statement-breakpoint
CREATE TABLE `scenes` (
	`id` text PRIMARY KEY NOT NULL,
	`story_id` text NOT NULL,
	`scene_key` text,
	`scene_summary` text,
	`scene_image_key` text,
	`scene_image_url` text,
	`beats_json` text,
	`sort_order` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`story_id`) REFERENCES `stories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `scenes_story_id_idx` ON `scenes` (`story_id`);--> statement-breakpoint
CREATE TABLE `stories` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`world_setting` text NOT NULL,
	`style_guide` text NOT NULL,
	`style_reference_image_key` text,
	`orientation` text DEFAULT 'landscape' NOT NULL,
	`story_state_json` text,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `stories_user_id_idx` ON `stories` (`user_id`);--> statement-breakpoint
CREATE INDEX `stories_created_at_idx` ON `stories` (`created_at`);