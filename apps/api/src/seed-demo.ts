/**
 * Cria uma empresa de DEMONSTRAÇÃO com dados fictícios, claramente identificada (Tenant.isDemo = true).
 * Não altera nenhuma empresa real. Uso: npm run db:seed:demo
 *
 * Login criado: demo@reformar.local / demonstracao123 (somente ambiente local).
 */
import { addDaysISO, todayISO } from '@reformar/shared';
import { loadConfig } from './config.js';
import { createDb } from './db.js';
import { hashPassword } from './lib/crypto.js';
import { createQuote } from './modules/quotes/service.js';
import { DEFAULT_SERVICES } from './modules/catalog/default-services.js';

const config = loadConfig();
if (config.isProd) {
  console.error('Seed de demonstração não roda em produção.');
  process.exit(1);
}
const db = createDb(config.databaseUrl);
const EMAIL = 'demo@reformar.local';

const existing = await db.user.findUnique({ where: { email: EMAIL } });
if (existing) {
  console.warn('Usuário de demonstração já existe. Nada a fazer.');
  await db.$disconnect();
  process.exit(0);
}

const user = await db.user.create({
  data: { name: 'Usuário Demonstração', email: EMAIL, passwordHash: await hashPassword('demonstracao123') },
});
const tenant = await db.tenant.create({
  data: {
    name: 'DEMONSTRAÇÃO - Reformas Exemplo',
    isDemo: true,
    termsAcceptedAt: new Date(),
    profile: {
      create: {
        tradeName: 'DEMONSTRAÇÃO - Reformas Exemplo',
        phone: '11900000000',
        city: 'Cidade Exemplo',
        state: 'SP',
        pdfFooter: 'Empresa fictícia criada para demonstração.',
        defaultPaymentTerms: '50% na entrada e 50% na entrega.',
        defaultExclusions: 'Materiais não listados, retirada de entulho e serviços elétricos.',
      },
    },
    memberships: { create: { userId: user.id, role: 'OWNER' } },
  },
});
await db.serviceCatalogItem.createMany({ data: DEFAULT_SERVICES.map((s) => ({ ...s, tenantId: tenant.id })) });
const customer = await db.customer.create({
  data: { tenantId: tenant.id, name: 'Cliente Fictício (demonstração)', phone: '11900000001' },
});

await createQuote(
  db,
  { tenantId: tenant.id, userId: user.id, role: 'OWNER', permissions: [], ip: '127.0.0.1' },
  {
    customerId: customer.id,
    title: 'EXEMPLO - Porcelanato da sala',
    description: 'Orçamento fictício para conhecer o sistema.',
    siteAddress: null,
    siteCity: null,
    siteState: null,
    validUntil: addDaysISO(todayISO(), 15),
    paymentTerms: '50% na entrada e 50% na entrega.',
    exclusions: null,
    notes: null,
    discountType: 'NONE',
    discountPercent: null,
    discountCents: null,
    taxPercent: '0',
    contingencyPercent: '0',
    items: [{ serviceId: null, description: 'Assentamento de porcelanato', unit: 'M2', quantity: '32', unitPriceCents: 5500, notes: null }],
    materials: [
      {
        description: 'Porcelanato (exemplo)',
        unit: 'm²',
        supply: 'CLIENT',
        itemIndex: 0,
        coefficient: '1',
        baseQuantity: null,
        lossPercent: '10',
        packageSize: '2.5',
        packageLabel: 'caixa',
        unitPriceCents: null,
        notes: null,
      },
    ],
    costs: [
      { category: 'TEAM', description: 'Ajudante (exemplo)', quantity: '6', unit: 'diária', unitCostCents: 12000, chargeToClient: false },
    ],
  },
);

console.warn(`Empresa de demonstração criada. Login: ${EMAIL} / demonstracao123`);
await db.$disconnect();
