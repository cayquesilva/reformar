import {
  dec,
  decToString,
  formatBRL,
  physicalProgress,
  projectFinanceSummary,
  todayISO,
  type ProjectAlertDTO,
  type ProjectDetailDTO,
  type ProjectSummaryDTO,
  type StageDTO,
} from '@reformar/shared';
import type { Db, Prisma, Tx } from '../../db.js';
import { audit } from '../../lib/audit.js';
import { centsOut, dateIn, dateOut, decOut } from '../../lib/convert.js';
import { conflict, notFound } from '../../lib/errors.js';
import type { TenantContext } from '../../plugins/auth.js';
import type { QuoteDocument } from '../quotes/document.js';
import { assertProjectLimit } from '../billing/service.js';

export const projectSummarySelect = {
  id: true,
  number: true,
  name: true,
  status: true,
  startDate: true,
  expectedEndDate: true,
  contractTotalCents: true,
  quoteRevision: true,
  updatedAt: true,
  customer: { select: { id: true, name: true } },
  quote: { select: { id: true, number: true } },
  stages: { select: { plannedQuantity: true, measuredQuantity: true, unitPriceCents: true } },
} satisfies Prisma.ProjectSelect;

type SummaryRow = Prisma.ProjectGetPayload<{ select: typeof projectSummarySelect }>;

export const canSeeMoney = (t: TenantContext) => t.permissions.includes('finance:read');

function progressOf(stages: SummaryRow['stages']) {
  return physicalProgress(
    stages.map((s) => ({
      plannedQuantity: decOut(s.plannedQuantity),
      measuredQuantity: decOut(s.measuredQuantity),
      unitPriceCents: centsOut(s.unitPriceCents),
    })),
  );
}

export function isLate(p: { status: string; expectedEndDate: Date | null }, today = todayISO()) {
  return !!p.expectedEndDate && ['PLANNED', 'IN_PROGRESS', 'PAUSED'].includes(p.status) && dateOut(p.expectedEndDate) < today;
}

export function toProjectSummary(p: SummaryRow, t: TenantContext): ProjectSummaryDTO {
  return {
    id: p.id,
    number: p.number,
    name: p.name,
    status: p.status,
    customer: p.customer,
    quote: p.quote ? { id: p.quote.id, number: p.quote.number, revision: p.quoteRevision } : null,
    startDate: p.startDate ? dateOut(p.startDate) : null,
    expectedEndDate: p.expectedEndDate ? dateOut(p.expectedEndDate) : null,
    progressPercent: progressOf(p.stages),
    late: isLate(p),
    contractTotalCents: canSeeMoney(t) ? centsOut(p.contractTotalCents) : null,
    updatedAt: p.updatedAt.toISOString(),
  };
}

export async function loadProject(db: Db | Tx, tenantId: string, id: string) {
  const p = await db.project.findFirst({ where: { id, tenantId } });
  if (!p) throw notFound('Obra não encontrada.');
  return p;
}

async function nextProjectNumber(tx: Tx, tenantId: string) {
  const { projectSeq } = await tx.tenant.update({
    where: { id: tenantId },
    data: { projectSeq: { increment: 1 } },
    select: { projectSeq: true },
  });
  return projectSeq;
}

async function createProjectLocation(tx: Tx, tenantId: string, projectId: string, number: number, name: string) {
  await tx.stockLocation.create({
    data: { tenantId, projectId, name: `Obra ${String(number).padStart(4, '0')} - ${name}`.slice(0, 120) },
  });
}

