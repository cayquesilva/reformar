import {
  addDaysISO,
  quoteContentSchema,
  todayISO,
  type CostCategory,
  type DiscountType,
  type MaterialSupply,
  type QuoteContentInput,
  type QuoteContentRaw,
  type QuotePricingInput,
  type ServiceUnit,
} from '@reformar/shared';
import { t } from '../../lib/i18n';

export interface ItemForm {
  key: string;
  serviceId: string | null;
  description: string;
  unit: ServiceUnit;
  quantity: string | null;
  unitPriceCents: number | null;
  notes: string | null;
}

export interface MaterialForm {
  key: string;
  description: string;
  unit: string;
  supply: MaterialSupply;
  source: 'ITEM' | 'MANUAL';
  itemKey: string | null;
  coefficient: string | null;
  baseQuantity: string | null;
  lossPercent: string | null;
  packageSize: string | null;
  packageLabel: string | null;
  unitPriceCents: number | null;
  notes: string | null;
}

export interface CostForm {
  key: string;
  category: CostCategory;
  description: string;
  quantity: string | null;
  unit: string | null;
  unitCostCents: number | null;
  chargeToClient: boolean;
}

export interface QuoteForm {
  customerId: string | null;
  customerName: string | null;
  title: string;
  description: string | null;
  siteAddress: string | null;
  siteCity: string | null;
  siteState: string | null;
  validUntil: string;
  paymentTerms: string | null;
  exclusions: string | null;
  notes: string | null;
  discountType: DiscountType;
  discountPercent: string | null;
  discountCents: number | null;
  taxPercent: string | null;
  contingencyPercent: string | null;
  items: ItemForm[];
  materials: MaterialForm[];
  costs: CostForm[];
}

export function newKey(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function emptyQuoteForm(defaults: {
  validityDays?: number;
  paymentTerms?: string | null;
  exclusions?: string | null;
  notes?: string | null;
}): QuoteForm {
  return {
    customerId: null,
    customerName: null,
    title: '',
    description: null,
    siteAddress: null,
    siteCity: null,
    siteState: null,
    validUntil: addDaysISO(todayISO(), defaults.validityDays ?? 15),
    paymentTerms: defaults.paymentTerms ?? null,
    exclusions: defaults.exclusions ?? null,
    notes: defaults.notes ?? null,
    discountType: 'NONE',
    discountPercent: null,
    discountCents: null,
    taxPercent: null,
    contingencyPercent: null,
    items: [],
    materials: [],
    costs: [],
  };
}

export function newItem(over: Partial<ItemForm> = {}): ItemForm {
  return { key: newKey(), serviceId: null, description: '', unit: 'M2', quantity: null, unitPriceCents: null, notes: null, ...over };
}

export function newMaterial(over: Partial<MaterialForm> = {}): MaterialForm {
  return {
    key: newKey(),
    description: '',
    unit: 'm²',
    supply: 'CLIENT',
    source: 'MANUAL',
    itemKey: null,
    coefficient: '1',
    baseQuantity: null,
    lossPercent: null,
    packageSize: null,
    packageLabel: null,
    unitPriceCents: null,
    notes: null,
    ...over,
  };
}

export function newCost(category: CostCategory, over: Partial<CostForm> = {}): CostForm {
  return { key: newKey(), category, description: '', quantity: '1', unit: null, unitCostCents: null, chargeToClient: false, ...over };
}

const blank = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null);

function materialItemIndex(form: QuoteForm, m: MaterialForm): number | null {
  if (m.source !== 'ITEM' || !m.itemKey) return null;
  const i = form.items.findIndex((it) => it.key === m.itemKey);
  return i >= 0 ? i : null;
}

/** Formulário -> corpo enviado à API (validado também no servidor). */
export function formToContent(form: QuoteForm): QuoteContentRaw {
  return {
    customerId: form.customerId ?? '',
    title: form.title,
    description: blank(form.description),
    siteAddress: blank(form.siteAddress),
    siteCity: blank(form.siteCity),
    siteState: blank(form.siteState),
    validUntil: form.validUntil,
    paymentTerms: blank(form.paymentTerms),
    exclusions: blank(form.exclusions),
    notes: blank(form.notes),
    discountType: form.discountType,
    discountPercent: form.discountType === 'PERCENT' ? form.discountPercent : null,
    discountCents: form.discountType === 'AMOUNT' ? form.discountCents : null,
    taxPercent: form.taxPercent ?? '0',
    contingencyPercent: form.contingencyPercent ?? '0',
    items: form.items.map((i) => ({
      serviceId: i.serviceId,
      description: i.description,
      unit: i.unit,
      quantity: i.quantity ?? '',
      unitPriceCents: i.unitPriceCents as number,
      notes: blank(i.notes),
    })),
    materials: form.materials.map((m) => {
      const itemIndex = materialItemIndex(form, m);
      return {
        description: m.description,
        unit: m.unit,
        supply: m.supply,
        itemIndex,
        coefficient: itemIndex !== null ? (m.coefficient ?? '1') : null,
        baseQuantity: itemIndex === null ? m.baseQuantity : null,
        lossPercent: m.lossPercent ?? '0',
        packageSize: m.packageSize,
        packageLabel: blank(m.packageLabel),
        unitPriceCents: m.supply === 'CLIENT' ? null : m.unitPriceCents,
        notes: blank(m.notes),
      };
    }),
    costs: form.costs.map((c) => ({
      category: c.category,
      description: c.description,
      quantity: c.quantity ?? '',
      unit: blank(c.unit),
      unitCostCents: c.unitCostCents as number,
      chargeToClient: c.chargeToClient,
    })),
  };
}

