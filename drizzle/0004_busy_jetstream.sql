CREATE TABLE `balance_adjustments` (
	`id` text PRIMARY KEY NOT NULL,
	`member_id` text NOT NULL,
	`wechat_id` text NOT NULL,
	`game_id` text NOT NULL,
	`direction` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`rate_basis_points` integer NOT NULL,
	`delta_cents` integer NOT NULL,
	`old_balance_cents` integer NOT NULL,
	`new_balance_cents` integer NOT NULL,
	`created_at` integer NOT NULL,
	`deleted_at` integer,
	`guard` integer NOT NULL,
	CONSTRAINT "balance_adjustment_guard" CHECK("balance_adjustments"."guard" = 1)
);
--> statement-breakpoint
CREATE INDEX `idx_balance_adjustments_history` ON `balance_adjustments` (`deleted_at`,`created_at`,`id`);