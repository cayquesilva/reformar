import {
  displayStatus,
  type QuoteContentInput,
  type QuoteSummaryDTO,
} from '@reformar/shared';
import type { Prisma } from '../../db.js';
import { centsIn, centsOut, dateIn, dateOut, decOut } from '../../lib/convert.js';

export const quoteSummarySelect = {
  id: true,
  number: true,
  title: true,
  status: true,
  validUntil: true,
  totalCents: true,
  currentRevision: true,
  createdAt: true,
  updatedAt: true,
  customer: { select: { id: true, name: true } },
} satisfies Prisma.QuoteSelect;

export type QuoteSummaryRow = Prisma.QuoteGetPayload<{ select: typeof quoteSummarySelect }>;

export function toQuoteSummary(q: QuoteSummaryRow, today?: string): QuoteSummaryDTO {
  const validUntil = dateOut(q.validUntil);
  return {
    id: q.id,
    number: q.number,
    title: q.title,
    customer: q.customer,
    status: q.status,
    displayStatus: displayStatus(q.status, validUntil, today),
    validUntil,
    totalCents: centsOut(q.totalCents),
    currentRevision: q.currentRevision,
    createdAt: q.createdAt.toISOString(),
    updatedAt: q.updatedAt.toISOString(),
  };
}

export const quoteFullInclude = {
  customer: true,
  items: { orderBy: { position: 'asc' } },
  materials: { orderBy: { position: 'asc' } },
  costs: { orderBy: { position: 'asc' } },
} satisfies Prisma.QuoteInclude;

export type QuoteFullRow = Prisma.QuoteGetPayload<{ include: typeof quoteFullInclude }>;

/** Linhas do banco -> conteúdo editável (mesmo formato aceito pela API). */
export function rowsToContent(q: QuoteFullRow): QuoteContentInput {
  return {
    customerId: q.customerId,
    title: q.title,
    description: q.description,
    siteAddress: q.siteAddress,
    siteCity: q.siteCity,
    siteState: q.siteState,
    validUntil: dateOut(q.validUntil),
    paymentTerms: q.paymentTerms,
    exclusions: q.exclusions,
    notes: q.notes,
    discountType: q.discountType,
    discountPercent: decOut(q.discountPercent),
    discountCents: centsOut(q.discountCents),
    taxPercent: decOut(q.taxPercent),
    contingencyPercent: decOut(q.contingencyPercent),
    items: q.items.map((i) => ({
      serviceId: i.serviceId,
      description: i.description,
      unit: i.unit,
      quantity: decOut(i.quantity),
      unitPriceCents: centsOut(i.unitPriceCents),
      notes: i.notes,
    })),
    materials: q.materials.map((m) => ({
      description: m.description,
      unit: m.unit,
      supply: m.supply,
      itemIndex: m.itemIndex,
      coefficient: decOut(m.coefficient),
      baseQuantity: decOut(m.baseQuantity),
      lossPercent: decOut(m.lossPercent),
      packageSize: decOut(m.packageSize),
      packageLabel: m.packageLabel,
      unitPriceCents: centsOut(m.unitPriceCents),
      notes: m.notes,
    })),
    costs: q.costs.map((c) => ({
      category: c.category,
      description: c.description,
      quantity: decOut(c.quantity),
      unit: c.unit,
      unitCostCents: centsOut(c.unitCostCents),
      chargeToClient: c.chargeToClient,
    })),
  };
}

/** Campos escalares do orçamento a partir do conteúdo validado. */
export function contentToQuoteFields(c: QuoteContentInput) {
  return {
    customerId: c.customerId,
    title: c.title,
    description: c.description,
    siteAddress: c.siteAddress,
    siteCity: c.siteCity,
    siteState: c.siteState,
    validUntil: dateIn(c.validUntil),
    paymentTerms: c.paymentTerms,
    exclusions: c.exclusions,
    notes: c.notes,
    discountType: c.discountType,
    discountPercent: c.discountType === 'PERCENT' ? c.discountPercent : null,
    discountCents: c.discountType === 'AMOUNT' ? centsIn(c.discountCents) : null,
    taxPercent: c.taxPercent,
    contingencyPercent: c.contingencyPercent,
  };
}

export function contentToChildRows(tenantId: string, quoteId: string, c: QuoteContentInput) {
  return {
    items: c.items.map((i, position) => ({
      tenantId,
      quoteId,
      position,
      serviceId: i.serviceId,
      description: i.description,
      unit: i.unit,
      quantity: i.quantity,
      unitPriceCents: BigInt(i.unitPriceCents),
      notes: i.notes,
    })),
    materials: c.materials.map((m, position) => ({
      tenantId,
      quoteId,
      position,
      description: m.description,
      unit: m.unit,
      supply: m.supply,
      itemIndex: m.itemIndex,
      coefficient: m.coefficient,
      baseQuantity: m.baseQuantity,
      lossPercent: m.lossPercent,
      packageSize: m.packageSize,
      packageLabel: m.packageLabel,
      unitPriceCents: centsIn(m.unitPriceCents),
      notes: m.notes,
    })),
    costs: c.costs.map((cost, position) => ({
      tenantId,
      quoteId,
      position,
      category: cost.category,
      description: cost.description,
      quantity: cost.quantity,
      unit: cost.unit,
      unitCostCents: BigInt(cost.unitCostCents),
      chargeToClient: cost.chargeToClient,
    })),
  };
}
