import { describe, expect, it } from 'vitest';
import { calculateQuote, type QuotePricingInput } from '../src/quote-calc.js';
import { quoteContentSchema } from '../src/schemas.js';
import { displayStatus, addDaysISO, todayISO } from '../src/quote-status.js';

const base = (over: Partial<QuotePricingInput> = {}): QuotePricingInput => ({
  items: [],
  materials: [],
  costs: [],
  discountType: 'NONE',
  taxPercent: '0',
  contingencyPercent: '0',
  ...over,
});

const porcelanato = { description: 'Assentamento de porcelanato', unit: 'M2' as const, quantity: '32', unitPriceCents: 5500 };

describe('exemplo do enunciado: 32 m² a R$ 55/m² com 10% de perda', () => {
  it('mão de obra = R$ 1.760,00', () => {
    const r = calculateQuote(base({ items: [porcelanato] }));
    expect(r.items[0]!.totalCents).toBe(176000);
    expect(r.totals.laborCents).toBe(176000);
    expect(r.totals.totalCents).toBe(176000);
    expect(r.items[0]!.explanation).toBe('32 m² × R$ 55,00 = R$ 1.760,00');
  });

  it('cerâmica estimada = 35,2 m² e caixas dependem da cobertura informada', () => {
    const r = calculateQuote(
      base({
        items: [porcelanato],
        materials: [
          {
            description: 'Porcelanato 60x60',
            unit: 'm²',
            supply: 'CLIENT',
            itemIndex: 0,
            coefficient: '1',
            lossPercent: '10',
            packageSize: '2.5',
            packageLabel: 'caixa',
          },
        ],
      }),
    );
    const m = r.materials[0]!;
    expect(m.baseQuantity).toBe('32');
    expect(m.calculatedQuantity).toBe('35.2');
    expect(m.packages).toBe(15); // 35,2 / 2,5 = 14,08 -> 15
    expect(m.purchaseQuantity).toBe('37.5');
    expect(m.totalCents).toBe(0); // cliente compra
    expect(r.totals.totalCents).toBe(176000);
    expect(m.steps.join('\n')).toContain('Perda de 10%');
    expect(m.steps.join('\n')).toContain('15 caixa(s)');
  });

  it('divisão exata não arredonda para cima à toa', () => {
    const r = calculateQuote(
      base({
        items: [{ ...porcelanato, quantity: '20' }],
        materials: [
          { description: 'Piso', unit: 'm²', supply: 'CLIENT', itemIndex: 0, lossPercent: '10', packageSize: '2.2' },
        ],
      }),
    );
    expect(r.materials[0]!.calculatedQuantity).toBe('22');
    expect(r.materials[0]!.packages).toBe(10);
  });
});

describe('fornecimento de material', () => {
  const argamassa = {
    description: 'Argamassa AC-III',
    unit: 'kg',
    itemIndex: 0,
    coefficient: '5', // informado pelo usuário conforme fabricante (hipótese do teste)
    lossPercent: '0',
    packageSize: '20',
    packageLabel: 'saco',
    unitPriceCents: 4590,
  };

  it('COMPANY_BILLED: entra no preço do cliente e no custo', () => {
    const r = calculateQuote(base({ items: [porcelanato], materials: [{ ...argamassa, supply: 'COMPANY_BILLED' }] }));
    // 32 × 5 = 160 kg / 20 = 8 sacos × 45,90 = 367,20
    expect(r.materials[0]!.packages).toBe(8);
    expect(r.materials[0]!.totalCents).toBe(36720);
    expect(r.totals.materialsBilledCents).toBe(36720);
    expect(r.totals.subtotalCents).toBe(176000 + 36720);
    expect(r.totals.materialsCostCents).toBe(36720);
    expect(r.totals.estimatedProfitCents).toBe(176000);
  });

  it('COMPANY_INCLUDED: só custo interno, reduz o lucro', () => {
    const r = calculateQuote(base({ items: [porcelanato], materials: [{ ...argamassa, supply: 'COMPANY_INCLUDED' }] }));
    expect(r.totals.totalCents).toBe(176000);
    expect(r.totals.materialsCostCents).toBe(36720);
    expect(r.totals.estimatedProfitCents).toBe(176000 - 36720);
  });

  it('sem embalagem: quantidade × preço unitário', () => {
    const r = calculateQuote(
      base({
        items: [porcelanato],
        materials: [
          { description: 'Areia', unit: 'm³', supply: 'COMPANY_BILLED', baseQuantity: '1.5', lossPercent: '5', unitPriceCents: 15000 },
        ],
      }),
    );
    // 1,5 × 1,05 = 1,575 m³ × 150,00 = 236,25
    expect(r.materials[0]!.calculatedQuantity).toBe('1.575');
    expect(r.materials[0]!.packages).toBeNull();
    expect(r.materials[0]!.totalCents).toBe(23625);
  });

  it('avisa quando falta preço de material comprado pela empresa', () => {
    const r = calculateQuote(
      base({
        items: [porcelanato],
        materials: [{ description: 'Rejunte', unit: 'kg', supply: 'COMPANY_BILLED', baseQuantity: '5', lossPercent: '0' }],
      }),
    );
    expect(r.warnings.map((w) => w.code)).toContain('MATERIAL_WITHOUT_PRICE');
  });
});

