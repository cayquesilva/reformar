import fastifyCookie from '@fastify/cookie';
import fastifyHelmet from '@fastify/helmet';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { PublicConfigResponse } from '@reformar/shared';
import type { AppConfig } from './config.js';
import type { AppContext } from './context.js';
import type { Db } from './db.js';
import { registerErrorHandler } from './lib/errors.js';
import { ConsoleMailer, DisabledMailer, type Mailer } from './lib/mailer.js';
import { LocalDiskStorage, type Storage } from './lib/storage.js';
import { AnthropicAssistantModel, type AssistantModel } from './modules/ai/model.js';
import { aiRoutes } from './modules/ai/routes.js';
import type { BillingProvider } from './modules/billing/asaas.js';
import { Payments } from './modules/billing/payments.js';
import type { PaypalProvider } from './modules/billing/paypal.js';
import { billingRoutes } from './modules/billing/routes.js';
import { processPendingEvents, reconcileTenant } from './modules/billing/service.js';
import { platformRoutes } from './modules/platform/routes.js';
import { authRoutes } from './modules/auth/routes.js';
import { catalogRoutes } from './modules/catalog/routes.js';
import { companyExportRoutes, companyRoutes } from './modules/company/routes.js';
import { customerRoutes } from './modules/customers/routes.js';
import { financeRoutes } from './modules/finance/routes.js';
import { attachmentRoutes } from './modules/projects/attachments.js';
import { projectRoutes } from './modules/projects/routes.js';
import { stockRoutes } from './modules/stock/routes.js';
import { dashboardRoutes } from './modules/dashboard/routes.js';
import { publicRoutes } from './modules/public/routes.js';
import { quoteRoutes } from './modules/quotes/routes.js';
import { registerAuth, registerCsrfProtection, registerSubscriptionGate } from './plugins/auth.js';

export interface BuildOptions {
  config: AppConfig;
  db: Db;
  mailer?: Mailer;
  storage?: Storage;
  /** Injeção para testes; em produção vem da configuração. */
  assistant?: AssistantModel | null;
  /** Testes: Asaas simulado. */
  billing?: BillingProvider | null;
  /** Testes: PayPal simulado. */
  paypal?: PaypalProvider | null;
}

export async function buildApp(opts: BuildOptions): Promise<FastifyInstance> {
  const { config, db } = opts;
  const app = Fastify({
    logger: config.isTest
      ? false
      : {
          level: config.logLevel,
          // Nunca registrar cookies/tokens nos logs.
          redact: ['req.headers.cookie', 'req.headers.authorization', 'res.headers["set-cookie"]'],
        },
    trustProxy: config.trustProxy,
    bodyLimit: 1024 * 1024,
  });

  const mailer: Mailer =
    opts.mailer ?? (config.mailer === 'console' && !config.isProd ? new ConsoleMailer(app.log) : new DisabledMailer());
  const storage: Storage = opts.storage ?? new LocalDiskStorage(path.resolve(config.storageDir));
  const assistant: AssistantModel | null =
    opts.assistant !== undefined
      ? opts.assistant
      : config.aiProvider === 'anthropic'
        ? new AnthropicAssistantModel(config.aiModel, config.aiEffort)
        : null;
  const payments = new Payments(db, config, { asaas: opts.billing, paypal: opts.paypal });
  const ctx: AppContext = { config, db, mailer, storage, assistant, payments };

  registerErrorHandler(app);
  // Uploads binários (logo, fotos, comprovantes). O limite de tamanho é definido por rota.
  app.addContentTypeParser(
    ['image/png', 'image/jpeg', 'image/webp', 'application/pdf', 'application/octet-stream'],
    { parseAs: 'buffer' },
    (_req, body, done) => done(null, body),
  );
  await app.register(fastifyHelmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
        connectSrc: ["'self'"],
        frameSrc: ["'self'", 'blob:'],
        objectSrc: ["'self'", 'blob:'],
        frameAncestors: ["'self'"],
      },
    },
    crossOriginResourcePolicy: { policy: 'same-origin' },
  });
  await app.register(fastifyCookie);
  await app.register(fastifyRateLimit, {
    global: true,
    max: config.isTest ? 10_000 : 300,
    timeWindow: '1 minute',
  });

  registerAuth(app, ctx);
  registerCsrfProtection(app, ctx);
  registerSubscriptionGate(app);

  app.get('/api/health', async () => {
    await db.$queryRaw`SELECT 1`;
    return { ok: true };
  });

  app.get('/api/config', async (): Promise<PublicConfigResponse> => ({
    features: {
      passwordResetEmail: mailer.enabled,
      voiceAssistant: !!assistant,
      subscriptions: await payments.enabled(),
    },
  }));

  await authRoutes(app, ctx);
  await companyRoutes(app, ctx);
  await companyExportRoutes(app, ctx);
  await customerRoutes(app, ctx);
  await catalogRoutes(app, ctx);
  await quoteRoutes(app, ctx);
  await dashboardRoutes(app, ctx);
  await projectRoutes(app, ctx);
  await attachmentRoutes(app, ctx);
  await financeRoutes(app, ctx);
  await stockRoutes(app, ctx);
  await aiRoutes(app, ctx);
  await billingRoutes(app, ctx);
  await platformRoutes(app, ctx);
  await publicRoutes(app, ctx);

  // Worker simples (fila sobre o banco): reprocessa webhooks com falha e reconcilia assinaturas 1x/dia.
  // Roda sempre fora dos testes: os meios de pagamento podem ser ligados pelo painel a qualquer momento.
  if (!config.isTest) {
    let lastReconcile = 0;
    const timer = setInterval(async () => {
      try {
        const [asaas, paypal] = await Promise.all([payments.asaas(), payments.paypal()]);
        if (!asaas && !paypal) return;
        await processPendingEvents(ctx);
        if (Date.now() - lastReconcile > 24 * 3600_000) {
          lastReconcile = Date.now();
          const subs = await db.tenantSubscription.findMany({
            where: { OR: [{ asaasSubscriptionId: { not: null } }, { paypalSubscriptionId: { not: null } }], status: { not: 'CANCELED' } },
            select: { tenantId: true },
          });
          for (const s of subs) {
            await reconcileTenant(ctx, s.tenantId).catch((e) => app.log.warn({ err: e, tenantId: s.tenantId }, 'reconciliação falhou'));
          }
        }
      } catch (e) {
        app.log.error({ err: e }, 'worker de cobrança falhou');
      }
    }, 60_000);
    timer.unref();
    app.addHook('onClose', async () => clearInterval(timer));
  }

  // Produção: serve o build do front-end (mesma origem => cookies e CSRF simples).
  if (config.serveWebDir) {
    const root = path.resolve(config.serveWebDir);
    if (!existsSync(path.join(root, 'index.html'))) {
      throw new Error(`SERVE_WEB_DIR inválido: ${root}/index.html não encontrado`);
    }
    await app.register(fastifyStatic, { root, wildcard: false });
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith('/api/') || request.method !== 'GET') {
        return reply.status(404).send({ error: 'NOT_FOUND', message: 'Endereço não encontrado.' });
      }
      return reply.sendFile('index.html');
    });
  }

  return app;
}
