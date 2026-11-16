import { z } from 'zod';
import { dec } from './decimal.js';
import { MAX_CENTS } from './money.js';
import { COST_CATEGORIES, DISCOUNT_TYPES, MATERIAL_SUPPLY } from './quote-calc.js';
import { APPROVAL_CHANNELS } from './quote-status.js';
import { SERVICE_UNITS } from './units.js';

const trimmed = (max: number) => z.string().trim().max(max, { message: `Use no máximo ${max} caracteres.` });
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, { message: `Use no máximo ${max} caracteres.` })
    .nullish()
    .transform((v) => (v ? v : null));

export const centsSchema = z
  .number({ message: 'Informe um valor.' })
  .int({ message: 'Valor inválido.' })
  .min(0, { message: 'O valor não pode ser negativo.' })
  .max(MAX_CENTS, { message: 'Valor muito alto.' });

/** Decimal positivo como string com ponto, até 10 dígitos inteiros e `dp` casas. */
export const decimalString = (dp = 4, opts: { allowZero?: boolean; max?: string } = {}) => {
  const pattern = new RegExp(`^\\d{1,10}(\\.\\d{1,${dp}})?$`);
  // Zod 4 executa todos os refinamentos mesmo após falha da regex: cada refine se protege.
  return z
    .string({ message: 'Informe um número.' })
    .trim()
    .regex(pattern, { message: `Número inválido (use até ${dp} casas decimais).` })
    .refine((v) => !pattern.test(v) || opts.allowZero || dec(v).greaterThan(0), {
      message: 'Informe um número maior que zero.',
    })
    .refine((v) => !pattern.test(v) || !opts.max || dec(v).lessThanOrEqualTo(opts.max), {
      message: `O valor máximo é ${opts.max}.`,
    });
};

export const percentString = decimalString(2, { allowZero: true, max: '100' });

export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'Data inválida.' });

const digitsOnly = (v: string | null) => (v ? v.replace(/\D/g, '') : null);

export const phoneSchema = optionalText(30)
  .transform(digitsOnly)
  .refine((v) => v === null || v === '' || (v.length >= 10 && v.length <= 13), {
    message: 'Telefone inválido. Inclua o DDD, ex.: (11) 98765-4321.',
  })
  .transform((v) => (v ? v : null));

export const documentSchema = optionalText(20)
  .transform(digitsOnly)
  .refine((v) => v === null || v === '' || v.length === 11 || v.length === 14, {
    message: 'CPF deve ter 11 dígitos e CNPJ 14 dígitos.',
  })
  .transform((v) => (v ? v : null));

export const emailSchema = z.string().trim().toLowerCase().email({ message: 'E-mail inválido.' }).max(200);
export const optionalEmail = z
  .string()
  .trim()
  .toLowerCase()
  .max(200)
  .nullish()
  .transform((v) => (v ? v : null))
  .refine((v) => v === null || z.string().email().safeParse(v).success, { message: 'E-mail inválido.' });

export const passwordSchema = z
  .string()
  .min(8, { message: 'A senha precisa ter pelo menos 8 caracteres.' })
  .max(200, { message: 'Senha muito longa.' });

// ---------- Auth ----------
export const signupSchema = z.object({
  name: trimmed(120).min(2, { message: 'Informe seu nome.' }),
  email: emailSchema,
  password: passwordSchema,
  companyName: trimmed(120).min(2, { message: 'Informe o nome da sua empresa ou o seu nome profissional.' }),
  acceptTerms: z.literal(true, { message: 'É preciso aceitar os termos de uso e a política de privacidade.' }),
});
export type SignupInput = z.infer<typeof signupSchema>;

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, { message: 'Informe a senha.' }).max(200),
});

export const passwordResetRequestSchema = z.object({ email: emailSchema });
export const passwordResetConfirmSchema = z.object({
  token: z.string().min(20).max(200),
  password: passwordSchema,
});
export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: passwordSchema,
});

// ---------- Empresa ----------
export const UF_LIST = [
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ',
  'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
] as const;

const ufSchema = z
  .string()
  .trim()
  .toUpperCase()
  .nullish()
  .transform((v) => (v ? v : null))
  .refine((v) => v === null || (UF_LIST as readonly string[]).includes(v), { message: 'UF inválida.' });

export const companyProfileSchema = z.object({
  tradeName: trimmed(120).min(2, { message: 'Informe o nome que aparece para o cliente.' }),
  legalName: optionalText(160),
  document: documentSchema,
  phone: phoneSchema,
  whatsapp: phoneSchema,
  email: optionalEmail,
  addressLine: optionalText(200),
  city: optionalText(100),
  state: ufSchema,
  zipCode: optionalText(9),
  primaryColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, { message: 'Cor inválida.' })
    .default('#1F4E79'),
  pdfFooter: optionalText(500),
  defaultValidityDays: z.number().int().min(1).max(365).default(15),
  defaultPaymentTerms: optionalText(1000),
  defaultExclusions: optionalText(2000),
  defaultNotes: optionalText(2000),
});
export type CompanyProfileInput = z.infer<typeof companyProfileSchema>;

