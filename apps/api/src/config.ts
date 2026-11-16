import { z } from 'zod';

const bool = z
  .enum(['true', 'false', '1', '0', ''])
  .optional()
  .transform((v) => v === 'true' || v === '1');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(3333),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL é obrigatória'),
  APP_ORIGIN: z.string().default('http://localhost:5180'),
  PUBLIC_APP_URL: z.string().optional(),
  SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  COOKIE_SECURE: bool,
  TRUST_PROXY: bool,
  SERVE_WEB_DIR: z.string().optional(),
  MAILER: z.enum(['none', 'console']).default('none'),
  STORAGE_DIR: z.string().default('./storage'),
  // Assistente (Fase 3)
  AI_PROVIDER: z.enum(['none', 'anthropic']).default('none'),
  AI_MODEL: z.string().default('claude-opus-5-5'),
  AI_EFFORT: z.enum(['low', 'medium', 'high']).default('low'),
  AI_MONTHLY_REQUEST_LIMIT: z.coerce.number().int().min(0).default(100),
  // Assinatura da plataforma via Asaas (Fase 4)
  ASAAS_API_KEY: z.string().optional(),
  ASAAS_BASE_URL: z.string().optional(),
  ASAAS_WEBHOOK_TOKEN: z.string().optional(),
  // Chave para cifrar credenciais dos meios de pagamento salvas pelo painel (32 bytes em base64).
  SECRETS_KEY: z.string().optional(),
  BILLING_TRIAL_DAYS: z.coerce.number().int().min(0).max(90).default(14),
  BILLING_GRACE_DAYS: z.coerce.number().int().min(0).max(60).default(7),
});

export type AppConfig = ReturnType<typeof loadConfig>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Configuração inválida: ${msg}`);
  }
  const e = parsed.data;
  if (e.NODE_ENV === 'production') {
    if (!e.COOKIE_SECURE) throw new Error('Em produção, COOKIE_SECURE deve ser true (HTTPS obrigatório).');
    if (e.MAILER === 'console') throw new Error('MAILER=console não é permitido em produção.');
  }
  const billingEnabled = !!e.ASAAS_API_KEY;
  if (billingEnabled) {
    if (!e.ASAAS_WEBHOOK_TOKEN || e.ASAAS_WEBHOOK_TOKEN.length < 32 || /\s/.test(e.ASAAS_WEBHOOK_TOKEN)) {
      throw new Error('ASAAS_WEBHOOK_TOKEN é obrigatório (32+ caracteres, sem espaços) quando ASAAS_API_KEY está definido.');
    }
    if (e.NODE_ENV === 'production' && !e.ASAAS_BASE_URL) {
      throw new Error('Em produção, defina ASAAS_BASE_URL com a URL oficial da API do Asaas (conferir na documentação vigente).');
    }
  }
  if (e.AI_PROVIDER === 'anthropic' && !process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN && e.NODE_ENV === 'production') {
    throw new Error('AI_PROVIDER=anthropic exige ANTHROPIC_API_KEY no servidor.');
  }
  let secretsKey: Buffer | null = null;
  if (e.SECRETS_KEY) {
    secretsKey = Buffer.from(e.SECRETS_KEY, 'base64');
    if (secretsKey.length !== 32) throw new Error('SECRETS_KEY deve ter 32 bytes em base64 (gere com: openssl rand -base64 32).');
  }
  const origins = e.APP_ORIGIN.split(',')
    .map((o) => o.trim().replace(/\/$/, ''))
    .filter(Boolean);
  return {
    env: e.NODE_ENV,
    isProd: e.NODE_ENV === 'production',
    isTest: e.NODE_ENV === 'test',
    port: e.PORT,
    host: e.HOST,
    logLevel: e.LOG_LEVEL,
    databaseUrl: e.DATABASE_URL,
    allowedOrigins: origins,
    publicAppUrl: (e.PUBLIC_APP_URL || origins[0] || 'http://localhost:5180').replace(/\/$/, ''),
    sessionTtlMs: e.SESSION_TTL_DAYS * 24 * 60 * 60 * 1000,
    cookieSecure: e.COOKIE_SECURE,
    trustProxy: e.TRUST_PROXY,
    serveWebDir: e.SERVE_WEB_DIR || null,
    mailer: e.MAILER,
    storageDir: e.STORAGE_DIR,
    aiProvider: e.AI_PROVIDER,
    aiModel: e.AI_MODEL,
    aiEffort: e.AI_EFFORT,
    aiMonthlyRequestLimit: e.AI_MONTHLY_REQUEST_LIMIT,
    secretsKey,
    billing: {
      enabled: billingEnabled,
      apiKey: e.ASAAS_API_KEY ?? null,
      // Padrão apenas fora de produção: sandbox oficial documentado.
      baseUrl: (e.ASAAS_BASE_URL || 'https://api-sandbox.asaas.com').replace(/\/$/, ''),
      webhookToken: e.ASAAS_WEBHOOK_TOKEN ?? null,
      trialDays: e.BILLING_TRIAL_DAYS,
      graceDays: e.BILLING_GRACE_DAYS,
    },
  };
}
