CREATE TABLE `addresses` (
	`id` char(36) NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`row_version` bigint unsigned NOT NULL DEFAULT 0,
	`buyer_account_id` char(36) NOT NULL,
	`label` varchar(80) NOT NULL,
	`recipient_name` varchar(150) NOT NULL,
	`phone` varchar(32) NOT NULL,
	`street` text NOT NULL,
	`province` varchar(100) NOT NULL,
	`city` varchar(100) NOT NULL,
	`district` varchar(100) NOT NULL,
	`postal_code` varchar(10) NOT NULL,
	`area_id` varchar(100),
	`latitude` decimal(10,7),
	`longitude` decimal(10,7),
	`is_default` boolean NOT NULL DEFAULT false,
	`archived_at` datetime(3),
	`default_buyer_account_id` char(36) GENERATED ALWAYS AS (CASE WHEN is_default = 1 AND archived_at IS NULL THEN buyer_account_id ELSE NULL END) STORED,
	CONSTRAINT `addresses_id` PRIMARY KEY(`id`),
	CONSTRAINT `addresses_id_buyer_uq` UNIQUE(`id`,`buyer_account_id`),
	CONSTRAINT `addresses_default_uq` UNIQUE(`default_buyer_account_id`),
	CONSTRAINT `addresses_coordinates_ck` CHECK((`addresses`.`latitude` IS NULL AND `addresses`.`longitude` IS NULL) OR (`addresses`.`latitude` IS NOT NULL AND `addresses`.`longitude` IS NOT NULL AND `addresses`.`latitude` BETWEEN -90 AND 90 AND `addresses`.`longitude` BETWEEN -180 AND 180))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint
CREATE TABLE `admin_grants` (
	`id` char(36) NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`row_version` bigint unsigned NOT NULL DEFAULT 0,
	`user_id` char(36) NOT NULL,
	`role_code` varchar(32) NOT NULL,
	`revoked_at` datetime(3),
	`active_user_id` char(36) GENERATED ALWAYS AS (CASE WHEN revoked_at IS NULL THEN user_id ELSE NULL END) STORED,
	CONSTRAINT `admin_grants_id` PRIMARY KEY(`id`),
	CONSTRAINT `admin_grants_active_role_uq` UNIQUE(`active_user_id`,`role_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint
CREATE TABLE `audit_logs` (
	`id` char(36) NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`actor_id` char(36),
	`entity_type` varchar(100) NOT NULL,
	`entity_id` varchar(191) NOT NULL,
	`action` varchar(100) NOT NULL,
	`reason` text,
	`changes_redacted` json NOT NULL,
	`correlation_id` varchar(128) NOT NULL,
	CONSTRAINT `audit_logs_id` PRIMARY KEY(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint
CREATE TABLE `auth_tokens` (
	`id` char(36) NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`row_version` bigint unsigned NOT NULL DEFAULT 0,
	`user_id` char(36) NOT NULL,
	`purpose` varchar(24) NOT NULL,
	`token_hash` char(64) NOT NULL,
	`expires_at` datetime(3) NOT NULL,
	`consumed_at` datetime(3),
	`revoked_at` datetime(3),
	CONSTRAINT `auth_tokens_id` PRIMARY KEY(`id`),
	CONSTRAINT `auth_tokens_hash_uq` UNIQUE(`token_hash`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint
CREATE TABLE `buyer_accounts` (
	`id` char(36) NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`row_version` bigint unsigned NOT NULL DEFAULT 0,
	`manager_user_id` char(36) NOT NULL,
	`organization_id` char(36),
	`kind` varchar(24) NOT NULL,
	`status` varchar(20) NOT NULL DEFAULT 'ACTIVE',
	`individual_manager_id` char(36) GENERATED ALWAYS AS (CASE WHEN kind = 'INDIVIDUAL' THEN manager_user_id ELSE NULL END) STORED,
	CONSTRAINT `buyer_accounts_id` PRIMARY KEY(`id`),
	CONSTRAINT `buyer_accounts_organization_uq` UNIQUE(`organization_id`),
	CONSTRAINT `buyer_accounts_individual_uq` UNIQUE(`individual_manager_id`),
	CONSTRAINT `buyer_accounts_kind_ck` CHECK((`buyer_accounts`.`kind` = 'INDIVIDUAL' AND `buyer_accounts`.`organization_id` IS NULL) OR (`buyer_accounts`.`kind` = 'ORGANIZATION' AND `buyer_accounts`.`organization_id` IS NOT NULL))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint
CREATE TABLE `categories` (
	`id` char(36) NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`row_version` bigint unsigned NOT NULL DEFAULT 0,
	`parent_id` char(36),
	`slug` varchar(180) NOT NULL,
	`name` varchar(200) NOT NULL,
	`attribute_schema` json NOT NULL,
	`status` varchar(20) NOT NULL DEFAULT 'ACTIVE',
	CONSTRAINT `categories_id` PRIMARY KEY(`id`),
	CONSTRAINT `categories_slug_uq` UNIQUE(`slug`),
	CONSTRAINT `categories_not_self_ck` CHECK(`categories`.`parent_id` IS NULL OR `categories`.`parent_id` <> `categories`.`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint
CREATE TABLE `idempotency_keys` (
	`id` char(36) NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`row_version` bigint unsigned NOT NULL DEFAULT 0,
	`actor_id` char(36) NOT NULL,
	`operation` varchar(100) NOT NULL,
	`key` varchar(191) NOT NULL,
	`request_hash` char(64) NOT NULL,
	`state` varchar(20) NOT NULL DEFAULT 'IN_PROGRESS',
	`result_reference` json,
	`status_code` int,
	`response_body` json,
	`response_headers` json,
	`expires_at` datetime(3) NOT NULL,
	CONSTRAINT `idempotency_keys_id` PRIMARY KEY(`id`),
	CONSTRAINT `idempotency_keys_actor_operation_key_uq` UNIQUE(`actor_id`,`operation`,`key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint
CREATE TABLE `inventory_balances` (
	`id` char(36) NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`row_version` bigint unsigned NOT NULL DEFAULT 0,
	`sku_id` char(36) NOT NULL,
	`on_hand` int NOT NULL DEFAULT 0,
	`reserved` int NOT NULL DEFAULT 0,
	CONSTRAINT `inventory_balances_id` PRIMARY KEY(`id`),
	CONSTRAINT `inventory_balances_sku_uq` UNIQUE(`sku_id`),
	CONSTRAINT `inventory_balances_id_sku_uq` UNIQUE(`id`,`sku_id`),
	CONSTRAINT `inventory_balances_nonnegative_ck` CHECK(`inventory_balances`.`on_hand` >= 0 AND `inventory_balances`.`reserved` >= 0 AND `inventory_balances`.`reserved` <= `inventory_balances`.`on_hand`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint
CREATE TABLE `inventory_movements` (
	`id` char(36) NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`inventory_id` char(36) NOT NULL,
	`reservation_id` char(36),
	`on_hand_delta` int NOT NULL DEFAULT 0,
	`reserved_delta` int NOT NULL DEFAULT 0,
	`reason` varchar(200) NOT NULL,
	`event_key` varchar(191) NOT NULL,
	`actor_id` char(36),
	CONSTRAINT `inventory_movements_id` PRIMARY KEY(`id`),
	CONSTRAINT `inventory_movements_event_uq` UNIQUE(`event_key`),
	CONSTRAINT `inventory_movements_delta_ck` CHECK(`inventory_movements`.`on_hand_delta` <> 0 OR `inventory_movements`.`reserved_delta` <> 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint
CREATE TABLE `legal_entities` (
	`id` char(36) NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`row_version` bigint unsigned NOT NULL DEFAULT 0,
	`created_by` char(36) NOT NULL,
	`kind` varchar(24) NOT NULL,
	`legal_name` varchar(200) NOT NULL,
	`tax_identifier_ciphertext` text,
	`tax_identifier_fingerprint` char(64),
	`is_platform` boolean NOT NULL DEFAULT false,
	`status` varchar(24) NOT NULL DEFAULT 'PENDING',
	`platform_key` int GENERATED ALWAYS AS (CASE WHEN is_platform = 1 THEN 1 ELSE NULL END) STORED,
	CONSTRAINT `legal_entities_id` PRIMARY KEY(`id`),
	CONSTRAINT `legal_entities_tax_fingerprint_uq` UNIQUE(`tax_identifier_fingerprint`),
	CONSTRAINT `legal_entities_platform_uq` UNIQUE(`platform_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` char(36) NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`row_version` bigint unsigned NOT NULL DEFAULT 0,
	`user_id` char(36) NOT NULL,
	`business_event_key` varchar(191) NOT NULL,
	`kind` varchar(32) NOT NULL,
	`payload` json NOT NULL,
	`read_at` datetime(3),
	CONSTRAINT `notifications_id` PRIMARY KEY(`id`),
	CONSTRAINT `notifications_user_event_uq` UNIQUE(`user_id`,`business_event_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint
CREATE TABLE `organizations` (
	`id` char(36) NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`row_version` bigint unsigned NOT NULL DEFAULT 0,
	`name` varchar(200) NOT NULL,
	`kind` varchar(24) NOT NULL,
	`school_identifier` varchar(100),
	`contact_name` varchar(150) NOT NULL,
	`contact_phone` varchar(32) NOT NULL,
	`status` varchar(20) NOT NULL DEFAULT 'ACTIVE',
	CONSTRAINT `organizations_id` PRIMARY KEY(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint
CREATE TABLE `outbox_events` (
	`id` char(36) NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`row_version` bigint unsigned NOT NULL DEFAULT 0,
	`event_key` varchar(191) NOT NULL,
	`aggregate_type` varchar(100) NOT NULL,
	`aggregate_id` varchar(191) NOT NULL,
	`event_type` varchar(100) NOT NULL,
	`payload` json NOT NULL,
	`state` varchar(20) NOT NULL DEFAULT 'READY',
	`attempts` int unsigned NOT NULL DEFAULT 0,
	`available_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`locked_until` datetime(3),
	`last_error` text,
	CONSTRAINT `outbox_events_id` PRIMARY KEY(`id`),
	CONSTRAINT `outbox_events_event_uq` UNIQUE(`event_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint
CREATE TABLE `product_media` (
	`id` char(36) NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`row_version` bigint unsigned NOT NULL DEFAULT 0,
	`product_id` char(36) NOT NULL,
	`object_key` varchar(512) NOT NULL,
	`alt_text` varchar(300) NOT NULL,
	`sort_order` int unsigned NOT NULL,
	CONSTRAINT `product_media_id` PRIMARY KEY(`id`),
	CONSTRAINT `product_media_sort_uq` UNIQUE(`product_id`,`sort_order`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint
CREATE TABLE `products` (
	`id` char(36) NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`row_version` bigint unsigned NOT NULL DEFAULT 0,
	`store_id` char(36) NOT NULL,
	`category_id` char(36) NOT NULL,
	`tax_class_id` char(36) NOT NULL,
	`name` varchar(200) NOT NULL,
	`description` longtext NOT NULL,
	`attributes` json NOT NULL,
	`status` varchar(20) NOT NULL DEFAULT 'DRAFT',
	`slug` varchar(180) NOT NULL,
	CONSTRAINT `products_id` PRIMARY KEY(`id`),
	CONSTRAINT `products_store_slug_uq` UNIQUE(`store_id`,`slug`),
	CONSTRAINT `products_id_store_uq` UNIQUE(`id`,`store_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint
CREATE TABLE `skus` (
	`id` char(36) NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`row_version` bigint unsigned NOT NULL DEFAULT 0,
	`product_id` char(36) NOT NULL,
	`store_id` char(36) NOT NULL,
	`sku_code` varchar(100) NOT NULL,
	`variant_attributes` json NOT NULL,
	`unit_label` varchar(32) NOT NULL,
	`unit_price_gross` bigint unsigned NOT NULL,
	`weight_g` int unsigned NOT NULL,
	`length_cm` decimal(10,2) NOT NULL,
	`width_cm` decimal(10,2) NOT NULL,
	`height_cm` decimal(10,2) NOT NULL,
	`status` varchar(20) NOT NULL DEFAULT 'ACTIVE',
	CONSTRAINT `skus_id` PRIMARY KEY(`id`),
	CONSTRAINT `skus_store_code_uq` UNIQUE(`store_id`,`sku_code`),
	CONSTRAINT `skus_id_store_uq` UNIQUE(`id`,`store_id`),
	CONSTRAINT `skus_positive_price_ck` CHECK(`skus`.`unit_price_gross` > 0 AND `skus`.`unit_price_gross` <= 9007199254740991),
	CONSTRAINT `skus_dimensions_ck` CHECK(`skus`.`weight_g` > 0 AND `skus`.`length_cm` > 0 AND `skus`.`width_cm` > 0 AND `skus`.`height_cm` > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint
CREATE TABLE `store_members` (
	`id` char(36) NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`row_version` bigint unsigned NOT NULL DEFAULT 0,
	`store_id` char(36) NOT NULL,
	`user_id` char(36) NOT NULL,
	`role_code` varchar(24) NOT NULL,
	`revoked_at` datetime(3),
	`active_user_id` char(36) GENERATED ALWAYS AS (CASE WHEN revoked_at IS NULL THEN user_id ELSE NULL END) STORED,
	`owner_store_id` char(36) GENERATED ALWAYS AS (CASE WHEN role_code = 'OWNER' AND revoked_at IS NULL THEN store_id ELSE NULL END) STORED,
	CONSTRAINT `store_members_id` PRIMARY KEY(`id`),
	CONSTRAINT `store_members_active_user_uq` UNIQUE(`store_id`,`active_user_id`),
	CONSTRAINT `store_members_owner_uq` UNIQUE(`owner_store_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint
CREATE TABLE `store_origins` (
	`id` char(36) NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`row_version` bigint unsigned NOT NULL DEFAULT 0,
	`store_id` char(36) NOT NULL,
	`contact_name` varchar(150) NOT NULL,
	`phone` varchar(32) NOT NULL,
	`street` text NOT NULL,
	`postal_code` varchar(10) NOT NULL,
	`area_id` varchar(100),
	`latitude` decimal(10,7),
	`longitude` decimal(10,7),
	`active` boolean NOT NULL DEFAULT true,
	`active_store_id` char(36) GENERATED ALWAYS AS (CASE WHEN active = 1 THEN store_id ELSE NULL END) STORED,
	CONSTRAINT `store_origins_id` PRIMARY KEY(`id`),
	CONSTRAINT `store_origins_id_store_uq` UNIQUE(`id`,`store_id`),
	CONSTRAINT `store_origins_active_uq` UNIQUE(`active_store_id`),
	CONSTRAINT `store_origins_coordinates_ck` CHECK((`store_origins`.`latitude` IS NULL AND `store_origins`.`longitude` IS NULL) OR (`store_origins`.`latitude` IS NOT NULL AND `store_origins`.`longitude` IS NOT NULL AND `store_origins`.`latitude` BETWEEN -90 AND 90 AND `store_origins`.`longitude` BETWEEN -180 AND 180))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint
CREATE TABLE `stores` (
	`id` char(36) NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`row_version` bigint unsigned NOT NULL DEFAULT 0,
	`legal_entity_id` char(36) NOT NULL,
	`slug` varchar(180) NOT NULL,
	`name` varchar(200) NOT NULL,
	`contact_phone` varchar(32) NOT NULL,
	`status` varchar(24) NOT NULL DEFAULT 'DRAFT',
	`moderation_reason` text,
	`reviewed_by` char(36),
	`reviewed_at` datetime(3),
	CONSTRAINT `stores_id` PRIMARY KEY(`id`),
	CONSTRAINT `stores_slug_uq` UNIQUE(`slug`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint
CREATE TABLE `tax_classes` (
	`id` char(36) NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`row_version` bigint unsigned NOT NULL DEFAULT 0,
	`code` varchar(50) NOT NULL,
	`name` varchar(150) NOT NULL,
	`status` varchar(24) NOT NULL DEFAULT 'UNVERIFIED',
	CONSTRAINT `tax_classes_id` PRIMARY KEY(`id`),
	CONSTRAINT `tax_classes_code_uq` UNIQUE(`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint
CREATE TABLE `upload_intents` (
	`id` char(36) NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`row_version` bigint unsigned NOT NULL DEFAULT 0,
	`user_id` char(36) NOT NULL,
	`store_id` char(36) NOT NULL,
	`product_id` char(36) NOT NULL,
	`object_key` varchar(512) NOT NULL,
	`verified_object_key` varchar(512),
	`content_type` varchar(100) NOT NULL,
	`size_bytes` int unsigned NOT NULL,
	`checksum_sha256` char(64),
	`expires_at` datetime(3) NOT NULL,
	`confirmed_at` datetime(3),
	CONSTRAINT `upload_intents_id` PRIMARY KEY(`id`),
	CONSTRAINT `upload_intents_object_uq` UNIQUE(`object_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint
CREATE TABLE `users` (
	`id` char(36) NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`row_version` bigint unsigned NOT NULL DEFAULT 0,
	`email_normalized` varchar(254) NOT NULL,
	`password_hash` varchar(255) NOT NULL,
	`name` varchar(150) NOT NULL,
	`phone` varchar(32),
	`status` varchar(20) NOT NULL DEFAULT 'ACTIVE',
	`email_verified_at` datetime(3),
	CONSTRAINT `users_id` PRIMARY KEY(`id`),
	CONSTRAINT `users_email_uq` UNIQUE(`email_normalized`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint
ALTER TABLE `addresses` ADD CONSTRAINT `addresses_buyer_account_id_buyer_accounts_id_fk` FOREIGN KEY (`buyer_account_id`) REFERENCES `buyer_accounts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `admin_grants` ADD CONSTRAINT `admin_grants_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `audit_logs` ADD CONSTRAINT `audit_logs_actor_id_users_id_fk` FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `auth_tokens` ADD CONSTRAINT `auth_tokens_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `buyer_accounts` ADD CONSTRAINT `buyer_accounts_manager_user_id_users_id_fk` FOREIGN KEY (`manager_user_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `buyer_accounts` ADD CONSTRAINT `buyer_accounts_organization_id_organizations_id_fk` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `categories` ADD CONSTRAINT `categories_parent_id_categories_id_fk` FOREIGN KEY (`parent_id`) REFERENCES `categories`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `idempotency_keys` ADD CONSTRAINT `idempotency_keys_actor_id_users_id_fk` FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `inventory_balances` ADD CONSTRAINT `inventory_balances_sku_id_skus_id_fk` FOREIGN KEY (`sku_id`) REFERENCES `skus`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `inventory_movements` ADD CONSTRAINT `inventory_movements_inventory_id_inventory_balances_id_fk` FOREIGN KEY (`inventory_id`) REFERENCES `inventory_balances`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `inventory_movements` ADD CONSTRAINT `inventory_movements_actor_id_users_id_fk` FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `legal_entities` ADD CONSTRAINT `legal_entities_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `notifications` ADD CONSTRAINT `notifications_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `product_media` ADD CONSTRAINT `product_media_product_id_products_id_fk` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `products` ADD CONSTRAINT `products_store_id_stores_id_fk` FOREIGN KEY (`store_id`) REFERENCES `stores`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `products` ADD CONSTRAINT `products_category_id_categories_id_fk` FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `products` ADD CONSTRAINT `products_tax_class_id_tax_classes_id_fk` FOREIGN KEY (`tax_class_id`) REFERENCES `tax_classes`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `skus` ADD CONSTRAINT `skus_store_id_stores_id_fk` FOREIGN KEY (`store_id`) REFERENCES `stores`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `skus` ADD CONSTRAINT `skus_product_store_fk` FOREIGN KEY (`product_id`,`store_id`) REFERENCES `products`(`id`,`store_id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `store_members` ADD CONSTRAINT `store_members_store_id_stores_id_fk` FOREIGN KEY (`store_id`) REFERENCES `stores`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `store_members` ADD CONSTRAINT `store_members_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `store_origins` ADD CONSTRAINT `store_origins_store_id_stores_id_fk` FOREIGN KEY (`store_id`) REFERENCES `stores`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `stores` ADD CONSTRAINT `stores_legal_entity_id_legal_entities_id_fk` FOREIGN KEY (`legal_entity_id`) REFERENCES `legal_entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `stores` ADD CONSTRAINT `stores_reviewed_by_users_id_fk` FOREIGN KEY (`reviewed_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `upload_intents` ADD CONSTRAINT `upload_intents_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `upload_intents` ADD CONSTRAINT `upload_intents_store_id_stores_id_fk` FOREIGN KEY (`store_id`) REFERENCES `stores`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `upload_intents` ADD CONSTRAINT `upload_intents_product_id_products_id_fk` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `addresses_buyer_idx` ON `addresses` (`buyer_account_id`);--> statement-breakpoint
CREATE INDEX `audit_logs_entity_created_idx` ON `audit_logs` (`entity_type`,`entity_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `audit_logs_actor_created_idx` ON `audit_logs` (`actor_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `auth_tokens_user_purpose_idx` ON `auth_tokens` (`user_id`,`purpose`);--> statement-breakpoint
CREATE INDEX `auth_tokens_expiry_idx` ON `auth_tokens` (`expires_at`);--> statement-breakpoint
CREATE INDEX `buyer_accounts_manager_idx` ON `buyer_accounts` (`manager_user_id`);--> statement-breakpoint
CREATE INDEX `categories_parent_idx` ON `categories` (`parent_id`);--> statement-breakpoint
CREATE INDEX `idempotency_keys_expiry_idx` ON `idempotency_keys` (`expires_at`);--> statement-breakpoint
CREATE INDEX `inventory_movements_balance_created_idx` ON `inventory_movements` (`inventory_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `legal_entities_creator_idx` ON `legal_entities` (`created_by`);--> statement-breakpoint
CREATE INDEX `notifications_user_read_created_idx` ON `notifications` (`user_id`,`read_at`,`created_at`);--> statement-breakpoint
CREATE INDEX `organizations_name_idx` ON `organizations` (`name`);--> statement-breakpoint
CREATE INDEX `outbox_events_schedule_idx` ON `outbox_events` (`state`,`available_at`);--> statement-breakpoint
CREATE INDEX `outbox_events_lease_idx` ON `outbox_events` (`state`,`locked_until`);--> statement-breakpoint
CREATE INDEX `products_category_status_idx` ON `products` (`category_id`,`status`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `products_status_created_idx` ON `products` (`status`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `products_store_status_idx` ON `products` (`store_id`,`status`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `skus_price_idx` ON `skus` (`unit_price_gross`);--> statement-breakpoint
CREATE INDEX `store_members_user_idx` ON `store_members` (`user_id`,`revoked_at`);--> statement-breakpoint
CREATE INDEX `stores_legal_entity_idx` ON `stores` (`legal_entity_id`);--> statement-breakpoint
CREATE INDEX `stores_status_created_idx` ON `stores` (`status`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `upload_intents_expiry_idx` ON `upload_intents` (`expires_at`);--> statement-breakpoint
CREATE INDEX `upload_intents_owner_idx` ON `upload_intents` (`user_id`,`store_id`);
--> statement-breakpoint
CREATE FULLTEXT INDEX `products_search_idx` ON `products` (`name`, `description`);
