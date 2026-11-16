import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { quoteNumberLabel } from '@reformar/shared';
import type { AppContext } from '../../context.js';
import { audit } from '../../lib/audit.js';
import { sha256 } from '../../lib/crypto.js';
import { notFound } from '../../lib/errors.js';
import type { QuoteDocument } from '../quotes/document.js';
import { renderQuotePdf } from '../quotes/pdf.js';
import { loadLogo } from '../quotes/service.js';

/**
 * Rotas públicas (sem login). Acesso somente por token aleatório de alta entropia,
 * guardado apenas como hash, com expiração e possibilidade de revogação.
 * Nunca expõe o modo "interno" (custos e lucro).
 */
export async function publicRoutes(app: FastifyInstance, ctx: AppContext) {
  const { db } = ctx;

  app.get(
    '/api/public/quotes/:token/pdf',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const { token } = z.object({ token: z.string().min(20).max(100).regex(/^[\w-]+$/) }).parse(request.params);
      const link = await db.quoteShareLink.findUnique({ where: { tokenHash: sha256(token) } });
      const invalid = 'Link inválido ou expirado. Peça um novo link a quem enviou o orçamento.';
      if (!link || link.revokedAt || link.expiresAt <= new Date()) throw notFound(invalid);
      const quote = await db.quote.findFirst({
        where: { id: link.quoteId, tenantId: link.tenantId, deletedAt: null },
        select: { id: true },
      });
      if (!quote) throw notFound(invalid);
      const version = await db.quoteVersion.findUnique({
        where: { quoteId_revision: { quoteId: link.quoteId, revision: link.revision } },
      });
      if (!version || version.tenantId !== link.tenantId) throw notFound(invalid);

      const document = version.snapshot as unknown as QuoteDocument;
      const pdf = await renderQuotePdf(document, link.mode === 'SUMMARY' ? 'summary' : 'detailed', await loadLogo(db, link.tenantId));
      await db.quoteShareLink.update({
        where: { id: link.id },
        data: { accessCount: { increment: 1 }, lastAccessAt: new Date() },
      });
      if (link.accessCount === 0) {
        await audit(db, {
          tenantId: link.tenantId,
          userId: null,
          action: 'quote.public_pdf_viewed',
          entityType: 'Quote',
          entityId: link.quoteId,
          data: { revision: link.revision },
          ip: request.ip,
        });
      }
      return reply
        .header('Content-Type', 'application/pdf')
        .header('Content-Disposition', `inline; filename="orcamento-${quoteNumberLabel(document.number)}.pdf"`)
        .header('Cache-Control', 'private, no-store')
        .header('X-Robots-Tag', 'noindex, nofollow')
        .header('Referrer-Policy', 'no-referrer')
        .send(pdf);
    },
  );
}
