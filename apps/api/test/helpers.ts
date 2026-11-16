import { randomUUID } from 'node:crypto';
import { inflateSync } from 'node:zlib';
import { config as loadEnv } from 'dotenv';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { addDaysISO, todayISO, type Role } from '@reformar/shared';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { createDb, type Db } from '../src/db.js';
import { hashPassword } from '../src/lib/crypto.js';
import { MemoryMailer } from '../src/lib/mailer.js';
import { MemoryStorage } from '../src/lib/storage.js';
import type { AssistantModel } from '../src/modules/ai/model.js';
import type { BillingProvider } from '../src/modules/billing/asaas.js';
import type { PaypalProvider } from '../src/modules/billing/paypal.js';

loadEnv({ quiet: true });

export interface TestEnv {
  app: FastifyInstance;
  db: Db;
  mailer: MemoryMailer;
  storage: MemoryStorage;
  close: () => Promise<void>;
}

export async function createTestEnv(
  opts: { env?: Record<string, string>; assistant?: AssistantModel | null; billing?: BillingProvider | null; paypal?: PaypalProvider | null } = {},
): Promise<TestEnv> {
  const config = loadConfig({
    ...process.env,
    NODE_ENV: 'test',
    DATABASE_URL: process.env.DATABASE_URL_TEST,
    APP_ORIGIN: 'http://localhost:5173',
    PUBLIC_APP_URL: 'http://localhost:5173',
    COOKIE_SECURE: 'false',
    MAILER: 'none',
    ...opts.env,
  });
  const db = createDb(config.databaseUrl);
  const mailer = new MemoryMailer();
  const storage = new MemoryStorage();
  const app = await buildApp({ config, db, mailer, storage, assistant: opts.assistant ?? null, billing: opts.billing ?? null, paypal: opts.paypal ?? null });
  await app.ready();
  return {
    app,
    db,
    mailer,
    storage,
    close: async () => {
      await app.close();
      await db.$disconnect();
    },
  };
}

type Method = 'GET' | 'POST' | 'PUT' | 'DELETE';

/** Cliente HTTP de teste que guarda o cookie de sessão e envia o cabeçalho anti-CSRF. */
export class Client {
  cookie: string | null = null;
  constructor(private readonly app: FastifyInstance) {}

  async req(method: Method, url: string, body?: unknown, headers: Record<string, string> = {}): Promise<LightMyRequestResponse> {
    const res = await this.app.inject({
      method,
      url,
      headers: {
        'x-reformar-client': 'web',
        origin: 'http://localhost:5173',
        ...(this.cookie ? { cookie: this.cookie } : {}),
        ...(body !== undefined && !Buffer.isBuffer(body) ? { 'content-type': 'application/json' } : {}),
        ...headers,
      },
      payload: body === undefined ? undefined : Buffer.isBuffer(body) ? body : JSON.stringify(body),
    });
    const setCookie = res.cookies.find((c) => c.name === 'rf_session');
    if (setCookie) this.cookie = setCookie.value ? `rf_session=${setCookie.value}` : null;
    return res;
  }

  get = (url: string) => this.req('GET', url);
  post = (url: string, body?: unknown, headers?: Record<string, string>) => this.req('POST', url, body ?? {}, headers);
  put = (url: string, body?: unknown, headers?: Record<string, string>) => this.req('PUT', url, body, headers);
  del = (url: string) => this.req('DELETE', url);
}

export function uniqueEmail(prefix = 'user') {
  return `${prefix}-${randomUUID().slice(0, 8)}@teste.com.br`;
}

export async function signup(app: FastifyInstance, companyName = 'Empresa Teste') {
  const client = new Client(app);
  const email = uniqueEmail();
  const res = await client.post('/api/auth/signup', {
    name: 'Fulano de Tal',
    email,
    password: 'senha-forte-123',
    companyName,
    acceptTerms: true,
  });
  if (res.statusCode !== 201) throw new Error(`signup falhou: ${res.body}`);
  const me = (await client.get('/api/auth/me')).json();
  return { client, email, tenantId: me.activeTenant.id as string, userId: me.user.id as string };
}

/** Cria um usuário com o perfil indicado dentro de uma empresa existente e faz login. */
export async function addMember(env: TestEnv, tenantId: string, role: Role) {
  const email = uniqueEmail(role.toLowerCase());
  const user = await env.db.user.create({
    data: { name: `Membro ${role}`, email, passwordHash: await hashPassword('senha-forte-123') },
  });
  await env.db.membership.create({ data: { userId: user.id, tenantId, role } });
  const client = new Client(env.app);
  const res = await client.post('/api/auth/login', { email, password: 'senha-forte-123' });
  if (res.statusCode !== 200) throw new Error(`login falhou: ${res.body}`);
  return client;
}

export async function createCustomer(client: Client, name = 'João da Silva') {
  const res = await client.post('/api/customers', { name, phone: '(11) 98765-4321' });
  if (res.statusCode !== 201) throw new Error(`cliente falhou: ${res.body}`);
  return res.json().id as string;
}

export function quoteBody(customerId: string, over: Record<string, unknown> = {}) {
  return {
    customerId,
    title: 'Porcelanato da sala',
    validUntil: addDaysISO(todayISO(), 15),
    items: [{ description: 'Assentamento de porcelanato', unit: 'M2', quantity: '32', unitPriceCents: 5500 }],
    materials: [
      {
        description: 'Porcelanato 60x60',
        unit: 'm²',
        supply: 'CLIENT',
        itemIndex: 0,
        coefficient: '1',
        lossPercent: '10',
        packageSize: '2.5',
        packageLabel: 'caixa',
      },
      {
        description: 'Argamassa AC-III',
        unit: 'kg',
        supply: 'COMPANY_BILLED',
        itemIndex: 0,
        coefficient: '5',
        lossPercent: '0',
        packageSize: '20',
        packageLabel: 'saco',
        unitPriceCents: 4590,
      },
    ],
    costs: [
      { category: 'TEAM', description: 'Ajudante', quantity: '6', unit: 'diária', unitCostCents: 12000, chargeToClient: false },
      { category: 'FOOD', description: 'Almoço da equipe', quantity: '9', unit: 'refeição', unitCostCents: 2500, chargeToClient: false },
    ],
    ...over,
  };
}

/**
 * Extrai o texto de um PDF gerado pelo pdfkit (fontes padrão WinAnsi),
 * descompactando os fluxos e decodificando as strings hexadecimais.
 */
export function pdfToText(pdf: Buffer): string {
  const raw = pdf.toString('latin1');
  const out: string[] = [];
  const re = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    let content: string;
    try {
      content = inflateSync(Buffer.from(m[1]!, 'latin1')).toString('latin1');
    } catch {
      content = m[1]!;
    }
    const tj = /\[(.*?)\]\s*TJ/g;
    let t: RegExpExecArray | null;
    while ((t = tj.exec(content))) {
      const hex = [...t[1]!.matchAll(/<([0-9a-fA-F]*)>/g)].map((h) => Buffer.from(h[1]!, 'hex').toString('latin1')).join('');
      out.push(hex);
    }
  }
  return out.join(' ');
}
