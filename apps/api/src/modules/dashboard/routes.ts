import type { FastifyInstance } from 'fastify';
import { todayISO, type DashboardDTO } from '@reformar/shared';
import type { AppContext } from '../../context.js';
import { centsOut, dateIn } from '../../lib/convert.js';
import { requireTenant } from '../../plugins/auth.js';
import { quoteSummarySelect, toQuoteSummary } from '../quotes/mapper.js';

export async function dashboardRoutes(app: FastifyInstance, ctx: AppContext) {
  const { db } = ctx;

  app.get('/api/dashboard', async (request): Promise<DashboardDTO> => {
    const t = requireTenant(request, 'dashboard:read');
    const today = todayISO();
    const todayDate = dateIn(today);
    // Início do mês no fuso de São Paulo (UTC-3).
    const monthStart = new Date(`${today.slice(0, 7)}-01T00:00:00-03:00`);
    const base = { tenantId: t.tenantId, deletedAt: null };
    const canSeeQuotes = t.permissions.includes('quote:read');
    if (!canSeeQuotes) {
      return { awaiting: { count: 0, totalCents: 0 }, approvedThisMonth: { count: 0, totalCents: 0 }, drafts: 0, expired: 0, recentQuotes: [] };
    }

    const [awaiting, approved, drafts, expired, recent] = await Promise.all([
      db.quote.aggregate({
        where: { ...base, status: 'SENT', validUntil: { gte: todayDate } },
        _count: true,
        _sum: { totalCents: true },
      }),
      db.quote.aggregate({
        where: { ...base, status: 'APPROVED', approvedAt: { gte: monthStart } },
        _count: true,
        _sum: { totalCents: true },
      }),
      db.quote.count({ where: { ...base, status: 'DRAFT' } }),
      db.quote.count({ where: { ...base, status: 'SENT', validUntil: { lt: todayDate } } }),
      db.quote.findMany({ where: base, select: quoteSummarySelect, orderBy: { updatedAt: 'desc' }, take: 5 }),
    ]);

    return {
      awaiting: { count: awaiting._count, totalCents: centsOut(awaiting._sum.totalCents ?? 0n) },
      approvedThisMonth: { count: approved._count, totalCents: centsOut(approved._sum.totalCents ?? 0n) },
      drafts,
      expired,
      recentQuotes: recent.map((q) => toQuoteSummary(q, today)),
    };
  });
}
