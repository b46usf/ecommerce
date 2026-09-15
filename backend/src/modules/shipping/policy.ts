import { AppError } from '../../shared/errors.js';
import { money } from '../../shared/money.js';

export type ShippingState = 'BOOKED' | 'PICKED_UP' | 'IN_TRANSIT' | 'DELIVERED' | 'CANCELLED' | 'SHIPMENT_REVIEW';
const mapped: Record<string, ShippingState> = { confirmed: 'BOOKED', scheduled: 'BOOKED', allocated: 'BOOKED', picking_up: 'BOOKED',
  picked: 'PICKED_UP', in_transit: 'IN_TRANSIT', dropping_off: 'IN_TRANSIT', delivered: 'DELIVERED', cancelled: 'CANCELLED' };
export function providerState(status: unknown): ShippingState { return typeof status === 'string' ? mapped[status] ?? 'SHIPMENT_REVIEW' : 'SHIPMENT_REVIEW'; }

export function nextState(current: string, incoming: ShippingState): ShippingState | string {
  const rank: Record<string, number> = { NOT_BOOKED: 0, BOOKING: 0, BOOKED: 1, PICKED_UP: 2, IN_TRANSIT: 3, DELIVERED: 4 };
  if (incoming === 'CANCELLED' && ['PICKED_UP', 'IN_TRANSIT', 'DELIVERED'].includes(current)) return 'SHIPMENT_REVIEW';
  if (current === 'CANCELLED' && incoming !== 'CANCELLED') return 'SHIPMENT_REVIEW';
  if (rank[incoming] !== undefined && rank[current] !== undefined && rank[incoming]! < rank[current]!) return current;
  return incoming;
}

function location(address: any, prefix: string, booking = false) {
  const area = address.area_id ?? address.areaId;
  const latitude = address.latitude, longitude = address.longitude;
  const postal = String(address.postal_code ?? address.postalCode ?? '');
  if (typeof area === 'string' && area.length) return { [`${prefix}_area_id`]: area };
  if (latitude != null && longitude != null && Number.isFinite(Number(latitude)) && Number.isFinite(Number(longitude)) &&
      Math.abs(Number(latitude)) <= 90 && Math.abs(Number(longitude)) <= 180) {
    return booking ? { [`${prefix}_coordinate`]: { latitude: Number(latitude), longitude: Number(longitude) } } :
      { [`${prefix}_latitude`]: Number(latitude), [`${prefix}_longitude`]: Number(longitude) };
  }
  if (/^\d{5}$/.test(postal)) return { [`${prefix}_postal_code`]: Number(postal) };
  throw new AppError(422, 'SHIPPING_ADDRESS_INVALID', 'Alamat pengiriman membutuhkan area, koordinat, atau kode pos valid.');
}

export function validatedPackage(snapshot: any) {
  if (!snapshot || !Array.isArray(snapshot.items) || snapshot.items.length < 1 || snapshot.items.length > 100) {
    throw new AppError(422, 'SHIPPING_PACKAGE_INVALID', 'Paket harus memiliki 1–100 baris barang.');
  }
  let weight = 0n, value = 0n;
  const items = snapshot.items.map((item: any) => {
    for (const key of ['value', 'quantity', 'weight']) if (!Number.isSafeInteger(item[key]) || item[key] < 1) {
      throw new AppError(422, 'SHIPPING_PACKAGE_INVALID', 'Nilai, jumlah, dan berat paket harus integer positif.');
    }
    for (const key of ['length', 'width', 'height']) if (!Number.isFinite(item[key]) || item[key] <= 0) {
      throw new AppError(422, 'SHIPPING_PACKAGE_INVALID', 'Dimensi paket harus positif.');
    }
    if (typeof item.name !== 'string' || !item.name.trim()) throw new AppError(422, 'SHIPPING_PACKAGE_INVALID', 'Nama barang tidak tersedia.');
    weight += BigInt(item.weight) * BigInt(item.quantity); value += BigInt(item.value) * BigInt(item.quantity);
    return { name: item.name, sku: item.sku, value: item.value, quantity: item.quantity,
      weight: item.weight, length: item.length, width: item.width, height: item.height };
  });
  money(weight); money(value);
  return { ...snapshot, items, total_weight_g: Number(weight), declared_value: Number(value) };
}

export function rateRequest(snapshot: any, couriers: string) {
  const data = validatedPackage(snapshot);
  if (!/^[a-z0-9]+(?:,[a-z0-9]+)*$/.test(couriers)) throw new AppError(503, 'SHIPPING_COURIERS_INVALID', 'Konfigurasi kurir tidak valid.');
  return { ...location(data.origin, 'origin'), ...location(data.destination, 'destination'), couriers, items: data.items };
}

