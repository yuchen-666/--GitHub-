CREATE TABLE `auth_admins` (
	`id` text PRIMARY KEY NOT NULL,
	`account` text NOT NULL,
	`password_salt` text NOT NULL,
	`password_hash` text NOT NULL,
	`role` text NOT NULL,
	`created_at` integer NOT NULL,
	`created_by` text NOT NULL,
	`disabled_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_auth_admins_account` ON `auth_admins` (`account`);--> statement-breakpoint
CREATE TABLE `auth_devices` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`token_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	`created_by` text NOT NULL,
	`revoked_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_auth_devices_token_hash` ON `auth_devices` (`token_hash`);--> statement-breakpoint
CREATE TABLE `auth_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`admin_id` text NOT NULL,
	`device_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_auth_sessions_token_hash` ON `auth_sessions` (`token_hash`);--> statement-breakpoint
CREATE INDEX `idx_auth_sessions_expiry` ON `auth_sessions` (`expires_at`);--> statement-breakpoint
CREATE TABLE `device_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`request_token_hash` text NOT NULL,
	`requested_name` text NOT NULL,
	`status` text NOT NULL,
	`approved_device_id` text,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`consumed_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_device_requests_code` ON `device_requests` (`code`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_device_requests_token` ON `device_requests` (`request_token_hash`);--> statement-breakpoint
CREATE INDEX `idx_device_requests_status_expiry` ON `device_requests` (`status`,`expires_at`);