/** Formulário -> dados para a prévia do cálculo (campos incompletos contam como zero). */
export function formToPricing(form: QuoteForm): QuotePricingInput {
  return {
    items: form.items.map((i) => ({
      description: i.description || 'Serviço',
      unit: i.unit,
      quantity: i.quantity ?? '0',
      unitPriceCents: i.unitPriceCents ?? 0,
    })),
    materials: form.materials.map((m) => {
      const itemIndex = materialItemIndex(form, m);
      return {
        description: m.description || 'Material',
        unit: m.unit || 'un',
        supply: m.supply,
        itemIndex,
        coefficient: m.coefficient ?? '1',
        baseQuantity: itemIndex === null ? (m.baseQuantity ?? '0') : null,
        lossPercent: m.lossPercent ?? '0',
        packageSize: m.packageSize,
        packageLabel: m.packageLabel,
        unitPriceCents: m.supply === 'CLIENT' ? null : m.unitPriceCents,
      };
    }),
    costs: form.costs.map((c) => ({
      category: c.category,
      description: c.description || 'Custo',
      quantity: c.quantity ?? '0',
      unit: c.unit,
      unitCostCents: c.unitCostCents ?? 0,
      chargeToClient: c.chargeToClient,
    })),
    discountType: form.discountType,
    discountPercent: form.discountPercent,
    discountCents: form.discountCents,
    taxPercent: form.taxPercent ?? '0',
    contingencyPercent: form.contingencyPercent ?? '0',
  };
}

/** Conteúdo salvo -> formulário editável. */
export function contentToForm(c: QuoteContentInput, customerName: string | null): QuoteForm {
  const items = c.items.map((i) => newItem({ ...i, quantity: i.quantity, unitPriceCents: i.unitPriceCents }));
  return {
    customerId: c.customerId,
    customerName,
    title: c.title,
    description: c.description,
    siteAddress: c.siteAddress,
    siteCity: c.siteCity,
    siteState: c.siteState,
    validUntil: c.validUntil,
    paymentTerms: c.paymentTerms,
    exclusions: c.exclusions,
    notes: c.notes,
    discountType: c.discountType,
    discountPercent: c.discountPercent,
    discountCents: c.discountCents,
    taxPercent: c.taxPercent === '0' ? null : c.taxPercent,
    contingencyPercent: c.contingencyPercent === '0' ? null : c.contingencyPercent,
    items,
    materials: c.materials.map((m) =>
      newMaterial({
        ...m,
        source: m.itemIndex !== null ? 'ITEM' : 'MANUAL',
        itemKey: m.itemIndex !== null ? (items[m.itemIndex]?.key ?? null) : null,
        coefficient: m.coefficient ?? '1',
        lossPercent: m.lossPercent === '0' ? null : m.lossPercent,
      }),
    ),
    costs: c.costs.map((cost) => newCost(cost.category, { ...cost })),
  };
}

export const STEPS = ['Cliente e obra', 'Serviços', 'Materiais', 'Custos da obra', 'Condições', 'Conferir'] as const;

export function stepOfPath(path: string): number {
  const root = path.split('.')[0] ?? '';
  if (['customerId', 'title', 'description', 'siteAddress', 'siteCity', 'siteState'].includes(root)) return 0;
  if (root === 'items') return 1;
  if (root === 'materials') return 2;
  if (root === 'costs') return 3;
  return 4;
}

/** Valida no navegador com o MESMO schema do servidor. Retorna erros por caminho ("items.0.quantity"). */
export function validateForm(form: QuoteForm): Record<string, string> {
  const result = quoteContentSchema.safeParse(formToContent(form));
  const errors: Record<string, string> = {};
  if (!result.success) {
    for (const issue of result.error.issues) {
      const key = issue.path.join('.');
      if (!errors[key]) errors[key] = issue.message;
    }
  }
  form.items.forEach((i, n) => {
    if (i.unitPriceCents === null) errors[`items.${n}.unitPriceCents`] = t('Informe o preço.');
    if (i.quantity === null) errors[`items.${n}.quantity`] = t('Informe a quantidade.');
  });
  form.costs.forEach((c, n) => {
    if (c.unitCostCents === null) errors[`costs.${n}.unitCostCents`] = t('Informe o valor.');
  });
  if (!form.customerId) errors.customerId = t('Escolha ou cadastre o cliente.');
  return errors;
}
