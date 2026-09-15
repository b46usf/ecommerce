import { createHash } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import type { DatabaseExecutor } from '../../database/index.js';
import { cartItems, quoteLines, quoteVersions, quoteRequests, stores, storeOrigins, categories, taxClasses } from '../../database/schema.js';
import { activeAddress, one, present } from '../../shared/operations.js';
import { canonicalJson } from '../../shared/idempotency.js';
import { lockCart, skuSnapshot } from '../cart/index.js';
import { AppError } from '../../shared/errors.js';
import { money } from '../../shared/money.js';
export interface SelectionInput { address_id:string;cart_item_ids:string[];cart_version:number }
export async function selection(db: DatabaseExecutor,buyerId:string,body:SelectionInput) {
  if(!body.cart_item_ids.length||body.cart_item_ids.length>100||new Set(body.cart_item_ids).size!==body.cart_item_ids.length) throw new AppError(422,'ITEM_LIMIT','Checkout memerlukan 1–100 baris unik.');
  const cart=await lockCart(db,buyerId); if(cart.rowVersion!==body.cart_version) throw new AppError(409,'CART_CHANGED','Keranjang telah berubah.');
  const address=await activeAddress(db,buyerId,body.address_id);
  const items=await db.select().from(cartItems).where(and(eq(cartItems.cartId,cart.id),inArray(cartItems.id,body.cart_item_ids))).orderBy(cartItems.skuId,cartItems.id);
  if(items.length!==body.cart_item_ids.length) throw new AppError(404,'CART_ITEM_NOT_FOUND','Item keranjang tidak ditemukan.');
  const lines:any[]=[], groups=new Map<string,any>();
  for(const item of items){
    const {sku,product,snapshot}=await skuSnapshot(db,item.skuId);
    await one(db,categories,product.categoryId,eq(categories.status,'ACTIVE'));
    await one(db,taxClasses,product.taxClassId,eq(taxClasses.status,'ACTIVE'));
    let quote:any,quoteVersion:any;
    if(item.quoteLineId){quote=await one(db,quoteLines,item.quoteLineId);quoteVersion=await one(db,quoteVersions,quote.quoteVersionId,undefined,true);await one(db,quoteRequests,quoteVersion.quoteRequestId,and(eq(quoteRequests.buyerAccountId,buyerId),eq(quoteRequests.storeId,sku.storeId)));
      if(quoteVersion.status!=='ACCEPTED'||quoteVersion.expiresAt<=new Date()||item.quantity!==quote.quantity||quote.skuId!==item.skuId)throw new AppError(409,'QUOTE_CHANGED','Penawaran tidak lagi berlaku.');
      const required=await db.select({id:quoteLines.id}).from(quoteLines).where(eq(quoteLines.quoteVersionId,quoteVersion.id));
      if(required.some(row=>!items.some(i=>i.quoteLineId===row.id)))throw new AppError(409,'INCOMPLETE_QUOTE','Seluruh baris penawaran harus di-checkout bersama.');
    }
    if(!groups.has(sku.storeId)){const store=await one(db,stores,sku.storeId);const[origin]=await db.select().from(storeOrigins).where(and(eq(storeOrigins.storeId,store.id),eq(storeOrigins.active,true)));if(!origin)throw new AppError(409,'ORIGIN_MISSING','Alamat asal toko tidak tersedia.');groups.set(store.id,{store,origin,lines:[]});}
    const line={item,sku,product,snapshot,quote,quoteVersion,unitPriceGross:quote?.unitPriceGross??sku.unitPriceGross};lines.push(line);groups.get(sku.storeId).lines.push(line);
  }
  const recipient={schema_version:1,...present('AddressWrite',address)};
  const fingerprint=createHash('sha256').update(canonicalJson({buyerId,cartVersion:cart.rowVersion,recipient,lines:lines.map(l=>({id:l.item.id,skuId:l.sku.id,skuVersion:l.sku.rowVersion,productVersion:l.product.rowVersion,quantity:l.item.quantity,price:l.unitPriceGross,quoteVersion:l.quoteVersion?.rowVersion})),origins:[...groups.values()].map(g=>({storeId:g.store.id,origin:g.origin}))})).digest('hex');
  return{cart,address,recipient,lines,groups:[...groups.values()],fingerprint};
}
export function packageFor(group:any,recipient:any){
  const items=group.lines.map((l:any)=>({name:l.product.name,sku:l.sku.skuCode,value:l.unitPriceGross,quantity:l.item.quantity,weight:l.sku.weightG,length:Number(l.sku.lengthCm),width:Number(l.sku.widthCm),height:Number(l.sku.heightCm)}));
  const height=items.reduce((n:bigint,i:any)=>n+BigInt(Math.round(i.height*100))*BigInt(i.quantity),0n);
  return{schema_version:1,items,origin:group.origin,destination:recipient,total_weight_g:money(items.reduce((n:bigint,i:any)=>n+BigInt(i.weight)*BigInt(i.quantity),0n)),declared_value:money(items.reduce((n:bigint,i:any)=>n+BigInt(i.value)*BigInt(i.quantity),0n)),length_cm:Math.max(...items.map((i:any)=>i.length)),width_cm:Math.max(...items.map((i:any)=>i.width)),height_cm:money(height)/100};
}
