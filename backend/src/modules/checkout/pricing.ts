import { and, eq, isNull, lte, gt, or } from 'drizzle-orm';
import { taxProfiles, taxPolicies, feePolicies, legalEntities, documents } from '../../database/schema.js';
import type { DatabaseExecutor } from '../../database/index.js';
import { AppError } from '../../shared/errors.js';
import { fraction, halfUp, money, SCALE } from '../../shared/money.js';

function period(table: any, at: Date) { return and(lte(table.validFrom, at), or(isNull(table.validUntil), gt(table.validUntil, at))); }
async function profile(db: DatabaseExecutor, entityId: string, at: Date) {
  const rows = await db.select().from(taxProfiles).where(and(eq(taxProfiles.legalEntityId, entityId), eq(taxProfiles.status,'VERIFIED'), period(taxProfiles,at)));
  if (rows.length !== 1) throw new AppError(409, 'TAX_PROFILE_REVIEW', 'Status pajak entitas perlu diverifikasi untuk tanggal transaksi.'); return rows[0]!;
}
async function policy(db: DatabaseExecutor, kind: string, taxClassId: string | undefined, at: Date) {
  const rows = await db.select().from(taxPolicies).where(and(eq(taxPolicies.status,'ACTIVE'), eq(taxPolicies.kind,kind), period(taxPolicies,at), taxClassId ? or(eq(taxPolicies.taxClassId,taxClassId),isNull(taxPolicies.taxClassId)) : isNull(taxPolicies.taxClassId)));
  const exact = taxClassId ? rows.filter(row => row.taxClassId === taxClassId) : rows;
  const result = exact.length ? exact : rows.filter(row => row.taxClassId === null);
  if (result.length !== 1) throw new AppError(409, 'TAX_POLICY_REVIEW', 'Kebijakan pajak aktif belum tunggal/tersedia.'); return result[0]!;
}
export async function priceLine(db: DatabaseExecutor, input: { categoryId:string; taxClassId:string; sellerEntityId:string; quantity:number; unitPriceGross:number }, at: Date) {
  const seller = await profile(db,input.sellerEntityId,at);
  const [platformEntity] = await db.select().from(legalEntities).where(and(eq(legalEntities.isPlatform,true),eq(legalEntities.status,'VERIFIED')));
  if (!platformEntity) throw new AppError(409,'PLATFORM_TAX_REVIEW','Entitas platform belum terverifikasi.');
  const platform = await profile(db,platformEntity.id,at);
  const feeCandidates = await db.select().from(feePolicies).where(and(eq(feePolicies.status,'ACTIVE'),period(feePolicies,at),or(eq(feePolicies.categoryId,input.categoryId),isNull(feePolicies.categoryId))));
  const specific = feeCandidates.filter(row => row.categoryId === input.categoryId), fees = specific.length ? specific : feeCandidates.filter(row => row.categoryId === null);
  if (fees.length !== 1) throw new AppError(409,'FEE_POLICY_REVIEW','Kebijakan komisi aktif belum tunggal/tersedia.'); const fee = fees[0]!;
  const gross = BigInt(input.quantity) * BigInt(input.unitPriceGross);
  let net = gross, itemPolicy: any, commissionPolicy: any, withholdingPolicy: any;
  if (seller.isPkp) { itemPolicy = await policy(db,'ITEM_VAT',input.taxClassId,at); const numerator = fraction(itemPolicy.rate)*BigInt(itemPolicy.dppNumerator), denominator=SCALE*BigInt(itemPolicy.dppDenominator); net=halfUp(gross*denominator,denominator+numerator); }
  const vat=gross-net, commission=halfUp(net*fraction(fee.commissionRate),SCALE);
  let commissionVat=0n, withholding=0n, exemption: string | null=null;
  if (platform.isPkp && commission>0n) { commissionPolicy=await policy(db,'COMMISSION_VAT',undefined,at); commissionVat=halfUp(commission*fraction(commissionPolicy.rate)*BigInt(commissionPolicy.dppNumerator),SCALE*BigInt(commissionPolicy.dppDenominator)); }
  if (platform.collectorEnabled) {
    const evidence=await db.select().from(documents).where(and(eq(documents.legalEntityId,input.sellerEntityId),eq(documents.verificationStatus,'VERIFIED')));
    const day=at.toISOString().slice(0,10);
    const valid=evidence.filter(doc=>(!doc.validFrom||doc.validFrom<=day)&&(!doc.validUntil||doc.validUntil>=day));
    const entity=await db.select().from(legalEntities).where(eq(legalEntities.id,input.sellerEntityId));
    if (valid.some(doc=>doc.documentType==='SKB')) exemption='VERIFIED_SKB';
    else if(entity[0]?.kind==='INDIVIDUAL'&&valid.some(doc=>doc.documentType==='TURNOVER_STATEMENT'&&doc.metadata.annual_turnover_below_threshold===true)) exemption='VERIFIED_TURNOVER_STATEMENT';
    else { withholdingPolicy=await policy(db,'SELLER_WITHHOLDING',undefined,at); if(withholdingPolicy.ruleParameters.shipping_basis!=='AGGREGATOR_REVENUE_EXCLUDED') throw new AppError(409,'WITHHOLDING_BASIS_REVIEW','Dasar PPh ongkir perlu keputusan finance.'); withholding=halfUp(net*fraction(withholdingPolicy.rate),SCALE); }
  }
  if(commission+commissionVat+withholding>gross) throw new AppError(409,'INVALID_FEE_TOTAL','Potongan vendor melebihi nilai barang.');
  return { lineNet:money(net),lineVat:money(vat),lineGross:money(gross),commissionAmount:money(commission),commissionVat:money(commissionVat),sellerWithholding:money(withholding),buyerFee:fee.buyerFeeAmount,
    taxSnapshot:{schema_version:1,entity_tax_profile_id:seller.id,platform_tax_profile_id:platform.id,kind:'ITEM_VAT',policy_id:itemPolicy?.id??null,policy_version:itemPolicy?.rowVersion??null,rate:itemPolicy?.rate??'0',dpp_numerator:itemPolicy?.dppNumerator??1,dpp_denominator:itemPolicy?.dppDenominator??1,base_amount:money(net),tax_amount:money(vat),exemption_reason:seller.isPkp?null:'NON_PKP',document_ids:seller.profileSnapshot.document_ids??[],withholding_policy_id:withholdingPolicy?.id??null,withholding_exemption:exemption},
    feeSnapshot:{schema_version:1,fee_policy_id:fee.id,fee_policy_version:fee.rowVersion,commission_base:money(net),rate:fee.commissionRate,amount:money(commission),commission_tax_policy_id:commissionPolicy?.id??null,commission_tax_rate:commissionPolicy?.rate??'0'}, sellerTaxSnapshot:{schema_version:1,profile_id:seller.id,is_pkp:seller.isPkp,collector_enabled:platform.collectorEnabled} };
}
