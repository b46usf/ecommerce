import { randomUUID } from 'node:crypto';
import { and, asc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { bankAccounts, categories, documents, feePolicies, legalEntities, stores, taxClasses, taxPolicies, taxProfiles } from '../../database/schema.js';
import { AppError } from '../../shared/errors.js';
import { encryptSensitive, decryptSensitive, fingerprint } from '../../shared/crypto.js';
import { audit, one, operation, page, version, type Context } from '../../shared/operations.js';
import { boundedText } from '../catalog/policy.js';
import { accountNumber, fraction, maskedAccount, overlaps, period } from './policy.js';

function bankView(app: FastifyInstance, row: typeof bankAccounts.$inferSelect) {
  return { ...row, accountNumberMasked: maskedAccount(decryptSensitive(row.accountNumberCiphertext, app.services.config.dataEncryptionKey, 'bank-account-number')) };
}
function profileView(row: typeof taxProfiles.$inferSelect) {
  return { ...row, documentIds: row.profileSnapshot.document_ids ?? [] };
}
async function documentEvidence(ctx: Context, ids: string[], entityId: string, verified = false) {
  if (ids.length > 30 || new Set(ids).size !== ids.length) throw new AppError(422, 'INVALID_DOCUMENTS', 'Daftar dokumen harus unik dan maksimal 30.');
  const evidence: (typeof documents.$inferSelect)[] = [];
  for (const id of [...ids].sort()) {
    const document = await one(ctx.db, documents, id, eq(documents.legalEntityId, entityId), true);
    if (verified && document.verificationStatus !== 'VERIFIED') throw new AppError(422, 'DOCUMENT_UNVERIFIED', 'Seluruh dokumen pendukung harus terverifikasi.');
    evidence.push(document);
  }
  return evidence;
}

export async function financeConfigRoutes(app: FastifyInstance) {
  operation(app, 'createBankAccount', async ctx => {
    const store = await one(ctx.db, stores, ctx.params.storeId, undefined, true);
    const entity = await one(ctx.db, legalEntities, store.legalEntityId, undefined, true);
    if (entity.status === 'SUSPENDED') throw new AppError(409, 'ENTITY_SUSPENDED', 'Entitas penjual ditangguhkan.');
    const id = randomUUID(), number = accountNumber(ctx.body.account_number);
    const bankCode = boundedText(ctx.body.bank_code, 'bank_code', 50).toUpperCase();
    await ctx.db.insert(bankAccounts).values({ id, legalEntityId: entity.id, bankCode,
      accountName: boundedText(ctx.body.account_name, 'account_name', 200),
      accountNumberCiphertext: encryptSensitive(number, app.services.config.dataEncryptionKey, 'bank-account-number'),
      accountFingerprint: fingerprint(number, app.services.config.dataEncryptionKey), status: 'PENDING' });
    await audit(ctx, 'BANK_ACCOUNT', id, 'BANK_ACCOUNT_CREATED', { legal_entity_id: entity.id, bank_code: bankCode });
    return bankView(app, await one(ctx.db, bankAccounts, id));
  });
  operation(app, 'listBankAccounts', async ctx => {
    const store = await one(ctx.db, stores, ctx.params.storeId);
    const result = await page(ctx.db, bankAccounts, ctx.query, ['bank-accounts', store.legalEntityId], eq(bankAccounts.legalEntityId, store.legalEntityId));
    return { ...result, items: result.items.map((row: typeof bankAccounts.$inferSelect) => bankView(app, row)) };
  });
  operation(app, 'verifyBankAccount', async ctx => {
    const row = await one(ctx.db, bankAccounts, ctx.params.bankAccountId, undefined, true);
    version(ctx.request, row);
    if (row.status !== 'PENDING') throw new AppError(409, 'INVALID_STATE', 'Rekening tidak sedang menunggu verifikasi.');
    const entity = await one(ctx.db, legalEntities, row.legalEntityId, undefined, true);
    if (ctx.body.decision === 'APPROVE' && entity.status !== 'VERIFIED') throw new AppError(422, 'ENTITY_UNVERIFIED', 'Entitas harus terverifikasi sebelum rekening disetujui.');
    const status = ctx.body.decision === 'APPROVE' ? 'VERIFIED' : 'DISABLED';
    await ctx.db.update(bankAccounts).set({ status, verifiedBy: ctx.user.id, verifiedAt: new Date(), rowVersion: row.rowVersion + 1 }).where(eq(bankAccounts.id, row.id));
    await audit(ctx, 'BANK_ACCOUNT', row.id, 'BANK_ACCOUNT_DECISION', { from: row.status, to: status });
    return bankView(app, await one(ctx.db, bankAccounts, row.id));
  });

  operation(app, 'createTaxProfile', async ctx => {
    const entity = await one(ctx.db, legalEntities, ctx.params.legalEntityId, undefined, true);
    const dates = period(ctx.body.valid_from, ctx.body.valid_until);
    const ids: string[] = ctx.body.document_ids;
    await documentEvidence(ctx, ids, entity.id);
    if (ctx.body.collector_enabled && (!entity.isPlatform || !ctx.body.collector_basis_document_id)) {
      throw new AppError(422, 'INVALID_COLLECTOR', 'Pemungut hanya dapat diaktifkan untuk entitas platform dengan dasar penunjukan.');
    }
    if (!ctx.body.collector_enabled && ctx.body.collector_basis_document_id) throw new AppError(422, 'INVALID_COLLECTOR', 'Dasar pemungut hanya berlaku bila pemungut diaktifkan.');
    if (ctx.body.collector_basis_document_id) await documentEvidence(ctx, [ctx.body.collector_basis_document_id], entity.id);
    const id = randomUUID();
    await ctx.db.insert(taxProfiles).values({ id, legalEntityId: entity.id, ...dates, isPkp: ctx.body.is_pkp,
      collectorEnabled: ctx.body.collector_enabled, collectorBasisDocumentId: ctx.body.collector_basis_document_id ?? null,
      profileSnapshot: { document_ids: ids }, status: 'DRAFT' });
    await audit(ctx, 'TAX_PROFILE', id, 'TAX_PROFILE_CREATED', { legal_entity_id: entity.id });
    return profileView(await one(ctx.db, taxProfiles, id));
  });
  operation(app, 'listTaxProfiles', async ctx => {
    await one(ctx.db, legalEntities, ctx.params.legalEntityId);
    const result = await page(ctx.db, taxProfiles, ctx.query, ['tax-profiles', ctx.params.legalEntityId], eq(taxProfiles.legalEntityId, ctx.params.legalEntityId));
    return { ...result, items: result.items.map(profileView) };
  });
  operation(app, 'verifyTaxProfile', async ctx => {
    // Every verification locks its parent first, including two different draft profiles.
    const candidate = await one(ctx.db, taxProfiles, ctx.params.taxProfileId);
    const entity = await one(ctx.db, legalEntities, candidate.legalEntityId, undefined, true);
    const row = await one(ctx.db, taxProfiles, candidate.id, undefined, true);
    version(ctx.request, row);
    if (row.status !== 'DRAFT' || entity.status !== 'VERIFIED') throw new AppError(422, 'PROFILE_NOT_VERIFIABLE', 'Profil harus draft dan entitas harus terverifikasi.');
    const ids: string[] = Array.isArray(row.profileSnapshot.document_ids) ? row.profileSnapshot.document_ids : [];
    const evidence = await documentEvidence(ctx, ids, entity.id, true);
    if (!evidence.length || (row.isPkp && !evidence.some(doc => doc.documentType === 'PKP'))) throw new AppError(422, 'MISSING_TAX_EVIDENCE', 'Dokumen pendukung wajib disertakan; PKP memerlukan bukti PKP.');
    if (row.collectorEnabled) {
      if (!entity.isPlatform || !row.collectorBasisDocumentId) throw new AppError(422, 'INVALID_COLLECTOR', 'Dasar penunjukan pemungut tidak valid.');
      evidence.push(...await documentEvidence(ctx, [row.collectorBasisDocumentId], entity.id, true));
    }
    for (const doc of evidence) {
      const earliest = doc.validFrom ? new Date(`${doc.validFrom}T00:00:00Z`) : null;
      const latest = doc.validUntil ? new Date(new Date(`${doc.validUntil}T00:00:00Z`).getTime() + 86400000) : null;
      if ((earliest && row.validFrom < earliest) || (latest && (!row.validUntil || row.validUntil > latest))) {
        throw new AppError(422, 'DOCUMENT_PERIOD_MISMATCH', 'Periode profil harus tercakup dalam masa berlaku dokumen.');
      }
    }
    const active = await ctx.db.select().from(taxProfiles).where(and(eq(taxProfiles.legalEntityId, entity.id), eq(taxProfiles.status, 'VERIFIED'))).for('update');
    if (active.some(existing => overlaps(existing, row))) throw new AppError(409, 'POLICY_OVERLAP', 'Rentang profil terverifikasi bertumpuk.');
    await ctx.db.update(taxProfiles).set({ status: 'VERIFIED', verifiedBy: ctx.user.id, rowVersion: row.rowVersion + 1,
      profileSnapshot: { ...row.profileSnapshot, verified_at: new Date().toISOString(), evidence: evidence.map(doc => ({ id: doc.id, sha256: doc.sha256, row_version: doc.rowVersion })) } }).where(eq(taxProfiles.id, row.id));
    await audit(ctx, 'TAX_PROFILE', row.id, 'TAX_PROFILE_VERIFIED');
    return profileView(await one(ctx.db, taxProfiles, row.id));
  });

  operation(app, 'listFeePolicy', ctx => page(ctx.db, feePolicies, ctx.query, 'fee-policies'));
  operation(app, 'listTaxPolicy', ctx => page(ctx.db, taxPolicies, ctx.query, 'tax-policies'));
  operation(app, 'createFeePolicy', async ctx => {
    if (ctx.body.category_id) await one(ctx.db, categories, ctx.body.category_id);
    const id = randomUUID();
    await ctx.db.insert(feePolicies).values({ id, policyKey: boundedText(ctx.body.policy_key, 'policy_key', 191),
      categoryId: ctx.body.category_id ?? null, commissionRate: fraction(ctx.body.commission_rate),
      buyerFeeAmount: ctx.body.buyer_fee_amount, ...period(ctx.body.valid_from, ctx.body.valid_until), status: 'DRAFT' });
    await audit(ctx, 'FEE_POLICY', id, 'FEE_POLICY_CREATED');
    return one(ctx.db, feePolicies, id);
  });
  operation(app, 'createTaxPolicy', async ctx => {
    if (ctx.body.tax_class_id) await one(ctx.db, taxClasses, ctx.body.tax_class_id);
    for (const value of [ctx.body.dpp_numerator, ctx.body.dpp_denominator]) {
      if (!Number.isInteger(value) || value < 1 || value > 2147483647) throw new AppError(422, 'INVALID_DPP', 'Faktor DPP harus integer positif maksimal 2147483647.');
    }
    if ((ctx.body.kind === 'ITEM_VAT') !== Boolean(ctx.body.tax_class_id)) throw new AppError(422, 'INVALID_TAX_SCOPE', 'ITEM_VAT memerlukan kelas pajak; pajak platform tidak memakai kelas produk.');
    const id = randomUUID();
    await ctx.db.insert(taxPolicies).values({ id, policyKey: boundedText(ctx.body.policy_key, 'policy_key', 191),
      taxClassId: ctx.body.tax_class_id ?? null, kind: ctx.body.kind, rate: fraction(ctx.body.rate),
      dppNumerator: ctx.body.dpp_numerator, dppDenominator: ctx.body.dpp_denominator,
      ruleParameters: ctx.body.rule_parameters ?? {}, ...period(ctx.body.valid_from, ctx.body.valid_until), status: 'DRAFT' });
    await audit(ctx, 'TAX_POLICY', id, 'TAX_POLICY_CREATED');
    return one(ctx.db, taxPolicies, id);
  });
  operation(app, 'activateFeePolicy', async ctx => {
    const all = await ctx.db.select().from(feePolicies).orderBy(asc(feePolicies.id)).for('update');
    const row = all.find(item => item.id === ctx.params.feePolicyId);
    if (!row) throw new AppError(404, 'NOT_FOUND', 'Kebijakan tidak ditemukan.');
    version(ctx.request, row);
    if (row.status !== 'DRAFT') throw new AppError(409, 'INVALID_STATE', 'Hanya draft dapat diaktifkan.');
    if (all.some(other => other.id !== row.id && other.status === 'ACTIVE'
      && (other.policyKey === row.policyKey || other.categoryId === row.categoryId) && overlaps(other, row))) {
      throw new AppError(409, 'POLICY_OVERLAP', 'Periode fee aktif untuk scope yang sama bertumpuk.');
    }
    if (row.categoryId) await one(ctx.db, categories, row.categoryId, eq(categories.status, 'ACTIVE'), true);
    await ctx.db.update(feePolicies).set({ status: 'ACTIVE', rowVersion: row.rowVersion + 1 }).where(eq(feePolicies.id, row.id));
    await audit(ctx, 'FEE_POLICY', row.id, 'FEE_POLICY_ACTIVATED', { policy_key: row.policyKey });
    return one(ctx.db, feePolicies, row.id);
  });
  operation(app, 'activateTaxPolicy', async ctx => {
    const all = await ctx.db.select().from(taxPolicies).orderBy(asc(taxPolicies.id)).for('update');
    const row = all.find(item => item.id === ctx.params.taxPolicyId);
    if (!row) throw new AppError(404, 'NOT_FOUND', 'Kebijakan tidak ditemukan.');
    version(ctx.request, row);
    if (row.status !== 'DRAFT') throw new AppError(409, 'INVALID_STATE', 'Hanya draft dapat diaktifkan.');
    if (all.some(other => other.id !== row.id && other.status === 'ACTIVE' &&
      (other.policyKey === row.policyKey || (other.kind === row.kind && other.taxClassId === row.taxClassId)) && overlaps(other, row))) {
      throw new AppError(409, 'POLICY_OVERLAP', 'Periode pajak aktif untuk scope yang sama bertumpuk.');
    }
    if (row.taxClassId) await one(ctx.db, taxClasses, row.taxClassId, eq(taxClasses.status, 'ACTIVE'), true);
    await ctx.db.update(taxPolicies).set({ status: 'ACTIVE', rowVersion: row.rowVersion + 1 }).where(eq(taxPolicies.id, row.id));
    await audit(ctx, 'TAX_POLICY', row.id, 'TAX_POLICY_ACTIVATED', { policy_key: row.policyKey });
    return one(ctx.db, taxPolicies, row.id);
  });
}
