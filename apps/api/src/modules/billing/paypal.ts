/**
 * Cliente da API REST do PayPal (Subscriptions v1) — SOMENTE o que foi conferido na documentação
 * oficial em 2026-11-13 (developer.paypal.com):
 *   - URLs: sandbox https://api-m.sandbox.paypal.com · produção https://api-m.paypal.com (/api/rest/requests/)
 *   - POST /v1/oauth2/token (Basic client_id:secret, grant_type=client_credentials) → access_token, expires_in
 *   - POST /v1/catalogs/products {name, type: SERVICE} → id
 *   - POST /v1/billing/plans {product_id, name, billing_cycles[], payment_preferences} → id
 *   - POST /v1/billing/subscriptions {plan_id, start_time, custom_id, application_context} → id, status, links[]
 *   - GET  /v1/billing/subscriptions/{id} → status, custom_id, billing_info.last_payment, next_billing_time, failed_payments_count
 *   - POST /v1/billing/subscriptions/{id}/cancel {reason} → 204
 *   - POST /v1/notifications/verify-webhook-signature → verification_status (SUCCESS | FAILURE)
 *   - Cabeçalho PayPal-Request-Id (idempotência de POST, guardado por 72 h)
 *
 * NÃO CONFIRMADO na documentação lida (validar no sandbox antes de produção):
 *   - o `rel` do link de aprovação do comprador (usamos "approve"; sem ele a contratação é desfeita com erro claro);
 *   - a lista completa de status da assinatura (só ACTIVE e APPROVAL_PENDING aparecem nas páginas);
 *   - `application_context.return_url/cancel_url` aparecem como obsoletos, sem substituto indicado;
 *   - o formato do corpo dos webhooks: por isso o evento só serve de AVISO e o estado vem sempre do GET da assinatura.
 * NÃO validado contra o serviço real (sem credenciais).
 */
import { randomUUID } from 'node:crypto';
import { dec } from '@reformar/shared';
import { AppError } from '../../lib/errors.js';

export const PAYPAL_BASE_URL = { SANDBOX: 'https://api-m.sandbox.paypal.com', PRODUCTION: 'https://api-m.paypal.com' } as const;

export interface PaypalSubscriptionState {
  id: string;
  status: string;
  planId: string | null;
  customId: string | null;
  lastPayment: { valueCents: number; currency: string; time: string } | null;
  nextBillingTime: string | null;
  failedPaymentsCount: number;
}

export interface PaypalProvider {
  /** Pede um token: confirma que client id e secret são válidos para o ambiente. */
  testConnection(): Promise<void>;
  createProduct(input: { name: string; description: string }): Promise<{ id: string }>;
  createPlan(input: {
    productId: string;
    name: string;
    valueCents: number;
    currency: string;
    cycle: 'MONTHLY' | 'YEARLY';
  }): Promise<{ id: string }>;
  createSubscription(input: {
    planId: string;
    customId: string;
    startTime: string | null;
    returnUrl: string;
    cancelUrl: string;
    brandName: string;
    locale: string;
  }): Promise<{ id: string; approveUrl: string | null }>;
  getSubscription(id: string): Promise<PaypalSubscriptionState>;
  cancelSubscription(id: string, reason: string): Promise<void>;
  verifyWebhook(input: { headers: Record<string, string | undefined>; event: unknown; webhookId: string }): Promise<boolean>;
}

/** Valor em reais como string com 2 casas, formato pedido pelo PayPal (ex.: "49.90"). */
export const centsToMoneyString = (cents: number) => dec(cents).dividedBy(100).toFixed(2);
export const moneyStringToCents = (value: string) => Number(dec(value).times(100).toDecimalPlaces(0).toFixed());

type Json = Record<string, unknown>;

export class PaypalHttpClient implements PaypalProvider {
  private token: { value: string; until: number } | null = null;

  constructor(
    private readonly baseUrl: string,
    private readonly clientId: string,
    private readonly clientSecret: string,
  ) {}

