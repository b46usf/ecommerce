import { and, eq } from 'drizzle-orm';
import type { Config } from '../config.js';
import type { DatabaseExecutor } from '../database/index.js';
import { providerAccounts } from '../database/schema.js';
import { AppError } from '../shared/errors.js';

const channels = new Set(['qris','bca_va','bni_va','bri_va','permata_va','echannel','other_va','gopay','shopeepay','dana','ovo']);
export async function providerAccount(db: DatabaseExecutor, config: Config, provider: 'MIDTRANS'|'BITESHIP') {
  const merchant = provider === 'MIDTRANS' ? config.midtransMerchantId : config.biteshipAccountId;
  const secret = provider === 'MIDTRANS' ? config.midtransServerKey : config.biteshipApiKey;
  if (!merchant || !secret) throw new AppError(503, 'PROVIDER_NOT_CONFIGURED', `${provider} belum dikonfigurasi.`);
  if (provider === 'MIDTRANS' && (!config.paymentChannels.length || config.paymentChannels.some(channel => !channels.has(channel)))) throw new AppError(503, 'PAYMENT_CHANNELS_NOT_CONFIGURED', 'Konfigurasikan kanal merchant yang sudah aktif.');
  if (provider === 'BITESHIP' && !secret.startsWith(config.providerEnvironment === 'SANDBOX' ? 'biteship_test.' : 'biteship_live.')) throw new AppError(503, 'PROVIDER_ENVIRONMENT_MISMATCH', 'Environment Biteship tidak cocok.');
  const capabilities = provider === 'MIDTRANS' ? { channels: config.paymentChannels, payment_limits: config.paymentChannelLimits, refund_channels: config.refundChannels, manual_refund_channels: config.manualRefundChannels } : { couriers: config.biteshipCouriers };
  await db.insert(providerAccounts).values({ provider, environment: config.providerEnvironment, merchantReference: merchant, secretReference: provider === 'MIDTRANS' ? 'env:MIDTRANS_SERVER_KEY' : 'env:BITESHIP_API_KEY', capabilities }).onDuplicateKeyUpdate({ set: { merchantReference: merchant, capabilities } });
  const [account] = await db.select().from(providerAccounts).where(and(eq(providerAccounts.provider, provider), eq(providerAccounts.environment, config.providerEnvironment), eq(providerAccounts.merchantReference, merchant), eq(providerAccounts.status, 'ACTIVE'))).limit(1);
  if (!account) throw new AppError(503, 'PROVIDER_DISABLED', 'Akun provider dinonaktifkan.');
  return account;
}
export class ProviderError extends Error { constructor(public status: number, public ambiguous: boolean) { super('Provider request failed'); } }
const breaker = new Map<string,{failures:number;retryAt:number}>();
export async function providerRequest(config: Config, provider: 'MIDTRANS'|'BITESHIP', path: string, method = 'GET', body?: any, snap = false) {
  const key = `${provider}:${config.providerEnvironment}`;
  const state = breaker.get(key);
  if (state && state.retryAt > Date.now()) throw new ProviderError(503, true);
  const token = provider === 'MIDTRANS' ? config.midtransServerKey : config.biteshipApiKey;
  if (!token) throw new AppError(503, 'PROVIDER_NOT_CONFIGURED', 'Credential provider belum tersedia.');
  const base = provider === 'BITESHIP' ? 'https://api.biteship.com' : snap ? (config.providerEnvironment === 'SANDBOX' ? 'https://app.sandbox.midtrans.com' : 'https://app.midtrans.com') : (config.providerEnvironment === 'SANDBOX' ? 'https://api.sandbox.midtrans.com' : 'https://api.midtrans.com');
  try {
    const response = await fetch(`${base}${path}`, { method, headers: { Authorization: provider === 'MIDTRANS' ? `Basic ${Buffer.from(`${token}:`).toString('base64')}` : token, 'Content-Type': 'application/json', Accept: 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15_000), redirect: 'error' });
    if (!response.ok) throw new ProviderError(response.status, response.status >= 500 || response.status === 429);
    const text = await response.text(); if (text.length > 2_000_000) throw new ProviderError(502, true);
    const data = JSON.parse(text);
    if (provider === 'MIDTRANS' && Number(data.status_code) >= 400) throw new ProviderError(Number(data.status_code), Number(data.status_code) >= 500);
    if (provider === 'BITESHIP' && data.success === false) throw new ProviderError(422, false);
    breaker.delete(key); return data;
  } catch (error) {
    const failure = error instanceof ProviderError ? error : new ProviderError(503, true);
    if (failure.ambiguous) { const failures = (state?.failures ?? 0) + 1; breaker.set(key, { failures, retryAt: failures >= 3 ? Date.now() + 30_000 : 0 }); }
    throw failure;
  }
}
