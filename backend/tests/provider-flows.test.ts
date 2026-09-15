import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { paymentMethodLimits, rupiah, validSignature } from '../src/modules/payments/policy.js';
import { nextState, providerState, ratesFromProvider, validatedPackage, verifiedProviderOrder } from '../src/modules/shipping/policy.js';

describe('provider boundary policies', () => {
  it('verifies Midtrans signatures over the exact provider amount string', () => {
    const body = { order_id: 'payment-1', status_code: '200', gross_amount: '12000.00', signature_key: '' };
    body.signature_key = createHash('sha512').update(body.order_id + body.status_code + body.gross_amount + 'server-secret').digest('hex');
    expect(validSignature(body, 'server-secret')).toBe(true);
    expect(validSignature({ ...body, gross_amount: '12001.00' }, 'server-secret')).toBe(false);
    expect(rupiah('9007199254740991.00')).toBe(Number.MAX_SAFE_INTEGER);
    expect(() => rupiah('100.50')).toThrow();
  });

  it('exposes only explicitly configured channels with verified safe limits', () => {
    expect(paymentMethodLimits({ payment_limits: { qris: { minimum_amount: 10_000, maximum_amount: 5_000_000 } } }, ['qris', 'gopay']))
      .toEqual([{ code: 'qris', name: 'qris', minimum_amount: 10_000, maximum_amount: 5_000_000, buyer_surcharge: 0 }]);
    const config = loadConfig({ NODE_ENV: 'test', DATABASE_URL: 'mysql://test:test@127.0.0.1/db', REDIS_URL: 'redis://127.0.0.1:6379',
      SESSION_SECRET: 'test-secret-with-more-than-thirty-two-characters', PAYMENT_CHANNEL_LIMITS: '{"qris":{"minimum_amount":10000,"maximum_amount":5000000}}' });
    expect(config.paymentChannelLimits.qris).toEqual({ minimum_amount: 10_000, maximum_amount: 5_000_000 });
    expect(() => loadConfig({ NODE_ENV: 'test', DATABASE_URL: 'mysql://test:test@127.0.0.1/db', REDIS_URL: 'redis://127.0.0.1:6379',
      SESSION_SECRET: 'test-secret-with-more-than-thirty-two-characters', PAYMENT_CHANNEL_LIMITS: '{"qris":{"minimum_amount":-1,"maximum_amount":2}}' })).toThrow();
  });

  it('accepts only allowlisted, integer-IDR, non-COD Biteship rates', () => {
    const rates = ratesFromProvider({ success: true, pricing: [
      { courier_code: 'jne', courier_service_code: 'reg', currency: 'IDR', price: 15_000, duration: '1-2 days', available_collection_method: ['pickup'] },
      { courier_code: 'other', courier_service_code: 'reg', currency: 'IDR', price: 1 },
      { courier_code: 'jne', courier_service_code: 'cod', currency: 'IDR', price: 10_000, cash_on_delivery_fee: 100 },
    ] }, 'jne');
    expect(rates).toHaveLength(1);
    expect(rates[0]).toMatchObject({ courierCode: 'jne', serviceCode: 'reg', finalAmount: 15_000 });
  });

  it('keeps unknown or regressive shipment states safe', () => {
    expect(providerState('unexpected')).toBe('SHIPMENT_REVIEW');
    expect(nextState('DELIVERED', 'IN_TRANSIT')).toBe('DELIVERED');
    expect(nextState('IN_TRANSIT', 'CANCELLED')).toBe('SHIPMENT_REVIEW');
  });

  it('binds provider booking responses to local reference, courier and amount', () => {
    const shipment = { id: 'local', providerOrderId: null, bookingReference: 'shipment-local', courierCode: 'jne', serviceCode: 'reg' };
    expect(verifiedProviderOrder({ success: true, id: 'provider_1', reference_id: 'shipment-local', status: 'confirmed',
      courier: { company: 'jne', type: 'reg', waybill_id: 'WB1' }, currency: 'IDR', price: 12_000 }, shipment))
      .toMatchObject({ state: 'BOOKED', actualAmount: 12_000, waybillId: 'WB1' });
    expect(() => verifiedProviderOrder({ success: true, id: 'provider_1', reference_id: 'other', status: 'delivered',
      courier: { company: 'jne', type: 'reg' }, currency: 'IDR', price: 12_000 }, shipment)).toThrow();
  });

  it('uses bigint totals for bounded package snapshots', () => {
    const packet = validatedPackage({ items: [{ name: 'Item', sku: 'SKU', value: 2_000_000_000, quantity: 2,
      weight: 1000, length: 10, width: 5, height: 2 }], origin: {}, destination: {} });
    expect(packet.declared_value).toBe(4_000_000_000);
    expect(packet.total_weight_g).toBe(2000);
  });
});