// ---------- Clientes ----------
export const customerSchema = z.object({
  type: z.enum(['INDIVIDUAL', 'COMPANY']).default('INDIVIDUAL'),
  name: trimmed(160).min(2, { message: 'Informe o nome do cliente.' }),
  document: documentSchema,
  phone: phoneSchema,
  whatsapp: phoneSchema,
  email: optionalEmail,
  addressLine: optionalText(200),
  city: optionalText(100),
  state: ufSchema,
  zipCode: optionalText(9),
  notes: optionalText(2000),
});
export type CustomerInput = z.infer<typeof customerSchema>;

// ---------- Catálogo ----------
export const serviceCatalogSchema = z.object({
  name: trimmed(120).min(2, { message: 'Informe o nome do serviço.' }),
  description: optionalText(500),
  unit: z.enum(SERVICE_UNITS, { message: 'Escolha a unidade.' }),
  defaultPriceCents: centsSchema.nullish().transform((v) => v ?? null),
  active: z.boolean().default(true),
});
export type ServiceCatalogInput = z.infer<typeof serviceCatalogSchema>;

// ---------- Orçamento ----------
export const quoteItemSchema = z.object({
  serviceId: z.uuid().nullish().transform((v) => v ?? null),
  description: trimmed(300).min(2, { message: 'Descreva o serviço.' }),
  unit: z.enum(SERVICE_UNITS, { message: 'Escolha a unidade.' }),
  quantity: decimalString(4),
  unitPriceCents: centsSchema,
  notes: optionalText(500),
});

export const quoteMaterialSchema = z
  .object({
    description: trimmed(200).min(2, { message: 'Informe o material.' }),
    unit: trimmed(20).min(1, { message: 'Informe a unidade do material (ex.: m², kg, saco).' }),
    supply: z.enum(MATERIAL_SUPPLY),
    itemIndex: z.number().int().min(0).nullish().transform((v) => v ?? null),
    coefficient: decimalString(6).nullish().transform((v) => v ?? null),
    baseQuantity: decimalString(4).nullish().transform((v) => v ?? null),
    lossPercent: percentString.default('0'),
    packageSize: decimalString(4).nullish().transform((v) => v ?? null),
    packageLabel: optionalText(30),
    unitPriceCents: centsSchema.nullish().transform((v) => v ?? null),
    notes: optionalText(500),
  })
  .refine((m) => m.itemIndex !== null || m.baseQuantity !== null, {
    message: 'Informe a quantidade do material ou ligue-o a um serviço.',
    path: ['baseQuantity'],
  });

export const quoteCostSchema = z.object({
  category: z.enum(COST_CATEGORIES),
  description: trimmed(200).min(2, { message: 'Descreva o custo.' }),
  quantity: decimalString(4),
  unit: optionalText(20),
  unitCostCents: centsSchema,
  chargeToClient: z.boolean().default(false),
});

export const quoteContentSchema = z
  .object({
    customerId: z.uuid({ message: 'Escolha o cliente.' }),
    title: trimmed(160).min(2, { message: 'Dê um nome ao orçamento, ex.: "Piso da sala".' }),
    description: optionalText(2000),
    siteAddress: optionalText(200),
    siteCity: optionalText(100),
    siteState: ufSchema,
    validUntil: isoDate,
    paymentTerms: optionalText(1000),
    exclusions: optionalText(2000),
    notes: optionalText(2000),
    discountType: z.enum(DISCOUNT_TYPES).default('NONE'),
    discountPercent: percentString.nullish().transform((v) => v ?? null),
    discountCents: centsSchema.nullish().transform((v) => v ?? null),
    taxPercent: percentString.default('0'),
    contingencyPercent: percentString.default('0'),
    items: z.array(quoteItemSchema).max(200, { message: 'Máximo de 200 serviços.' }),
    materials: z.array(quoteMaterialSchema).max(300, { message: 'Máximo de 300 materiais.' }),
    costs: z.array(quoteCostSchema).max(300, { message: 'Máximo de 300 custos.' }),
  })
  .superRefine((quote, ctx) => {
    quote.materials.forEach((m, i) => {
      if (m.itemIndex !== null && m.itemIndex >= quote.items.length) {
        ctx.addIssue({
          code: 'custom',
          message: 'O material está ligado a um serviço que não existe.',
          path: ['materials', i, 'itemIndex'],
        });
      }
    });
    if (quote.discountType === 'PERCENT' && quote.discountPercent === null) {
      ctx.addIssue({ code: 'custom', message: 'Informe o percentual de desconto.', path: ['discountPercent'] });
    }
    if (quote.discountType === 'AMOUNT' && quote.discountCents === null) {
      ctx.addIssue({ code: 'custom', message: 'Informe o valor do desconto.', path: ['discountCents'] });
    }
  });
export type QuoteContentInput = z.infer<typeof quoteContentSchema>;
export type QuoteContentRaw = z.input<typeof quoteContentSchema>;

export const quoteUpdateSchema = z.object({
  lockVersion: z.number().int().min(0),
  content: quoteContentSchema,
});

export const quoteApproveSchema = z.object({
  approvedByName: trimmed(160).min(2, { message: 'Informe quem aprovou (nome do cliente ou responsável).' }),
  channel: z.enum(APPROVAL_CHANNELS),
  approvedOn: isoDate,
  note: optionalText(1000),
});

export const quoteRefuseSchema = z.object({
  reason: optionalText(1000),
});

export const PDF_MODES = ['detailed', 'summary', 'internal'] as const;
export type PdfMode = (typeof PDF_MODES)[number];

export const quoteShareSchema = z.object({
  mode: z.enum(['detailed', 'summary']).default('detailed'),
});