describe('custos, desconto, imposto e lucro', () => {
  it('jornada completa com equipe, alimentação, desconto, reserva e imposto', () => {
    const r = calculateQuote(
      base({
        items: [porcelanato],
        costs: [
          { category: 'TEAM', description: 'Ajudante', quantity: '6', unit: 'diária', unitCostCents: 12000, chargeToClient: false },
          { category: 'FOOD', description: 'Almoço', quantity: '9', unit: 'refeição', unitCostCents: 2500, chargeToClient: false },
          { category: 'TRANSPORT', description: 'Deslocamento', quantity: '1', unitCostCents: 8000, chargeToClient: true },
        ],
        discountType: 'PERCENT',
        discountPercent: '5',
        contingencyPercent: '10',
        taxPercent: '6',
      }),
    );
    const t = r.totals;
    expect(t.laborCents).toBe(176000);
    expect(t.costsBilledCents).toBe(8000);
    expect(t.subtotalCents).toBe(184000);
    expect(t.discountCents).toBe(9200);
    expect(t.totalCents).toBe(174800);
    expect(t.costsByCategory.TEAM).toBe(72000);
    expect(t.costsByCategory.FOOD).toBe(22500);
    expect(t.otherCostsCents).toBe(102500);
    expect(t.internalCostsCents).toBe(102500);
    expect(t.contingencyCents).toBe(10250);
    expect(t.taxCents).toBe(10488);
    expect(t.estimatedProfitCents).toBe(174800 - 10488 - 102500 - 10250);
    expect(t.marginPercent).toBe('29.5');
  });

  it('desconto em valor maior que o subtotal é limitado e avisado', () => {
    const r = calculateQuote(base({ items: [porcelanato], discountType: 'AMOUNT', discountCents: 999999 }));
    expect(r.totals.discountCents).toBe(176000);
    expect(r.totals.totalCents).toBe(0);
    expect(r.warnings.map((w) => w.code)).toContain('DISCOUNT_EXCEEDS_SUBTOTAL');
  });

  it('avisa prejuízo', () => {
    const r = calculateQuote(
      base({
        items: [porcelanato],
        costs: [{ category: 'THIRD_PARTY', description: 'Terceiro', quantity: '1', unitCostCents: 200000, chargeToClient: false }],
      }),
    );
    expect(r.totals.estimatedProfitCents).toBe(-24000);
    expect(r.warnings.map((w) => w.code)).toContain('NEGATIVE_PROFIT');
  });

  it('orçamento vazio avisa falta de serviço', () => {
    const r = calculateQuote(base());
    expect(r.totals.totalCents).toBe(0);
    expect(r.totals.marginPercent).toBeNull();
    expect(r.warnings.map((w) => w.code)).toContain('NO_ITEMS');
  });

  it('soma de muitas linhas fracionadas é exata (sem float)', () => {
    const items = Array.from({ length: 100 }, () => ({ ...porcelanato, quantity: '0.1', unitPriceCents: 333 }));
    const r = calculateQuote(base({ items }));
    // cada linha: 0,1 × 333 = 33,3 -> 33 centavos; 100 linhas = 3300
    expect(r.totals.laborCents).toBe(3300);
  });
});

describe('validação do conteúdo do orçamento', () => {
  const valid = {
    customerId: '6f1d3c1e-8c1a-4f7e-9a51-2c6f1b7c0d11',
    title: 'Piso da sala',
    validUntil: '2026-12-31',
    items: [{ ...porcelanato }],
    materials: [],
    costs: [],
  };

  it('aceita conteúdo válido e aplica padrões', () => {
    const r = quoteContentSchema.parse(valid);
    expect(r.discountType).toBe('NONE');
    expect(r.taxPercent).toBe('0');
  });

  it('rejeita quantidade com vírgula/float e preço não inteiro', () => {
    expect(quoteContentSchema.safeParse({ ...valid, items: [{ ...porcelanato, quantity: '32,5' }] }).success).toBe(false);
    expect(quoteContentSchema.safeParse({ ...valid, items: [{ ...porcelanato, unitPriceCents: 55.5 }] }).success).toBe(false);
    expect(quoteContentSchema.safeParse({ ...valid, items: [{ ...porcelanato, quantity: '0' }] }).success).toBe(false);
  });

  it('rejeita material ligado a serviço inexistente', () => {
    const r = quoteContentSchema.safeParse({
      ...valid,
      materials: [{ description: 'Piso', unit: 'm²', supply: 'CLIENT', itemIndex: 3, lossPercent: '10' }],
    });
    expect(r.success).toBe(false);
  });

  it('rejeita perda acima de 100%', () => {
    const r = quoteContentSchema.safeParse({
      ...valid,
      materials: [{ description: 'Piso', unit: 'm²', supply: 'CLIENT', baseQuantity: '10', lossPercent: '150' }],
    });
    expect(r.success).toBe(false);
  });
});

describe('status e datas', () => {
  it('orçamento enviado e vencido aparece como Vencido', () => {
    expect(displayStatus('SENT', '2026-01-01', '2026-01-02')).toBe('EXPIRED');
    expect(displayStatus('SENT', '2026-01-02', '2026-01-02')).toBe('SENT');
    expect(displayStatus('APPROVED', '2026-01-01', '2026-01-02')).toBe('APPROVED');
  });

  it('soma dias e calcula hoje em São Paulo', () => {
    expect(addDaysISO('2026-12-25', 15)).toBe('2027-01-09');
    // 02:00 UTC de 06/11 ainda é 05/11 em São Paulo (UTC-3)
    expect(todayISO(new Date('2026-11-06T02:00:00Z'))).toBe('2026-11-05');
  });
});
