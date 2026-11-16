/**
 * Painel da plataforma → Meios de pagamento (Asaas e PayPal).
 * Credenciais entram cifradas (SECRETS_KEY) e NUNCA voltam ao navegador: só "salva" e os 4 últimos caracteres.
 * Campo vazio no formulário = manter o valor salvo.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { PaymentProviderAdminDTO, PaymentProvidersAdminDTO } from '@reformar/shared';
import type { AppContext } from '../../context.js';
import { audit } from '../../lib/audit.js';
import { AppError, badRequest } from '../../lib/errors.js';
import type { AsaasSecrets, PaypalSecrets, PaypalSettings, ProviderEnv, ProviderId } from '../billing/payments.js';

const providerParam = z.object({ provider: z.enum(['ASAAS', 'PAYPAL']) });
const secret = z.string().trim().max(500).optional();

const updateSchema = z.object({
  enabled: z.boolean(),
  environment: z.enum(['SANDBOX', 'PRODUCTION']),
  credentials: z.object({ apiKey: secret, webhookToken: secret, clientId: secret, clientSecret: secret }).default({}),
  settings: z
    .object({
      webhookId: z.string().trim().max(200).optional(),
      currency: z
        .string()
        .trim()
        .regex(/^[A-Z]{3}$/, { message: 'Moeda: código de 3 letras (ex.: BRL).' })
        .optional(),
    })
    .default({}),
});

const hint = (v: string | undefined) => (v ? { set: true, hint: v.length > 8 ? `…${v.slice(-4)}` : null } : { set: false, hint: null });

export async function paymentProviderRoutes(
  app: FastifyInstance,
  ctx: AppContext,
  requireAdmin: (r: FastifyRequest) => { user: { id: string } },
) {
  const { db, payments } = ctx;

  async function view(provider: ProviderId): Promise<PaymentProviderAdminDTO> {
    const row = await db.paymentProviderConfig.findUnique({ where: { provider } });
    const subscriptions = await db.tenantSubscription.count({ where: { provider, status: { not: 'CANCELED' } } });
    const webhookUrl = `${ctx.config.publicAppUrl}/api/webhooks/${provider.toLowerCase()}`;
    const lastTest = row?.lastTestAt ? { at: row.lastTestAt.toISOString(), ok: !!row.lastTestOk, message: row.lastTestMessage } : null;

    if (provider === 'ASAAS') {
      if (!row) {
        const env = ctx.config.billing;
        return {
          provider,
          enabled: env.enabled,
          environment: /sandbox/i.test(env.baseUrl) ? 'SANDBOX' : 'PRODUCTION',
          source: env.enabled ? 'environment' : 'none',
          ready: env.enabled,
          unreadable: false,
          credentials: { apiKey: hint(env.apiKey ?? undefined), webhookToken: hint(env.webhookToken ?? undefined) },
          settings: {},
          webhookUrl,
          lastTest,
          subscriptions,
        };
      }
      const s = payments.openSecrets<AsaasSecrets>(row.secrets);
      return {
        provider,
        enabled: row.enabled,
        environment: row.environment === 'PRODUCTION' ? 'PRODUCTION' : 'SANDBOX',
        source: 'database',
        ready: !!(s?.apiKey && s.webhookToken),
        unreadable: !!row.secrets && !s,
        credentials: { apiKey: hint(s?.apiKey), webhookToken: hint(s?.webhookToken) },
        settings: {},
        webhookUrl,
        lastTest,
        subscriptions,
      };
    }
    const s = row ? payments.openSecrets<PaypalSecrets>(row.secrets) : null;
    const settings = (row?.settings ?? {}) as PaypalSettings;
    return {
      provider,
      enabled: !!row?.enabled,
      environment: row?.environment === 'PRODUCTION' ? 'PRODUCTION' : 'SANDBOX',
      source: row ? 'database' : 'none',
      ready: !!(s?.clientId && s.clientSecret && settings.webhookId),
      unreadable: !!row?.secrets && !s,
      credentials: { clientId: hint(s?.clientId), clientSecret: hint(s?.clientSecret) },
      settings: { webhookId: settings.webhookId ?? null, currency: settings.currency ?? 'BRL' },
      webhookUrl,
      lastTest,
      subscriptions,
    };
  }

  app.get('/api/platform/payment-providers', async (request): Promise<PaymentProvidersAdminDTO> => {
    requireAdmin(request);
    return { canStoreSecrets: !!payments.box, providers: [await view('ASAAS'), await view('PAYPAL')] };
  });

  app.put('/api/platform/payment-providers/:provider', async (request) => {
    const admin = requireAdmin(request);
    const { provider } = providerParam.parse(request.params);
    const input = updateSchema.parse(request.body);
    if (!payments.box) {
      throw new AppError(503, 'SECRETS_KEY_MISSING', 'Defina SECRETS_KEY no servidor para salvar credenciais de pagamento.');
    }
    const row = await db.paymentProviderConfig.findUnique({ where: { provider } });
    const keep = <T extends object>() => (row ? (payments.openSecrets<T>(row.secrets) ?? ({} as T)) : ({} as T));
    const c = input.credentials;
    const fields: Record<string, string> = {};
    let secrets: object;
    let settings: PaypalSettings | Record<string, never> = {};

    if (provider === 'ASAAS') {
      // Primeira gravação com o Asaas vindo das variáveis do servidor: aproveita os valores atuais.
      const prev = row
        ? keep<AsaasSecrets>()
        : { apiKey: ctx.config.billing.apiKey ?? undefined, webhookToken: ctx.config.billing.webhookToken ?? undefined };
      const next: AsaasSecrets = { apiKey: c.apiKey || prev.apiKey, webhookToken: c.webhookToken || prev.webhookToken };
      if (next.webhookToken && (next.webhookToken.length < 32 || /\s/.test(next.webhookToken))) {
        fields['credentials.webhookToken'] = 'Use 32 caracteres ou mais, sem espaços.';
      }
      if (next.apiKey && next.webhookToken && next.apiKey === next.webhookToken) {
        fields['credentials.webhookToken'] = 'O token do webhook deve ser diferente da chave de API.';
      }
      if (input.enabled && !next.apiKey) fields['credentials.apiKey'] = 'Informe a chave de API.';
      if (input.enabled && !next.webhookToken) fields['credentials.webhookToken'] ??= 'Informe o token do webhook.';
      secrets = next;
    } else {
      const prev = keep<PaypalSecrets>();
      const prevSettings = (row?.settings ?? {}) as PaypalSettings;
      const next: PaypalSecrets = { clientId: c.clientId || prev.clientId, clientSecret: c.clientSecret || prev.clientSecret };
      const webhookId = input.settings.webhookId ?? prevSettings.webhookId;
      if (input.enabled && !next.clientId) fields['credentials.clientId'] = 'Informe o client ID.';
      if (input.enabled && !next.clientSecret) fields['credentials.clientSecret'] = 'Informe o secret.';
      if (input.enabled && !webhookId) fields['settings.webhookId'] = 'Informe o ID do webhook cadastrado no PayPal.';
      secrets = next;
      settings = {
        ...prevSettings,
        webhookId: webhookId || undefined,
        currency: input.settings.currency ?? prevSettings.currency ?? 'BRL',
      };
    }
    if (Object.keys(fields).length) throw badRequest('Confira os campos destacados.', fields);

    const envChanged = row && row.environment !== input.environment;
    const data = {
      enabled: input.enabled,
      environment: input.environment,
      secrets: payments.sealSecrets(secrets),
      ...(provider === 'PAYPAL' ? { settings: settings as object } : {}),
      updatedById: admin.user.id,
      // Credencial ou ambiente novos: o último teste deixa de valer.
      ...(envChanged || Object.values(c).some(Boolean) ? { lastTestAt: null, lastTestOk: null, lastTestMessage: null } : {}),
    };
    await db.paymentProviderConfig.upsert({ where: { provider }, create: { provider, ...data }, update: data });
    payments.invalidate();
    await audit(db, {
      tenantId: null,
      userId: admin.user.id,
      action: 'platform.payment_provider_updated',
      entityType: 'PaymentProviderConfig',
      entityId: provider,
      // Nunca o valor das credenciais: só quais foram trocadas.
      data: {
        enabled: input.enabled,
        environment: input.environment,
        changed: Object.entries(c)
          .filter(([, v]) => v)
          .map(([k]) => k),
      },
    });
    return view(provider);
  });

  /** Testa as credenciais salvas: token no PayPal; listar 1 cliente no Asaas. */
  app.post('/api/platform/payment-providers/:provider/test', async (request) => {
    const admin = requireAdmin(request);
    const { provider } = providerParam.parse(request.params);
    const row = await db.paymentProviderConfig.findUnique({ where: { provider } });
    let run: () => Promise<void>;
    if (provider === 'ASAAS') {
      const s = row ? payments.openSecrets<AsaasSecrets>(row.secrets) : null;
      const env: ProviderEnv = row?.environment === 'PRODUCTION' ? 'PRODUCTION' : 'SANDBOX';
      if (s?.apiKey) run = () => payments.asaasClient(env, s.apiKey!).testConnection();
      else if (!row && ctx.config.billing.apiKey) {
        const cfg = ctx.config.billing;
        run = () =>
          payments.asaasClient(/sandbox/i.test(cfg.baseUrl) ? 'SANDBOX' : 'PRODUCTION', cfg.apiKey!, cfg.baseUrl).testConnection();
      } else throw badRequest('Salve a chave de API antes de testar.');
    } else {
      const s = row ? payments.openSecrets<PaypalSecrets>(row.secrets) : null;
      if (!s?.clientId || !s.clientSecret) throw badRequest('Salve o client ID e o secret antes de testar.');
      const env: ProviderEnv = row?.environment === 'PRODUCTION' ? 'PRODUCTION' : 'SANDBOX';
      run = () => payments.paypalClient(env, s.clientId!, s.clientSecret!).testConnection();
    }
    let ok = true;
    let message: string | null = null;
    try {
      await run();
    } catch (e) {
      ok = false;
      message = e instanceof AppError ? e.message : 'Não foi possível testar agora.';
    }
    if (row)
      await db.paymentProviderConfig.update({
        where: { provider },
        data: { lastTestAt: new Date(), lastTestOk: ok, lastTestMessage: message },
      });
    await audit(db, {
      tenantId: null,
      userId: admin.user.id,
      action: 'platform.payment_provider_tested',
      entityType: 'PaymentProviderConfig',
      entityId: provider,
      data: { ok },
    });
    return { ok, message };
  });
}
