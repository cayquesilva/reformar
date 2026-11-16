import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ROLE_PERMISSIONS, type AccessDecision, type Permission, type Role } from '@reformar/shared';
import { subscriptionAccess } from '../modules/billing/service.js';
import type { AppContext } from '../context.js';
import { sha256 } from '../lib/crypto.js';
import { AppError, forbidden, unauthorized } from '../lib/errors.js';

export const SESSION_COOKIE = 'rf_session';
const TOUCH_INTERVAL_MS = 5 * 60 * 1000;

export interface AuthState {
  sessionId: string;
  user: { id: string; name: string; email: string };
  isPlatformAdmin: boolean;
  tenant: {
    id: string;
    name: string;
    isDemo: boolean;
    role: Role;
    permissions: readonly Permission[];
    access: AccessDecision;
  } | null;
}

/** Contexto de empresa resolvido NO SERVIDOR a partir da sessão. Nunca vem do corpo/URL. */
export interface TenantContext {
  tenantId: string;
  userId: string;
  role: Role;
  permissions: readonly Permission[];
  ip: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    auth: AuthState | null;
  }
}

export function registerAuth(app: FastifyInstance, ctx: AppContext) {
  app.decorateRequest('auth', null);

  app.addHook('onRequest', async (request) => {
    request.auth = null;
    if (!request.url.startsWith('/api/')) return;
    const token = request.cookies[SESSION_COOKIE];
    if (!token || token.length > 200) return;

    const session = await ctx.db.session.findUnique({
      where: { tokenHash: sha256(token) },
      include: { user: { select: { id: true, name: true, email: true, isPlatformAdmin: true } } },
    });
    const now = new Date();
    if (!session || session.revokedAt || session.expiresAt <= now) return;

    let tenant: AuthState['tenant'] = null;
    if (session.activeTenantId) {
      const membership = await ctx.db.membership.findUnique({
        where: { userId_tenantId: { userId: session.userId, tenantId: session.activeTenantId } },
        include: { tenant: { select: { id: true, name: true, isDemo: true } } },
      });
      if (membership?.active) {
        const sub = (await ctx.payments.enabled())
          ? await ctx.db.tenantSubscription.findUnique({ where: { tenantId: membership.tenantId } })
          : null;
        tenant = {
          access: subscriptionAccess(sub),
          id: membership.tenant.id,
          name: membership.tenant.name,
          isDemo: membership.tenant.isDemo,
          role: membership.role,
          permissions: ROLE_PERMISSIONS[membership.role],
        };
      }
    }

    const { isPlatformAdmin, ...user } = session.user;
    request.auth = { sessionId: session.id, user, isPlatformAdmin, tenant };

    if (now.getTime() - session.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
      await ctx.db.session.update({ where: { id: session.id }, data: { lastSeenAt: now } });
    }
  });
}

export function requireUser(request: FastifyRequest): AuthState {
  if (!request.auth) throw unauthorized();
  return request.auth;
}

export function requireTenant(request: FastifyRequest, permission?: Permission): TenantContext {
  const auth = requireUser(request);
  if (!auth.tenant) throw forbidden('Escolha uma empresa para continuar.');
  if (permission && !auth.tenant.permissions.includes(permission)) throw forbidden();
  return {
    tenantId: auth.tenant.id,
    userId: auth.user.id,
    role: auth.tenant.role,
    permissions: auth.tenant.permissions,
    ip: request.ip,
  };
}

export function setSessionCookie(reply: FastifyReply, ctx: AppContext, token: string) {
  reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: ctx.config.cookieSecure,
    sameSite: 'lax',
    path: '/',
    maxAge: Math.floor(ctx.config.sessionTtlMs / 1000),
  });
}

export function clearSessionCookie(reply: FastifyReply, ctx: AppContext) {
  reply.clearCookie(SESSION_COOKIE, { path: '/', httpOnly: true, secure: ctx.config.cookieSecure, sameSite: 'lax' });
}

/**
 * Proteção CSRF para rotas autenticadas por cookie:
 * - cookie SameSite=Lax;
 * - requisições que alteram dados exigem o cabeçalho X-Reformar-Client (força preflight CORS);
 * - se houver Origin, ela precisa estar na lista permitida.
 */
export function registerCsrfProtection(app: FastifyInstance, ctx: AppContext) {
  const safe = new Set(['GET', 'HEAD', 'OPTIONS']);
  app.addHook('onRequest', async (request) => {
    if (
      safe.has(request.method) ||
      !request.url.startsWith('/api/') ||
      request.url.startsWith('/api/public/') ||
      request.url.startsWith('/api/webhooks/')
    ) {
      return;
    }
    const origin = request.headers.origin;
    if (origin && !ctx.config.allowedOrigins.includes(origin.replace(/\/$/, ''))) {
      throw forbidden('Origem da requisição não permitida.');
    }
    if (request.headers['x-reformar-client'] !== 'web') {
      throw forbidden('Requisição sem identificação do aplicativo.');
    }
  });
}

/**
 * Assinatura inadimplente/expirada => SOMENTE LEITURA: bloqueia alterações, mas mantém
 * consulta, exportação, login/conta e gestão da assinatura (nunca apaga dados).
 */
const ALWAYS_ALLOWED = ['/api/auth/', '/api/billing/', '/api/webhooks/', '/api/public/', '/api/platform/'];
export function registerSubscriptionGate(app: FastifyInstance) {
  app.addHook('preHandler', async (request) => {
    if (request.method === 'GET' || request.method === 'HEAD' || !request.url.startsWith('/api/')) return;
    if (ALWAYS_ALLOWED.some((p) => request.url.startsWith(p))) return;
    const access = request.auth?.tenant?.access;
    if (access && access.level === 'READ_ONLY') {
      throw new AppError(402, 'SUBSCRIPTION_INACTIVE', access.reason);
    }
  });
}
