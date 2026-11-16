import { calculateQuote, quoteContentSchema } from '@reformar/shared';
import { describe, expect, it } from 'vitest';
import {
  contentToForm,
  emptyQuoteForm,
  formToContent,
  formToPricing,
  newCost,
  newItem,
  newMaterial,
  stepOfPath,
  validateForm,
} from './quote-form';

function sampleForm() {
  const form = emptyQuoteForm({ validityDays: 15 });
  form.customerId = '6f1d3c1e-8c1a-4f7e-9a51-2c6f1b7c0d11';
  form.customerName = 'João';
  form.title = 'Piso da sala';
  const item = newItem({ description: 'Assentamento', unit: 'M2', quantity: '32', unitPriceCents: 5500 });
  const item2 = newItem({ description: 'Rodapé', unit: 'M', quantity: '20', unitPriceCents: 1500 });
  form.items = [item, item2];
  form.materials = [
    newMaterial({ description: 'Porcelanato', source: 'ITEM', itemKey: item.key, lossPercent: '10', packageSize: '2.5', packageLabel: 'caixa' }),
    newMaterial({ description: 'Areia', unit: 'm³', supply: 'COMPANY_BILLED', source: 'MANUAL', baseQuantity: '1', unitPriceCents: 15000 }),
  ];
  form.costs = [newCost('TEAM', { description: 'Ajudante', quantity: '6', unitCostCents: 12000 })];
  return { form, item, item2 };
}

describe('formulário de orçamento', () => {
  it('converte para o contrato da API e passa na validação compartilhada', () => {
    const { form } = sampleForm();
    const content = formToContent(form);
    const parsed = quoteContentSchema.safeParse(content);
    expect(parsed.success).toBe(true);
    expect(content.materials[0]!.itemIndex).toBe(0);
    expect(content.materials[0]!.baseQuantity).toBeNull();
    expect(content.materials[1]!.itemIndex).toBeNull();
    expect(content.materials[1]!.baseQuantity).toBe('1');
    expect(validateForm(form)).toEqual({});
  });

  it('prévia usa o mesmo cálculo do servidor', () => {
    const { form } = sampleForm();
    const r = calculateQuote(formToPricing(form));
    expect(r.items[0]!.totalCents).toBe(176000);
    expect(r.materials[0]!.packages).toBe(15);
    expect(r.totals.totalCents).toBe(176000 + 30000 + 15000);
  });

  it('material segue o serviço certo mesmo depois de reordenar serviços', () => {
    const { form, item, item2 } = sampleForm();
    form.items = [item2, item];
    expect(formToContent(form).materials[0]!.itemIndex).toBe(1);
  });

  it('ida e volta (conteúdo salvo -> formulário -> conteúdo) preserva os dados', () => {
    const { form } = sampleForm();
    const content = quoteContentSchema.parse(formToContent(form));
    const back = quoteContentSchema.parse(formToContent(contentToForm(content, 'João')));
    expect(back).toEqual(content);
  });

  it('campos vazios geram erros amigáveis no passo correto', () => {
    const form = emptyQuoteForm({});
    form.items = [newItem()];
    const errors = validateForm(form);
    expect(errors.customerId).toBeTruthy();
    expect(errors['items.0.unitPriceCents']).toBe('Informe o preço.');
    expect(stepOfPath('items.0.quantity')).toBe(1);
    expect(stepOfPath('materials.2.lossPercent')).toBe(2);
    expect(stepOfPath('validUntil')).toBe(4);
  });
});
