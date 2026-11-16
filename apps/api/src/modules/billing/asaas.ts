/**
 * Cliente da API do Asaas — SOMENTE os endpoints conferidos na documentação oficial (2026-11-05 e 2026-11-13):
 *   POST /v3/customers, GET /v3/customers?limit=1 (teste de conexão), POST /v3/subscriptions,
 *   GET /v3/subscriptions/{id}, GET /v3/subscriptions/{id}/payments, DELETE /v3/subscriptions/{id}
 * URLs (docs.asaas.com/reference/comece-por-aqui): sandbox https://api-sandbox.asaas.com · produção https://api.asaas.com
 * Autenticação: cabeçalho `access_token`; User-Agent identificando a aplicação. NÃO validado contra o serviço real (sem credenciais).
 */
import { dec } from '@reformar/shared';
import { AppError } from '../../lib/errors.js';

export interface AsaasPayment {
  id: string;
  status: string;
  value: number;
  dueDate: string;
  paymentDate?: string | null;
  invoiceUrl?: string | null;
  subscription?: string | null;
}

export const ASAAS_BASE_URL = { SANDBOX: 'https://api-sandbox.asaas.com', PRODUCTION: 'https://api.asaas.com' } as const;

export interface BillingProvider {
  /** Chamada inofensiva (lista 1 cliente) para conferir chave e ambiente. */
  testConnection(): Promise<void>;
  createCustomer(input: { name: string; cpfCnpj: string; email: string | null; externalReference: string }): Promise<{ id: string }>;
  createSubscription(input: {
    customer: string;
    billingType: 'UNDEFINED' | 'BOLETO' | 'CREDIT_CARD' | 'PIX';
    valueCents: number;
    nextDueDate: string;
    cycle: 'MONTHLY' | 'YEARLY';
    description: string;
    externalReference: string;
  }): Promise<{ id: string }>;
  getSubscription(id: string): Promise<{ id: string; status: string; deleted: boolean; nextDueDate: string | null }>;
  listSubscriptionPayments(id: string): Promise<AsaasPayment[]>;
  deleteSubscription(id: string): Promise<void>;
}

/** Converte centavos para o número em reais esperado pela API (2 casas exatas). */
export const centsToReais = (cents: number) => Number(dec(cents).dividedBy(100).toFixed(2));
export const reaisToCents = (value: number) => Number(dec(String(value)).times(100).toDecimalPlaces(0).toFixed());

export class AsaasHttpClient implements BillingProvider {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
  ) {}

  private async call<T>(method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          access_token: this.apiKey,
          'Content-Type': 'application/json',
          'User-Agent': 'reformar-saas',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      throw new AppError(503, 'BILLING_UNAVAILABLE', 'Não foi possível falar com o sistema de pagamentos. Tente de novo.');
    }
    if (!res.ok) {
      // Mensagens do provedor podem expor detalhes: registramos só o status.
      throw new AppError(502, 'BILLING_ERROR', `O sistema de pagamentos recusou a operação (HTTP ${res.status}). Confira os dados e tente de novo.`);
    }
    return (await res.json()) as T;
  }

  async testConnection() {
    await this.call<{ data: unknown[] }>('GET', '/v3/customers?limit=1');
  }

  createCustomer(input: { name: string; cpfCnpj: string; email: string | null; externalReference: string }) {
    return this.call<{ id: string }>('POST', '/v3/customers', {
      name: input.name,
      cpfCnpj: input.cpfCnpj,
      ...(input.email ? { email: input.email } : {}),
      externalReference: input.externalReference,
    });
  }

  createSubscription(input: Parameters<BillingProvider['createSubscription']>[0]) {
    return this.call<{ id: string }>('POST', '/v3/subscriptions', {
      customer: input.customer,
      billingType: input.billingType,
      value: centsToReais(input.valueCents),
      nextDueDate: input.nextDueDate,
      cycle: input.cycle,
      description: input.description,
      externalReference: input.externalReference,
    });
  }

  getSubscription(id: string) {
    return this.call<{ id: string; status: string; deleted: boolean; nextDueDate: string | null }>('GET', `/v3/subscriptions/${encodeURIComponent(id)}`);
  }

  async listSubscriptionPayments(id: string) {
    const r = await this.call<{ data: AsaasPayment[] }>('GET', `/v3/subscriptions/${encodeURIComponent(id)}/payments`);
    return r.data;
  }

  async deleteSubscription(id: string) {
    await this.call('DELETE', `/v3/subscriptions/${encodeURIComponent(id)}`);
  }
}

/** SOMENTE TESTES/DESENVOLVIMENTO SEM CREDENCIAIS: simula o Asaas em memória. Nunca usado em produção. */
export class FakeBillingProvider implements BillingProvider {
  customers: { id: string; cpfCnpj: string }[] = [];
  subscriptions = new Map<string, { id: string; customer: string; valueCents: number; nextDueDate: string; deleted: boolean; status: string }>();
  payments = new Map<string, AsaasPayment[]>();
  private seq = 0;
  connectionOk = true;
  async testConnection() {
    if (!this.connectionOk) throw new AppError(502, 'BILLING_ERROR', 'O sistema de pagamentos recusou a operação (HTTP 401). Confira os dados e tente de novo.');
  }
  async createCustomer(input: { cpfCnpj: string }) {
    const id = `cus_fake${++this.seq}`;
    this.customers.push({ id, cpfCnpj: input.cpfCnpj });
    return { id };
  }
  async createSubscription(input: Parameters<BillingProvider['createSubscription']>[0]) {
    const id = `sub_fake${++this.seq}`;
    this.subscriptions.set(id, { id, customer: input.customer, valueCents: input.valueCents, nextDueDate: input.nextDueDate, deleted: false, status: 'ACTIVE' });
    this.payments.set(id, [
      { id: `pay_fake${++this.seq}`, status: 'PENDING', value: centsToReais(input.valueCents), dueDate: input.nextDueDate, invoiceUrl: `https://sandbox.example/i/${id}`, subscription: id },
    ]);
    return { id };
  }
  async getSubscription(id: string) {
    const s = this.subscriptions.get(id);
    if (!s) throw new AppError(502, 'BILLING_ERROR', 'não encontrada');
    return { id, status: s.status, deleted: s.deleted, nextDueDate: s.nextDueDate };
  }
  async listSubscriptionPayments(id: string) {
    return this.payments.get(id) ?? [];
  }
  async deleteSubscription(id: string) {
    const s = this.subscriptions.get(id);
    if (s) {
      s.deleted = true;
      s.status = 'INACTIVE';
    }
  }
}
