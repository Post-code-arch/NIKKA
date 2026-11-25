CREATE TABLE `node_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`shot_id` text NOT NULL,
	`node_id` text NOT NULL,
	`kind` text NOT NULL,
	`model` text NOT NULL,
	`prompt` text NOT NULL,
	`params` text NOT NULL,
	`seed` integer,
	`prediction_id` text,
	`status` text DEFAULT 'queued' NOT NULL,
	`asset_id` text,
	`cost_estimated_usd` real NOT NULL,
	`cost_actual_usd` real,
	`error` text,
	`sent_take_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`shot_id`) REFERENCES `shots`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `node_runs_shot_idx` ON `node_runs` (`shot_id`);--> statement-breakpoint
ALTER TABLE `jobs` ADD `node_run_id` text REFERENCES node_runs(id) ON UPDATE no action ON DELETE cascade;