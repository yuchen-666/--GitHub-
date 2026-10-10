ALTER TABLE `checkout_operations` ADD `deleted_at` integer;--> statement-breakpoint
CREATE INDEX `idx_checkout_operations_history` ON `checkout_operations` (`deleted_at`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `idx_checkout_lines_operation_id` ON `checkout_lines` (`operation_id`);