import type { AiCandidate, AiQuoteDraft } from '@reformar/shared';
import { emptyQuoteForm, newCost, newItem, newMaterial, type QuoteForm } from '../quotes/quote-form';

export const AI_DRAFT_KEY = 'reformar:ia-rascunho';

/**
 * Converte o rascunho proposto pelo assistente em formulário do editor.
 * Campos que o assistente não sabia ficam vazios para o usuário completar.
 * "Quem compra?" desconhecido vira "Cliente compra" (não altera valores) e o editor mostra para revisar.
 */
export function aiDraftToForm(d: AiQuoteDraft, customer: AiCandidate | null): QuoteForm {
  const form = emptyQuoteForm({});
  form.customerId = customer?.id ?? null;
  form.customerName = customer?.label ?? null;
  form.title = d.title ?? '';
  form.description = d.description;
  form.paymentTerms = d.paymentTerms;
  form.items = d.items.map((i) =>
    newItem({ description: i.description, unit: i.unit, quantity: i.quantity, unitPriceCents: i.unitPriceCents, notes: i.notes }),
  );
  form.materials = d.materials.map((m) =>
    newMaterial({
      description: m.description,
      unit: m.unit,
      supply: m.supply ?? 'CLIENT',
      source: m.itemIndex !== null ? 'ITEM' : 'MANUAL',
      itemKey: m.itemIndex !== null ? (form.items[m.itemIndex]?.key ?? null) : null,
      coefficient: '1',
      baseQuantity: m.baseQuantity,
      unitPriceCents: m.unitPriceCents,
    }),
  );
  form.costs = d.costs.map((c) =>
    newCost(c.category, { description: c.description, quantity: c.quantity, unit: c.unit, unitCostCents: c.unitCostCents }),
  );
  return form;
}
