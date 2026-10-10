CREATE TABLE `checkout_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`operation_id` text NOT NULL,
	`member_id` text NOT NULL,
	`charge_cents` integer NOT NULL,
	`old_balance_cents` integer NOT NULL,
	`new_balance_cents` integer NOT NULL,
	`guard` integer NOT NULL,
	CONSTRAINT "checkout_line_guard" CHECK("checkout_lines"."guard" = 1)
);
--> statement-breakpoint
CREATE TABLE `checkout_operations` (
	`id` text PRIMARY KEY NOT NULL,
	`fingerprint` text NOT NULL,
	`result_json` text NOT NULL,
	`created_at` integer NOT NULL
);