/** Converte orçamento APROVADO em obra, a partir da revisão aprovada (fotografia imutável). */
export async function createProjectFromQuote(
  db: Db,
  t: TenantContext,
  input: { quoteId: string; startDate: string | null; expectedEndDate: string | null },
) {
  return db.$transaction(async (tx) => {
    const quote = await tx.quote.findFirst({
      where: { id: input.quoteId, tenantId: t.tenantId, deletedAt: null },
      include: { project: { select: { id: true } } },
    });
    if (!quote) throw notFound('Orçamento não encontrado.');
    if (quote.project) throw conflict('Este orçamento já virou uma obra.', 'PROJECT_EXISTS');
    if (quote.status !== 'APPROVED') throw conflict('Só orçamentos aprovados podem virar obra.', 'NOT_APPROVED');
    const approval = await tx.quoteApproval.findFirst({
      where: { tenantId: t.tenantId, quoteId: quote.id },
      orderBy: { createdAt: 'desc' },
      include: { version: true },
    });
    if (!approval) throw conflict('Aprovação não encontrada.', 'NOT_APPROVED');
    const doc = approval.version.snapshot as unknown as QuoteDocument;
    const totals = doc.calculation.totals;

    await assertProjectLimit(tx, t.tenantId);
    const number = await nextProjectNumber(tx, t.tenantId);
    const project = await tx.project.create({
      data: {
        tenantId: t.tenantId,
        number,
        quoteId: quote.id,
        quoteRevision: approval.version.revision,
        customerId: quote.customerId,
        name: doc.content.title,
        siteAddress: doc.content.siteAddress,
        siteCity: doc.content.siteCity,
        siteState: doc.content.siteState,
        startDate: input.startDate ? dateIn(input.startDate) : null,
        expectedEndDate: input.expectedEndDate ? dateIn(input.expectedEndDate) : null,
        contractTotalCents: BigInt(totals.totalCents),
        plannedCostCents: BigInt(totals.internalCostsCents),
        plannedTaxCents: BigInt(totals.taxCents),
        plannedContingencyCents: BigInt(totals.contingencyCents),
        createdById: t.userId,
      },
    });
    if (doc.calculation.items.length) {
      await tx.projectStage.createMany({
        data: doc.calculation.items.map((i, position) => ({
          tenantId: t.tenantId,
          projectId: project.id,
          position,
          name: i.description,
          unit: i.unit,
          plannedQuantity: i.quantity,
          unitPriceCents: BigInt(i.unitPriceCents),
        })),
      });
    }
    if (doc.calculation.materials.length) {
      await tx.projectMaterial.createMany({
        data: doc.calculation.materials.map((m) => ({
          tenantId: t.tenantId,
          projectId: project.id,
          description: m.description,
          unit: m.unit,
          plannedQuantity: m.purchaseQuantity,
          plannedPackages: m.packages,
          packageLabel: m.packageLabel,
          supply: m.supply,
        })),
      });
    }
    await createProjectLocation(tx, t.tenantId, project.id, number, project.name);
    await audit(tx, {
      tenantId: t.tenantId,
      userId: t.userId,
      action: 'project.created_from_quote',
      entityType: 'Project',
      entityId: project.id,
      data: { quoteNumber: quote.number, revision: approval.version.revision, contractTotalCents: totals.totalCents },
      ip: t.ip,
    });
    return { id: project.id, number };
  });
}

export async function createStandaloneProject(
  db: Db,
  t: TenantContext,
  input: {
    customerId: string;
    name: string;
    contractTotalCents: number;
    siteAddress: string | null;
    siteCity: string | null;
    siteState: string | null;
    startDate: string | null;
    expectedEndDate: string | null;
    notes: string | null;
  },
) {
  return db.$transaction(async (tx) => {
    const customer = await tx.customer.findFirst({ where: { id: input.customerId, tenantId: t.tenantId, deletedAt: null } });
    if (!customer) throw notFound('Cliente não encontrado.');
    await assertProjectLimit(tx, t.tenantId);
    const number = await nextProjectNumber(tx, t.tenantId);
    const project = await tx.project.create({
      data: {
        ...input,
        tenantId: t.tenantId,
        number,
        contractTotalCents: BigInt(input.contractTotalCents),
        startDate: input.startDate ? dateIn(input.startDate) : null,
        expectedEndDate: input.expectedEndDate ? dateIn(input.expectedEndDate) : null,
        createdById: t.userId,
      },
    });
    await createProjectLocation(tx, t.tenantId, project.id, number, project.name);
    await audit(tx, { tenantId: t.tenantId, userId: t.userId, action: 'project.created', entityType: 'Project', entityId: project.id, ip: t.ip });
    return { id: project.id, number };
  });
}

