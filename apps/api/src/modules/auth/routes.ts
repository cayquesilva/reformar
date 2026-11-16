import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  changePasswordSchema,
  loginSchema,
  passwordResetConfirmSchema,
  passwordResetRequestSchema,
  ROLE_PERMISSIONS,
  signupSchema,
  type MeResponse,
  type SessionDTO,
} from '@reformar/shared';
import type { AppContext } from '../../context.js';
import { audit } from '../../lib/audit.js';
import { generateToken, getDummyHash, hashPassword, sha256, verifyPassword } from '../../lib/crypto.js';
import { badRequest, conflict, notFound, unauthorized } from '../../lib/errors.js';
import { clearSessionCookie, requireUser, setSessionCookie } from '../../plugins/auth.js';
import { DEFAULT_SERVICES } from '../catalog/default-services.js';
import { startTrialIfConfigured } from '../billing/service.js';

const RESET_TTL_MS = 60 * 60 * 1000;



export async function authRoutes(app: FastifyInstance, ctx: AppContext) {
  const { db } = ctx;
  // Limite por IP nas rotas de autenticação (força bruta). Mais folgado só em testes automatizados.
  const authRateLimit = { rateLimit: { max: ctx.config.isTest ? 1000 : 10, timeWindow: '1 minute' } };

  async function createSession(userId: string, activeTenantId: string | null, ua: string | undefined, ip: string) {
    const token = generateToken();
    await db.session.create({
      data: {
        tokenHash: sha256(token),
        userId,
        activeTenantId,
        userAgent: ua?.slice(0, 300) ?? null,
        ip,
        expiresAt: new Date(Date.now() + ctx.config.sessionTtlMs),
      },
    });
    return token;
  }

  app.post('/api/auth/signup', { config: authRateLimit }, async (request, reply) => {
    const input = signupSchema.parse(request.body);
    const existing = await db.user.findUnique({ where: { email: input.email } });
    if (existing) throw conflict('Já existe uma conta com este e-mail. Tente entrar ou recuperar a senha.', 'EMAIL_TAKEN');

    const passwordHash = await hashPassword(input.password);
    const { user, tenant } = await db.$transaction(async (tx) => {
      const user = await tx.user.create({ data: { name: input.name, email: input.email, passwordHash } });
      const tenant = await tx.tenant.create({
        data: {
          name: input.companyName,
          termsAcceptedAt: new Date(),
          profile: { create: { tradeName: input.companyName, email: input.email } },
          memberships: { create: { userId: user.id, role: 'OWNER' } },
        },
      });
      await tx.serviceCatalogItem.createMany({
        data: DEFAULT_SERVICES.map((s) => ({ ...s, tenantId: tenant.id })),
      });
      await startTrialIfConfigured(ctx, tx, tenant.id);
      await audit(tx, {
        tenantId: tenant.id,
        userId: user.id,
        action: 'tenant.created',
        entityType: 'Tenant',
        entityId: tenant.id,
        ip: request.ip,
      });
      return { user, tenant };
    });

    const token = await createSession(user.id, tenant.id, request.headers['user-agent'], request.ip);
    setSessionCookie(reply, ctx, token);
    return reply.status(201).send({ ok: true });
  });

  app.post('/api/auth/login', { config: authRateLimit }, async (request, reply) => {
    const input = loginSchema.parse(request.body);
    const user = await db.user.findUnique({
      where: { email: input.email },
      include: { memberships: { where: { active: true }, orderBy: { createdAt: 'asc' }, take: 1 } },
    });
    const ok = await verifyPassword(input.password, user?.passwordHash ?? (await getDummyHash()));
    if (!user || !ok) {
      await audit(db, {
        tenantId: null,
        userId: user?.id ?? null,
        action: 'auth.login_failed',
        entityType: 'User',
        ip: request.ip,
      });
      throw unauthorized('E-mail ou senha incorretos.');
    }
    const token = await createSession(user.id, user.memberships[0]?.tenantId ?? null, request.headers['user-agent'], request.ip);
    setSessionCookie(reply, ctx, token);
    await audit(db, { tenantId: null, userId: user.id, action: 'auth.login', entityType: 'User', entityId: user.id, ip: request.ip });
    return { ok: true };
  });

  app.post('/api/auth/logout', async (request, reply) => {
    if (request.auth) {
      await db.session.update({ where: { id: request.auth.sessionId }, data: { revokedAt: new Date() } });
    }
    clearSessionCookie(reply, ctx);
    return { ok: true };
  });

  app.get('/api/auth/me', async (request): Promise<MeResponse> => {
    const auth = requireUser(request);
    const memberships = await db.membership.findMany({
      where: { userId: auth.user.id, active: true },
      include: { tenant: { select: { name: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return {
      user: auth.user,
      activeTenant: auth.tenant
        ? {
            id: auth.tenant.id,
            name: auth.tenant.name,
            role: auth.tenant.role,
            permissions: [...auth.tenant.permissions],
            isDemo: auth.tenant.isDemo,
            access: auth.tenant.access,
          }
        : null,
      isPlatformAdmin: auth.isPlatformAdmin,
      memberships: memberships.map((m) => ({ tenantId: m.tenantId, tenantName: m.tenant.name, role: m.role })),
    };
  });

  app.post('/api/auth/switch-tenant', async (request) => {
    const auth = requireUser(request);
    const { tenantId } = z.object({ tenantId: z.uuid() }).parse(request.body);
    const membership = await db.membership.findUnique({
      where: { userId_tenantId: { userId: auth.user.id, tenantId } },
    });
    // Só troca para empresas às quais o usuário está explicitamente associado.
    if (!membership?.active) throw notFound('Empresa não encontrada.');
    await db.session.update({ where: { id: auth.sessionId }, data: { activeTenantId: tenantId } });
    return { ok: true, role: membership.role, permissions: ROLE_PERMISSIONS[membership.role] };
  });

  app.get('/api/auth/sessions', async (request): Promise<SessionDTO[]> => {
    const auth = requireUser(request);
    const sessions = await db.session.findMany({
      where: { userId: auth.user.id, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { lastSeenAt: 'desc' },
    });
    return sessions.map((s) => ({
      id: s.id,
      current: s.id === auth.sessionId,
      userAgent: s.userAgent,
      ip: s.ip,
      createdAt: s.createdAt.toISOString(),
      lastSeenAt: s.lastSeenAt.toISOString(),
    }));
  });

  app.delete('/api/auth/sessions/:id', async (request) => {
    const auth = requireUser(request);
    const { id } = z.object({ id: z.uuid() }).parse(request.params);
    const result = await db.session.updateMany({
      where: { id, userId: auth.user.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (result.count === 0) throw notFound('Sessão não encontrada.');
    await audit(db, { tenantId: null, userId: auth.user.id, action: 'auth.session_revoked', entityType: 'Session', entityId: id, ip: request.ip });
    return { ok: true };
  });

  app.post('/api/auth/sessions/revoke-others', async (request) => {
    const auth = requireUser(request);
    const result = await db.session.updateMany({
      where: { userId: auth.user.id, revokedAt: null, id: { not: auth.sessionId } },
      data: { revokedAt: new Date() },
    });
    await audit(db, { tenantId: null, userId: auth.user.id, action: 'auth.sessions_revoked_others', entityType: 'Session', data: { count: result.count }, ip: request.ip });
    return { ok: true, revoked: result.count };
  });

  app.post('/api/auth/change-password', { config: authRateLimit }, async (request) => {
    const auth = requireUser(request);
    const input = changePasswordSchema.parse(request.body);
    const user = await db.user.findUniqueOrThrow({ where: { id: auth.user.id } });
    if (!(await verifyPassword(input.currentPassword, user.passwordHash))) {
      throw badRequest('A senha atual está incorreta.', { currentPassword: 'A senha atual está incorreta.' });
    }
    await db.$transaction([
      db.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(input.newPassword) } }),
      db.session.updateMany({
        where: { userId: user.id, revokedAt: null, id: { not: auth.sessionId } },
        data: { revokedAt: new Date() },
      }),
    ]);
    await audit(db, { tenantId: null, userId: user.id, action: 'auth.password_changed', entityType: 'User', entityId: user.id, ip: request.ip });
    return { ok: true };
  });

  // Recuperação de acesso. Resposta sempre igual para não revelar se o e-mail existe.
  app.post('/api/auth/password-reset/request', { config: authRateLimit }, async (request) => {
    const { email } = passwordResetRequestSchema.parse(request.body);
    if (!ctx.mailer.enabled) {
      return { ok: false, reason: 'EMAIL_NOT_CONFIGURED' };
    }
    const user = await db.user.findUnique({ where: { email } });
    if (user) {
      const token = generateToken();
      await db.passwordResetToken.create({
        data: { userId: user.id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + RESET_TTL_MS) },
      });
      await ctx.mailer.sendPasswordReset(user.email, `${ctx.config.publicAppUrl}/redefinir-senha?token=${token}`);
      await audit(db, { tenantId: null, userId: user.id, action: 'auth.password_reset_requested', entityType: 'User', entityId: user.id, ip: request.ip });
    }
    return { ok: true };
  });

  app.post('/api/auth/password-reset/confirm', { config: authRateLimit }, async (request) => {
    const input = passwordResetConfirmSchema.parse(request.body);
    const record = await db.passwordResetToken.findUnique({ where: { tokenHash: sha256(input.token) } });
    if (!record || record.usedAt || record.expiresAt <= new Date()) {
      throw badRequest('Este link de redefinição é inválido ou expirou. Peça um novo.');
    }
    const passwordHash = await hashPassword(input.password);
    await db.$transaction([
      db.passwordResetToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
      db.user.update({ where: { id: record.userId }, data: { passwordHash } }),
      // Encerra todas as sessões abertas após redefinir a senha.
      db.session.updateMany({ where: { userId: record.userId, revokedAt: null }, data: { revokedAt: new Date() } }),
    ]);
    await audit(db, { tenantId: null, userId: record.userId, action: 'auth.password_reset', entityType: 'User', entityId: record.userId, ip: request.ip });
    return { ok: true };
  });
}
