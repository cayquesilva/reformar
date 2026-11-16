import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  dec,
  decToString,
  locationSchema,
  materialSchema,
  MOVEMENT_NEEDS_FROM,
  MOVEMENT_NEEDS_TO,
  purchaseSchema,
  stockMovementSchema,
  type MaterialDTO,
  type StockBalanceDTO,
  type StockLocationDTO,
  type StockMovementDTO,
} from '@reformar/shared';
import type { AppContext } from '../../context.js';
import { Prisma, type Db } from '../../db.js';
import { audit } from '../../lib/audit.js';
import { centsOut, dateIn, dateOut, decOut } from '../../lib/convert.js';
import { badRequest, conflict, forbidden, notFound } from '../../lib/errors.js';
import { withIdempotency } from '../../lib/idempotency.js';
import { userNames } from '../../lib/users.js';
import { requireTenant } from '../../plugins/auth.js';

type Tx = Prisma.TransactionClient;
type D = ReturnType<typeof dec>;

/** Saldos por (material, local) = entradas no local − saídas do local. */
export async function computeBalances(db: Db | Tx, tenantId: string, filter: { materialId?: string; locationId?: string } = {}) {
  // Sequencial: pode rodar dentro de transação.
  const ins = await db.stockMovement.groupBy({
      by: ['materialId', 'toLocationId'],
      where: { tenantId, toLocationId: filter.locationId ?? { not: null }, ...(filter.materialId ? { materialId: filter.materialId } : {}) },
      _sum: { quantity: true },
    });
  const outs = await db.stockMovement.groupBy({
      by: ['materialId', 'fromLocationId'],
      where: { tenantId, fromLocationId: filter.locationId ?? { not: null }, ...(filter.materialId ? { materialId: filter.materialId } : {}) },
      _sum: { quantity: true },
    });
  const map = new Map<string, { materialId: string; locationId: string; qty: D }>();
  const key = (m: string, l: string) => `${m}|${l}`;
  for (const r of ins) {
    if (!r.toLocationId) continue;
    map.set(key(r.materialId, r.toLocationId), { materialId: r.materialId, locationId: r.toLocationId, qty: dec(decOut(r._sum.quantity ?? new Prisma.Decimal(0))) });
  }
  for (const r of outs) {
    if (!r.fromLocationId) continue;
    const k = key(r.materialId, r.fromLocationId);
    const cur = map.get(k) ?? { materialId: r.materialId, locationId: r.fromLocationId, qty: dec(0) };
    cur.qty = cur.qty.minus(decOut(r._sum.quantity ?? new Prisma.Decimal(0)));
    map.set(k, cur);
  }
  return [...map.values()];
}