/** Resumo financeiro calculado a partir dos lançamentos reais da obra. */
export async function loadProjectFinance(db: Db | Tx, tenantId: string, project: {
  id: string;
  contractTotalCents: bigint;
  plannedCostCents: bigint;
  plannedTaxCents: bigint;
  plannedContingencyCents: bigint;
}) {
  // Sequencial de propósito: pode rodar dentro de transação (uma conexão não aceita consultas paralelas).
  const receivables = await db.receivable.findMany({
    where: { tenantId, projectId: project.id },
    include: { payments: { where: { reversedAt: null }, select: { amountCents: true } } },
  });
  const expenses = await db.expense.findMany({ where: { tenantId, projectId: project.id } });
  return projectFinanceSummary(
    {
      contractTotalCents: centsOut(project.contractTotalCents),
      plannedCostCents: centsOut(project.plannedCostCents),
      plannedTaxCents: centsOut(project.plannedTaxCents),
      plannedContingencyCents: centsOut(project.plannedContingencyCents),
      receivables: receivables.map((r) => ({
        amountCents: centsOut(r.amountCents),
        paidCents: r.payments.reduce((a, p) => a + centsOut(p.amountCents), 0),
        canceled: !!r.canceledAt,
        dueDate: dateOut(r.dueDate),
      })),
      expenses: expenses.map((e) => ({
        amountCents: centsOut(e.amountCents),
        status: e.status,
        category: e.category,
        dueDate: e.dueDate ? dateOut(e.dueDate) : null,
      })),
    },
    todayISO(),
  );
}

export function stageToDTO(
  s: { id: string; position: number; name: string; unit: StageDTO['unit']; plannedQuantity: Prisma.Decimal; measuredQuantity: Prisma.Decimal; status: StageDTO['status']; unitPriceCents: bigint },
  showMoney: boolean,
): StageDTO {
  const planned = decOut(s.plannedQuantity);
  const measured = decOut(s.measuredQuantity);
  const pct = dec(planned).greaterThan(0) ? decToString(dec(measured).times(100).dividedBy(planned), 2) : '0';
  return {
    id: s.id,
    position: s.position,
    name: s.name,
    unit: s.unit,
    plannedQuantity: planned,
    measuredQuantity: measured,
    progressPercent: pct,
    status: s.status,
    unitPriceCents: showMoney ? centsOut(s.unitPriceCents) : null,
  };
}