  private async fetchSafe(url: string, init: RequestInit): Promise<Response> {
    try {
      return await fetch(url, { ...init, signal: AbortSignal.timeout(20_000) });
    } catch {
      throw new AppError(503, 'BILLING_UNAVAILABLE', 'Não foi possível falar com o PayPal. Tente de novo.');
    }
  }

  private async accessToken(): Promise<string> {
    if (this.token && this.token.until > Date.now()) return this.token.value;
    const res = await this.fetchSafe(`${this.baseUrl}/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    });
    if (!res.ok) {
      throw new AppError(
        502,
        'BILLING_AUTH',
        `O PayPal recusou as credenciais (HTTP ${res.status}). Confira client ID, secret e o ambiente.`,
      );
    }
    const body = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!body.access_token) throw new AppError(502, 'BILLING_ERROR', 'O PayPal não devolveu o token de acesso.');
    // Renova 60 s antes de vencer.
    this.token = { value: body.access_token, until: Date.now() + Math.max(0, (body.expires_in ?? 0) - 60) * 1000 };
    return body.access_token;
  }

  private async call<T>(method: 'GET' | 'POST', path: string, body?: unknown, opts: { idempotent?: boolean } = {}): Promise<T> {
    const token = await this.accessToken();
    const res = await this.fetchSafe(`${this.baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(opts.idempotent ? { 'PayPal-Request-Id': randomUUID() } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) {
      // A resposta de erro pode expor detalhes: registramos só o status.
      throw new AppError(502, 'BILLING_ERROR', `O PayPal recusou a operação (HTTP ${res.status}). Confira os dados e tente de novo.`);
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  async testConnection() {
    this.token = null;
    await this.accessToken();
  }

  async createProduct(input: { name: string; description: string }) {
    const r = await this.call<{ id: string }>(
      'POST',
      '/v1/catalogs/products',
      { name: input.name, type: 'SERVICE', description: input.description },
      { idempotent: true },
    );
    return { id: r.id };
  }

  async createPlan(input: Parameters<PaypalProvider['createPlan']>[0]) {
    const r = await this.call<{ id: string }>(
      'POST',
      '/v1/billing/plans',
      {
        product_id: input.productId,
        name: input.name,
        billing_cycles: [
          {
            frequency: { interval_unit: input.cycle === 'YEARLY' ? 'YEAR' : 'MONTH', interval_count: 1 },
            tenure_type: 'REGULAR',
            sequence: 1,
            total_cycles: 0, // 0 = renova até cancelar
            pricing_scheme: { fixed_price: { value: centsToMoneyString(input.valueCents), currency_code: input.currency } },
          },
        ],
        payment_preferences: { auto_bill_outstanding: true },
      },
      { idempotent: true },
    );
    return { id: r.id };
  }

  async createSubscription(input: Parameters<PaypalProvider['createSubscription']>[0]) {
    const r = await this.call<{ id: string; links?: { href: string; rel: string }[] }>(
      'POST',
      '/v1/billing/subscriptions',
      {
        plan_id: input.planId,
        custom_id: input.customId,
        ...(input.startTime ? { start_time: input.startTime } : {}),
        application_context: {
          brand_name: input.brandName.slice(0, 127),
          locale: input.locale,
          shipping_preference: 'NO_SHIPPING',
          user_action: 'SUBSCRIBE_NOW',
          return_url: input.returnUrl,
          cancel_url: input.cancelUrl,
        },
      },
      { idempotent: true },
    );
    const approve = r.links?.find((l) => l.rel === 'approve')?.href ?? null;
    return { id: r.id, approveUrl: approve };
  }

  async getSubscription(id: string): Promise<PaypalSubscriptionState> {
    const r = await this.call<{
      id: string;
      status: string;
      plan_id?: string;
      custom_id?: string;
      billing_info?: {
        last_payment?: { amount?: { currency_code?: string; value?: string }; time?: string };
        next_billing_time?: string;
        failed_payments_count?: number;
      };
    }>('GET', `/v1/billing/subscriptions/${encodeURIComponent(id)}`);
    const lp = r.billing_info?.last_payment;
    return {
      id: r.id,
      status: r.status,
      planId: r.plan_id ?? null,
      customId: r.custom_id ?? null,
      lastPayment:
        lp?.amount?.value && lp.amount.currency_code && lp.time
          ? { valueCents: moneyStringToCents(lp.amount.value), currency: lp.amount.currency_code, time: lp.time }
          : null,
      nextBillingTime: r.billing_info?.next_billing_time ?? null,
      failedPaymentsCount: r.billing_info?.failed_payments_count ?? 0,
    };
  }

  async cancelSubscription(id: string, reason: string) {
    await this.call('POST', `/v1/billing/subscriptions/${encodeURIComponent(id)}/cancel`, { reason: reason.slice(0, 128) });
  }

  async verifyWebhook(input: Parameters<PaypalProvider['verifyWebhook']>[0]) {
    const h = input.headers;
    const required = [
      'paypal-auth-algo',
      'paypal-cert-url',
      'paypal-transmission-id',
      'paypal-transmission-sig',
      'paypal-transmission-time',
    ];
    if (required.some((k) => !h[k])) return false;
    const r = await this.call<{ verification_status?: string }>('POST', '/v1/notifications/verify-webhook-signature', {
      auth_algo: h['paypal-auth-algo'],
      cert_url: h['paypal-cert-url'],
      transmission_id: h['paypal-transmission-id'],
      transmission_sig: h['paypal-transmission-sig'],
      transmission_time: h['paypal-transmission-time'],
      webhook_id: input.webhookId,
      webhook_event: input.event as Json,
    });
    return r.verification_status === 'SUCCESS';
  }
}

/** SOMENTE TESTES/DESENVOLVIMENTO SEM CREDENCIAIS: simula o PayPal em memória. Nunca usado em produção. */
export class FakePaypalProvider implements PaypalProvider {
  products: string[] = [];
  plans = new Map<string, { productId: string; valueCents: number; currency: string; cycle: string }>();
  subscriptions = new Map<string, PaypalSubscriptionState & { startTime: string | null }>();
  canceled: string[] = [];
  validSignature = true;
  connectionOk = true;
  private seq = 0;

  async testConnection() {
    if (!this.connectionOk)
      throw new AppError(502, 'BILLING_AUTH', 'O PayPal recusou as credenciais (HTTP 401). Confira client ID, secret e o ambiente.');
  }
  async createProduct() {
    const id = `PROD-FAKE${++this.seq}`;
    this.products.push(id);
    return { id };
  }
  async createPlan(input: Parameters<PaypalProvider['createPlan']>[0]) {
    const id = `P-FAKE${++this.seq}`;
    this.plans.set(id, { productId: input.productId, valueCents: input.valueCents, currency: input.currency, cycle: input.cycle });
    return { id };
  }
  async createSubscription(input: Parameters<PaypalProvider['createSubscription']>[0]) {
    const id = `I-FAKE${++this.seq}`;
    this.subscriptions.set(id, {
      id,
      planId: input.planId,
      startTime: input.startTime,
      status: 'APPROVAL_PENDING',
      customId: input.customId,
      lastPayment: null,
      nextBillingTime: null,
      failedPaymentsCount: 0,
    });
    return { id, approveUrl: `https://sandbox.example/paypal/approve/${id}` };
  }
  async getSubscription(id: string) {
    const s = this.subscriptions.get(id);
    if (!s) throw new AppError(502, 'BILLING_ERROR', 'não encontrada');
    return { ...s };
  }
  async cancelSubscription(id: string) {
    const s = this.subscriptions.get(id);
    if (s) s.status = 'CANCELLED';
    this.canceled.push(id);
  }
  async verifyWebhook() {
    return this.validSignature;
  }
}
