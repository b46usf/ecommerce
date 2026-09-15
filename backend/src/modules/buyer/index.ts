import { randomUUID } from 'node:crypto';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { addresses, buyerAccounts, organizations, notifications, taxClasses } from '../../database/schema.js';
import { operation, one, values, page, activeAddress, version, audit } from '../../shared/operations.js';
import { AppError } from '../../shared/errors.js';

export async function buyerRoutes(app: FastifyInstance) {
  operation(app, 'createOrganization', async ctx => {
    const id = randomUUID();
    const fields = values(ctx.body);
    for (const value of Object.values(fields)) if (typeof value === 'string' && (!value.trim() || value.length > 200)) throw new AppError(422, 'INVALID_ORGANIZATION', 'Profil organisasi tidak valid.');
    await ctx.db.insert(organizations).values({ ...fields, id } as any);
    const accountId = randomUUID();
    await ctx.db.insert(buyerAccounts).values({ id: accountId, managerUserId: ctx.user.id, organizationId: id, kind: 'ORGANIZATION' });
    await audit(ctx, 'ORGANIZATION', id, 'CREATE_ORGANIZATION');
    return { ...await one(ctx.db, buyerAccounts, accountId), organization_name: ctx.body.name };
  });
  operation(app, 'listAddresses', ctx => page(ctx.db, addresses, ctx.query, ['addresses', ctx.params.buyerAccountId], and(eq(addresses.buyerAccountId, ctx.params.buyerAccountId), isNull(addresses.archivedAt))));
  operation(app, 'getAddress', ctx => activeAddress(ctx.db, ctx.params.buyerAccountId, ctx.params.addressId));
  for (const id of ['createAddress', 'updateAddress'] as const) operation(app, id, async ctx => {
    await one(ctx.db, buyerAccounts, ctx.params.buyerAccountId, undefined, true);
    const existing = id === 'updateAddress' ? await activeAddress(ctx.db, ctx.params.buyerAccountId, ctx.params.addressId) : undefined;
    if (existing) version(ctx.request, existing);
    if ((ctx.body.latitude === undefined) !== (ctx.body.longitude === undefined)) throw new AppError(422, 'INVALID_COORDINATES', 'Koordinat harus dikirim bersama.');
    const fields = values(ctx.body);
    for (const [key, value] of Object.entries(fields)) if (typeof value === 'string' && (!value.trim() || value.length > (key === 'street' ? 2000 : 150))) throw new AppError(422, 'INVALID_ADDRESS', 'Alamat tidak valid.');
    if (fields.latitude !== undefined) { fields.latitude = Number(fields.latitude).toFixed(7); fields.longitude = Number(fields.longitude).toFixed(7); }
    if (fields.isDefault) await ctx.db.update(addresses).set({ isDefault: false, rowVersion: sql`${addresses.rowVersion} + 1` }).where(and(eq(addresses.buyerAccountId, ctx.params.buyerAccountId), eq(addresses.isDefault, true)));
    const addressId = existing?.id ?? randomUUID();
    if (existing) await ctx.db.update(addresses).set({ ...fields, rowVersion: existing.rowVersion + 1 }).where(eq(addresses.id, addressId));
    else await ctx.db.insert(addresses).values({ ...fields, id: addressId, buyerAccountId: ctx.params.buyerAccountId } as any);
    return one(ctx.db, addresses, addressId);
  }, { transaction: true });
  operation(app, 'archiveAddress', async ctx => {
    await one(ctx.db, buyerAccounts, ctx.params.buyerAccountId, undefined, true);
    const address = await activeAddress(ctx.db, ctx.params.buyerAccountId, ctx.params.addressId); version(ctx.request, address);
    await ctx.db.update(addresses).set({ archivedAt: new Date(), isDefault: false, rowVersion: address.rowVersion + 1 }).where(eq(addresses.id, address.id));
  }, { transaction: true });
  operation(app, 'listNotifications', async ctx => {
    const result = await page(ctx.db, notifications, ctx.query, ['notifications', ctx.user.id], eq(notifications.userId, ctx.user.id));
    return { ...result, items: result.items.map(notificationView) };
  });
  operation(app, 'readNotification', async ctx => {
    const row = await one(ctx.db, notifications, ctx.params.notificationId, eq(notifications.userId, ctx.user.id), true);
    if (!row.readAt) await ctx.db.update(notifications).set({ readAt: new Date(), rowVersion: row.rowVersion + 1 }).where(eq(notifications.id, row.id));
    return notificationView(await one(ctx.db, notifications, row.id));
  }, { transaction: true });
  operation(app, 'listVendorTaxClasses', ctx => page(ctx.db, taxClasses, ctx.query, ['vendor-tax', ctx.params.storeId], eq(taxClasses.status, 'ACTIVE')));
}

function notificationView(row: any) { return { ...row, message: row.payload.message ?? '', resource_id: row.payload.resource_id }; }
