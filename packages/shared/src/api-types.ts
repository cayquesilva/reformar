/** Contratos de resposta da API (JSON). Datas em ISO 8601; dinheiro em centavos. */
import type { Permission, Role } from './permissions.js';
import type { QuoteCalculation } from './quote-calc.js';
import type { ApprovalChannel, QuoteDisplayStatus, QuoteStatus } from './quote-status.js';
import type { QuoteContentInput } from './schemas.js';
import type { ServiceUnit } from './units.js';

export interface ApiErrorBody {
  error: string;
  message: string;
  fields?: Record<string, string>;
}

export interface MeResponse {
  user: { id: string; name: string; email: string };
  activeTenant: {
    id: string;
    name: string;
    role: Role;
    permissions: Permission[];
    isDemo: boolean;
    /** Nível de acesso pela assinatura da plataforma (somente leitura quando inadimplente/expirado). */
    access: { level: 'FULL' | 'READ_ONLY'; reason: string; warning: string | null };
  } | null;
  isPlatformAdmin: boolean;
  memberships: { tenantId: string; tenantName: string; role: Role }[];
}

export interface PublicConfigResponse {
  features: {
    passwordResetEmail: boolean;
    voiceAssistant: boolean;
    subscriptions: boolean;
  };
}

export interface SessionDTO {
  id: string;
  current: boolean;
  userAgent: string | null;
  ip: string | null;
  createdAt: string;
  lastSeenAt: string;
}

export interface CompanyProfileDTO {
  tradeName: string;
  legalName: string | null;
  document: string | null;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  addressLine: string | null;
  city: string | null;
  state: string | null;
  zipCode: string | null;
  primaryColor: string;
  pdfFooter: string | null;
  defaultValidityDays: number;
  defaultPaymentTerms: string | null;
  defaultExclusions: string | null;
  defaultNotes: string | null;
  hasLogo: boolean;
  updatedAt: string;
}

export interface CustomerDTO {
  id: string;
  type: 'INDIVIDUAL' | 'COMPANY';
  name: string;
  document: string | null;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  addressLine: string | null;
  city: string | null;
  state: string | null;
  zipCode: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CustomerDetailDTO extends CustomerDTO {
  quotes: QuoteSummaryDTO[];
}

export interface ServiceDTO {
  id: string;
  name: string;
  description: string | null;
  unit: ServiceUnit;
  defaultPriceCents: number | null;
  active: boolean;
}

export interface QuoteSummaryDTO {
  id: string;
  number: number;
  title: string;
  customer: { id: string; name: string };
  status: QuoteStatus;
  displayStatus: QuoteDisplayStatus;
  validUntil: string;
  totalCents: number;
  currentRevision: number;
  createdAt: string;
  updatedAt: string;
}

export interface QuoteVersionDTO {
  revision: number;
  createdAt: string;
  createdByName: string | null;
  totalCents: number;
}

export interface QuoteApprovalDTO {
  approvedByName: string;
  channel: ApprovalChannel;
  approvedOn: string;
  note: string | null;
  revision: number;
  recordedByName: string | null;
  recordedAt: string;
}

export interface QuoteHistoryEntryDTO {
  action: string;
  label: string;
  at: string;
  userName: string | null;
}

export interface QuoteDetailDTO extends QuoteSummaryDTO {
  lockVersion: number;
  content: QuoteContentInput;
  /** null quando o usuário não tem permissão de ver custos internos. */
  calculation: QuoteCalculation | null;
  clientTotals: { subtotalCents: number; discountCents: number; totalCents: number };
  versions: QuoteVersionDTO[];
  approval: QuoteApprovalDTO | null;
  refusedReason: string | null;
  history: QuoteHistoryEntryDTO[];
  canEdit: boolean;
  sentAt: string | null;
  /** Obra criada a partir deste orçamento, se houver. */
  projectId: string | null;
}

export interface QuoteShareDTO {
  url: string;
  expiresAt: string;
  whatsappUrl: string;
  message: string;
}

export interface DashboardDTO {
  awaiting: { count: number; totalCents: number };
  approvedThisMonth: { count: number; totalCents: number };
  drafts: number;
  expired: number;
  recentQuotes: QuoteSummaryDTO[];
}

export interface Paginated<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
}
