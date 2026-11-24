CREATE TABLE `ref_generations` (
	`id` text PRIMARY KEY NOT NULL,
	`reference_id` text NOT NULL,
	`variant_id` text NOT NULL,
	`view` text NOT NULL,
	`source_asset_id` text,
	`asset_id` text,
	`model` text NOT NULL,
	`prompt` text NOT NULL,
	`params` text NOT NULL,
	`prediction_id` text,
	`status` text DEFAULT 'queued' NOT NULL,
	`validated` integer DEFAULT false NOT NULL,
	`cost_estimated_usd` real NOT NULL,
	`cost_actual_usd` real,
	`error` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`reference_id`) REFERENCES `references`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`variant_id`) REFERENCES `reference_variants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `refgen_reference_idx` ON `ref_generations` (`reference_id`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`take_id` text,
	`ref_generation_id` text,
	`prediction_id` text NOT NULL,
	`endpoint` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_polled_at` integer,
	`next_poll_at` integer NOT NULL,
	`error` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`take_id`) REFERENCES `takes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`ref_generation_id`) REFERENCES `ref_generations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_jobs`("id", "take_id", "ref_generation_id", "prediction_id", "endpoint", "status", "attempts", "last_polled_at", "next_poll_at", "error", "created_at") SELECT "id", "take_id", NULL, "prediction_id", "endpoint", "status", "attempts", "last_polled_at", "next_poll_at", "error", "created_at" FROM `jobs`;--> statement-breakpoint
DROP TABLE `jobs`;--> statement-breakpoint
ALTER TABLE `__new_jobs` RENAME TO `jobs`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `jobs_status_idx` ON `jobs` (`status`);