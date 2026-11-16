import type { AppConfig } from './config.js';
import type { Db } from './db.js';
import type { Mailer } from './lib/mailer.js';
import type { Storage } from './lib/storage.js';
import type { AssistantModel } from './modules/ai/model.js';
import type { Payments } from './modules/billing/payments.js';

/** Dependências compartilhadas pelas rotas (injetadas para facilitar testes). */
export interface AppContext {
  config: AppConfig;
  db: Db;
  mailer: Mailer;
  storage: Storage;
  /** null quando o assistente não está configurado. */
  assistant: AssistantModel | null;
  /** Meios de pagamento da assinatura (Asaas, PayPal), configurados no painel da plataforma. */
  payments: Payments;
}
