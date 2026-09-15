import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import {
  type AnyMySqlColumn,
  bigint,
  boolean,
  char,
  check,
  customType,
  date,
  datetime,
  decimal,
  foreignKey,
  index,
  int,
  longtext,
  mysqlTable,
  text,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core';

const uuid = (name: string) => char(name, { length: 36 });
const instant = (name: string) => datetime(name, { mode: 'date', fsp: 3 });
// MariaDB exposes JSON as LONGTEXT; decode it here as well as native MySQL JSON.
const json = customType<{ data: unknown; driverData: string }>({
  dataType: () => 'json',
  toDriver: (value) => JSON.stringify(value),
  fromDriver: (value) => typeof value === 'string' ? JSON.parse(value) : value,
});
const money = (name: string) => bigint(name, { mode: 'number', unsigned: true }).notNull();
const snapshot = (name: string) => json(name).$type<Record<string, unknown>>().notNull();
const code = (name: string, length = 32) => varchar(name, { length }).notNull();
const currency = () => char('currency', { length: 3 }).notNull().default('IDR');
const enumCheck = (table: string, column: string, values: readonly string[]) =>
  check(`${table}_${column}_ck`, sql.raw(`\`${column}\` IN (${values.map((value) => `'${value}'`).join(', ')})`));
const moneyCheck = (table: string, names: string[]) => check(`${table}_money_ck`, sql.raw(names.map((name) => `\`${name}\` BETWEEN 0 AND 9007199254740991`).join(' AND ')));
const identity = () => ({
  id: uuid('id').primaryKey().$defaultFn(randomUUID),
  createdAt: instant('created_at').notNull().default(sql`CURRENT_TIMESTAMP(3)`),
});
const mutable = () => ({
  ...identity(),
  updatedAt: instant('updated_at').notNull().default(sql`CURRENT_TIMESTAMP(3)`).$onUpdateFn(() => new Date()),
  rowVersion: bigint('row_version', { mode: 'number', unsigned: true }).notNull().default(0),
});

export const users = mysqlTable('users', {
  ...mutable(),
  emailNormalized: varchar('email_normalized', { length: 254 }).notNull(),
  passwordHash: varchar('password_hash', { length: 255 }).notNull(),
  name: varchar('name', { length: 150 }).notNull(),
  phone: varchar('phone', { length: 32 }),
  status: varchar('status', { length: 20 }).notNull().default('ACTIVE'),
  emailVerifiedAt: instant('email_verified_at'),
}, (t) => [uniqueIndex('users_email_uq').on(t.emailNormalized)]);

export const authTokens = mysqlTable('auth_tokens', {
  ...mutable(),
  userId: uuid('user_id').notNull().references(() => users.id),
  purpose: varchar('purpose', { length: 24 }).notNull(),
  tokenHash: char('token_hash', { length: 64 }).notNull(),
  expiresAt: instant('expires_at').notNull(),
  consumedAt: instant('consumed_at'),
  revokedAt: instant('revoked_at'),
}, (t) => [
  uniqueIndex('auth_tokens_hash_uq').on(t.tokenHash),
  index('auth_tokens_user_purpose_idx').on(t.userId, t.purpose),
  index('auth_tokens_expiry_idx').on(t.expiresAt),
]);

export const adminGrants = mysqlTable('admin_grants', {
  ...mutable(),
  userId: uuid('user_id').notNull().references(() => users.id),
  roleCode: varchar('role_code', { length: 32 }).notNull(),
  revokedAt: instant('revoked_at'),
  activeUserId: uuid('active_user_id').generatedAlwaysAs(sql`CASE WHEN revoked_at IS NULL THEN user_id ELSE NULL END`, { mode: 'stored' }),
}, (t) => [uniqueIndex('admin_grants_active_role_uq').on(t.activeUserId, t.roleCode)]);

export const organizations = mysqlTable('organizations', {
  ...mutable(),
  name: varchar('name', { length: 200 }).notNull(),
  kind: varchar('kind', { length: 24 }).notNull(),
  schoolIdentifier: varchar('school_identifier', { length: 100 }),
  contactName: varchar('contact_name', { length: 150 }).notNull(),
  contactPhone: varchar('contact_phone', { length: 32 }).notNull(),
  status: varchar('status', { length: 20 }).notNull().default('ACTIVE'),
}, (t) => [index('organizations_name_idx').on(t.name)]);

export const buyerAccounts = mysqlTable('buyer_accounts', {
  ...mutable(),
  managerUserId: uuid('manager_user_id').notNull().references(() => users.id),
  organizationId: uuid('organization_id').references(() => organizations.id),
  kind: varchar('kind', { length: 24 }).notNull(),
  status: varchar('status', { length: 20 }).notNull().default('ACTIVE'),
  individualManagerId: uuid('individual_manager_id').generatedAlwaysAs(sql`CASE WHEN kind = 'INDIVIDUAL' THEN manager_user_id ELSE NULL END`, { mode: 'stored' }),
}, (t) => [
  uniqueIndex('buyer_accounts_organization_uq').on(t.organizationId),
  uniqueIndex('buyer_accounts_individual_uq').on(t.individualManagerId),
  index('buyer_accounts_manager_idx').on(t.managerUserId),
  check('buyer_accounts_kind_ck', sql`(${t.kind} = 'INDIVIDUAL' AND ${t.organizationId} IS NULL) OR (${t.kind} = 'ORGANIZATION' AND ${t.organizationId} IS NOT NULL)`),
]);

export const addresses = mysqlTable('addresses', {
  ...mutable(),
  buyerAccountId: uuid('buyer_account_id').notNull().references(() => buyerAccounts.id),
  label: varchar('label', { length: 80 }).notNull(),
  recipientName: varchar('recipient_name', { length: 150 }).notNull(),
  phone: varchar('phone', { length: 32 }).notNull(),
  street: text('street').notNull(),
  province: varchar('province', { length: 100 }).notNull(),
  city: varchar('city', { length: 100 }).notNull(),
  district: varchar('district', { length: 100 }).notNull(),
  postalCode: varchar('postal_code', { length: 10 }).notNull(),
  areaId: varchar('area_id', { length: 100 }),
  latitude: decimal('latitude', { precision: 10, scale: 7 }),
  longitude: decimal('longitude', { precision: 10, scale: 7 }),
  isDefault: boolean('is_default').notNull().default(false),
  archivedAt: instant('archived_at'),
  defaultBuyerAccountId: uuid('default_buyer_account_id').generatedAlwaysAs(sql`CASE WHEN is_default = 1 AND archived_at IS NULL THEN buyer_account_id ELSE NULL END`, { mode: 'stored' }),
}, (t) => [
  uniqueIndex('addresses_id_buyer_uq').on(t.id, t.buyerAccountId),
  uniqueIndex('addresses_default_uq').on(t.defaultBuyerAccountId),
  index('addresses_buyer_idx').on(t.buyerAccountId),
  check('addresses_coordinates_ck', sql`(${t.latitude} IS NULL AND ${t.longitude} IS NULL) OR (${t.latitude} IS NOT NULL AND ${t.longitude} IS NOT NULL AND ${t.latitude} BETWEEN -90 AND 90 AND ${t.longitude} BETWEEN -180 AND 180)`),
]);

export const legalEntities = mysqlTable('legal_entities', {
  ...mutable(),
  createdBy: uuid('created_by').notNull().references(() => users.id),
  kind: varchar('kind', { length: 24 }).notNull(),
  legalName: varchar('legal_name', { length: 200 }).notNull(),
  taxIdentifierCiphertext: text('tax_identifier_ciphertext'),
  taxIdentifierFingerprint: char('tax_identifier_fingerprint', { length: 64 }),
  isPlatform: boolean('is_platform').notNull().default(false),
  status: varchar('status', { length: 24 }).notNull().default('PENDING'),
  platformKey: int('platform_key').generatedAlwaysAs(sql`CASE WHEN is_platform = 1 THEN 1 ELSE NULL END`, { mode: 'stored' }),
}, (t) => [
  uniqueIndex('legal_entities_tax_fingerprint_uq').on(t.taxIdentifierFingerprint),
  uniqueIndex('legal_entities_platform_uq').on(t.platformKey),
  index('legal_entities_creator_idx').on(t.createdBy),
]);

export const stores = mysqlTable('stores', {
  ...mutable(),
  legalEntityId: uuid('legal_entity_id').notNull().references(() => legalEntities.id),
  slug: varchar('slug', { length: 180 }).notNull(),
  name: varchar('name', { length: 200 }).notNull(),
  contactPhone: varchar('contact_phone', { length: 32 }).notNull(),
  status: varchar('status', { length: 24 }).notNull().default('DRAFT'),
  moderationReason: text('moderation_reason'),
  reviewedBy: uuid('reviewed_by').references(() => users.id),
  reviewedAt: instant('reviewed_at'),
}, (t) => [
  uniqueIndex('stores_slug_uq').on(t.slug),
  index('stores_legal_entity_idx').on(t.legalEntityId),
  index('stores_status_created_idx').on(t.status, t.createdAt, t.id),
]);

export const storeMembers = mysqlTable('store_members', {
  ...mutable(),
  storeId: uuid('store_id').notNull().references(() => stores.id),
  userId: uuid('user_id').notNull().references(() => users.id),
  roleCode: varchar('role_code', { length: 24 }).notNull(),
  revokedAt: instant('revoked_at'),
  activeUserId: uuid('active_user_id').generatedAlwaysAs(sql`CASE WHEN revoked_at IS NULL THEN user_id ELSE NULL END`, { mode: 'stored' }),
  ownerStoreId: uuid('owner_store_id').generatedAlwaysAs(sql`CASE WHEN role_code = 'OWNER' AND revoked_at IS NULL THEN store_id ELSE NULL END`, { mode: 'stored' }),
}, (t) => [
  uniqueIndex('store_members_active_user_uq').on(t.storeId, t.activeUserId),
  uniqueIndex('store_members_owner_uq').on(t.ownerStoreId),
  index('store_members_user_idx').on(t.userId, t.revokedAt),
]);

export const storeOrigins = mysqlTable('store_origins', {
  ...mutable(),
  storeId: uuid('store_id').notNull().references(() => stores.id),
  contactName: varchar('contact_name', { length: 150 }).notNull(),
  phone: varchar('phone', { length: 32 }).notNull(),
  street: text('street').notNull(),
  postalCode: varchar('postal_code', { length: 10 }).notNull(),
  areaId: varchar('area_id', { length: 100 }),
  latitude: decimal('latitude', { precision: 10, scale: 7 }),
  longitude: decimal('longitude', { precision: 10, scale: 7 }),
  active: boolean('active').notNull().default(true),
  activeStoreId: uuid('active_store_id').generatedAlwaysAs(sql`CASE WHEN active = 1 THEN store_id ELSE NULL END`, { mode: 'stored' }),
}, (t) => [
  uniqueIndex('store_origins_id_store_uq').on(t.id, t.storeId),
  uniqueIndex('store_origins_active_uq').on(t.activeStoreId),
  check('store_origins_coordinates_ck', sql`(${t.latitude} IS NULL AND ${t.longitude} IS NULL) OR (${t.latitude} IS NOT NULL AND ${t.longitude} IS NOT NULL AND ${t.latitude} BETWEEN -90 AND 90 AND ${t.longitude} BETWEEN -180 AND 180)`),
]);

export const taxClasses = mysqlTable('tax_classes', {
  ...mutable(),
  code: varchar('code', { length: 50 }).notNull(),
  name: varchar('name', { length: 150 }).notNull(),
  status: varchar('status', { length: 24 }).notNull().default('UNVERIFIED'),
}, (t) => [uniqueIndex('tax_classes_code_uq').on(t.code)]);

export const categories = mysqlTable('categories', {
  ...mutable(),
  parentId: uuid('parent_id').references((): AnyMySqlColumn => categories.id),
  slug: varchar('slug', { length: 180 }).notNull(),
  name: varchar('name', { length: 200 }).notNull(),
  attributeSchema: json('attribute_schema').$type<Record<string, unknown>>().notNull().$defaultFn(() => ({})),
  status: varchar('status', { length: 20 }).notNull().default('ACTIVE'),
}, (t) => [
  uniqueIndex('categories_slug_uq').on(t.slug),
  index('categories_parent_idx').on(t.parentId),
  check('categories_not_self_ck', sql`${t.parentId} IS NULL OR ${t.parentId} <> ${t.id}`),
]);

export const products = mysqlTable('products', {
  ...mutable(),
  storeId: uuid('store_id').notNull().references(() => stores.id),
  categoryId: uuid('category_id').notNull().references(() => categories.id),
  taxClassId: uuid('tax_class_id').notNull().references(() => taxClasses.id),
  name: varchar('name', { length: 200 }).notNull(),
  description: longtext('description').notNull(),
  attributes: json('attributes').$type<Record<string, unknown>>().notNull().$defaultFn(() => ({})),
  status: varchar('status', { length: 20 }).notNull().default('DRAFT'),
  slug: varchar('slug', { length: 180 }).notNull(),
}, (t) => [
  uniqueIndex('products_store_slug_uq').on(t.storeId, t.slug),
  uniqueIndex('products_id_store_uq').on(t.id, t.storeId),
  index('products_category_status_idx').on(t.categoryId, t.status, t.createdAt, t.id),
  index('products_status_created_idx').on(t.status, t.createdAt, t.id),
  index('products_store_status_idx').on(t.storeId, t.status, t.createdAt, t.id),
]);

export const productMedia = mysqlTable('product_media', {
  ...mutable(),
  productId: uuid('product_id').notNull().references(() => products.id),
  objectKey: varchar('object_key', { length: 512 }).notNull(),
  altText: varchar('alt_text', { length: 300 }).notNull(),
  sortOrder: int('sort_order', { unsigned: true }).notNull(),
}, (t) => [uniqueIndex('product_media_sort_uq').on(t.productId, t.sortOrder)]);

export const skus = mysqlTable('skus', {
  ...mutable(),
  productId: uuid('product_id').notNull(),
  storeId: uuid('store_id').notNull().references(() => stores.id),
  skuCode: varchar('sku_code', { length: 100 }).notNull(),
  variantAttributes: json('variant_attributes').$type<Record<string, unknown>>().notNull().$defaultFn(() => ({})),
  unitLabel: varchar('unit_label', { length: 32 }).notNull(),
  unitPriceGross: bigint('unit_price_gross', { mode: 'number', unsigned: true }).notNull(),
  weightG: int('weight_g', { unsigned: true }).notNull(),
  lengthCm: decimal('length_cm', { precision: 10, scale: 2 }).notNull(),
  widthCm: decimal('width_cm', { precision: 10, scale: 2 }).notNull(),
  heightCm: decimal('height_cm', { precision: 10, scale: 2 }).notNull(),
  status: varchar('status', { length: 20 }).notNull().default('ACTIVE'),
}, (t) => [
  uniqueIndex('skus_store_code_uq').on(t.storeId, t.skuCode),
  uniqueIndex('skus_id_store_uq').on(t.id, t.storeId),
  foreignKey({ name: 'skus_product_store_fk', columns: [t.productId, t.storeId], foreignColumns: [products.id, products.storeId] }),
  index('skus_price_idx').on(t.unitPriceGross),
  check('skus_positive_price_ck', sql`${t.unitPriceGross} > 0 AND ${t.unitPriceGross} <= 9007199254740991`),
  check('skus_dimensions_ck', sql`${t.weightG} > 0 AND ${t.lengthCm} > 0 AND ${t.widthCm} > 0 AND ${t.heightCm} > 0`),
]);

export const inventoryBalances = mysqlTable('inventory_balances', {
  ...mutable(),
  skuId: uuid('sku_id').notNull().references(() => skus.id),
  onHand: int('on_hand').notNull().default(0),
  reserved: int('reserved').notNull().default(0),
}, (t) => [
  uniqueIndex('inventory_balances_sku_uq').on(t.skuId),
  uniqueIndex('inventory_balances_id_sku_uq').on(t.id, t.skuId),
  check('inventory_balances_nonnegative_ck', sql`${t.onHand} >= 0 AND ${t.reserved} >= 0 AND ${t.reserved} <= ${t.onHand}`),
]);

export const inventoryMovements = mysqlTable('inventory_movements', {
  ...identity(),
  inventoryId: uuid('inventory_id').notNull().references(() => inventoryBalances.id),
  reservationId: uuid('reservation_id').references((): AnyMySqlColumn => stockReservations.id),
  onHandDelta: int('on_hand_delta').notNull().default(0),
  reservedDelta: int('reserved_delta').notNull().default(0),
  reason: varchar('reason', { length: 200 }).notNull(),
  eventKey: varchar('event_key', { length: 191 }).notNull(),
  actorId: uuid('actor_id').references(() => users.id),
}, (t) => [
  uniqueIndex('inventory_movements_event_uq').on(t.eventKey),
  index('inventory_movements_balance_created_idx').on(t.inventoryId, t.createdAt),
  check('inventory_movements_delta_ck', sql`${t.onHandDelta} <> 0 OR ${t.reservedDelta} <> 0`),
]);

export const idempotencyKeys = mysqlTable('idempotency_keys', {
  ...mutable(),
  actorId: uuid('actor_id').notNull().references(() => users.id),
  operation: varchar('operation', { length: 100 }).notNull(),
  key: varchar('key', { length: 191 }).notNull(),
  requestHash: char('request_hash', { length: 64 }).notNull(),
  state: varchar('state', { length: 20 }).notNull().default('IN_PROGRESS'),
  resultReference: json('result_reference').$type<Record<string, unknown>>(),
  statusCode: int('status_code'),
  responseBody: json('response_body').$type<unknown>(),
  responseHeaders: json('response_headers').$type<Record<string, string>>(),
  expiresAt: instant('expires_at').notNull(),
}, (t) => [
  uniqueIndex('idempotency_keys_actor_operation_key_uq').on(t.actorId, t.operation, t.key),
  index('idempotency_keys_expiry_idx').on(t.expiresAt),
]);

export const outboxEvents = mysqlTable('outbox_events', {
  ...mutable(),
  eventKey: varchar('event_key', { length: 191 }).notNull(),
  aggregateType: varchar('aggregate_type', { length: 100 }).notNull(),
  aggregateId: varchar('aggregate_id', { length: 191 }).notNull(),
  eventType: varchar('event_type', { length: 100 }).notNull(),
  payload: json('payload').$type<Record<string, unknown>>().notNull(),
  state: varchar('state', { length: 20 }).notNull().default('READY'),
  attempts: int('attempts', { unsigned: true }).notNull().default(0),
  availableAt: instant('available_at').notNull().default(sql`CURRENT_TIMESTAMP(3)`),
  lockedUntil: instant('locked_until'),
  lastError: text('last_error'),
}, (t) => [
  uniqueIndex('outbox_events_event_uq').on(t.eventKey),
  index('outbox_events_schedule_idx').on(t.state, t.availableAt),
  index('outbox_events_lease_idx').on(t.state, t.lockedUntil),
]);

export const auditLogs = mysqlTable('audit_logs', {
  ...identity(),
  actorId: uuid('actor_id').references(() => users.id),
  entityType: varchar('entity_type', { length: 100 }).notNull(),
  entityId: varchar('entity_id', { length: 191 }).notNull(),
  action: varchar('action', { length: 100 }).notNull(),
  reason: text('reason'),
  changesRedacted: json('changes_redacted').$type<Record<string, unknown>>().notNull(),
  correlationId: varchar('correlation_id', { length: 128 }).notNull(),
}, (t) => [
  index('audit_logs_entity_created_idx').on(t.entityType, t.entityId, t.createdAt),
  index('audit_logs_actor_created_idx').on(t.actorId, t.createdAt),
]);

export const notifications = mysqlTable('notifications', {
  ...mutable(),
  userId: uuid('user_id').notNull().references(() => users.id),
  businessEventKey: varchar('business_event_key', { length: 191 }).notNull(),
  kind: varchar('kind', { length: 32 }).notNull(),
  payload: json('payload').$type<Record<string, unknown>>().notNull(),
  readAt: instant('read_at'),
}, (t) => [
  uniqueIndex('notifications_user_event_uq').on(t.userId, t.businessEventKey),
  index('notifications_user_read_created_idx').on(t.userId, t.readAt, t.createdAt),
]);

export const uploadIntents = mysqlTable('upload_intents', {
  ...mutable(),
  userId: uuid('user_id').notNull().references(() => users.id),
  storeId: uuid('store_id').notNull().references(() => stores.id),
  productId: uuid('product_id').notNull().references(() => products.id),
  objectKey: varchar('object_key', { length: 512 }).notNull(),
  verifiedObjectKey: varchar('verified_object_key', { length: 512 }),
  contentType: varchar('content_type', { length: 100 }).notNull(),
  sizeBytes: int('size_bytes', { unsigned: true }).notNull(),
  checksumSha256: char('checksum_sha256', { length: 64 }),
  expiresAt: instant('expires_at').notNull(),
  confirmedAt: instant('confirmed_at'),
}, (t) => [
  uniqueIndex('upload_intents_object_uq').on(t.objectKey),
  index('upload_intents_expiry_idx').on(t.expiresAt),
  index('upload_intents_owner_idx').on(t.userId, t.storeId),
]);

export const taxProfiles = mysqlTable('tax_profiles', {
  ...mutable(),
  legalEntityId: uuid('legal_entity_id').notNull().references(() => legalEntities.id),
  isPkp: boolean('is_pkp').notNull().default(false),
  collectorEnabled: boolean('collector_enabled').notNull().default(false),
  validFrom: instant('valid_from').notNull(), validUntil: instant('valid_until'),
  status: code('status').default('DRAFT'),
  verifiedBy: uuid('verified_by').references(() => users.id),
  collectorBasisDocumentId: uuid('collector_basis_document_id').references((): AnyMySqlColumn => documents.id),
  profileSnapshot: snapshot('profile_snapshot'),
}, (t) => [index('tax_profiles_entity_period_idx').on(t.legalEntityId, t.status, t.validFrom),
  enumCheck('tax_profiles', 'status', ['DRAFT', 'VERIFIED']),
  check('tax_profiles_period_ck', sql`valid_until IS NULL OR valid_until > valid_from`),
  check('tax_profiles_collector_basis_ck', sql`collector_enabled = 0 OR collector_basis_document_id IS NOT NULL`),
]);

export const documents = mysqlTable('documents', {
  ...mutable(),
  legalEntityId: uuid('legal_entity_id').references(() => legalEntities.id),
  vendorOrderId: uuid('vendor_order_id').references((): AnyMySqlColumn => vendorOrders.id),
  uploadedBy: uuid('uploaded_by').notNull().references(() => users.id),
  documentType: code('document_type'), objectKey: code('object_key', 512),
  sha256: char('sha256', { length: 64 }).notNull(), mimeType: code('mime_type', 100),
  validFrom: date('valid_from', { mode: 'string' }), validUntil: date('valid_until', { mode: 'string' }),
  verificationStatus: code('verification_status').default('PENDING'),
  verifiedBy: uuid('verified_by').references(() => users.id), metadata: snapshot('metadata'),
}, (t) => [index('documents_entity_type_idx').on(t.legalEntityId, t.documentType), index('documents_order_idx').on(t.vendorOrderId),
  enumCheck('documents', 'document_type', ['NPWP', 'PKP', 'SKB', 'TURNOVER_STATEMENT', 'INVOICE', 'TAX_INVOICE', 'PAYOUT_PROOF', 'REFUND_PROOF', 'OTHER']),
  enumCheck('documents', 'verification_status', ['PENDING', 'VERIFIED', 'REJECTED']),
  check('documents_period_ck', sql`valid_from IS NULL OR valid_until IS NULL OR valid_until >= valid_from`),
]);

export const taxPolicies = mysqlTable('tax_policies', {
  ...mutable(), taxClassId: uuid('tax_class_id').references(() => taxClasses.id),
  policyKey: code('policy_key', 191), kind: code('kind'), rate: decimal('rate', { precision: 12, scale: 8 }).notNull(),
  dppNumerator: int('dpp_numerator').notNull(), dppDenominator: int('dpp_denominator').notNull(),
  validFrom: instant('valid_from').notNull(), validUntil: instant('valid_until'),
  status: code('status').default('DRAFT'), ruleParameters: snapshot('rule_parameters'),
}, (t) => [uniqueIndex('tax_policies_key_period_uq').on(t.policyKey, t.validFrom),
  enumCheck('tax_policies', 'kind', ['ITEM_VAT', 'COMMISSION_VAT', 'SELLER_WITHHOLDING']),
  enumCheck('tax_policies', 'status', ['DRAFT', 'ACTIVE', 'RETIRED']),
  check('tax_policies_rate_ck', sql`rate BETWEEN 0 AND 1 AND dpp_numerator >= 0 AND dpp_denominator > 0`),
  check('tax_policies_period_ck', sql`valid_until IS NULL OR valid_until > valid_from`),
]);

export const feePolicies = mysqlTable('fee_policies', {
  ...mutable(), categoryId: uuid('category_id').references(() => categories.id), policyKey: code('policy_key', 191),
  commissionRate: decimal('commission_rate', { precision: 12, scale: 8 }).notNull(), buyerFeeAmount: money('buyer_fee_amount').default(0),
  validFrom: instant('valid_from').notNull(), validUntil: instant('valid_until'), status: code('status').default('DRAFT'),
}, (t) => [uniqueIndex('fee_policies_key_period_uq').on(t.policyKey, t.validFrom),
  enumCheck('fee_policies', 'status', ['DRAFT', 'ACTIVE', 'RETIRED']),
  check('fee_policies_rate_ck', sql`commission_rate BETWEEN 0 AND 1`),
  check('fee_policies_period_ck', sql`valid_until IS NULL OR valid_until > valid_from`), moneyCheck('fee_policies', ['buyer_fee_amount']),
]);

export const quoteRequests = mysqlTable('quote_requests', {
  ...mutable(), buyerAccountId: uuid('buyer_account_id').notNull().references(() => buyerAccounts.id),
  storeId: uuid('store_id').notNull().references(() => stores.id), requestedBy: uuid('requested_by').notNull().references(() => users.id),
  addressSnapshot: snapshot('address_snapshot'), notes: text('notes'), status: code('status').default('SUBMITTED'),
}, (t) => [uniqueIndex('quote_requests_id_store_uq').on(t.id, t.storeId),
  index('quote_requests_store_status_idx').on(t.storeId, t.status, t.createdAt), index('quote_requests_buyer_created_idx').on(t.buyerAccountId, t.createdAt),
  enumCheck('quote_requests', 'status', ['SUBMITTED', 'OFFERED', 'REJECTED', 'CLOSED']),
]);

export const quoteRequestLines = mysqlTable('quote_request_lines', {
  ...mutable(), quoteRequestId: uuid('quote_request_id').notNull(), storeId: uuid('store_id').notNull(),
  skuId: uuid('sku_id').notNull(), quantity: int('quantity').notNull(), productSnapshot: snapshot('product_snapshot'),
}, (t) => [uniqueIndex('quote_request_lines_sku_uq').on(t.quoteRequestId, t.skuId),
  foreignKey({ name: 'quote_request_lines_request_store_fk', columns: [t.quoteRequestId, t.storeId], foreignColumns: [quoteRequests.id, quoteRequests.storeId] }),
  foreignKey({ name: 'quote_request_lines_sku_store_fk', columns: [t.skuId, t.storeId], foreignColumns: [skus.id, skus.storeId] }),
  check('quote_request_lines_quantity_ck', sql`quantity > 0`),
]);

export const quoteVersions = mysqlTable('quote_versions', {
  ...mutable(), quoteRequestId: uuid('quote_request_id').notNull().references(() => quoteRequests.id),
  versionNo: int('version_no').notNull(), status: code('status').default('OFFERED'), expiresAt: instant('expires_at').notNull(),
  acceptedBy: uuid('accepted_by').references(() => users.id), acceptedAt: instant('accepted_at'),
  activeRequestId: uuid('active_request_id').generatedAlwaysAs(sql`CASE WHEN status IN ('OFFERED', 'ACCEPTED') THEN quote_request_id ELSE NULL END`, { mode: 'stored' }),
}, (t) => [uniqueIndex('quote_versions_request_version_uq').on(t.quoteRequestId, t.versionNo), uniqueIndex('quote_versions_active_uq').on(t.activeRequestId),
  enumCheck('quote_versions', 'status', ['OFFERED', 'SUPERSEDED', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'CONSUMED']),
  check('quote_versions_number_ck', sql`version_no > 0`),
]);

export const quoteLines = mysqlTable('quote_lines', {
  ...mutable(), quoteVersionId: uuid('quote_version_id').notNull().references(() => quoteVersions.id),
  skuId: uuid('sku_id').notNull().references(() => skus.id), quantity: int('quantity').notNull(),
  unitPriceGross: money('unit_price_gross'), itemSnapshot: snapshot('item_snapshot'),
}, (t) => [uniqueIndex('quote_lines_version_sku_uq').on(t.quoteVersionId, t.skuId), uniqueIndex('quote_lines_id_sku_uq').on(t.id, t.skuId),
  check('quote_lines_positive_ck', sql`quantity > 0 AND unit_price_gross > 0`), moneyCheck('quote_lines', ['unit_price_gross']),
]);

export const carts = mysqlTable('carts', {
  ...mutable(), buyerAccountId: uuid('buyer_account_id').notNull().references(() => buyerAccounts.id),
}, (t) => [uniqueIndex('carts_buyer_uq').on(t.buyerAccountId)]);

export const cartItems = mysqlTable('cart_items', {
  ...mutable(), cartId: uuid('cart_id').notNull().references(() => carts.id), skuId: uuid('sku_id').notNull().references(() => skus.id),
  quoteLineId: uuid('quote_line_id'), quantity: int('quantity').notNull(),
  catalogSkuId: uuid('catalog_sku_id').generatedAlwaysAs(sql`CASE WHEN quote_line_id IS NULL THEN sku_id ELSE NULL END`, { mode: 'stored' }),
}, (t) => [uniqueIndex('cart_items_catalog_uq').on(t.cartId, t.catalogSkuId), uniqueIndex('cart_items_quote_uq').on(t.cartId, t.quoteLineId),
  foreignKey({ name: 'cart_items_quote_sku_fk', columns: [t.quoteLineId, t.skuId], foreignColumns: [quoteLines.id, quoteLines.skuId] }),
  check('cart_items_quantity_ck', sql`quantity > 0`),
]);

export const providerAccounts = mysqlTable('provider_accounts', {
  ...mutable(), provider: code('provider'), environment: code('environment'), merchantReference: code('merchant_reference', 191),
  secretReference: code('secret_reference', 512), status: code('status').default('ACTIVE'), capabilities: snapshot('capabilities'),
}, (t) => [uniqueIndex('provider_accounts_identity_uq').on(t.provider, t.environment, t.merchantReference),
  enumCheck('provider_accounts', 'provider', ['MIDTRANS', 'BITESHIP']), enumCheck('provider_accounts', 'environment', ['SANDBOX', 'PRODUCTION']),
  enumCheck('provider_accounts', 'status', ['ACTIVE', 'DISABLED']),
]);

export const shippingQuotes = mysqlTable('shipping_quotes', {
  ...mutable(), buyerAccountId: uuid('buyer_account_id').notNull().references(() => buyerAccounts.id),
  storeId: uuid('store_id').notNull().references(() => stores.id), providerAccountId: uuid('provider_account_id').notNull().references(() => providerAccounts.id),
  inputHash: char('input_hash', { length: 64 }).notNull(), courierCode: code('courier_code', 64), serviceCode: code('service_code', 64), finalAmount: money('final_amount'),
  originSnapshot: snapshot('origin_snapshot'), destinationSnapshot: snapshot('destination_snapshot'), packageSnapshot: snapshot('package_snapshot'), priceBreakdown: snapshot('price_breakdown'),
  fetchedAt: instant('fetched_at').notNull(), validUntil: instant('valid_until').notNull(),
}, (t) => [uniqueIndex('shipping_quotes_id_store_uq').on(t.id, t.storeId),
  index('shipping_quotes_buyer_store_hash_idx').on(t.buyerAccountId, t.storeId, t.inputHash), index('shipping_quotes_expiry_idx').on(t.validUntil),
  check('shipping_quotes_period_ck', sql`valid_until > fetched_at`), moneyCheck('shipping_quotes', ['final_amount']),
]);

export const checkoutGroups = mysqlTable('checkout_groups', {
  ...mutable(), buyerAccountId: uuid('buyer_account_id').notNull().references(() => buyerAccounts.id),
  createdBy: uuid('created_by').notNull().references(() => users.id), orderNumber: code('order_number', 100), currency: currency(),
  recipientSnapshot: snapshot('recipient_snapshot'), itemsGross: money('items_gross'), shippingTotal: money('shipping_total'),
  buyerFeeTotal: money('buyer_fee_total'), platformDiscount: money('platform_discount'), grandTotal: money('grand_total'),
  orderState: code('order_state').default('AWAITING_PAYMENT'), reservationExpiresAt: instant('reservation_expires_at').notNull(), pricingSnapshot: snapshot('pricing_snapshot'),
}, (t) => [uniqueIndex('checkout_groups_order_number_uq').on(t.orderNumber), index('checkout_groups_buyer_created_idx').on(t.buyerAccountId, t.createdAt),
  enumCheck('checkout_groups', 'currency', ['IDR']),
  enumCheck('checkout_groups', 'order_state', ['AWAITING_PAYMENT', 'ACTIVE', 'CANCEL_REQUESTED', 'CANCELLED', 'EXPIRED', 'REVIEW', 'COMPLETED']),
  moneyCheck('checkout_groups', ['items_gross', 'shipping_total', 'buyer_fee_total', 'platform_discount', 'grand_total']),
  check('checkout_groups_total_ck', sql`grand_total > 0 AND grand_total + platform_discount = items_gross + shipping_total + buyer_fee_total`),
]);

export const vendorOrders = mysqlTable('vendor_orders', {
  ...mutable(), checkoutGroupId: uuid('checkout_group_id').notNull().references(() => checkoutGroups.id), storeId: uuid('store_id').notNull().references(() => stores.id),
  shippingQuoteId: uuid('shipping_quote_id').notNull(), orderNumber: code('order_number', 100),
  itemsNet: money('items_net'), itemsVat: money('items_vat'), itemsGross: money('items_gross'), shippingAmount: money('shipping_amount'),
  buyerFee: money('buyer_fee'), platformDiscount: money('platform_discount'), buyerTotal: money('buyer_total'),
  fulfillmentStatus: code('fulfillment_status').default('UNFULFILLED'), commissionAmount: money('commission_amount'), commissionVat: money('commission_vat'), sellerWithholding: money('seller_withholding'),
  sellerTaxSnapshot: snapshot('seller_tax_snapshot'), originSnapshot: snapshot('origin_snapshot'), completedAt: instant('completed_at'), disputeDeadline: instant('dispute_deadline'),
}, (t) => [uniqueIndex('vendor_orders_number_uq').on(t.orderNumber), uniqueIndex('vendor_orders_group_store_uq').on(t.checkoutGroupId, t.storeId),
  uniqueIndex('vendor_orders_id_store_uq').on(t.id, t.storeId), uniqueIndex('vendor_orders_id_group_uq').on(t.id, t.checkoutGroupId),
  foreignKey({ name: 'vendor_orders_shipping_store_fk', columns: [t.shippingQuoteId, t.storeId], foreignColumns: [shippingQuotes.id, shippingQuotes.storeId] }),
  index('vendor_orders_store_status_idx').on(t.storeId, t.fulfillmentStatus, t.createdAt),
  enumCheck('vendor_orders', 'fulfillment_status', ['UNFULFILLED', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'COMPLETED', 'CANCELLED', 'REVIEW']),
  moneyCheck('vendor_orders', ['items_net', 'items_vat', 'items_gross', 'shipping_amount', 'buyer_fee', 'platform_discount', 'buyer_total', 'commission_amount', 'commission_vat', 'seller_withholding']),
  check('vendor_orders_total_ck', sql`items_gross = items_net + items_vat AND buyer_total + platform_discount = items_gross + shipping_amount + buyer_fee`),
]);

export const orderItems = mysqlTable('order_items', {
  ...mutable(), vendorOrderId: uuid('vendor_order_id').notNull(), storeId: uuid('store_id').notNull(), skuId: uuid('sku_id').notNull(), quoteLineId: uuid('quote_line_id'),
  quantity: int('quantity').notNull(), unitPriceGross: money('unit_price_gross'), lineNet: money('line_net'), lineVat: money('line_vat'), lineGross: money('line_gross'), vendorDiscount: money('vendor_discount'),
  commissionAmount: money('commission_amount'), commissionVat: money('commission_vat'), sellerWithholding: money('seller_withholding'),
  productSnapshot: snapshot('product_snapshot'), taxSnapshot: snapshot('tax_snapshot'), feeSnapshot: snapshot('fee_snapshot'),
}, (t) => [uniqueIndex('order_items_id_order_uq').on(t.id, t.vendorOrderId), uniqueIndex('order_items_id_sku_uq').on(t.id, t.skuId),
  foreignKey({ name: 'order_items_order_store_fk', columns: [t.vendorOrderId, t.storeId], foreignColumns: [vendorOrders.id, vendorOrders.storeId] }),
  foreignKey({ name: 'order_items_sku_store_fk', columns: [t.skuId, t.storeId], foreignColumns: [skus.id, skus.storeId] }),
  foreignKey({ name: 'order_items_quote_sku_fk', columns: [t.quoteLineId, t.skuId], foreignColumns: [quoteLines.id, quoteLines.skuId] }),
  moneyCheck('order_items', ['unit_price_gross', 'line_net', 'line_vat', 'line_gross', 'vendor_discount', 'commission_amount', 'commission_vat', 'seller_withholding']),
  check('order_items_total_ck', sql`quantity > 0 AND line_gross = line_net + line_vat AND line_gross + vendor_discount = CAST(quantity AS DECIMAL(19,0)) * unit_price_gross AND (quote_line_id IS NULL OR vendor_discount = 0)`),
]);

export const quoteRedemptions = mysqlTable('quote_redemptions', {
  ...identity(), quoteVersionId: uuid('quote_version_id').notNull().references(() => quoteVersions.id), vendorOrderId: uuid('vendor_order_id').notNull().references(() => vendorOrders.id),
}, (t) => [uniqueIndex('quote_redemptions_version_uq').on(t.quoteVersionId)]);

export const stockReservations = mysqlTable('stock_reservations', {
  ...mutable(), orderItemId: uuid('order_item_id').notNull(), skuId: uuid('sku_id').notNull(), inventoryId: uuid('inventory_id').notNull(),
  quantity: int('quantity').notNull(), state: code('state').default('ACTIVE'), expiresAt: instant('expires_at').notNull(), closedAt: instant('closed_at'),
}, (t) => [uniqueIndex('stock_reservations_item_uq').on(t.orderItemId), index('stock_reservations_state_expiry_idx').on(t.state, t.expiresAt),
  foreignKey({ name: 'stock_reservations_item_sku_fk', columns: [t.orderItemId, t.skuId], foreignColumns: [orderItems.id, orderItems.skuId] }),
  foreignKey({ name: 'stock_reservations_inventory_sku_fk', columns: [t.inventoryId, t.skuId], foreignColumns: [inventoryBalances.id, inventoryBalances.skuId] }),
  enumCheck('stock_reservations', 'state', ['ACTIVE', 'CONSUMED', 'RELEASED']), check('stock_reservations_quantity_ck', sql`quantity > 0`),
  check('stock_reservations_closed_ck', sql`(state = 'ACTIVE' AND closed_at IS NULL) OR (state <> 'ACTIVE' AND closed_at IS NOT NULL)`),
]);

export const paymentAttempts = mysqlTable('payment_attempts', {
  ...mutable(), checkoutGroupId: uuid('checkout_group_id').notNull().references(() => checkoutGroups.id), providerAccountId: uuid('provider_account_id').notNull().references(() => providerAccounts.id),
  providerOrderId: code('provider_order_id', 191), providerTransactionId: varchar('provider_transaction_id', { length: 191 }),
  expectedAmount: money('expected_amount'), currency: currency(), channel: varchar('channel', { length: 64 }), state: code('state').default('CREATING'),
  providerStatus: varchar('provider_status', { length: 100 }), expiresAt: instant('expires_at'), terminalVerifiedAt: instant('terminal_verified_at'),
  sessionSecretCiphertext: text('session_secret_ciphertext'),
  openCheckoutGroupId: uuid('open_checkout_group_id').generatedAlwaysAs(sql`CASE WHEN terminal_verified_at IS NULL THEN checkout_group_id ELSE NULL END`, { mode: 'stored' }),
}, (t) => [uniqueIndex('payment_attempts_provider_order_uq').on(t.providerAccountId, t.providerOrderId), uniqueIndex('payment_attempts_provider_transaction_uq').on(t.providerAccountId, t.providerTransactionId),
  uniqueIndex('payment_attempts_open_group_uq').on(t.openCheckoutGroupId), uniqueIndex('payment_attempts_identity_uq').on(t.id, t.checkoutGroupId, t.providerAccountId),
  enumCheck('payment_attempts', 'currency', ['IDR']), enumCheck('payment_attempts', 'state', ['CREATING', 'PENDING', 'CANCEL_REQUESTED', 'UNKNOWN', 'TERMINAL']),
  moneyCheck('payment_attempts', ['expected_amount']), check('payment_attempts_positive_ck', sql`expected_amount > 0`),
]);

export const paymentEvents = mysqlTable('payment_events', {
  ...mutable(), providerAccountId: uuid('provider_account_id').notNull().references(() => providerAccounts.id),
  paymentAttemptId: uuid('payment_attempt_id').references(() => paymentAttempts.id), dedupeKey: code('dedupe_key', 191), source: code('source'),
  payloadReference: code('payload_reference', 512), verificationStatus: code('verification_status').default('UNVERIFIED'), processingStatus: code('processing_status').default('RECEIVED'),
  lastError: text('last_error'), processedAt: instant('processed_at'),
}, (t) => [uniqueIndex('payment_events_dedupe_uq').on(t.providerAccountId, t.dedupeKey), index('payment_events_processing_idx').on(t.processingStatus, t.createdAt),
  enumCheck('payment_events', 'source', ['WEBHOOK', 'POLL', 'RECONCILIATION']), enumCheck('payment_events', 'verification_status', ['UNVERIFIED', 'VERIFIED', 'REJECTED']),
  enumCheck('payment_events', 'processing_status', ['RECEIVED', 'PROCESSING', 'DONE', 'ERROR']),
]);

export const paymentReceipts = mysqlTable('payment_receipts', {
  ...mutable(), paymentAttemptId: uuid('payment_attempt_id').notNull(), checkoutGroupId: uuid('checkout_group_id').notNull(), providerAccountId: uuid('provider_account_id').notNull(),
  providerTransactionId: code('provider_transaction_id', 191), amount: money('amount'), receivedAt: instant('received_at').notNull(), applicationStatus: code('application_status').default('UNAPPLIED'),
  feeActual: bigint('fee_actual', { mode: 'number', unsigned: true }), feeTaxActual: bigint('fee_tax_actual', { mode: 'number', unsigned: true }), providerFundsAvailableAt: instant('provider_funds_available_at'),
  appliedCheckoutGroupId: uuid('applied_checkout_group_id').generatedAlwaysAs(sql`CASE WHEN application_status = 'APPLIED' THEN checkout_group_id ELSE NULL END`, { mode: 'stored' }),
}, (t) => [uniqueIndex('payment_receipts_attempt_uq').on(t.paymentAttemptId), uniqueIndex('payment_receipts_provider_transaction_uq').on(t.providerAccountId, t.providerTransactionId),
  uniqueIndex('payment_receipts_id_group_uq').on(t.id, t.checkoutGroupId), uniqueIndex('payment_receipts_applied_group_uq').on(t.appliedCheckoutGroupId),
  foreignKey({ name: 'payment_receipts_attempt_scope_fk', columns: [t.paymentAttemptId, t.checkoutGroupId, t.providerAccountId], foreignColumns: [paymentAttempts.id, paymentAttempts.checkoutGroupId, paymentAttempts.providerAccountId] }),
  enumCheck('payment_receipts', 'application_status', ['UNAPPLIED', 'APPLIED', 'EXCESS_REVIEW']),
  moneyCheck('payment_receipts', ['amount', 'fee_actual', 'fee_tax_actual']), check('payment_receipts_positive_ck', sql`amount > 0`),
]);

export const paymentAllocations = mysqlTable('payment_allocations', {
  ...identity(), paymentReceiptId: uuid('payment_receipt_id').notNull(), checkoutGroupId: uuid('checkout_group_id').notNull(), vendorOrderId: uuid('vendor_order_id').notNull(), amount: money('amount'),
}, (t) => [uniqueIndex('payment_allocations_receipt_order_uq').on(t.paymentReceiptId, t.vendorOrderId),
  foreignKey({ name: 'payment_allocations_receipt_group_fk', columns: [t.paymentReceiptId, t.checkoutGroupId], foreignColumns: [paymentReceipts.id, paymentReceipts.checkoutGroupId] }),
  foreignKey({ name: 'payment_allocations_order_group_fk', columns: [t.vendorOrderId, t.checkoutGroupId], foreignColumns: [vendorOrders.id, vendorOrders.checkoutGroupId] }),
  moneyCheck('payment_allocations', ['amount']), check('payment_allocations_positive_ck', sql`amount > 0`),
]);

export const shipments = mysqlTable('shipments', {
  ...mutable(), vendorOrderId: uuid('vendor_order_id').notNull().references(() => vendorOrders.id), providerAccountId: uuid('provider_account_id').notNull().references(() => providerAccounts.id),
  bookingReference: code('booking_reference', 191), providerOrderId: varchar('provider_order_id', { length: 191 }), waybillId: varchar('waybill_id', { length: 191 }),
  state: code('state').default('NOT_BOOKED'), courierCode: code('courier_code', 64), serviceCode: code('service_code', 64), packageSnapshot: snapshot('package_snapshot'),
  quotedAmount: money('quoted_amount'), actualAmount: money('actual_amount'), vendorReadyAt: instant('vendor_ready_at'), bookedAt: instant('booked_at'), deliveredAt: instant('delivered_at'),
}, (t) => [uniqueIndex('shipments_order_uq').on(t.vendorOrderId), uniqueIndex('shipments_booking_uq').on(t.bookingReference), uniqueIndex('shipments_provider_order_uq').on(t.providerAccountId, t.providerOrderId),
  index('shipments_state_updated_idx').on(t.state, t.updatedAt), enumCheck('shipments', 'state', ['NOT_BOOKED', 'BOOKING', 'BOOKED', 'PICKED_UP', 'IN_TRANSIT', 'DELIVERED', 'CANCELLED', 'SHIPMENT_REVIEW']),
  moneyCheck('shipments', ['quoted_amount', 'actual_amount']),
]);

export const shipmentEvents = mysqlTable('shipment_events', {
  ...mutable(), shipmentId: uuid('shipment_id').references(() => shipments.id), providerAccountId: uuid('provider_account_id').notNull().references(() => providerAccounts.id),
  dedupeKey: code('dedupe_key', 191), eventType: code('event_type', 100), payloadReference: code('payload_reference', 512),
  verificationStatus: code('verification_status').default('UNVERIFIED'), processingStatus: code('processing_status').default('RECEIVED'),
  providerOccurredAt: instant('provider_occurred_at'), processedAt: instant('processed_at'),
}, (t) => [uniqueIndex('shipment_events_dedupe_uq').on(t.providerAccountId, t.dedupeKey), index('shipment_events_processing_idx').on(t.processingStatus, t.createdAt),
  enumCheck('shipment_events', 'verification_status', ['UNVERIFIED', 'VERIFIED', 'REJECTED']), enumCheck('shipment_events', 'processing_status', ['RECEIVED', 'PROCESSING', 'DONE', 'ERROR']),
]);

export const refunds = mysqlTable('refunds', {
  ...mutable(), paymentReceiptId: uuid('payment_receipt_id').notNull().references(() => paymentReceipts.id), reference: code('reference', 191),
  providerRefundId: varchar('provider_refund_id', { length: 191 }), amount: money('amount'), state: code('state').default('REQUESTED'), reason: text('reason').notNull(),
  requestedBy: uuid('requested_by').references(() => users.id), approvedBy: uuid('approved_by').references(() => users.id),
  proofDocumentId: uuid('proof_document_id').references(() => documents.id), completedAt: instant('completed_at'),
}, (t) => [uniqueIndex('refunds_reference_uq').on(t.reference), uniqueIndex('refunds_provider_reference_uq').on(t.paymentReceiptId, t.providerRefundId), index('refunds_receipt_state_idx').on(t.paymentReceiptId, t.state),
  enumCheck('refunds', 'state', ['REQUESTED', 'APPROVED', 'PROCESSING', 'UNKNOWN', 'SUCCEEDED', 'FAILED', 'REJECTED']), moneyCheck('refunds', ['amount']), check('refunds_positive_ck', sql`amount > 0`),
]);

export const refundLines = mysqlTable('refund_lines', {
  ...mutable(), refundId: uuid('refund_id').notNull().references(() => refunds.id), vendorOrderId: uuid('vendor_order_id').references(() => vendorOrders.id), orderItemId: uuid('order_item_id'),
  component: code('component'), amount: money('amount'), quantity: int('quantity'), taxReversalSnapshot: snapshot('tax_reversal_snapshot'), feeReversalSnapshot: snapshot('fee_reversal_snapshot'),
}, (t) => [index('refund_lines_refund_idx').on(t.refundId),
  foreignKey({ name: 'refund_lines_item_order_fk', columns: [t.orderItemId, t.vendorOrderId], foreignColumns: [orderItems.id, orderItems.vendorOrderId] }),
  enumCheck('refund_lines', 'component', ['ITEM', 'SHIPPING', 'BUYER_FEE', 'EXCESS_PAYMENT']), moneyCheck('refund_lines', ['amount']),
  check('refund_lines_positive_ck', sql`amount > 0 AND (quantity IS NULL OR quantity > 0)`),
  check('refund_lines_scope_ck', sql`(component = 'EXCESS_PAYMENT' AND vendor_order_id IS NULL AND order_item_id IS NULL) OR (component = 'ITEM' AND vendor_order_id IS NOT NULL AND order_item_id IS NOT NULL) OR (component IN ('SHIPPING', 'BUYER_FEE') AND vendor_order_id IS NOT NULL AND order_item_id IS NULL)`),
]);

export const orderCases = mysqlTable('order_cases', {
  ...mutable(), vendorOrderId: uuid('vendor_order_id').notNull().references(() => vendorOrders.id), openedBy: uuid('opened_by').notNull().references(() => users.id),
  kind: code('kind'), state: code('state').default('OPEN'), reason: text('reason'), resolution: text('resolution'), resolvedBy: uuid('resolved_by').references(() => users.id), resolvedAt: instant('resolved_at'),
}, (t) => [index('order_cases_order_state_idx').on(t.vendorOrderId, t.state), enumCheck('order_cases', 'kind', ['DISPUTE', 'DELIVERY_FAILURE', 'TAX_REVIEW', 'OTHER']), enumCheck('order_cases', 'state', ['OPEN', 'RESOLVED', 'REJECTED'])]);

export const ledgerAccounts = mysqlTable('ledger_accounts', {
  ...mutable(), code: code('code', 100), storeId: uuid('store_id').references(() => stores.id), kind: code('kind'), currency: currency(), name: code('name', 200),
}, (t) => [uniqueIndex('ledger_accounts_code_uq').on(t.code), index('ledger_accounts_store_kind_idx').on(t.storeId, t.kind),
  enumCheck('ledger_accounts', 'kind', ['ASSET', 'LIABILITY', 'INCOME', 'EXPENSE', 'EQUITY']), enumCheck('ledger_accounts', 'currency', ['IDR']),
]);

export const journalEntries = mysqlTable('journal_entries', {
  ...mutable(), eventKey: code('event_key', 191), status: code('status').default('DRAFT'),
  paymentReceiptId: uuid('payment_receipt_id').references(() => paymentReceipts.id), refundId: uuid('refund_id').references(() => refunds.id),
  payoutId: uuid('payout_id').references((): AnyMySqlColumn => payouts.id), reversalOfId: uuid('reversal_of_id').references((): AnyMySqlColumn => journalEntries.id),
  postedAt: instant('posted_at'), description: text('description').notNull(),
}, (t) => [uniqueIndex('journal_entries_event_uq').on(t.eventKey), uniqueIndex('journal_entries_reversal_uq').on(t.reversalOfId),
  enumCheck('journal_entries', 'status', ['DRAFT', 'POSTED']), check('journal_entries_posted_at_ck', sql`(status = 'DRAFT' AND posted_at IS NULL) OR (status = 'POSTED' AND posted_at IS NOT NULL)`),
  check('journal_entries_not_self_ck', sql`reversal_of_id IS NULL OR reversal_of_id <> id`),
]);

export const journalLines = mysqlTable('journal_lines', {
  ...mutable(), journalEntryId: uuid('journal_entry_id').notNull().references(() => journalEntries.id), ledgerAccountId: uuid('ledger_account_id').notNull().references(() => ledgerAccounts.id),
  vendorOrderId: uuid('vendor_order_id').references(() => vendorOrders.id), debit: money('debit').default(0), credit: money('credit').default(0), lineNo: int('line_no').notNull(),
}, (t) => [uniqueIndex('journal_lines_entry_line_uq').on(t.journalEntryId, t.lineNo), index('journal_lines_account_idx').on(t.ledgerAccountId, t.createdAt),
  moneyCheck('journal_lines', ['debit', 'credit']), check('journal_lines_sided_ck', sql`line_no > 0 AND ((debit > 0 AND credit = 0) OR (credit > 0 AND debit = 0))`),
]);

export const vendorPayables = mysqlTable('vendor_payables', {
  ...mutable(), vendorOrderId: uuid('vendor_order_id').notNull().references(() => vendorOrders.id), accruedAmount: money('accrued_amount'),
  adjustmentAmount: bigint('adjustment_amount', { mode: 'number' }).notNull().default(0), reservedPayoutAmount: money('reserved_payout_amount').default(0), paidAmount: money('paid_amount').default(0),
  eligibility: code('eligibility').default('BLOCKED'), eligibleAt: instant('eligible_at'), lastJournalEntryId: uuid('last_journal_entry_id').references(() => journalEntries.id),
}, (t) => [uniqueIndex('vendor_payables_order_uq').on(t.vendorOrderId), index('vendor_payables_eligibility_idx').on(t.eligibility, t.eligibleAt),
  enumCheck('vendor_payables', 'eligibility', ['BLOCKED', 'ELIGIBLE']), moneyCheck('vendor_payables', ['accrued_amount', 'reserved_payout_amount', 'paid_amount']),
  check('vendor_payables_adjustment_ck', sql`adjustment_amount BETWEEN -9007199254740991 AND 9007199254740991`),
]);

export const bankAccounts = mysqlTable('bank_accounts', {
  ...mutable(), legalEntityId: uuid('legal_entity_id').notNull().references(() => legalEntities.id), bankCode: code('bank_code', 50), accountName: code('account_name', 200),
  accountNumberCiphertext: text('account_number_ciphertext').notNull(), accountFingerprint: char('account_fingerprint', { length: 64 }).notNull(),
  status: code('status').default('PENDING'), verifiedBy: uuid('verified_by').references(() => users.id), verifiedAt: instant('verified_at'),
}, (t) => [uniqueIndex('bank_accounts_identity_uq').on(t.legalEntityId, t.bankCode, t.accountFingerprint), enumCheck('bank_accounts', 'status', ['PENDING', 'VERIFIED', 'DISABLED'])]);

export const payouts = mysqlTable('payouts', {
  ...mutable(), storeId: uuid('store_id').notNull().references(() => stores.id), bankAccountId: uuid('bank_account_id').notNull().references(() => bankAccounts.id),
  reference: code('reference', 191), amount: money('amount'), state: code('state').default('DRAFT'), requestedBy: uuid('requested_by').references(() => users.id), approvedBy: uuid('approved_by').references(() => users.id),
  beneficiarySnapshot: snapshot('beneficiary_snapshot'), transferReference: varchar('transfer_reference', { length: 191 }), proofDocumentId: uuid('proof_document_id').references(() => documents.id), paidAt: instant('paid_at'),
}, (t) => [uniqueIndex('payouts_reference_uq').on(t.reference), index('payouts_store_state_idx').on(t.storeId, t.state),
  enumCheck('payouts', 'state', ['DRAFT', 'APPROVED', 'PROCESSING', 'UNKNOWN', 'PAID', 'FAILED', 'REJECTED']), moneyCheck('payouts', ['amount']),
  check('payouts_positive_ck', sql`amount > 0`), check('payouts_maker_checker_ck', sql`approved_by IS NULL OR (requested_by IS NOT NULL AND requested_by <> approved_by)`),
]);

export const payoutLines = mysqlTable('payout_lines', {
  ...mutable(), payoutId: uuid('payout_id').notNull().references(() => payouts.id), vendorPayableId: uuid('vendor_payable_id').notNull().references(() => vendorPayables.id), amount: money('amount'),
}, (t) => [uniqueIndex('payout_lines_payout_payable_uq').on(t.payoutId, t.vendorPayableId), moneyCheck('payout_lines', ['amount']), check('payout_lines_positive_ck', sql`amount > 0`)]);

export const reconciliationRuns = mysqlTable('reconciliation_runs', {
  ...mutable(), providerAccountId: uuid('provider_account_id').notNull().references(() => providerAccounts.id), periodStart: instant('period_start').notNull(), periodEnd: instant('period_end').notNull(),
  state: code('state').default('RUNNING'), sourceDocumentId: uuid('source_document_id').references(() => documents.id), finishedAt: instant('finished_at'),
}, (t) => [index('reconciliation_runs_provider_period_idx').on(t.providerAccountId, t.periodStart), enumCheck('reconciliation_runs', 'state', ['RUNNING', 'COMPLETED', 'FAILED']), check('reconciliation_runs_period_ck', sql`period_end > period_start`)]);

export const reconciliationItems = mysqlTable('reconciliation_items', {
  ...mutable(), runId: uuid('run_id').notNull().references(() => reconciliationRuns.id), paymentAttemptId: uuid('payment_attempt_id').references(() => paymentAttempts.id),
  externalReference: code('external_reference', 191), expectedAmount: bigint('expected_amount', { mode: 'number', unsigned: true }), actualAmount: bigint('actual_amount', { mode: 'number', unsigned: true }),
  kind: code('kind'), state: code('state').default('OPEN'), resolutionJournalId: uuid('resolution_journal_id').references(() => journalEntries.id),
}, (t) => [uniqueIndex('reconciliation_items_identity_uq').on(t.runId, t.externalReference, t.kind),
  enumCheck('reconciliation_items', 'kind', ['MISSING_LOCAL', 'MISSING_PROVIDER', 'AMOUNT', 'FEE', 'STATUS']), enumCheck('reconciliation_items', 'state', ['OPEN', 'RESOLVED']), moneyCheck('reconciliation_items', ['expected_amount', 'actual_amount']),
]);
