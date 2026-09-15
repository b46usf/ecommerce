CREATE TABLE `bank_accounts` (
	`id` char(36) NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`row_version` bigint unsigned NOT NULL DEFAULT 0,
	`legal_entity_id` char(36) NOT NULL,
	`bank_code` varchar(50) NOT NULL,
	`account_name` varchar(200) NOT NULL,
	`account_number_ciphertext` text NOT NULL,
	`account_fingerprint` char(64) NOT NULL,
	`status` varchar(32) NOT NULL DEFAULT 'PENDING',
	`verified_by` char(36),
	`verified_at` datetime(3),
	CONSTRAINT `bank_accounts_id` PRIMARY KEY(`id`),
	CONSTRAINT `bank_accounts_identity_uq` UNIQUE(`legal_entity_id`,`bank_code`,`account_fingerprint`),
	CONSTRAINT `bank_accounts_status_ck` CHECK(`status` IN ('PENDING', 'VERIFIED', 'DISABLED'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint
CREATE TABLE `cart_items` (
	`id` char(36) NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`row_version` bigint unsigned NOT NULL DEFAULT 0,
	`cart_id` char(36) NOT NULL,
	`sku_id` char(36) NOT NULL,
	`quote_line_id` char(36),
	`quantity` int NOT NULL,
	`catalog_sku_id` char(36) GENERATED ALWAYS AS (CASE WHEN quote_line_id IS NULL THEN sku_id ELSE NULL END) STORED,
	CONSTRAINT `cart_items_id` PRIMARY KEY(`id`),
	CONSTRAINT `cart_items_catalog_uq` UNIQUE(`cart_id`,`catalog_sku_id`),
	CONSTRAINT `cart_items_quote_uq` UNIQUE(`cart_id`,`quote_line_id`),
	CONSTRAINT `cart_items_quantity_ck` CHECK(quantity > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint
CREATE TABLE `carts` (
	`id` char(36) NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`row_version` bigint unsigned NOT NULL DEFAULT 0,
	`buyer_account_id` char(36) NOT NULL,
	CONSTRAINT `carts_id` PRIMARY KEY(`id`),
	CONSTRAINT `carts_buyer_uq` UNIQUE(`buyer_account_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint
CREATE TABLE `checkout_groups` (
	`id` char(36) NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`row_version` bigint unsigned NOT NULL DEFAULT 0,
	`buyer_account_id` char(36) NOT NULL,
	`created_by` char(36) NOT NULL,
	`order_number` varchar(100) NOT NULL,
	`currency` char(3) NOT NULL DEFAULT 'IDR',
	`recipient_snapshot` json NOT NULL,
	`items_gross` bigint unsigned NOT NULL,
	`shipping_total` bigint unsigned NOT NULL,
	`buyer_fee_total` bigint unsigned NOT NULL,
	`platform_discount` bigint unsigned NOT NULL,
	`grand_total` bigint unsigned NOT NULL,
	`order_state` varchar(32) NOT NULL DEFAULT 'AWAITING_PAYMENT',
	`reservation_expires_at` datetime(3) NOT NULL,
	`pricing_snapshot` json NOT NULL,
	CONSTRAINT `checkout_groups_id` PRIMARY KEY(`id`),
	CONSTRAINT `checkout_groups_order_number_uq` UNIQUE(`order_number`),
	CONSTRAINT `checkout_groups_currency_ck` CHECK(`currency` IN ('IDR')),
	CONSTRAINT `checkout_groups_order_state_ck` CHECK(`order_state` IN ('AWAITING_PAYMENT', 'ACTIVE', 'CANCEL_REQUESTED', 'CANCELLED', 'EXPIRED', 'REVIEW', 'COMPLETED')),
	CONSTRAINT `checkout_groups_money_ck` CHECK(`items_gross` BETWEEN 0 AND 9007199254740991 AND `shipping_total` BETWEEN 0 AND 9007199254740991 AND `buyer_fee_total` BETWEEN 0 AND 9007199254740991 AND `platform_discount` BETWEEN 0 AND 9007199254740991 AND `grand_total` BETWEEN 0 AND 9007199254740991),
	CONSTRAINT `checkout_groups_total_ck` CHECK(grand_total > 0 AND grand_total + platform_discount = items_gross + shipping_total + buyer_fee_total)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint
CREATE TABLE `documents` (
	`id` char(36) NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`row_version` bigint unsigned NOT NULL DEFAULT 0,
	`legal_entity_id` char(36),
	`vendor_order_id` char(36),
	`uploaded_by` char(36) NOT NULL,
	`document_type` varchar(32) NOT NULL,
	`object_key` varchar(512) NOT NULL,
	`sha256` char(64) NOT NULL,
	`mime_type` varchar(100) NOT NULL,
	`valid_from` date,
	`valid_until` date,
	`verification_status` varchar(32) NOT NULL DEFAULT 'PENDING',
	`verified_by` char(36),
	`metadata` json NOT NULL,
	CONSTRAINT `documents_id` PRIMARY KEY(`id`),
	CONSTRAINT `documents_document_type_ck` CHECK(`document_type` IN ('NPWP', 'PKP', 'SKB', 'TURNOVER_STATEMENT', 'INVOICE', 'TAX_INVOICE', 'PAYOUT_PROOF', 'REFUND_PROOF', 'OTHER')),
	CONSTRAINT `documents_verification_status_ck` CHECK(`verification_status` IN ('PENDING', 'VERIFIED', 'REJECTED')),
	CONSTRAINT `documents_period_ck` CHECK(valid_from IS NULL OR valid_until IS NULL OR valid_until >= valid_from)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint
CREATE TABLE `fee_policies` (
	`id` char(36) NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`row_version` bigint unsigned NOT NULL DEFAULT 0,
	`category_id` char(36),
	`policy_key` varchar(191) NOT NULL,
	`commission_rate` decimal(12,8) NOT NULL,
	`buyer_fee_amount` bigint unsigned NOT NULL DEFAULT 0,
	`valid_from` datetime(3) NOT NULL,
	`valid_until` datetime(3),
	`status` varchar(32) NOT NULL DEFAULT 'DRAFT',
	CONSTRAINT `fee_policies_id` PRIMARY KEY(`id`),
	CONSTRAINT `fee_policies_key_period_uq` UNIQUE(`policy_key`,`valid_from`),
	CONSTRAINT `fee_policies_status_ck` CHECK(`status` IN ('DRAFT', 'ACTIVE', 'RETIRED')),
	CONSTRAINT `fee_policies_rate_ck` CHECK(commission_rate BETWEEN 0 AND 1),
	CONSTRAINT `fee_policies_period_ck` CHECK(valid_until IS NULL OR valid_until > valid_from),
	CONSTRAINT `fee_policies_money_ck` CHECK(`buyer_fee_amount` BETWEEN 0 AND 9007199254740991)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint
CREATE TABLE `journal_entries` (
	`id` char(36) NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`row_version` bigint unsigned NOT NULL DEFAULT 0,
	`event_key` varchar(191) NOT NULL,
	`status` varchar(32) NOT NULL DEFAULT 'DRAFT',
	`payment_receipt_id` char(36),
	`refund_id` char(36),
	`payout_id` char(36),
	`reversal_of_id` char(36),
	`posted_at` datetime(3),
	`description` text NOT NULL,
	CONSTRAINT `journal_entries_id` PRIMARY KEY(`id`),
	CONSTRAINT `journal_entries_event_uq` UNIQUE(`event_key`),
	CONSTRAINT `journal_entries_reversal_uq` UNIQUE(`reversal_of_id`),
	CONSTRAINT `journal_entries_status_ck` CHECK(`status` IN ('DRAFT', 'POSTED')),
	CONSTRAINT `journal_entries_posted_at_ck` CHECK((status = 'DRAFT' AND posted_at IS NULL) OR (status = 'POSTED' AND posted_at IS NOT NULL)),
	CONSTRAINT `journal_entries_not_self_ck` CHECK(reversal_of_id IS NULL OR reversal_of_id <> id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint
CREATE TABLE `journal_lines` (
	`id` char(36) NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`row_version` bigint unsigned NOT NULL DEFAULT 0,
	`journal_entry_id` char(36) NOT NULL,
	`ledger_account_id` char(36) NOT NULL,
	`vendor_order_id` char(36),
	`debit` bigint unsigned NOT NULL DEFAULT 0,
	`credit` bigint unsigned NOT NULL DEFAULT 0,
	`line_no` int NOT NULL,
	CONSTRAINT `journal_lines_id` PRIMARY KEY(`id`),
	CONSTRAINT `journal_lines_entry_line_uq` UNIQUE(`journal_entry_id`,`line_no`),
	CONSTRAINT `journal_lines_money_ck` CHECK(`debit` BETWEEN 0 AND 9007199254740991 AND `credit` BETWEEN 0 AND 9007199254740991),
	CONSTRAINT `journal_lines_sided_ck` CHECK(line_no > 0 AND ((debit > 0 AND credit = 0) OR (credit > 0 AND debit = 0)))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint
CREATE TABLE `ledger_accounts` (
	`id` char(36) NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`row_version` bigint unsigned NOT NULL DEFAULT 0,
	`code` varchar(100) NOT NULL,
	`store_id` char(36),
	`kind` varchar(32) NOT NULL,
	`currency` char(3) NOT NULL DEFAULT 'IDR',
	`name` varchar(200) NOT NULL,
	CONSTRAINT `ledger_accounts_id` PRIMARY KEY(`id`),
	CONSTRAINT `ledger_accounts_code_uq` UNIQUE(`code`),
	CONSTRAINT `ledger_accounts_kind_ck` CHECK(`kind` IN ('ASSET', 'LIABILITY', 'INCOME', 'EXPENSE', 'EQUITY')),
	CONSTRAINT `ledger_accounts_currency_ck` CHECK(`currency` IN ('IDR'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint
CREATE TABLE `order_cases` (
	`id` char(36) NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`row_version` bigint unsigned NOT NULL DEFAULT 0,
	`vendor_order_id` char(36) NOT NULL,
	`opened_by` char(36) NOT NULL,
	`kind` varchar(32) NOT NULL,
	`state` varchar(32) NOT NULL DEFAULT 'OPEN',
	`reason` text,
	`resolution` text,
	`resolved_by` char(36),
	`resolved_at` datetime(3),
	CONSTRAINT `order_cases_id` PRIMARY KEY(`id`),
	CONSTRAINT `order_cases_kind_ck` CHECK(`kind` IN ('DISPUTE', 'DELIVERY_FAILURE', 'TAX_REVIEW', 'OTHER')),
	CONSTRAINT `order_cases_state_ck` CHECK(`state` IN ('OPEN', 'RESOLVED', 'REJECTED'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint
CREATE TABLE `order_items` (
	`id` char(36) NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`row_version` bigint unsigned NOT NULL DEFAULT 0,
	`vendor_order_id` char(36) NOT NULL,
	`store_id` char(36) NOT NULL,
	`sku_id` char(36) NOT NULL,
	`quote_line_id` char(36),
	`quantity` int NOT NULL,
	`unit_price_gross` bigint unsigned NOT NULL,
	`line_net` bigint unsigned NOT NULL,
	`line_vat` bigint unsigned NOT NULL,
	`line_gross` bigint unsigned NOT NULL,
	`vendor_discount` bigint unsigned NOT NULL,
	`commission_amount` bigint unsigned NOT NULL,
	`commission_vat` bigint unsigned NOT NULL,
	`seller_withholding` bigint unsigned NOT NULL,
	`product_snapshot` json NOT NULL,
	`tax_snapshot` json NOT NULL,
	`fee_snapshot` json NOT NULL,
	CONSTRAINT `order_items_id` PRIMARY KEY(`id`),
	CONSTRAINT `order_items_id_order_uq` UNIQUE(`id`,`vendor_order_id`),
	CONSTRAINT `order_items_id_sku_uq` UNIQUE(`id`,`sku_id`),
	CONSTRAINT `order_items_money_ck` CHECK(`unit_price_gross` BETWEEN 0 AND 9007199254740991 AND `line_net` BETWEEN 0 AND 9007199254740991 AND `line_vat` BETWEEN 0 AND 9007199254740991 AND `line_gross` BETWEEN 0 AND 9007199254740991 AND `vendor_discount` BETWEEN 0 AND 9007199254740991 AND `commission_amount` BETWEEN 0 AND 9007199254740991 AND `commission_vat` BETWEEN 0 AND 9007199254740991 AND `seller_withholding` BETWEEN 0 AND 9007199254740991),
	CONSTRAINT `order_items_total_ck` CHECK(quantity > 0 AND line_gross = line_net + line_vat AND line_gross + vendor_discount = CAST(quantity AS DECIMAL(19,0)) * unit_price_gross AND (quote_line_id IS NULL OR vendor_discount = 0))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint
CREATE TABLE `payment_allocations` (
	`id` char(36) NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`payment_receipt_id` char(36) NOT NULL,
	`checkout_group_id` char(36) NOT NULL,
	`vendor_order_id` char(36) NOT NULL,
	`amount` bigint unsigned NOT NULL,
	CONSTRAINT `payment_allocations_id` PRIMARY KEY(`id`),
	CONSTRAINT `payment_allocations_receipt_order_uq` UNIQUE(`payment_receipt_id`,`vendor_order_id`),
	CONSTRAINT `payment_allocations_money_ck` CHECK(`amount` BETWEEN 0 AND 9007199254740991),
	CONSTRAINT `payment_allocations_positive_ck` CHECK(amount > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint
CREATE TABLE `payment_attempts` (
	`id` char(36) NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`row_version` bigint unsigned NOT NULL DEFAULT 0,
	`checkout_group_id` char(36) NOT NULL,
	`provider_account_id` char(36) NOT NULL,
	`provider_order_id` varchar(191) NOT NULL,
	`provider_transaction_id` varchar(191),
	`expected_amount` bigint unsigned NOT NULL,
	`currency` char(3) NOT NULL DEFAULT 'IDR',
	`channel` varchar(64),
	`state` varchar(32) NOT NULL DEFAULT 'CREATING',
	`provider_status` varchar(100),
	`expires_at` datetime(3),
	`terminal_verified_at` datetime(3),
	`session_secret_ciphertext` text,
	`open_checkout_group_id` char(36) GENERATED ALWAYS AS (CASE WHEN terminal_verified_at IS NULL THEN checkout_group_id ELSE NULL END) STORED,
	CONSTRAINT `payment_attempts_id` PRIMARY KEY(`id`),
	CONSTRAINT `payment_attempts_provider_order_uq` UNIQUE(`provider_account_id`,`provider_order_id`),
	CONSTRAINT `payment_attempts_provider_transaction_uq` UNIQUE(`provider_account_id`,`provider_transaction_id`),
	CONSTRAINT `payment_attempts_open_group_uq` UNIQUE(`open_checkout_group_id`),
	CONSTRAINT `payment_attempts_identity_uq` UNIQUE(`id`,`checkout_group_id`,`provider_account_id`),
	CONSTRAINT `payment_attempts_currency_ck` CHECK(`currency` IN ('IDR')),
	CONSTRAINT `payment_attempts_state_ck` CHECK(`state` IN ('CREATING', 'PENDING', 'CANCEL_REQUESTED', 'UNKNOWN', 'TERMINAL')),
	CONSTRAINT `payment_attempts_money_ck` CHECK(`expected_amount` BETWEEN 0 AND 9007199254740991),
	CONSTRAINT `payment_attempts_positive_ck` CHECK(expected_amount > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint
CREATE TABLE `payment_events` (
	`id` char(36) NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`row_version` bigint unsigned NOT NULL DEFAULT 0,
	`provider_account_id` char(36) NOT NULL,
	`payment_attempt_id` char(36),
	`dedupe_key` varchar(191) NOT NULL,
	`source` varchar(32) NOT NULL,
	`payload_reference` varchar(512) NOT NULL,
	`verification_status` varchar(32) NOT NULL DEFAULT 'UNVERIFIED',
	`processing_status` varchar(32) NOT NULL DEFAULT 'RECEIVED',
	`last_error` text,
	`processed_at` datetime(3),
	CONSTRAINT `payment_events_id` PRIMARY KEY(`id`),
	CONSTRAINT `payment_events_dedupe_uq` UNIQUE(`provider_account_id`,`dedupe_key`),
	CONSTRAINT `payment_events_source_ck` CHECK(`source` IN ('WEBHOOK', 'POLL', 'RECONCILIATION')),
	CONSTRAINT `payment_events_verification_status_ck` CHECK(`verification_status` IN ('UNVERIFIED', 'VERIFIED', 'REJECTED')),
	CONSTRAINT `payment_events_processing_status_ck` CHECK(`processing_status` IN ('RECEIVED', 'PROCESSING', 'DONE', 'ERROR'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint
CREATE TABLE `payment_receipts` (
	`id` char(36) NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`row_version` bigint unsigned NOT NULL DEFAULT 0,
	`payment_attempt_id` char(36) NOT NULL,
	`checkout_group_id` char(36) NOT NULL,
	`provider_account_id` char(36) NOT NULL,
	`provider_transaction_id` varchar(191) NOT NULL,
	`amount` bigint unsigned NOT NULL,
	`received_at` datetime(3) NOT NULL,
	`application_status` varchar(32) NOT NULL DEFAULT 'UNAPPLIED',
	`fee_actual` bigint unsigned,
	`fee_tax_actual` bigint unsigned,
	`provider_funds_available_at` datetime(3),
	`applied_checkout_group_id` char(36) GENERATED ALWAYS AS (CASE WHEN application_status = 'APPLIED' THEN checkout_group_id ELSE NULL END) STORED,
	CONSTRAINT `payment_receipts_id` PRIMARY KEY(`id`),
	CONSTRAINT `payment_receipts_attempt_uq` UNIQUE(`payment_attempt_id`),
	CONSTRAINT `payment_receipts_provider_transaction_uq` UNIQUE(`provider_account_id`,`provider_transaction_id`),
	CONSTRAINT `payment_receipts_id_group_uq` UNIQUE(`id`,`checkout_group_id`),
	CONSTRAINT `payment_receipts_applied_group_uq` UNIQUE(`applied_checkout_group_id`),
	CONSTRAINT `payment_receipts_application_status_ck` CHECK(`application_status` IN ('UNAPPLIED', 'APPLIED', 'EXCESS_REVIEW')),
	CONSTRAINT `payment_receipts_money_ck` CHECK(`amount` BETWEEN 0 AND 9007199254740991 AND `fee_actual` BETWEEN 0 AND 9007199254740991 AND `fee_tax_actual` BETWEEN 0 AND 9007199254740991),
	CONSTRAINT `payment_receipts_positive_ck` CHECK(amount > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint
CREATE TABLE `payout_lines` (
	`id` char(36) NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`row_version` bigint unsigned NOT NULL DEFAULT 0,
	`payout_id` char(36) NOT NULL,
	`vendor_payable_id` char(36) NOT NULL,
	`amount` bigint unsigned NOT NULL,
	CONSTRAINT `payout_lines_id` PRIMARY KEY(`id`),
	CONSTRAINT `payout_lines_payout_payable_uq` UNIQUE(`payout_id`,`vendor_payable_id`),
	CONSTRAINT `payout_lines_money_ck` CHECK(`amount` BETWEEN 0 AND 9007199254740991),
	CONSTRAINT `payout_lines_positive_ck` CHECK(amount > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint
CREATE TABLE `payouts` (
	`id` char(36) NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`row_version` bigint unsigned NOT NULL DEFAULT 0,
	`store_id` char(36) NOT NULL,
	`bank_account_id` char(36) NOT NULL,
	`reference` varchar(191) NOT NULL,
	`amount` bigint unsigned NOT NULL,
	`state` varchar(32) NOT NULL DEFAULT 'DRAFT',
	`requested_by` char(36),
	`approved_by` char(36),
	`beneficiary_snapshot` json NOT NULL,
	`transfer_reference` varchar(191),
	`proof_document_id` char(36),
	`paid_at` datetime(3),
	CONSTRAINT `payouts_id` PRIMARY KEY(`id`),
	CONSTRAINT `payouts_reference_uq` UNIQUE(`reference`),
	CONSTRAINT `payouts_state_ck` CHECK(`state` IN ('DRAFT', 'APPROVED', 'PROCESSING', 'UNKNOWN', 'PAID', 'FAILED', 'REJECTED')),
	CONSTRAINT `payouts_money_ck` CHECK(`amount` BETWEEN 0 AND 9007199254740991),
	CONSTRAINT `payouts_positive_ck` CHECK(amount > 0),
	CONSTRAINT `payouts_maker_checker_ck` CHECK(approved_by IS NULL OR (requested_by IS NOT NULL AND requested_by <> approved_by))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint
CREATE TABLE `provider_accounts` (
	`id` char(36) NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`row_version` bigint unsigned NOT NULL DEFAULT 0,
	`provider` varchar(32) NOT NULL,
	`environment` varchar(32) NOT NULL,
	`merchant_reference` varchar(191) NOT NULL,
	`secret_reference` varchar(512) NOT NULL,
	`status` varchar(32) NOT NULL DEFAULT 'ACTIVE',
	`capabilities` json NOT NULL,
	CONSTRAINT `provider_accounts_id` PRIMARY KEY(`id`),
	CONSTRAINT `provider_accounts_identity_uq` UNIQUE(`provider`,`environment`,`merchant_reference`),
	CONSTRAINT `provider_accounts_provider_ck` CHECK(`provider` IN ('MIDTRANS', 'BITESHIP')),
	CONSTRAINT `provider_accounts_environment_ck` CHECK(`environment` IN ('SANDBOX', 'PRODUCTION')),
	CONSTRAINT `provider_accounts_status_ck` CHECK(`status` IN ('ACTIVE', 'DISABLED'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint
CREATE TABLE `quote_lines` (
	`id` char(36) NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`row_version` bigint unsigned NOT NULL DEFAULT 0,
	`quote_version_id` char(36) NOT NULL,
	`sku_id` char(36) NOT NULL,
	`quantity` int NOT NULL,
	`unit_price_gross` bigint unsigned NOT NULL,
	`item_snapshot` json NOT NULL,
	CONSTRAINT `quote_lines_id` PRIMARY KEY(`id`),
	CONSTRAINT `quote_lines_version_sku_uq` UNIQUE(`quote_version_id`,`sku_id`),
	CONSTRAINT `quote_lines_id_sku_uq` UNIQUE(`id`,`sku_id`),
	CONSTRAINT `quote_lines_positive_ck` CHECK(quantity > 0 AND unit_price_gross > 0),
	CONSTRAINT `quote_lines_money_ck` CHECK(`unit_price_gross` BETWEEN 0 AND 9007199254740991)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint
CREATE TABLE `quote_redemptions` (
	`id` char(36) NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`quote_version_id` char(36) NOT NULL,
	`vendor_order_id` char(36) NOT NULL,
	CONSTRAINT `quote_redemptions_id` PRIMARY KEY(`id`),
	CONSTRAINT `quote_redemptions_version_uq` UNIQUE(`quote_version_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint
CREATE TABLE `quote_request_lines` (
	`id` char(36) NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`row_version` bigint unsigned NOT NULL DEFAULT 0,
	`quote_request_id` char(36) NOT NULL,
	`store_id` char(36) NOT NULL,
	`sku_id` char(36) NOT NULL,
	`quantity` int NOT NULL,
	`product_snapshot` json NOT NULL,
	CONSTRAINT `quote_request_lines_id` PRIMARY KEY(`id`),
	CONSTRAINT `quote_request_lines_sku_uq` UNIQUE(`quote_request_id`,`sku_id`),
	CONSTRAINT `quote_request_lines_quantity_ck` CHECK(quantity > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint
CREATE TABLE `quote_requests` (
	`id` char(36) NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`row_version` bigint unsigned NOT NULL DEFAULT 0,
	`buyer_account_id` char(36) NOT NULL,
	`store_id` char(36) NOT NULL,
	`requested_by` char(36) NOT NULL,
	`address_snapshot` json NOT NULL,
	`notes` text,
	`status` varchar(32) NOT NULL DEFAULT 'SUBMITTED',
	CONSTRAINT `quote_requests_id` PRIMARY KEY(`id`),
	CONSTRAINT `quote_requests_id_store_uq` UNIQUE(`id`,`store_id`),
	CONSTRAINT `quote_requests_status_ck` CHECK(`status` IN ('SUBMITTED', 'OFFERED', 'REJECTED', 'CLOSED'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint
CREATE TABLE `quote_versions` (
	`id` char(36) NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`row_version` bigint unsigned NOT NULL DEFAULT 0,
	`quote_request_id` char(36) NOT NULL,
	`version_no` int NOT NULL,
	`status` varchar(32) NOT NULL DEFAULT 'OFFERED',
	`expires_at` datetime(3) NOT NULL,
	`accepted_by` char(36),
	`accepted_at` datetime(3),
	`active_request_id` char(36) GENERATED ALWAYS AS (CASE WHEN status IN ('OFFERED', 'ACCEPTED') THEN quote_request_id ELSE NULL END) STORED,
	CONSTRAINT `quote_versions_id` PRIMARY KEY(`id`),
	CONSTRAINT `quote_versions_request_version_uq` UNIQUE(`quote_request_id`,`version_no`),
	CONSTRAINT `quote_versions_active_uq` UNIQUE(`active_request_id`),
	CONSTRAINT `quote_versions_status_ck` CHECK(`status` IN ('OFFERED', 'SUPERSEDED', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'CONSUMED')),
	CONSTRAINT `quote_versions_number_ck` CHECK(version_no > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint
CREATE TABLE `reconciliation_items` (
	`id` char(36) NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`row_version` bigint unsigned NOT NULL DEFAULT 0,
	`run_id` char(36) NOT NULL,
	`payment_attempt_id` char(36),
	`external_reference` varchar(191) NOT NULL,
	`expected_amount` bigint unsigned,
	`actual_amount` bigint unsigned,
	`kind` varchar(32) NOT NULL,
	`state` varchar(32) NOT NULL DEFAULT 'OPEN',
	`resolution_journal_id` char(36),
	CONSTRAINT `reconciliation_items_id` PRIMARY KEY(`id`),
	CONSTRAINT `reconciliation_items_identity_uq` UNIQUE(`run_id`,`external_reference`,`kind`),
	CONSTRAINT `reconciliation_items_kind_ck` CHECK(`kind` IN ('MISSING_LOCAL', 'MISSING_PROVIDER', 'AMOUNT', 'FEE', 'STATUS')),
	CONSTRAINT `reconciliation_items_state_ck` CHECK(`state` IN ('OPEN', 'RESOLVED')),
	CONSTRAINT `reconciliation_items_money_ck` CHECK(`expected_amount` BETWEEN 0 AND 9007199254740991 AND `actual_amount` BETWEEN 0 AND 9007199254740991)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint
CREATE TABLE `reconciliation_runs` (
	`id` char(36) NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`row_version` bigint unsigned NOT NULL DEFAULT 0,
	`provider_account_id` char(36) NOT NULL,
	`period_start` datetime(3) NOT NULL,
	`period_end` datetime(3) NOT NULL,
	`state` varchar(32) NOT NULL DEFAULT 'RUNNING',
	`source_document_id` char(36),
	`finished_at` datetime(3),
	CONSTRAINT `reconciliation_runs_id` PRIMARY KEY(`id`),
	CONSTRAINT `reconciliation_runs_state_ck` CHECK(`state` IN ('RUNNING', 'COMPLETED', 'FAILED')),
	CONSTRAINT `reconciliation_runs_period_ck` CHECK(period_end > period_start)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint
CREATE TABLE `refund_lines` (
	`id` char(36) NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`row_version` bigint unsigned NOT NULL DEFAULT 0,
	`refund_id` char(36) NOT NULL,
	`vendor_order_id` char(36),
	`order_item_id` char(36),
	`component` varchar(32) NOT NULL,
	`amount` bigint unsigned NOT NULL,
	`quantity` int,
	`tax_reversal_snapshot` json NOT NULL,
	`fee_reversal_snapshot` json NOT NULL,
	CONSTRAINT `refund_lines_id` PRIMARY KEY(`id`),
	CONSTRAINT `refund_lines_component_ck` CHECK(`component` IN ('ITEM', 'SHIPPING', 'BUYER_FEE', 'EXCESS_PAYMENT')),
	CONSTRAINT `refund_lines_money_ck` CHECK(`amount` BETWEEN 0 AND 9007199254740991),
	CONSTRAINT `refund_lines_positive_ck` CHECK(amount > 0 AND (quantity IS NULL OR quantity > 0)),
	CONSTRAINT `refund_lines_scope_ck` CHECK((component = 'EXCESS_PAYMENT' AND vendor_order_id IS NULL AND order_item_id IS NULL) OR (component = 'ITEM' AND vendor_order_id IS NOT NULL AND order_item_id IS NOT NULL) OR (component IN ('SHIPPING', 'BUYER_FEE') AND vendor_order_id IS NOT NULL AND order_item_id IS NULL))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint
CREATE TABLE `refunds` (
	`id` char(36) NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`row_version` bigint unsigned NOT NULL DEFAULT 0,
	`payment_receipt_id` char(36) NOT NULL,
	`reference` varchar(191) NOT NULL,
	`provider_refund_id` varchar(191),
	`amount` bigint unsigned NOT NULL,
	`state` varchar(32) NOT NULL DEFAULT 'REQUESTED',
	`reason` text NOT NULL,
	`requested_by` char(36),
	`approved_by` char(36),
	`proof_document_id` char(36),
	`completed_at` datetime(3),
	CONSTRAINT `refunds_id` PRIMARY KEY(`id`),
	CONSTRAINT `refunds_reference_uq` UNIQUE(`reference`),
	CONSTRAINT `refunds_provider_reference_uq` UNIQUE(`payment_receipt_id`,`provider_refund_id`),
	CONSTRAINT `refunds_state_ck` CHECK(`state` IN ('REQUESTED', 'APPROVED', 'PROCESSING', 'UNKNOWN', 'SUCCEEDED', 'FAILED', 'REJECTED')),
	CONSTRAINT `refunds_money_ck` CHECK(`amount` BETWEEN 0 AND 9007199254740991),
	CONSTRAINT `refunds_positive_ck` CHECK(amount > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint
CREATE TABLE `shipment_events` (
	`id` char(36) NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`row_version` bigint unsigned NOT NULL DEFAULT 0,
	`shipment_id` char(36),
	`provider_account_id` char(36) NOT NULL,
	`dedupe_key` varchar(191) NOT NULL,
	`event_type` varchar(100) NOT NULL,
	`payload_reference` varchar(512) NOT NULL,
	`verification_status` varchar(32) NOT NULL DEFAULT 'UNVERIFIED',
	`processing_status` varchar(32) NOT NULL DEFAULT 'RECEIVED',
	`provider_occurred_at` datetime(3),
	`processed_at` datetime(3),
	CONSTRAINT `shipment_events_id` PRIMARY KEY(`id`),
	CONSTRAINT `shipment_events_dedupe_uq` UNIQUE(`provider_account_id`,`dedupe_key`),
	CONSTRAINT `shipment_events_verification_status_ck` CHECK(`verification_status` IN ('UNVERIFIED', 'VERIFIED', 'REJECTED')),
	CONSTRAINT `shipment_events_processing_status_ck` CHECK(`processing_status` IN ('RECEIVED', 'PROCESSING', 'DONE', 'ERROR'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint
CREATE TABLE `shipments` (
	`id` char(36) NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`row_version` bigint unsigned NOT NULL DEFAULT 0,
	`vendor_order_id` char(36) NOT NULL,
	`provider_account_id` char(36) NOT NULL,
	`booking_reference` varchar(191) NOT NULL,
	`provider_order_id` varchar(191),
	`waybill_id` varchar(191),
	`state` varchar(32) NOT NULL DEFAULT 'NOT_BOOKED',
	`courier_code` varchar(64) NOT NULL,
	`service_code` varchar(64) NOT NULL,
	`package_snapshot` json NOT NULL,
	`quoted_amount` bigint unsigned NOT NULL,
	`actual_amount` bigint unsigned NOT NULL,
	`vendor_ready_at` datetime(3),
	`booked_at` datetime(3),
	`delivered_at` datetime(3),
	CONSTRAINT `shipments_id` PRIMARY KEY(`id`),
	CONSTRAINT `shipments_order_uq` UNIQUE(`vendor_order_id`),
	CONSTRAINT `shipments_booking_uq` UNIQUE(`booking_reference`),
	CONSTRAINT `shipments_provider_order_uq` UNIQUE(`provider_account_id`,`provider_order_id`),
	CONSTRAINT `shipments_state_ck` CHECK(`state` IN ('NOT_BOOKED', 'BOOKING', 'BOOKED', 'PICKED_UP', 'IN_TRANSIT', 'DELIVERED', 'CANCELLED', 'SHIPMENT_REVIEW')),
	CONSTRAINT `shipments_money_ck` CHECK(`quoted_amount` BETWEEN 0 AND 9007199254740991 AND `actual_amount` BETWEEN 0 AND 9007199254740991)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint
CREATE TABLE `shipping_quotes` (
	`id` char(36) NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`row_version` bigint unsigned NOT NULL DEFAULT 0,
	`buyer_account_id` char(36) NOT NULL,
	`store_id` char(36) NOT NULL,
	`provider_account_id` char(36) NOT NULL,
	`input_hash` char(64) NOT NULL,
	`courier_code` varchar(64) NOT NULL,
	`service_code` varchar(64) NOT NULL,
	`final_amount` bigint unsigned NOT NULL,
	`origin_snapshot` json NOT NULL,
	`destination_snapshot` json NOT NULL,
	`package_snapshot` json NOT NULL,
	`price_breakdown` json NOT NULL,
	`fetched_at` datetime(3) NOT NULL,
	`valid_until` datetime(3) NOT NULL,
	CONSTRAINT `shipping_quotes_id` PRIMARY KEY(`id`),
	CONSTRAINT `shipping_quotes_id_store_uq` UNIQUE(`id`,`store_id`),
	CONSTRAINT `shipping_quotes_period_ck` CHECK(valid_until > fetched_at),
	CONSTRAINT `shipping_quotes_money_ck` CHECK(`final_amount` BETWEEN 0 AND 9007199254740991)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint
CREATE TABLE `stock_reservations` (
	`id` char(36) NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`row_version` bigint unsigned NOT NULL DEFAULT 0,
	`order_item_id` char(36) NOT NULL,
	`sku_id` char(36) NOT NULL,
	`inventory_id` char(36) NOT NULL,
	`quantity` int NOT NULL,
	`state` varchar(32) NOT NULL DEFAULT 'ACTIVE',
	`expires_at` datetime(3) NOT NULL,
	`closed_at` datetime(3),
	CONSTRAINT `stock_reservations_id` PRIMARY KEY(`id`),
	CONSTRAINT `stock_reservations_item_uq` UNIQUE(`order_item_id`),
	CONSTRAINT `stock_reservations_state_ck` CHECK(`state` IN ('ACTIVE', 'CONSUMED', 'RELEASED')),
	CONSTRAINT `stock_reservations_quantity_ck` CHECK(quantity > 0),
	CONSTRAINT `stock_reservations_closed_ck` CHECK((state = 'ACTIVE' AND closed_at IS NULL) OR (state <> 'ACTIVE' AND closed_at IS NOT NULL))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint
CREATE TABLE `tax_policies` (
	`id` char(36) NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`row_version` bigint unsigned NOT NULL DEFAULT 0,
	`tax_class_id` char(36),
	`policy_key` varchar(191) NOT NULL,
	`kind` varchar(32) NOT NULL,
	`rate` decimal(12,8) NOT NULL,
	`dpp_numerator` int NOT NULL,
	`dpp_denominator` int NOT NULL,
	`valid_from` datetime(3) NOT NULL,
	`valid_until` datetime(3),
	`status` varchar(32) NOT NULL DEFAULT 'DRAFT',
	`rule_parameters` json NOT NULL,
	CONSTRAINT `tax_policies_id` PRIMARY KEY(`id`),
	CONSTRAINT `tax_policies_key_period_uq` UNIQUE(`policy_key`,`valid_from`),
	CONSTRAINT `tax_policies_kind_ck` CHECK(`kind` IN ('ITEM_VAT', 'COMMISSION_VAT', 'SELLER_WITHHOLDING')),
	CONSTRAINT `tax_policies_status_ck` CHECK(`status` IN ('DRAFT', 'ACTIVE', 'RETIRED')),
	CONSTRAINT `tax_policies_rate_ck` CHECK(rate BETWEEN 0 AND 1 AND dpp_numerator >= 0 AND dpp_denominator > 0),
	CONSTRAINT `tax_policies_period_ck` CHECK(valid_until IS NULL OR valid_until > valid_from)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint
CREATE TABLE `tax_profiles` (
	`id` char(36) NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`row_version` bigint unsigned NOT NULL DEFAULT 0,
	`legal_entity_id` char(36) NOT NULL,
	`is_pkp` boolean NOT NULL DEFAULT false,
	`collector_enabled` boolean NOT NULL DEFAULT false,
	`valid_from` datetime(3) NOT NULL,
	`valid_until` datetime(3),
	`status` varchar(32) NOT NULL DEFAULT 'DRAFT',
	`verified_by` char(36),
	`collector_basis_document_id` char(36),
	`profile_snapshot` json NOT NULL,
	CONSTRAINT `tax_profiles_id` PRIMARY KEY(`id`),
	CONSTRAINT `tax_profiles_status_ck` CHECK(`status` IN ('DRAFT', 'VERIFIED')),
	CONSTRAINT `tax_profiles_period_ck` CHECK(valid_until IS NULL OR valid_until > valid_from),
	CONSTRAINT `tax_profiles_collector_basis_ck` CHECK(collector_enabled = 0 OR collector_basis_document_id IS NOT NULL)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint
CREATE TABLE `vendor_orders` (
	`id` char(36) NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`row_version` bigint unsigned NOT NULL DEFAULT 0,
	`checkout_group_id` char(36) NOT NULL,
	`store_id` char(36) NOT NULL,
	`shipping_quote_id` char(36) NOT NULL,
	`order_number` varchar(100) NOT NULL,
	`items_net` bigint unsigned NOT NULL,
	`items_vat` bigint unsigned NOT NULL,
	`items_gross` bigint unsigned NOT NULL,
	`shipping_amount` bigint unsigned NOT NULL,
	`buyer_fee` bigint unsigned NOT NULL,
	`platform_discount` bigint unsigned NOT NULL,
	`buyer_total` bigint unsigned NOT NULL,
	`fulfillment_status` varchar(32) NOT NULL DEFAULT 'UNFULFILLED',
	`commission_amount` bigint unsigned NOT NULL,
	`commission_vat` bigint unsigned NOT NULL,
	`seller_withholding` bigint unsigned NOT NULL,
	`seller_tax_snapshot` json NOT NULL,
	`origin_snapshot` json NOT NULL,
	`completed_at` datetime(3),
	`dispute_deadline` datetime(3),
	CONSTRAINT `vendor_orders_id` PRIMARY KEY(`id`),
	CONSTRAINT `vendor_orders_number_uq` UNIQUE(`order_number`),
	CONSTRAINT `vendor_orders_group_store_uq` UNIQUE(`checkout_group_id`,`store_id`),
	CONSTRAINT `vendor_orders_id_store_uq` UNIQUE(`id`,`store_id`),
	CONSTRAINT `vendor_orders_id_group_uq` UNIQUE(`id`,`checkout_group_id`),
	CONSTRAINT `vendor_orders_fulfillment_status_ck` CHECK(`fulfillment_status` IN ('UNFULFILLED', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'COMPLETED', 'CANCELLED', 'REVIEW')),
	CONSTRAINT `vendor_orders_money_ck` CHECK(`items_net` BETWEEN 0 AND 9007199254740991 AND `items_vat` BETWEEN 0 AND 9007199254740991 AND `items_gross` BETWEEN 0 AND 9007199254740991 AND `shipping_amount` BETWEEN 0 AND 9007199254740991 AND `buyer_fee` BETWEEN 0 AND 9007199254740991 AND `platform_discount` BETWEEN 0 AND 9007199254740991 AND `buyer_total` BETWEEN 0 AND 9007199254740991 AND `commission_amount` BETWEEN 0 AND 9007199254740991 AND `commission_vat` BETWEEN 0 AND 9007199254740991 AND `seller_withholding` BETWEEN 0 AND 9007199254740991),
	CONSTRAINT `vendor_orders_total_ck` CHECK(items_gross = items_net + items_vat AND buyer_total + platform_discount = items_gross + shipping_amount + buyer_fee)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint
CREATE TABLE `vendor_payables` (
	`id` char(36) NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`row_version` bigint unsigned NOT NULL DEFAULT 0,
	`vendor_order_id` char(36) NOT NULL,
	`accrued_amount` bigint unsigned NOT NULL,
	`adjustment_amount` bigint NOT NULL DEFAULT 0,
	`reserved_payout_amount` bigint unsigned NOT NULL DEFAULT 0,
	`paid_amount` bigint unsigned NOT NULL DEFAULT 0,
	`eligibility` varchar(32) NOT NULL DEFAULT 'BLOCKED',
	`eligible_at` datetime(3),
	`last_journal_entry_id` char(36),
	CONSTRAINT `vendor_payables_id` PRIMARY KEY(`id`),
	CONSTRAINT `vendor_payables_order_uq` UNIQUE(`vendor_order_id`),
	CONSTRAINT `vendor_payables_eligibility_ck` CHECK(`eligibility` IN ('BLOCKED', 'ELIGIBLE')),
	CONSTRAINT `vendor_payables_money_ck` CHECK(`accrued_amount` BETWEEN 0 AND 9007199254740991 AND `reserved_payout_amount` BETWEEN 0 AND 9007199254740991 AND `paid_amount` BETWEEN 0 AND 9007199254740991),
	CONSTRAINT `vendor_payables_adjustment_ck` CHECK(adjustment_amount BETWEEN -9007199254740991 AND 9007199254740991)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint
ALTER TABLE `bank_accounts` ADD CONSTRAINT `bank_accounts_legal_entity_id_legal_entities_id_fk` FOREIGN KEY (`legal_entity_id`) REFERENCES `legal_entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `bank_accounts` ADD CONSTRAINT `bank_accounts_verified_by_users_id_fk` FOREIGN KEY (`verified_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `cart_items` ADD CONSTRAINT `cart_items_cart_id_carts_id_fk` FOREIGN KEY (`cart_id`) REFERENCES `carts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `cart_items` ADD CONSTRAINT `cart_items_sku_id_skus_id_fk` FOREIGN KEY (`sku_id`) REFERENCES `skus`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `cart_items` ADD CONSTRAINT `cart_items_quote_sku_fk` FOREIGN KEY (`quote_line_id`,`sku_id`) REFERENCES `quote_lines`(`id`,`sku_id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `carts` ADD CONSTRAINT `carts_buyer_account_id_buyer_accounts_id_fk` FOREIGN KEY (`buyer_account_id`) REFERENCES `buyer_accounts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `checkout_groups` ADD CONSTRAINT `checkout_groups_buyer_account_id_buyer_accounts_id_fk` FOREIGN KEY (`buyer_account_id`) REFERENCES `buyer_accounts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `checkout_groups` ADD CONSTRAINT `checkout_groups_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `documents` ADD CONSTRAINT `documents_legal_entity_id_legal_entities_id_fk` FOREIGN KEY (`legal_entity_id`) REFERENCES `legal_entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `documents` ADD CONSTRAINT `documents_vendor_order_id_vendor_orders_id_fk` FOREIGN KEY (`vendor_order_id`) REFERENCES `vendor_orders`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `documents` ADD CONSTRAINT `documents_uploaded_by_users_id_fk` FOREIGN KEY (`uploaded_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `documents` ADD CONSTRAINT `documents_verified_by_users_id_fk` FOREIGN KEY (`verified_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `fee_policies` ADD CONSTRAINT `fee_policies_category_id_categories_id_fk` FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `journal_entries` ADD CONSTRAINT `journal_entries_payment_receipt_id_payment_receipts_id_fk` FOREIGN KEY (`payment_receipt_id`) REFERENCES `payment_receipts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `journal_entries` ADD CONSTRAINT `journal_entries_refund_id_refunds_id_fk` FOREIGN KEY (`refund_id`) REFERENCES `refunds`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `journal_entries` ADD CONSTRAINT `journal_entries_payout_id_payouts_id_fk` FOREIGN KEY (`payout_id`) REFERENCES `payouts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `journal_entries` ADD CONSTRAINT `journal_entries_reversal_of_id_journal_entries_id_fk` FOREIGN KEY (`reversal_of_id`) REFERENCES `journal_entries`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `journal_lines` ADD CONSTRAINT `journal_lines_journal_entry_id_journal_entries_id_fk` FOREIGN KEY (`journal_entry_id`) REFERENCES `journal_entries`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `journal_lines` ADD CONSTRAINT `journal_lines_ledger_account_id_ledger_accounts_id_fk` FOREIGN KEY (`ledger_account_id`) REFERENCES `ledger_accounts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `journal_lines` ADD CONSTRAINT `journal_lines_vendor_order_id_vendor_orders_id_fk` FOREIGN KEY (`vendor_order_id`) REFERENCES `vendor_orders`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `ledger_accounts` ADD CONSTRAINT `ledger_accounts_store_id_stores_id_fk` FOREIGN KEY (`store_id`) REFERENCES `stores`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `order_cases` ADD CONSTRAINT `order_cases_vendor_order_id_vendor_orders_id_fk` FOREIGN KEY (`vendor_order_id`) REFERENCES `vendor_orders`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `order_cases` ADD CONSTRAINT `order_cases_opened_by_users_id_fk` FOREIGN KEY (`opened_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `order_cases` ADD CONSTRAINT `order_cases_resolved_by_users_id_fk` FOREIGN KEY (`resolved_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `order_items` ADD CONSTRAINT `order_items_order_store_fk` FOREIGN KEY (`vendor_order_id`,`store_id`) REFERENCES `vendor_orders`(`id`,`store_id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `order_items` ADD CONSTRAINT `order_items_sku_store_fk` FOREIGN KEY (`sku_id`,`store_id`) REFERENCES `skus`(`id`,`store_id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `order_items` ADD CONSTRAINT `order_items_quote_sku_fk` FOREIGN KEY (`quote_line_id`,`sku_id`) REFERENCES `quote_lines`(`id`,`sku_id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `payment_allocations` ADD CONSTRAINT `payment_allocations_receipt_group_fk` FOREIGN KEY (`payment_receipt_id`,`checkout_group_id`) REFERENCES `payment_receipts`(`id`,`checkout_group_id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `payment_allocations` ADD CONSTRAINT `payment_allocations_order_group_fk` FOREIGN KEY (`vendor_order_id`,`checkout_group_id`) REFERENCES `vendor_orders`(`id`,`checkout_group_id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `payment_attempts` ADD CONSTRAINT `payment_attempts_checkout_group_id_checkout_groups_id_fk` FOREIGN KEY (`checkout_group_id`) REFERENCES `checkout_groups`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `payment_attempts` ADD CONSTRAINT `payment_attempts_provider_account_id_provider_accounts_id_fk` FOREIGN KEY (`provider_account_id`) REFERENCES `provider_accounts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `payment_events` ADD CONSTRAINT `payment_events_provider_account_id_provider_accounts_id_fk` FOREIGN KEY (`provider_account_id`) REFERENCES `provider_accounts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `payment_events` ADD CONSTRAINT `payment_events_payment_attempt_id_payment_attempts_id_fk` FOREIGN KEY (`payment_attempt_id`) REFERENCES `payment_attempts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `payment_receipts` ADD CONSTRAINT `payment_receipts_attempt_scope_fk` FOREIGN KEY (`payment_attempt_id`,`checkout_group_id`,`provider_account_id`) REFERENCES `payment_attempts`(`id`,`checkout_group_id`,`provider_account_id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `payout_lines` ADD CONSTRAINT `payout_lines_payout_id_payouts_id_fk` FOREIGN KEY (`payout_id`) REFERENCES `payouts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `payout_lines` ADD CONSTRAINT `payout_lines_vendor_payable_id_vendor_payables_id_fk` FOREIGN KEY (`vendor_payable_id`) REFERENCES `vendor_payables`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `payouts` ADD CONSTRAINT `payouts_store_id_stores_id_fk` FOREIGN KEY (`store_id`) REFERENCES `stores`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `payouts` ADD CONSTRAINT `payouts_bank_account_id_bank_accounts_id_fk` FOREIGN KEY (`bank_account_id`) REFERENCES `bank_accounts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `payouts` ADD CONSTRAINT `payouts_requested_by_users_id_fk` FOREIGN KEY (`requested_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `payouts` ADD CONSTRAINT `payouts_approved_by_users_id_fk` FOREIGN KEY (`approved_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `payouts` ADD CONSTRAINT `payouts_proof_document_id_documents_id_fk` FOREIGN KEY (`proof_document_id`) REFERENCES `documents`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `quote_lines` ADD CONSTRAINT `quote_lines_quote_version_id_quote_versions_id_fk` FOREIGN KEY (`quote_version_id`) REFERENCES `quote_versions`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `quote_lines` ADD CONSTRAINT `quote_lines_sku_id_skus_id_fk` FOREIGN KEY (`sku_id`) REFERENCES `skus`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `quote_redemptions` ADD CONSTRAINT `quote_redemptions_quote_version_id_quote_versions_id_fk` FOREIGN KEY (`quote_version_id`) REFERENCES `quote_versions`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `quote_redemptions` ADD CONSTRAINT `quote_redemptions_vendor_order_id_vendor_orders_id_fk` FOREIGN KEY (`vendor_order_id`) REFERENCES `vendor_orders`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `quote_request_lines` ADD CONSTRAINT `quote_request_lines_request_store_fk` FOREIGN KEY (`quote_request_id`,`store_id`) REFERENCES `quote_requests`(`id`,`store_id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `quote_request_lines` ADD CONSTRAINT `quote_request_lines_sku_store_fk` FOREIGN KEY (`sku_id`,`store_id`) REFERENCES `skus`(`id`,`store_id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `quote_requests` ADD CONSTRAINT `quote_requests_buyer_account_id_buyer_accounts_id_fk` FOREIGN KEY (`buyer_account_id`) REFERENCES `buyer_accounts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `quote_requests` ADD CONSTRAINT `quote_requests_store_id_stores_id_fk` FOREIGN KEY (`store_id`) REFERENCES `stores`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `quote_requests` ADD CONSTRAINT `quote_requests_requested_by_users_id_fk` FOREIGN KEY (`requested_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `quote_versions` ADD CONSTRAINT `quote_versions_quote_request_id_quote_requests_id_fk` FOREIGN KEY (`quote_request_id`) REFERENCES `quote_requests`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `quote_versions` ADD CONSTRAINT `quote_versions_accepted_by_users_id_fk` FOREIGN KEY (`accepted_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `reconciliation_items` ADD CONSTRAINT `reconciliation_items_run_id_reconciliation_runs_id_fk` FOREIGN KEY (`run_id`) REFERENCES `reconciliation_runs`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `reconciliation_items` ADD CONSTRAINT `reconciliation_items_payment_attempt_id_payment_attempts_id_fk` FOREIGN KEY (`payment_attempt_id`) REFERENCES `payment_attempts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `reconciliation_items` ADD CONSTRAINT `reconciliation_items_resolution_journal_id_journal_entries_id_fk` FOREIGN KEY (`resolution_journal_id`) REFERENCES `journal_entries`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `reconciliation_runs` ADD CONSTRAINT `reconciliation_runs_provider_account_id_provider_accounts_id_fk` FOREIGN KEY (`provider_account_id`) REFERENCES `provider_accounts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `reconciliation_runs` ADD CONSTRAINT `reconciliation_runs_source_document_id_documents_id_fk` FOREIGN KEY (`source_document_id`) REFERENCES `documents`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `refund_lines` ADD CONSTRAINT `refund_lines_refund_id_refunds_id_fk` FOREIGN KEY (`refund_id`) REFERENCES `refunds`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `refund_lines` ADD CONSTRAINT `refund_lines_vendor_order_id_vendor_orders_id_fk` FOREIGN KEY (`vendor_order_id`) REFERENCES `vendor_orders`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `refund_lines` ADD CONSTRAINT `refund_lines_item_order_fk` FOREIGN KEY (`order_item_id`,`vendor_order_id`) REFERENCES `order_items`(`id`,`vendor_order_id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `refunds` ADD CONSTRAINT `refunds_payment_receipt_id_payment_receipts_id_fk` FOREIGN KEY (`payment_receipt_id`) REFERENCES `payment_receipts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `refunds` ADD CONSTRAINT `refunds_requested_by_users_id_fk` FOREIGN KEY (`requested_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `refunds` ADD CONSTRAINT `refunds_approved_by_users_id_fk` FOREIGN KEY (`approved_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `refunds` ADD CONSTRAINT `refunds_proof_document_id_documents_id_fk` FOREIGN KEY (`proof_document_id`) REFERENCES `documents`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `shipment_events` ADD CONSTRAINT `shipment_events_shipment_id_shipments_id_fk` FOREIGN KEY (`shipment_id`) REFERENCES `shipments`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `shipment_events` ADD CONSTRAINT `shipment_events_provider_account_id_provider_accounts_id_fk` FOREIGN KEY (`provider_account_id`) REFERENCES `provider_accounts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `shipments` ADD CONSTRAINT `shipments_vendor_order_id_vendor_orders_id_fk` FOREIGN KEY (`vendor_order_id`) REFERENCES `vendor_orders`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `shipments` ADD CONSTRAINT `shipments_provider_account_id_provider_accounts_id_fk` FOREIGN KEY (`provider_account_id`) REFERENCES `provider_accounts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `shipping_quotes` ADD CONSTRAINT `shipping_quotes_buyer_account_id_buyer_accounts_id_fk` FOREIGN KEY (`buyer_account_id`) REFERENCES `buyer_accounts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `shipping_quotes` ADD CONSTRAINT `shipping_quotes_store_id_stores_id_fk` FOREIGN KEY (`store_id`) REFERENCES `stores`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `shipping_quotes` ADD CONSTRAINT `shipping_quotes_provider_account_id_provider_accounts_id_fk` FOREIGN KEY (`provider_account_id`) REFERENCES `provider_accounts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `stock_reservations` ADD CONSTRAINT `stock_reservations_item_sku_fk` FOREIGN KEY (`order_item_id`,`sku_id`) REFERENCES `order_items`(`id`,`sku_id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `stock_reservations` ADD CONSTRAINT `stock_reservations_inventory_sku_fk` FOREIGN KEY (`inventory_id`,`sku_id`) REFERENCES `inventory_balances`(`id`,`sku_id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `tax_policies` ADD CONSTRAINT `tax_policies_tax_class_id_tax_classes_id_fk` FOREIGN KEY (`tax_class_id`) REFERENCES `tax_classes`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `tax_profiles` ADD CONSTRAINT `tax_profiles_legal_entity_id_legal_entities_id_fk` FOREIGN KEY (`legal_entity_id`) REFERENCES `legal_entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `tax_profiles` ADD CONSTRAINT `tax_profiles_verified_by_users_id_fk` FOREIGN KEY (`verified_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `tax_profiles` ADD CONSTRAINT `tax_profiles_collector_basis_document_id_documents_id_fk` FOREIGN KEY (`collector_basis_document_id`) REFERENCES `documents`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `vendor_orders` ADD CONSTRAINT `vendor_orders_checkout_group_id_checkout_groups_id_fk` FOREIGN KEY (`checkout_group_id`) REFERENCES `checkout_groups`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `vendor_orders` ADD CONSTRAINT `vendor_orders_store_id_stores_id_fk` FOREIGN KEY (`store_id`) REFERENCES `stores`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `vendor_orders` ADD CONSTRAINT `vendor_orders_shipping_store_fk` FOREIGN KEY (`shipping_quote_id`,`store_id`) REFERENCES `shipping_quotes`(`id`,`store_id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `vendor_payables` ADD CONSTRAINT `vendor_payables_vendor_order_id_vendor_orders_id_fk` FOREIGN KEY (`vendor_order_id`) REFERENCES `vendor_orders`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `vendor_payables` ADD CONSTRAINT `vendor_payables_last_journal_entry_id_journal_entries_id_fk` FOREIGN KEY (`last_journal_entry_id`) REFERENCES `journal_entries`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `checkout_groups_buyer_created_idx` ON `checkout_groups` (`buyer_account_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `documents_entity_type_idx` ON `documents` (`legal_entity_id`,`document_type`);--> statement-breakpoint
CREATE INDEX `documents_order_idx` ON `documents` (`vendor_order_id`);--> statement-breakpoint
CREATE INDEX `journal_lines_account_idx` ON `journal_lines` (`ledger_account_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `ledger_accounts_store_kind_idx` ON `ledger_accounts` (`store_id`,`kind`);--> statement-breakpoint
CREATE INDEX `order_cases_order_state_idx` ON `order_cases` (`vendor_order_id`,`state`);--> statement-breakpoint
CREATE INDEX `payment_events_processing_idx` ON `payment_events` (`processing_status`,`created_at`);--> statement-breakpoint
CREATE INDEX `payouts_store_state_idx` ON `payouts` (`store_id`,`state`);--> statement-breakpoint
CREATE INDEX `quote_requests_store_status_idx` ON `quote_requests` (`store_id`,`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `quote_requests_buyer_created_idx` ON `quote_requests` (`buyer_account_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `reconciliation_runs_provider_period_idx` ON `reconciliation_runs` (`provider_account_id`,`period_start`);--> statement-breakpoint
CREATE INDEX `refund_lines_refund_idx` ON `refund_lines` (`refund_id`);--> statement-breakpoint
CREATE INDEX `refunds_receipt_state_idx` ON `refunds` (`payment_receipt_id`,`state`);--> statement-breakpoint
CREATE INDEX `shipment_events_processing_idx` ON `shipment_events` (`processing_status`,`created_at`);--> statement-breakpoint
CREATE INDEX `shipments_state_updated_idx` ON `shipments` (`state`,`updated_at`);--> statement-breakpoint
CREATE INDEX `shipping_quotes_buyer_store_hash_idx` ON `shipping_quotes` (`buyer_account_id`,`store_id`,`input_hash`);--> statement-breakpoint
CREATE INDEX `shipping_quotes_expiry_idx` ON `shipping_quotes` (`valid_until`);--> statement-breakpoint
CREATE INDEX `stock_reservations_state_expiry_idx` ON `stock_reservations` (`state`,`expires_at`);--> statement-breakpoint
CREATE INDEX `tax_profiles_entity_period_idx` ON `tax_profiles` (`legal_entity_id`,`status`,`valid_from`);--> statement-breakpoint
CREATE INDEX `vendor_orders_store_status_idx` ON `vendor_orders` (`store_id`,`fulfillment_status`,`created_at`);--> statement-breakpoint
CREATE INDEX `vendor_payables_eligibility_idx` ON `vendor_payables` (`eligibility`,`eligible_at`);--> statement-breakpoint
ALTER TABLE `inventory_movements` ADD CONSTRAINT `inventory_movements_reservation_id_stock_reservations_id_fk` FOREIGN KEY (`reservation_id`) REFERENCES `stock_reservations`(`id`) ON DELETE no action ON UPDATE no action;