/**
 * Assinatura da PLATAFORMA (o que a empresa paga para usar o sistema).
 * Política: inadimplência => tolerância => SOMENTE LEITURA. Dados nunca são apagados;
 * consulta, exportação e gestão da assinatura continuam disponíveis.
 */
export type SubscriptionStatus = 'TRIALING' | 'PENDING' | 'ACTIVE' | 'PAST_DUE' | 'SUSPENDED' | 'CANCELED';
export type AccessLevel = 'FULL' | 'READ_ONLY';

export const SUBSCRIPTION_STATUS_LABEL: Record<SubscriptionStatus, string> = {
  TRIALING: 'Período de teste',
  PENDING: 'Aguardando pagamento',
  ACTIVE: 'Ativa',
  PAST_DUE: 'Pagamento em atraso',
  SUSPENDED: 'Suspensa',
  CANCELED: 'Cancelada',
};

export interface SubscriptionState {
  status: SubscriptionStatus;
  trialEndsAt: string | null; // ISO data-hora
  currentPeriodEnd: string | null; // AAAA-MM-DD
  graceUntil: string | null; // AAAA-MM-DD
}

export interface AccessDecision {
  level: AccessLevel;
  reason: string;
  /** Aviso a mostrar mesmo com acesso completo (ex.: atraso dentro da tolerância). */
  warning: string | null;
}

export function accessFor(s: SubscriptionState | null, now: Date, today: string): AccessDecision {
  if (!s) return { level: 'FULL', reason: 'Sem assinatura configurada.', warning: null };
  const trialActive = !!s.trialEndsAt && new Date(s.trialEndsAt) > now;
  const paidThrough = !!s.currentPeriodEnd && s.currentPeriodEnd >= today;
  switch (s.status) {
    case 'ACTIVE':
      return { level: 'FULL', reason: 'Assinatura ativa.', warning: null };
    case 'TRIALING':
    case 'PENDING':
      if (trialActive || paidThrough) {
        return { level: 'FULL', reason: 'Período de teste.', warning: s.status === 'PENDING' ? 'Aguardando confirmação do pagamento.' : null };
      }
      return { level: 'READ_ONLY', reason: 'O período de teste terminou. Assine um plano para continuar lançando dados.', warning: null };
    case 'PAST_DUE':
      if ((s.graceUntil && s.graceUntil >= today) || paidThrough) {
        return {
          level: 'FULL',
          reason: 'Pagamento em atraso (em tolerância).',
          warning: `Pagamento da assinatura em atraso. Regularize${s.graceUntil ? ` até ${s.graceUntil.split('-').reverse().join('/')}` : ''} para não ficar só em modo de consulta.`,
        };
      }
      return { level: 'READ_ONLY', reason: 'Pagamento da assinatura em atraso. Seus dados estão guardados; regularize para voltar a lançar.', warning: null };
    case 'CANCELED':
      if (paidThrough) return { level: 'FULL', reason: 'Cancelada; acesso até o fim do período pago.', warning: 'Assinatura cancelada. O acesso completo vai até o fim do período pago.' };
      return { level: 'READ_ONLY', reason: 'Assinatura cancelada. Você ainda pode consultar e exportar seus dados.', warning: null };
    case 'SUSPENDED':
    default:
      return { level: 'READ_ONLY', reason: 'Assinatura suspensa. Você ainda pode consultar e exportar seus dados.', warning: null };
  }
}

/** Fim do período pago a partir do vencimento da cobrança paga. */
export function periodEndFrom(dueDate: string, cycle: string): string {
  const months = cycle === 'YEARLY' ? 12 : cycle === 'QUARTERLY' ? 3 : cycle === 'SEMIANNUALLY' ? 6 : 1;
  const [y, m, d] = dueDate.split('-').map(Number) as [number, number, number];
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, last));
  target.setUTCDate(target.getUTCDate() - 1);
  return target.toISOString().slice(0, 10);
}

export interface PlanDTO {
  id: string;
  code: string;
  name: string;
  description: string | null;
  priceCents: number;
  cycle: 'MONTHLY' | 'YEARLY';
  maxUsers: number | null;
  maxActiveProjects: number | null;
  aiMonthlyRequests: number;
  active: boolean;
}

/** Meios de pagamento da assinatura. */
export type PaymentProvider = 'ASAAS' | 'PAYPAL';
export type PaymentEnvironment = 'SANDBOX' | 'PRODUCTION';
export const PAYMENT_PROVIDER_INFO: Record<PaymentProvider, { label: string; methods: string }> = {
  ASAAS: { label: 'Asaas', methods: 'Pix, boleto ou cartão' },
  PAYPAL: { label: 'PayPal', methods: 'Conta PayPal ou cartão' },
};

export interface BillingDTO {
  enabled: boolean;
  /** Meios de pagamento oferecidos para contratar. */
  providers: PaymentProvider[];
  /** Meio de pagamento da assinatura atual. */
  provider: PaymentProvider | null;
  status: SubscriptionStatus | null;
  plan: PlanDTO | null;
  access: AccessDecision;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  graceUntil: string | null;
  billingType: string | null;
  pendingInvoiceUrl: string | null;
  plans: PlanDTO[];
}

/** Painel da plataforma: estado de um meio de pagamento. Credenciais nunca voltam (só se estão salvas e o final). */
export interface PaymentProviderAdminDTO {
  provider: PaymentProvider;
  enabled: boolean;
  environment: PaymentEnvironment;
  /** database = salvo no painel · environment = variáveis ASAAS_* do servidor · none = não configurado */
  source: 'database' | 'environment' | 'none';
  /** Credenciais completas e legíveis (pronto para cobrar). */
  ready: boolean;
  /** Credencial salva mas ilegível (a chave SECRETS_KEY do servidor mudou): cadastre de novo. */
  unreadable: boolean;
  credentials: Record<string, { set: boolean; hint: string | null }>;
  settings: { webhookId?: string | null; currency?: string | null };
  webhookUrl: string;
  lastTest: { at: string; ok: boolean; message: string | null } | null;
  subscriptions: number;
}

export interface PaymentProvidersAdminDTO {
  /** Sem SECRETS_KEY no servidor o painel não salva credenciais. */
  canStoreSecrets: boolean;
  providers: PaymentProviderAdminDTO[];
}
