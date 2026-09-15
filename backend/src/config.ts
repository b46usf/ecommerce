import 'dotenv/config';
import { createHmac } from 'node:crypto';
import { z } from 'zod';

const bool = z.enum(['true', 'false']).transform(value => value === 'true');
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('127.0.0.1'), PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DATABASE_URL: z.string().url().refine(value => value.startsWith('mysql://'), 'Must use mysql://'),
  DATABASE_CONNECTION_LIMIT: z.coerce.number().int().min(1).max(100).default(10),
  DATABASE_TIMEZONE: z.literal('Z').default('Z'),
  REDIS_URL: z.string().url().refine(value => /^rediss?:/.test(value)),
  SESSION_SECRET: z.string().min(32), AUTH_TOKEN_SECRET: z.string().min(32).optional(),
  DATA_ENCRYPTION_KEY: z.string().min(32).optional(),
  SESSION_TTL_SECONDS: z.coerce.number().int().min(300).max(2592000).default(604800),
  COOKIE_SECURE: bool.default(false), TRUST_PROXY: bool.default(false),
  APP_ORIGINS: z.string().default('http://localhost:3000,http://127.0.0.1:3000'),
  PUBLIC_APP_URL: z.string().url().default('http://localhost:3000'),
  PUBLIC_API_URL: z.string().url().default('http://127.0.0.1:3001'),
  CLAMAV_HOST: z.string().optional(), CLAMAV_PORT: z.coerce.number().int().default(3310), CLAMAV_TIMEOUT_MS: z.coerce.number().int().default(15000),
  PROVIDER_ENVIRONMENT: z.enum(['SANDBOX','PRODUCTION']).default('SANDBOX'),
  MIDTRANS_SERVER_KEY: z.string().optional(), MIDTRANS_MERCHANT_ID: z.string().optional(),
  BITESHIP_API_KEY: z.string().optional(), BITESHIP_ACCOUNT_ID: z.string().optional(), BITESHIP_WEBHOOK_TOKEN: z.string().min(32).optional(),
  BITESHIP_COURIERS: z.string().default('jne,jnt,sicepat'),
  PAYMENT_CHANNELS: z.string().default(''), MIDTRANS_REFUND_CHANNELS: z.string().default(''), MIDTRANS_MANUAL_REFUND_CHANNELS: z.string().default(''),
  PAYMENT_CHANNEL_LIMITS: z.string().default('{}'),
  DISPUTE_WINDOW_HOURS: z.coerce.number().int().min(1).max(720).default(48),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(32).default(4),
  SMTP_HOST: z.string().optional(), SMTP_PORT: z.coerce.number().int().default(1025),
  SMTP_SECURE: bool.default(false), SMTP_USER: z.string().optional(), SMTP_PASSWORD: z.string().optional(),
  SMTP_FROM: z.string().default('Marketplace <no-reply@marketplace.test>'),
  S3_ENDPOINT: z.string().url().optional(), S3_REGION: z.string().default('auto'),
  S3_BUCKET: z.string().optional(), S3_ACCESS_KEY_ID: z.string().optional(), S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_PUBLIC_BASE_URL: z.string().url().default('http://localhost:3001/media'),
});

