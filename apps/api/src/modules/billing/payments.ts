/**
 * Meios de pagamento da assinatura (Asaas e PayPal), configurados pelo painel da plataforma.
 * O que está salvo no banco tem prioridade; sem registro do Asaas no banco, valem as variáveis
 * ASAAS_* do servidor (configuração antiga). Credenciais ficam cifradas com SECRETS_KEY.
 * O resultado fica em cache por alguns segundos (o portão de acesso consulta a cada requisição).
 */
import type { AppConfig } from '../../config.js';
import type { Db } from '../../db.js';
import { SecretBox } from '../../lib/secret-box.js';
import { ASAAS_BASE_URL, AsaasHttpClient, type BillingProvider } from './asaas.js';
import { PAYPAL_BASE_URL, PaypalHttpClient, type PaypalProvider } from './paypal.js';

export type ProviderId = 'ASAAS' | 'PAYPAL';
export type ProviderEnv = 'SANDBOX' | 'PRODUCTION';
export const PROVIDERS: readonly ProviderId[] = ['ASAAS', 'PAYPAL'];

export interface AsaasSecrets {
  apiKey?: string;
  webhookToken?: string;
}
export interface PaypalSecrets {
  clientId?: string;
  clientSecret?: string;
}
export interface PaypalSettings {
  webhookId?: string;
  /** Moeda dos planos no PayPal (BRL só funciona para contas PayPal do Brasil). */
  currency?: string;
  /** Produto criado no PayPal, por ambiente. */
  products?: Partial<Record<ProviderEnv, string>>;
}

export interface ResolvedAsaas {
  /** Oferecido para novas contratações (desligar no painel não abandona quem já assina por ele). */
  offered: boolean;
  source: 'database' | 'environment';
  environment: ProviderEnv;
  client: BillingProvider;
  webhookToken: string | null;
}
export interface ResolvedPaypal {
  offered: boolean;
  environment: ProviderEnv;
  client: PaypalProvider;
  webhookId: string | null;
  currency: string;
  productId: string | null;
}

export interface PaymentOverrides {
  /** Testes: cliente simulado no lugar do Asaas real. */
  asaas?: BillingProvider | null;
  /** Testes: cliente simulado no lugar do PayPal real. */
  paypal?: PaypalProvider | null;
}

const TTL_MS = 15_000;

export class Payments {
  readonly box: SecretBox | null;
  private cache: { at: number; asaas: ResolvedAsaas | null; paypal: ResolvedPaypal | null } | null = null;

  constructor(
    private readonly db: Db,
    private readonly config: AppConfig,
    private readonly overrides: PaymentOverrides = {},
  ) {
    this.box = config.secretsKey ? new SecretBox(config.secretsKey) : null;
  }

  invalidate() {
    this.cache = null;
  }

  /** Lê as credenciais cifradas; null se não houver ou se a chave do servidor mudou. */
  openSecrets<T>(sealed: string | null): T | null {
    if (!sealed || !this.box) return null;
    try {
      return JSON.parse(this.box.open(sealed)) as T;
    } catch {
      return null;
    }
  }

  sealSecrets(value: object): string {
    if (!this.box) throw new Error('SECRETS_KEY ausente');
    return this.box.seal(JSON.stringify(value));
  }

  asaasClient(environment: ProviderEnv, apiKey: string, baseUrl?: string): BillingProvider {
    return this.overrides.asaas ?? new AsaasHttpClient(baseUrl ?? ASAAS_BASE_URL[environment], apiKey);
  }

  paypalClient(environment: ProviderEnv, clientId: string, clientSecret: string): PaypalProvider {
    return this.overrides.paypal ?? new PaypalHttpClient(PAYPAL_BASE_URL[environment], clientId, clientSecret);
  }

  private async load() {
    if (this.cache && Date.now() - this.cache.at < TTL_MS) return this.cache;
    const rows = await this.db.paymentProviderConfig.findMany();
    const asaasRow = rows.find((r) => r.provider === 'ASAAS');
    const paypalRow = rows.find((r) => r.provider === 'PAYPAL');

    let asaas: ResolvedAsaas | null = null;
    if (asaasRow) {
      const s = this.openSecrets<AsaasSecrets>(asaasRow.secrets);
      if (s?.apiKey && s.webhookToken) {
        const environment = asaasRow.environment === 'PRODUCTION' ? 'PRODUCTION' : 'SANDBOX';
        asaas = {
          offered: asaasRow.enabled,
          source: 'database',
          environment,
          client: this.asaasClient(environment, s.apiKey),
          webhookToken: s.webhookToken,
        };
      }
    } else if (this.config.billing.enabled) {
      const environment: ProviderEnv = /sandbox/i.test(this.config.billing.baseUrl) ? 'SANDBOX' : 'PRODUCTION';
      asaas = {
        offered: true,
        source: 'environment',
        environment,
        client: this.asaasClient(environment, this.config.billing.apiKey!, this.config.billing.baseUrl),
        webhookToken: this.config.billing.webhookToken,
      };
    }

    let paypal: ResolvedPaypal | null = null;
    if (paypalRow) {
      const s = this.openSecrets<PaypalSecrets>(paypalRow.secrets);
      const settings = (paypalRow.settings ?? {}) as PaypalSettings;
      if (s?.clientId && s.clientSecret && settings.webhookId) {
        const environment = paypalRow.environment === 'PRODUCTION' ? 'PRODUCTION' : 'SANDBOX';
        paypal = {
          offered: paypalRow.enabled,
          environment,
          client: this.paypalClient(environment, s.clientId, s.clientSecret),
          webhookId: settings.webhookId,
          currency: settings.currency || 'BRL',
          productId: settings.products?.[environment] ?? null,
        };
      }
    }
    this.cache = { at: Date.now(), asaas, paypal };
    return this.cache;
  }

  async asaas() {
    return (await this.load()).asaas;
  }

  async paypal() {
    return (await this.load()).paypal;
  }

  /** Meios de pagamento prontos para contratar. */
  async available(): Promise<ProviderId[]> {
    const c = await this.load();
    return PROVIDERS.filter((p) => (p === 'ASAAS' ? c.asaas?.offered : c.paypal?.offered));
  }

  /** Cobrança ligada = há ao menos um meio de pagamento pronto (sem isso ninguém é bloqueado). */
  async enabled(): Promise<boolean> {
    return (await this.available()).length > 0;
  }
}
