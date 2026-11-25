PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__jobs_backup` AS SELECT * FROM `jobs` WHERE `node_run_id` IS NOT NULL;--> statement-breakpoint
CREATE TABLE `__new_node_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`shot_id` text,
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
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`shot_id`) REFERENCES `shots`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_node_runs`("id", "project_id", "shot_id", "node_id", "kind", "model", "prompt", "params", "seed", "prediction_id", "status", "asset_id", "cost_estimated_usd", "cost_actual_usd", "error", "sent_take_id", "created_at") SELECT nr."id", (SELECT sq."project_id" FROM `shots` sh JOIN `sequences` sq ON sq."id" = sh."sequence_id" WHERE sh."id" = nr."shot_id"), nr."shot_id", nr."node_id", nr."kind", nr."model", nr."prompt", nr."params", nr."seed", nr."prediction_id", nr."status", nr."asset_id", nr."cost_estimated_usd", nr."cost_actual_usd", nr."error", nr."sent_take_id", nr."created_at" FROM `node_runs` nr WHERE EXISTS (SELECT 1 FROM `shots` sh WHERE sh."id" = nr."shot_id");--> statement-breakpoint
DROP TABLE `node_runs`;--> statement-breakpoint
ALTER TABLE `__new_node_runs` RENAME TO `node_runs`;--> statement-breakpoint
INSERT OR IGNORE INTO `jobs` SELECT * FROM `__jobs_backup`;--> statement-breakpoint
DROP TABLE `__jobs_backup`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `node_runs_project_idx` ON `node_runs` (`project_id`);--> statement-breakpoint
ALTER TABLE `projects` ADD `canvas` text DEFAULT '{"nodes":[],"edges":[]}' NOT NULL;