export function bookingRequest(shipment: { id: string; bookingReference: string; courierCode: string; serviceCode: string; packageSnapshot: unknown }) {
  const data = validatedPackage(shipment.packageSnapshot);
  const origin = data.origin, destination = data.destination;
  const fields = { origin_contact_name: origin.contactName ?? origin.contact_name, origin_contact_phone: origin.phone,
    origin_address: origin.street, destination_contact_name: destination.recipient_name ?? destination.recipientName,
    destination_contact_phone: destination.phone, destination_address: destination.street };
  if (Object.values(fields).some(value => typeof value !== 'string' || !value.trim())) throw new AppError(422, 'SHIPPING_CONTACT_INVALID', 'Kontak dan alamat paket tidak lengkap.');
  return { ...fields, ...location(origin, 'origin', true), ...location(destination, 'destination', true),
    courier_company: shipment.courierCode, courier_type: shipment.serviceCode, reference_id: shipment.bookingReference,
    delivery_type: 'now', origin_collection_method: 'pickup', metadata: { marketplace_shipment_id: shipment.id }, items: data.items };
}

export function ratesFromProvider(response: any, couriers: string) {
  if (response?.success !== true || !Array.isArray(response.pricing)) throw new AppError(503, 'SHIPPING_PROVIDER_INVALID', 'Respons tarif kurir tidak valid.');
  const allowed = new Set(couriers.split(',')), seen = new Set<string>();
  const result: Array<{ courierCode: string; serviceCode: string; finalAmount: number; estimatedDelivery: string; breakdown: Record<string, unknown> }> = [];
  for (const option of response.pricing) {
    const courier = option.courier_code, service = option.courier_service_code;
    if (typeof courier !== 'string' || typeof service !== 'string' || !allowed.has(courier) || !/^[a-zA-Z0-9_-]{1,64}$/.test(service)) continue;
    if (option.currency != null && option.currency !== 'IDR') continue;
    if (!Number.isSafeInteger(option.price) || option.price < 0) throw new AppError(503, 'SHIPPING_PROVIDER_INVALID', 'Tarif kurir bukan nominal integer IDR valid.');
    if (Array.isArray(option.available_collection_method) && !option.available_collection_method.includes('pickup')) continue;
    if (Number(option.cash_on_delivery_fee ?? 0) !== 0) continue;
    const key = `${courier}:${service}`; if (seen.has(key)) continue; seen.add(key);
    const breakdown: Record<string, unknown> = { schema_version: 1, currency: 'IDR', price: option.price };
    for (const name of ['shipping_fee', 'shipment_fee', 'shipping_fee_discount', 'shipping_fee_surcharge', 'insurance_fee']) {
      if (option[name] !== undefined) {
        if (!Number.isSafeInteger(option[name]) || option[name] < 0) throw new AppError(503, 'SHIPPING_PROVIDER_INVALID', 'Rincian tarif kurir tidak valid.');
        breakdown[name] = option[name];
      }
    }
    result.push({ courierCode: courier, serviceCode: service, finalAmount: option.price,
      estimatedDelivery: typeof option.duration === 'string' ? option.duration.slice(0, 200) : '', breakdown });
    if (result.length >= 30) break;
  }
  if (!result.length) throw new AppError(422, 'SHIPPING_UNAVAILABLE', 'Tidak ada layanan kirim yang tersedia untuk paket ini.');
  return result;
}

export function verifiedProviderOrder(data: any, shipment: { id: string; providerOrderId: string | null; bookingReference: string; courierCode: string; serviceCode: string }, expectedId?: string) {
  if (data?.success !== true || typeof data.id !== 'string' || !/^[a-zA-Z0-9_-]{1,191}$/.test(data.id) ||
    (expectedId && data.id !== expectedId) || (shipment.providerOrderId && data.id !== shipment.providerOrderId) ||
    (data.reference_id != null && data.reference_id !== shipment.bookingReference) ||
    (!shipment.providerOrderId && data.reference_id !== shipment.bookingReference) ||
    data.courier?.company !== shipment.courierCode || data.courier?.type !== shipment.serviceCode ||
    data.currency !== 'IDR' || !Number.isSafeInteger(data.price) || data.price < 0 ||
    Number(data.destination?.cash_on_delivery?.amount ?? 0) !== 0) {
    throw new AppError(409, 'SHIPMENT_PROVIDER_MISMATCH', 'Data provider tidak cocok dengan shipment; rekonsiliasi diperlukan.');
  }
  return { providerOrderId: data.id as string, status: String(data.status ?? 'unknown'),
    state: providerState(data.status), actualAmount: data.price as number,
    waybillId: typeof data.courier?.waybill_id === 'string' ? data.courier.waybill_id.slice(0, 191) : null };
}