const normUnit = (u: string | null | undefined) =>
  (u ?? '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/s$/, '');

/**
 * Quantidade prevista na unidade do material do estoque. Só compara unidades iguais
 * (ex.: kg × kg, ou saco × "saco" da embalagem). Sem fator conhecido => null (nunca converte por suposição).
 */
export function plannedInStockUnit(
  m: { unit: string; plannedQuantity: Prisma.Decimal; plannedPackages: number | null; packageLabel: string | null },
  stockUnit: string | null,
): string | null {
  if (!stockUnit) return null;
  if (normUnit(stockUnit) === normUnit(m.unit)) return decOut(m.plannedQuantity);
  if (m.plannedPackages !== null && m.packageLabel && normUnit(stockUnit) === normUnit(m.packageLabel)) {
    return String(m.plannedPackages);
  }
  return null;
}

export async function getProjectDetail(db: Db, t: TenantContext, id: string): Promise<ProjectDetailDTO> {
  const p = await db.project.findFirst({
    where: { id, tenantId: t.tenantId },
    include: {
      customer: { select: { id: true, name: true } },
      quote: { select: { id: true, number: true } },
      stages: { orderBy: { position: 'asc' } },
      materials: { orderBy: { createdAt: 'asc' }, include: { material: { select: { unit: true } } } },
      locations: { select: { id: true } },
    },
  });
  if (!p) throw notFound('Obra não encontrada.');
  const showMoney = canSeeMoney(t);
  const locationId = p.locations[0]?.id ?? null;

  // Recebido/usado na obra (estoque do local da obra), por material vinculado.
  const materialIds = p.materials.map((m) => m.materialId).filter((x): x is string => !!x);
  const movements = locationId && materialIds.length
    ? await db.stockMovement.findMany({
        where: { tenantId: t.tenantId, materialId: { in: materialIds }, OR: [{ toLocationId: locationId }, { fromLocationId: locationId }] },
        select: { materialId: true, type: true, quantity: true, toLocationId: true },
      })
    : [];
  const received = new Map<string, ReturnType<typeof dec>>();
  const used = new Map<string, ReturnType<typeof dec>>();
  for (const mv of movements) {
    if (mv.toLocationId === locationId) {
      received.set(mv.materialId, (received.get(mv.materialId) ?? dec(0)).plus(decOut(mv.quantity)));
    } else if (mv.type === 'OUT' || mv.type === 'LOSS') {
      used.set(mv.materialId, (used.get(mv.materialId) ?? dec(0)).plus(decOut(mv.quantity)));
    }
  }

  const finance = showMoney ? await loadProjectFinance(db, t.tenantId, p) : null;
  const alerts: ProjectAlertDTO[] = [];
  const late = isLate(p);
  if (late) alerts.push({ code: 'LATE', message: `Prazo previsto (${dateOut(p.expectedEndDate!).split('-').reverse().join('/')}) já passou.` });
  if (finance?.budgetOverrun) {
    alerts.push({ code: 'BUDGET_OVERRUN', message: `Custos passaram do previsto em ${formatBRL(finance.costVarianceCents)}.` });
  }
  if (finance && finance.overdueReceivableCents > 0) {
    alerts.push({ code: 'OVERDUE_RECEIVABLE', message: `${formatBRL(finance.overdueReceivableCents)} a receber em atraso.` });
  }
  if (finance && finance.overduePayableCents > 0) {
    alerts.push({ code: 'OVERDUE_PAYABLE', message: `${formatBRL(finance.overduePayableCents)} a pagar em atraso.` });
  }
  if (finance && finance.unscheduledCents > 0 && p.status !== 'CANCELED') {
    alerts.push({
      code: 'UNSCHEDULED_CONTRACT',
      message: `${formatBRL(finance.unscheduledCents)} do contrato ainda sem cobrança lançada.`,
    });
  }

  return {
    ...toProjectSummary({ ...p, stages: p.stages }, t),
    siteAddress: p.siteAddress,
    siteCity: p.siteCity,
    siteState: p.siteState,
    notes: p.notes,
    completedAt: p.completedAt?.toISOString() ?? null,
    stages: p.stages.map((s) => stageToDTO(s, showMoney)),
    materials: p.materials.map((m) => {
      const stockUnit = m.material?.unit ?? null;
      const planned = plannedInStockUnit(m, stockUnit);
      return {
        id: m.id,
        description: m.description,
        unit: m.unit,
        supply: m.supply,
        plannedQuantity: decOut(m.plannedQuantity),
        plannedPackages: m.plannedPackages,
        packageLabel: m.packageLabel,
        materialId: m.materialId,
        stockUnit,
        plannedInStockUnit: planned,
        unitMismatch: !!m.materialId && planned === null,
        receivedQuantity: m.materialId ? decToString(received.get(m.materialId) ?? dec(0)) : null,
        usedQuantity: m.materialId ? decToString(used.get(m.materialId) ?? dec(0)) : null,
      };
    }),
    finance,
    alerts,
    stockLocationId: locationId,
  };
}