async function serializable<T>(db: Db, fn: (tx: Tx) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await db.$transaction(fn, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (e) {
      if (attempt < 2 && e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2034') continue;
      throw e;
    }
  }
}

async function assertLocation(db: Db | Tx, tenantId: string, id: string) {
  const l = await db.stockLocation.findFirst({ where: { id, tenantId } });
  if (!l) throw notFound('Local de estoque não encontrado.');
  return l;
}

export async function stockRoutes(app: FastifyInstance, ctx: AppContext) {
  const { db } = ctx;

  // ---------- Materiais ----------
  app.get('/api/materials', async (request): Promise<MaterialDTO[]> => {
    const t = requireTenant(request, 'stock:read');
    const rows = await db.material.findMany({ where: { tenantId: t.tenantId }, orderBy: { name: 'asc' } });
    const balances = await computeBalances(db, t.tenantId);
    const total = new Map<string, D>();
    for (const b of balances) total.set(b.materialId, (total.get(b.materialId) ?? dec(0)).plus(b.qty));
    const money = t.permissions.includes('finance:read');
    return rows.map((m) => {
      const qty = total.get(m.id) ?? dec(0);
      const min = m.minStock ? decOut(m.minStock) : null;
      return {
        id: m.id,
        name: m.name,
        unit: m.unit,
        packageLabel: m.packageLabel,
        packageSize: m.packageSize ? decOut(m.packageSize) : null,
        minStock: min,
        lastCostCents: money && m.lastCostCents !== null ? centsOut(m.lastCostCents) : null,
        active: m.active,
        totalStock: decToString(qty),
        lowStock: min !== null && qty.lessThan(min),
      };
    });
  });

  app.post('/api/materials', async (request, reply) => {
    const t = requireTenant(request, 'stock:write');
    const input = materialSchema.parse(request.body);
    try {
      const m = await db.material.create({ data: { ...input, tenantId: t.tenantId } });
      await audit(db, { tenantId: t.tenantId, userId: t.userId, action: 'material.created', entityType: 'Material', entityId: m.id, ip: t.ip });
      return reply.status(201).send({ id: m.id });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw conflict('Já existe um material com esse nome.');
      throw e;
    }
  });

  app.put('/api/materials/:id', async (request) => {
    const t = requireTenant(request, 'stock:write');
    const { id } = z.object({ id: z.uuid() }).parse(request.params);
    const input = materialSchema.parse(request.body);
    const r = await db.material.updateMany({ where: { id, tenantId: t.tenantId }, data: input });
    if (r.count === 0) throw notFound('Material não encontrado.');
    return { ok: true };
  });

  // ---------- Locais ----------
  app.get('/api/stock/locations', async (request): Promise<StockLocationDTO[]> => {
    const t = requireTenant(request, 'stock:read');
    const rows = await db.stockLocation.findMany({
      where: { tenantId: t.tenantId },
      include: { project: { select: { id: true, number: true, name: true } } },
      orderBy: [{ projectId: { sort: 'asc', nulls: 'first' } }, { name: 'asc' }],
    });
    return rows.map((l) => ({ id: l.id, name: l.name, project: l.project, active: l.active }));
  });

  app.post('/api/stock/locations', async (request, reply) => {
    const t = requireTenant(request, 'stock:write');
    const { name } = locationSchema.parse(request.body);
    try {
      const l = await db.stockLocation.create({ data: { tenantId: t.tenantId, name } });
      return reply.status(201).send({ id: l.id });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw conflict('Já existe um local com esse nome.');
      throw e;
    }
  });

  // ---------- Saldos e movimentos ----------
  app.get('/api/stock/balances', async (request): Promise<StockBalanceDTO[]> => {
    const t = requireTenant(request, 'stock:read');
    const q = z.object({ locationId: z.uuid().optional(), materialId: z.uuid().optional() }).parse(request.query);
    const balances = (await computeBalances(db, t.tenantId, q)).filter((b) => !b.qty.isZero());
    const [materials, locations] = await Promise.all([
      db.material.findMany({ where: { tenantId: t.tenantId, id: { in: balances.map((b) => b.materialId) } } }),
      db.stockLocation.findMany({ where: { tenantId: t.tenantId, id: { in: balances.map((b) => b.locationId) } } }),
    ]);
    return balances
      .map((b) => {
        const m = materials.find((x) => x.id === b.materialId)!;
        const l = locations.find((x) => x.id === b.locationId)!;
        return { materialId: m.id, materialName: m.name, unit: m.unit, locationId: l.id, locationName: l.name, quantity: decToString(b.qty) };
      })
      .sort((a, b) => a.materialName.localeCompare(b.materialName) || a.locationName.localeCompare(b.locationName));
  });

  app.get('/api/stock/movements', async (request): Promise<StockMovementDTO[]> => {
    const t = requireTenant(request, 'stock:read');
    const q = z.object({ materialId: z.uuid().optional(), locationId: z.uuid().optional(), projectId: z.uuid().optional() }).parse(request.query);
    const rows = await db.stockMovement.findMany({
      where: {
        tenantId: t.tenantId,
        ...(q.materialId ? { materialId: q.materialId } : {}),
        ...(q.projectId ? { projectId: q.projectId } : {}),
        ...(q.locationId ? { OR: [{ toLocationId: q.locationId }, { fromLocationId: q.locationId }] } : {}),
      },
      include: {
        material: { select: { id: true, name: true, unit: true } },
        fromLocation: { select: { id: true, name: true } },
        toLocation: { select: { id: true, name: true } },
      },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      take: 300,
    });
    const nameOf = await userNames(db, t.tenantId, rows.map((r) => r.createdById));
    return rows.map((r) => ({
      id: r.id,
      type: r.type,
      material: r.material,
      quantity: decOut(r.quantity),
      from: r.fromLocation,
      to: r.toLocation,
      projectId: r.projectId,
      expenseId: r.expenseId,
      date: dateOut(r.date),
      notes: r.notes,
      createdByName: nameOf(r.createdById),
      createdAt: r.createdAt.toISOString(),
    }));
  });

  /** Uso na obra, transferência, perda, devolução e ajustes. Nunca deixa saldo negativo. Não gera custo. */
  app.post('/api/stock/movements', async (request, reply) => {
    const t = requireTenant(request, 'stock:write');
    const input = stockMovementSchema.parse(request.body);
    const result = await withIdempotency(db, request, t, 'stock.movement', async () => {
      const id = await serializable(db, async (tx) => {
        const material = await tx.material.findFirst({ where: { id: input.materialId, tenantId: t.tenantId } });
        if (!material) throw notFound('Material não encontrado.');
        const from = MOVEMENT_NEEDS_FROM.includes(input.type) ? await assertLocation(tx, t.tenantId, input.fromLocationId!) : null;
        const to = MOVEMENT_NEEDS_TO.includes(input.type) ? await assertLocation(tx, t.tenantId, input.toLocationId!) : null;
        if (from) {
          const [bal] = await computeBalances(tx, t.tenantId, { materialId: material.id, locationId: from.id });
          const available = bal?.qty ?? dec(0);
          if (available.lessThan(input.quantity)) {
            throw badRequest(`Saldo insuficiente em "${from.name}": há ${decToString(available)} ${material.unit}.`, {
              quantity: `Disponível: ${decToString(available)}`,
            });
          }
        }
        let projectId = input.projectId;
        if (projectId) {
          const p = await tx.project.findFirst({ where: { id: projectId, tenantId: t.tenantId } });
          if (!p) throw notFound('Obra não encontrada.');
        } else if (input.type === 'OUT') {
          projectId = from?.projectId ?? null;
        }
        const m = await tx.stockMovement.create({
          data: {
            tenantId: t.tenantId,
            materialId: material.id,
            type: input.type,
            quantity: input.quantity,
            fromLocationId: from?.id ?? null,
            toLocationId: to?.id ?? null,
            projectId,
            date: dateIn(input.date),
            notes: input.notes,
            createdById: t.userId,
          },
        });
        await audit(tx, {
          tenantId: t.tenantId,
          userId: t.userId,
          action: 'stock.movement',
          entityType: 'Material',
          entityId: material.id,
          data: { type: input.type, quantity: input.quantity, from: from?.name ?? null, to: to?.name ?? null },
          ip: t.ip,
        });
        return m.id;
      });
      return { status: 201, body: { id } };
    });
    return reply.status(result.status).send(result.body);
  });

  /**
   * Compra de material: cria UM lançamento financeiro (despesa MATERIAL) e UMA entrada física,
   * vinculados. O custo é contado só pela despesa; o movimento guarda quantidade e custo unitário informativo.
   */
  app.post('/api/stock/purchases', async (request, reply) => {
    const t = requireTenant(request, 'stock:write');
    if (!t.permissions.includes('finance:write')) throw forbidden('Registrar compra exige permissão financeira.');
    const input = purchaseSchema.parse(request.body);
    const result = await withIdempotency(db, request, t, 'stock.purchase', async () => {
      const body = await db.$transaction(async (tx) => {
        const material = await tx.material.findFirst({ where: { id: input.materialId, tenantId: t.tenantId } });
        if (!material) throw notFound('Material não encontrado.');
        const location = await assertLocation(tx, t.tenantId, input.toLocationId);
        const projectId = input.projectId ?? location.projectId;
        if (projectId) {
          const p = await tx.project.findFirst({ where: { id: projectId, tenantId: t.tenantId } });
          if (!p) throw notFound('Obra não encontrada.');
        }
        const expense = await tx.expense.create({
          data: {
            tenantId: t.tenantId,
            projectId,
            category: 'MATERIAL',
            description: `Compra: ${material.name}`,
            quantity: input.quantity,
            unit: material.unit,
            amountCents: BigInt(input.amountCents),
            date: dateIn(input.date),
            dueDate: input.dueDate ? dateIn(input.dueDate) : null,
            status: input.status,
            paidOn: input.status === 'PAID' && input.paidOn ? dateIn(input.paidOn) : null,
            paymentMethod: input.status === 'PAID' ? input.paymentMethod : null,
            supplier: input.supplier,
            notes: input.notes,
            createdById: t.userId,
          },
        });
        const unitCost = BigInt(dec(input.amountCents).dividedBy(input.quantity).toDecimalPlaces(0).toFixed());
        await tx.stockMovement.create({
          data: {
            tenantId: t.tenantId,
            materialId: material.id,
            type: 'IN',
            quantity: input.quantity,
            toLocationId: location.id,
            projectId,
            expenseId: expense.id,
            unitCostCents: unitCost,
            date: dateIn(input.date),
            notes: input.notes,
            createdById: t.userId,
          },
        });
        await tx.material.update({ where: { id: material.id }, data: { lastCostCents: unitCost } });
        await audit(tx, {
          tenantId: t.tenantId,
          userId: t.userId,
          action: 'stock.purchase',
          entityType: 'Expense',
          entityId: expense.id,
          data: { material: material.name, quantity: input.quantity, amountCents: input.amountCents },
          ip: t.ip,
        });
        return { expenseId: expense.id };
      });
      return { status: 201, body };
    });
    return reply.status(result.status).send(result.body);
  });
}
