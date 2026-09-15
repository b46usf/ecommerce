import { createHmac, createHash, randomUUID } from 'node:crypto';
import { eq, inArray, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { operation, one, audit } from '../../shared/operations.js';
import { canonicalJson } from '../../shared/idempotency.js';
import { AppError } from '../../shared/errors.js';
import { secureEqual } from '../auth/tokens.js';
import { total } from '../../shared/money.js';
import { selection, type SelectionInput } from './selection.js';
import { priceLine } from './pricing.js';
import { shippingQuotes, checkoutGroups, vendorOrders, orderItems, inventoryBalances, inventoryMovements, stockReservations, quoteRedemptions, quoteVersions, cartItems, carts, outboxEvents } from '../../database/schema.js';
import type { DatabaseExecutor } from '../../database/index.js';
import { orderGroup } from '../orders/service.js';

type Input=SelectionInput&{shipping_quote_ids:string[]};
function sign(payload:any,secret:string){const encoded=Buffer.from(JSON.stringify(payload)).toString('base64url');return`${encoded}.${createHmac('sha256',secret).update(`checkout:v1:${encoded}`).digest('base64url')}`;}
function verify(token:string,secret:string){try{const[encoded,signature]=token.split('.');if(!encoded||!signature||token.length>50000||!secureEqual(signature,createHmac('sha256',secret).update(`checkout:v1:${encoded}`).digest('base64url')))throw new Error();const payload=JSON.parse(Buffer.from(encoded,'base64url').toString('utf8'));if(payload.expiresAt<Date.now())throw new Error();return payload;}catch{throw new AppError(409,'PREVIEW_EXPIRED','Preview tidak berlaku; buat preview baru.');}}
async function preview(db:DatabaseExecutor,buyerId:string,body:Input){
  const selected=await selection(db,buyerId,body),now=new Date();
  if(body.shipping_quote_ids.length!==selected.groups.length)throw new AppError(409,'SHIPPING_SELECTION_INVALID','Pilih satu layanan kirim per toko.');
  const quotes=await db.select().from(shippingQuotes).where(inArray(shippingQuotes.id,body.shipping_quote_ids));
  if(quotes.length!==selected.groups.length||new Set(quotes.map(q=>q.storeId)).size!==selected.groups.length)throw new AppError(409,'SHIPPING_SELECTION_INVALID','Quotation kirim tidak cocok.');
  for(const group of selected.groups){
    const quote=quotes.find(q=>q.storeId===group.store.id);
    if(!quote||quote.buyerAccountId!==buyerId||quote.inputHash!==selected.fingerprint||quote.validUntil<=now)throw new AppError(409,'SHIPPING_QUOTE_CHANGED','Tarif atau isi paket berubah; ambil tarif baru.');group.shippingQuote=quote;
    for(const line of group.lines)line.pricing=await priceLine(db,{categoryId:line.product.categoryId,taxClassId:line.product.taxClassId,sellerEntityId:group.store.legalEntityId,quantity:line.item.quantity,unitPriceGross:line.unitPriceGross},now);
    const buyerFees=new Set(group.lines.map((line:any)=>line.pricing.buyerFee));if(buyerFees.size!==1)throw new AppError(409,'BUYER_FEE_REVIEW','Kebijakan biaya pembeli antarbaris tidak konsisten.');
    group.totals={items_net:total(group.lines.map((l:any)=>l.pricing.lineNet)),items_vat:total(group.lines.map((l:any)=>l.pricing.lineVat)),items_gross:total(group.lines.map((l:any)=>l.pricing.lineGross)),shipping:quote.finalAmount,buyer_fee:group.lines[0].pricing.buyerFee,platform_discount:0,currency:'IDR'};
    group.totals.grand_total=total([group.totals.items_gross,quote.finalAmount,group.totals.buyer_fee]);
  }
  const totals:any={currency:'IDR'};for(const key of ['items_net','items_vat','items_gross','shipping','buyer_fee','platform_discount','grand_total'])totals[key]=total(selected.groups.map(g=>g.totals[key]));
  const fingerprint=createHash('sha256').update(canonicalJson({selection:selected.fingerprint,groups:selected.groups.map(g=>({storeId:g.store.id,quoteId:g.shippingQuote.id,totals:g.totals,lines:g.lines.map((l:any)=>l.pricing)}))})).digest('hex');
  return{...selected,totals,pricingFingerprint:fingerprint};
}
export async function checkoutRoutes(app:FastifyInstance){
  operation(app,'previewCheckout',async ctx=>{const calculated=await preview(ctx.db,ctx.params.buyerAccountId,ctx.body);const expiresAt=Date.now()+120000;const payload={buyerId:ctx.params.buyerAccountId,userId:ctx.user.id,input:ctx.body,expiresAt,fingerprint:calculated.pricingFingerprint};return{preview_token:sign(payload,app.services.config.sessionSecret),expires_at:new Date(expiresAt).toISOString(),totals:calculated.totals,vendors:calculated.groups.map(g=>({store_id:g.store.id,shipping_quote_id:g.shippingQuote.id,totals:g.totals}))};},{transaction:true});
  operation(app,'confirmCheckout',async ctx=>{
    const token=verify(ctx.body.preview_token,app.services.config.sessionSecret);if(token.buyerId!==ctx.params.buyerAccountId||token.userId!==ctx.user.id)throw new AppError(403,'PREVIEW_OWNER_MISMATCH','Preview bukan milik pengguna ini.');
    const calculated=await preview(ctx.db,ctx.params.buyerAccountId,token.input);if(calculated.pricingFingerprint!==token.fingerprint)throw new AppError(409,'CHECKOUT_CHANGED','Harga, kebijakan, atau paket berubah; buat preview baru.');
    const requirements=new Map<string,number>();for(const line of calculated.lines)requirements.set(line.sku.id,(requirements.get(line.sku.id)??0)+line.item.quantity);
    const balances=await ctx.db.select().from(inventoryBalances).where(inArray(inventoryBalances.skuId,[...requirements.keys()].sort())).orderBy(inventoryBalances.skuId).for('update');
    if(balances.length!==requirements.size||balances.some(row=>row.onHand-row.reserved<requirements.get(row.skuId)!))throw new AppError(409,'INSUFFICIENT_STOCK','Stok tidak mencukupi.');
    const id=randomUUID(),expiresAt=new Date(Date.now()+15*60000);
    await ctx.db.insert(checkoutGroups).values({id,buyerAccountId:ctx.params.buyerAccountId,createdBy:ctx.user.id,orderNumber:`ORD-${id}`,recipientSnapshot:calculated.recipient,itemsGross:calculated.totals.items_gross,shippingTotal:calculated.totals.shipping,buyerFeeTotal:calculated.totals.buyer_fee,platformDiscount:0,grandTotal:calculated.totals.grand_total,reservationExpiresAt:expiresAt,pricingSnapshot:{schema_version:1,calculation_version:'v1',rounding_mode:'HALF_UP',preview_fingerprint:token.fingerprint,source_quote_ids:calculated.lines.filter(l=>l.quote).map(l=>l.quote.id)}});
    for(const group of calculated.groups){const vendorId=randomUUID();await ctx.db.insert(vendorOrders).values({id:vendorId,checkoutGroupId:id,storeId:group.store.id,shippingQuoteId:group.shippingQuote.id,orderNumber:`VEN-${vendorId}`,itemsNet:group.totals.items_net,itemsVat:group.totals.items_vat,itemsGross:group.totals.items_gross,shippingAmount:group.totals.shipping,buyerFee:group.totals.buyer_fee,platformDiscount:0,buyerTotal:group.totals.grand_total,commissionAmount:total(group.lines.map((l:any)=>l.pricing.commissionAmount)),commissionVat:total(group.lines.map((l:any)=>l.pricing.commissionVat)),sellerWithholding:total(group.lines.map((l:any)=>l.pricing.sellerWithholding)),sellerTaxSnapshot:group.lines[0].pricing.sellerTaxSnapshot,originSnapshot:group.shippingQuote.originSnapshot});
      for(const line of group.lines){const itemId=randomUUID(),reservationId=randomUUID(),balance=balances.find(b=>b.skuId===line.sku.id)!;
        await ctx.db.insert(orderItems).values({id:itemId,vendorOrderId:vendorId,storeId:group.store.id,skuId:line.sku.id,quoteLineId:line.quote?.id??null,quantity:line.item.quantity,unitPriceGross:line.unitPriceGross,lineNet:line.pricing.lineNet,lineVat:line.pricing.lineVat,lineGross:line.pricing.lineGross,vendorDiscount:0,commissionAmount:line.pricing.commissionAmount,commissionVat:line.pricing.commissionVat,sellerWithholding:line.pricing.sellerWithholding,productSnapshot:line.snapshot,taxSnapshot:line.pricing.taxSnapshot,feeSnapshot:line.pricing.feeSnapshot});
        await ctx.db.insert(stockReservations).values({id:reservationId,orderItemId:itemId,skuId:line.sku.id,inventoryId:balance.id,quantity:line.item.quantity,expiresAt});
        await ctx.db.update(inventoryBalances).set({reserved:sql`${inventoryBalances.reserved}+${line.item.quantity}`,rowVersion:sql`${inventoryBalances.rowVersion}+1`}).where(eq(inventoryBalances.id,balance.id));
        await ctx.db.insert(inventoryMovements).values({inventoryId:balance.id,reservationId,actorId:ctx.user.id,onHandDelta:0,reservedDelta:line.item.quantity,reason:'RESERVE',eventKey:`reserve:${reservationId}`});
      }
      const quoteIds=[...new Set(group.lines.filter((l:any)=>l.quoteVersion).map((l:any)=>l.quoteVersion.id))] as string[];
      for(const quoteId of quoteIds){await ctx.db.insert(quoteRedemptions).values({quoteVersionId:quoteId,vendorOrderId:vendorId});await ctx.db.update(quoteVersions).set({status:'CONSUMED',rowVersion:sql`${quoteVersions.rowVersion}+1`}).where(eq(quoteVersions.id,quoteId));}
    }
    await ctx.db.delete(cartItems).where(inArray(cartItems.id,token.input.cart_item_ids));await ctx.db.update(carts).set({rowVersion:calculated.cart.rowVersion+1}).where(eq(carts.id,calculated.cart.id));
    await ctx.db.insert(outboxEvents).values({eventKey:`order-expire:${id}`,aggregateType:'CHECKOUT',aggregateId:id,eventType:'ORDER_EXPIRE',payload:{orderGroupId:id,userId:ctx.user.id,requestId:ctx.request.id},availableAt:expiresAt});
    await audit(ctx,'CHECKOUT',id,'CHECKOUT_CONFIRMED',{grand_total:calculated.totals.grand_total});return orderGroup(ctx.db,await one(ctx.db,checkoutGroups,id));
  });
}
