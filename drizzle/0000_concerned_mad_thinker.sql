CREATE TABLE `member_records` (
	`id` text PRIMARY KEY NOT NULL,
	`wechat_id` text NOT NULL,
	`game_id` text NOT NULL,
	`discount` text NOT NULL,
	`balance_cents` integer NOT NULL,
	`created_at` integer NOT NULL
);
