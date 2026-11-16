import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { aiDraftToForm } from '../pages/ai/ai-draft';
import { formToContent } from '../pages/quotes/quote-form';
import { quoteContentSchema } from '@reformar/shared';

describe('fila offline', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('reenvia com a MESMA chave de idempotência e remove só após sucesso', async () => {
    const keys: string[] = [];
    let fail = true;
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      keys.push((init.headers as Record<string, string>)['Idempotency-Key']!);
      if (fail) throw new TypeError('offline');
      return new Response(JSON.stringify({ ids: ['x'] }), { status: 201, headers: { 'content-type': 'application/json' } });
    });
    const { enqueue, flushOutbox } = await import('./outbox');
    enqueue({ id: 'a', url: '/api/expenses', body: { amountCents: 100 }, idempotencyKey: 'chave-fixa-123', label: 'Almoço' });

    expect(await flushOutbox()).toBe(0); // rede caiu: item continua na fila
    expect(JSON.parse(localStorage.getItem('reformar:fila-offline')!)).toHaveLength(1);

    fail = false;
    expect(await flushOutbox()).toBe(1);
    expect(JSON.parse(localStorage.getItem('reformar:fila-offline')!)).toHaveLength(0);
    expect(keys).toEqual(['chave-fixa-123', 'chave-fixa-123']);
  });

  it('erro de validação fica visível e não bloqueia os próximos', async () => {
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string) as { ok: boolean };
      return body.ok
        ? new Response('{}', { status: 201, headers: { 'content-type': 'application/json' } })
        : new Response(JSON.stringify({ error: 'VALIDATION', message: 'Valor inválido' }), { status: 400, headers: { 'content-type': 'application/json' } });
    });
    const { enqueue, flushOutbox } = await import('./outbox');
    enqueue({ id: '1', url: '/api/expenses', body: { ok: false }, idempotencyKey: 'k1-aaaaaaaa', label: 'ruim' });
    enqueue({ id: '2', url: '/api/expenses', body: { ok: true }, idempotencyKey: 'k2-aaaaaaaa', label: 'bom' });
    expect(await flushOutbox()).toBe(1);
    const left = JSON.parse(localStorage.getItem('reformar:fila-offline')!);
    expect(left).toHaveLength(1);
    expect(left[0].lastError).toBe('Valor inválido');
  });
});

describe('rascunho do assistente -> editor', () => {
  it('mantém o que foi dito e deixa vazio o que falta (nada inventado)', () => {
    const form = aiDraftToForm(
      {
        customerName: 'João',
        customerCandidates: [],
        title: 'Porcelanato',
        description: null,
        items: [{ description: 'Assentamento', unit: 'M2', quantity: '32', unitPriceCents: 5500, notes: null }],
        materials: [{ description: 'Piso', unit: 'm²', supply: 'CLIENT', itemIndex: 0, baseQuantity: null, unitPriceCents: null }],
        costs: [{ category: 'TEAM', description: 'Ajudantes', quantity: '6', unit: 'diária', unitCostCents: null }],
        paymentTerms: null,
      },
      { id: '6f1d3c1e-8c1a-4f7e-9a51-2c6f1b7c0d11', label: 'João da Silva' },
    );
    expect(form.items[0]).toMatchObject({ quantity: '32', unitPriceCents: 5500 });
    expect(form.materials[0]!.itemKey).toBe(form.items[0]!.key);
    expect(form.costs[0]!.unitCostCents).toBeNull();
    const content = formToContent({ ...form, validUntil: '2026-12-01' });
    // sem o valor da diária, não passa na validação: o usuário precisa completar
    expect(quoteContentSchema.safeParse(content).success).toBe(false);
  });
});
