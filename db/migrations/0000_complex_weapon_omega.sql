CREATE TABLE `assets` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`path` text NOT NULL,
	`width` integer,
	`height` integer,
	`duration_sec` real,
	`sha256` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `assets_sha_idx` ON `assets` (`sha256`);--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`take_id` text NOT NULL,
	`prediction_id` text NOT NULL,
	`endpoint` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_polled_at` integer,
	`next_poll_at` integer NOT NULL,
	`error` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`take_id`) REFERENCES `takes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `jobs_status_idx` ON `jobs` (`status`);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`brief_raw` text DEFAULT '' NOT NULL,
	`maturity` integer DEFAULT 1 NOT NULL,
	`concept` text,
	`settings` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `reference_variants` (
	`id` text PRIMARY KEY NOT NULL,
	`reference_id` text NOT NULL,
	`name` text NOT NULL,
	`views` text NOT NULL,
	FOREIGN KEY (`reference_id`) REFERENCES `references`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `variants_reference_idx` ON `reference_variants` (`reference_id`);--> statement-breakpoint
CREATE TABLE `references` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`scope` text DEFAULT 'local' NOT NULL,
	`shot_id` text,
	`tag` text DEFAULT 'free' NOT NULL,
	`name` text NOT NULL,
	`descriptor` text DEFAULT '' NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`shot_id`) REFERENCES `shots`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `references_project_idx` ON `references` (`project_id`);--> statement-breakpoint
CREATE TABLE `sequences` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`order` integer NOT NULL,
	`title` text NOT NULL,
	`summary` text NOT NULL,
	`location_ref_id` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `sequences_project_idx` ON `sequences` (`project_id`);--> statement-breakpoint
CREATE TABLE `shots` (
	`id` text PRIMARY KEY NOT NULL,
	`sequence_id` text NOT NULL,
	`order` integer NOT NULL,
	`description` text NOT NULL,
	`dialogue` text,
	`sound` text,
	`duration_sec` real DEFAULT 3 NOT NULL,
	`camera` text NOT NULL,
	`recipe_id` text DEFAULT 'free' NOT NULL,
	`graph` text NOT NULL,
	`ref_ids` text NOT NULL,
	`framing` text,
	`selected_take_id` text,
	`status` text DEFAULT 'to_write' NOT NULL,
	FOREIGN KEY (`sequence_id`) REFERENCES `sequences`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `shots_sequence_idx` ON `shots` (`sequence_id`);--> statement-breakpoint
CREATE TABLE `takes` (
	`id` text PRIMARY KEY NOT NULL,
	`shot_id` text NOT NULL,
	`stage` text NOT NULL,
	`asset_id` text,
	`parent_take_id` text,
	`model` text NOT NULL,
	`prompt` text NOT NULL,
	`params` text NOT NULL,
	`seed` integer,
	`prediction_id` text,
	`status` text DEFAULT 'queued' NOT NULL,
	`cost_estimated_usd` real NOT NULL,
	`cost_actual_usd` real,
	`error` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`shot_id`) REFERENCES `shots`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `takes_shot_idx` ON `takes` (`shot_id`);