export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const parsed = schema.safeParse(env);
  if (!parsed.success) throw new Error(`Invalid environment: ${parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  const e = parsed.data;
  const appOrigins = e.APP_ORIGINS.split(',').map(value => new URL(value.trim()).origin);
  if (e.NODE_ENV === 'production') {
    if (!e.COOKIE_SECURE || !e.TRUST_PROXY || !appOrigins.every(value => value.startsWith('https://')) || !e.PUBLIC_APP_URL.startsWith('https://') || !e.PUBLIC_API_URL.startsWith('https://')) throw new Error('Production requires HTTPS origins, secure cookies, and trusted proxy');
    if (!e.DATA_ENCRYPTION_KEY || !e.AUTH_TOKEN_SECRET || /replace|change-this/i.test(e.SESSION_SECRET)) throw new Error('Production requires independently configured secrets');
  }
  const derive = (context: string) => createHmac('sha256', e.SESSION_SECRET).update(context).digest('hex');
  let paymentChannelLimits: Record<string, { minimum_amount: number; maximum_amount: number }>;
  try {
    const raw = JSON.parse(e.PAYMENT_CHANNEL_LIMITS) as Record<string, { minimum_amount?: unknown; maximum_amount?: unknown }>;
    paymentChannelLimits = Object.fromEntries(Object.entries(raw).map(([channel, limit]) => {
      const minimum = limit?.minimum_amount, maximum = limit?.maximum_amount;
      if (!Number.isSafeInteger(minimum) || !Number.isSafeInteger(maximum) || Number(minimum) < 1 || Number(maximum) < Number(minimum)) throw new Error();
      return [channel, { minimum_amount: Number(minimum), maximum_amount: Number(maximum) }];
    }));
  } catch { throw new Error('Invalid environment: PAYMENT_CHANNEL_LIMITS must contain safe integer bounds'); }
  return {
    nodeEnv: e.NODE_ENV, host: e.HOST, port: e.PORT, logLevel: e.LOG_LEVEL,
    databaseUrl: e.DATABASE_URL, databaseConnectionLimit: e.DATABASE_CONNECTION_LIMIT, databaseTimezone: e.DATABASE_TIMEZONE,
    redisUrl: e.REDIS_URL, sessionSecret: e.SESSION_SECRET,
    authTokenSecret: e.AUTH_TOKEN_SECRET ?? derive('auth-email'), dataEncryptionKey: e.DATA_ENCRYPTION_KEY ?? derive('sensitive-data'),
    sessionCookieName: 'marketplace_session', sessionTtlSeconds: e.SESSION_TTL_SECONDS,
    preSessionTtlSeconds: 1800, authTokenTtlSeconds: 3600, cookieSecure: e.COOKIE_SECURE,
    appOrigins, publicAppUrl: e.PUBLIC_APP_URL, trustProxy: e.TRUST_PROXY, workerConcurrency: e.WORKER_CONCURRENCY,
    publicApiUrl: e.PUBLIC_API_URL, clamavHost: e.CLAMAV_HOST, clamavPort: e.CLAMAV_PORT, clamavTimeoutMs: e.CLAMAV_TIMEOUT_MS,
    providerEnvironment: e.PROVIDER_ENVIRONMENT, midtransServerKey: e.MIDTRANS_SERVER_KEY, midtransMerchantId: e.MIDTRANS_MERCHANT_ID,
    biteshipApiKey: e.BITESHIP_API_KEY, biteshipAccountId: e.BITESHIP_ACCOUNT_ID, biteshipWebhookToken: e.BITESHIP_WEBHOOK_TOKEN, biteshipCouriers: e.BITESHIP_COURIERS,
    paymentChannels: e.PAYMENT_CHANNELS.split(',').map(value => value.trim()).filter(Boolean), paymentChannelLimits, disputeWindowHours: e.DISPUTE_WINDOW_HOURS,
    refundChannels: e.MIDTRANS_REFUND_CHANNELS.split(',').filter(Boolean), manualRefundChannels: e.MIDTRANS_MANUAL_REFUND_CHANNELS.split(',').filter(Boolean),
    smtpHost: e.SMTP_HOST, smtpPort: e.SMTP_PORT, smtpSecure: e.SMTP_SECURE, smtpUser: e.SMTP_USER, smtpPassword: e.SMTP_PASSWORD, smtpFrom: e.SMTP_FROM,
    s3Endpoint: e.S3_ENDPOINT, s3Region: e.S3_REGION, s3Bucket: e.S3_BUCKET,
    s3AccessKeyId: e.S3_ACCESS_KEY_ID, s3SecretAccessKey: e.S3_SECRET_ACCESS_KEY, mediaBaseUrl: e.S3_PUBLIC_BASE_URL,
  };
}
export type Config = ReturnType<typeof loadConfig>;
