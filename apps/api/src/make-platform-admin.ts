/**
 * Concede (ou remove) acesso ao painel da PLATAFORMA a um usuário existente.
 * Uso: npm run platform:admin -w @reformar/api -- email@exemplo.com [--remover]
 */
import { loadConfig } from './config.js';
import { createDb } from './db.js';
import { audit } from './lib/audit.js';

const [email, flag] = process.argv.slice(2);
if (!email) {
  console.error('Informe o e-mail do usuário.');
  process.exit(1);
}
const db = createDb(loadConfig().databaseUrl);
const grant = flag !== '--remover';
const user = await db.user.findUnique({ where: { email: email.toLowerCase() } });
if (!user) {
  console.error('Usuário não encontrado.');
  process.exit(1);
}
await db.user.update({ where: { id: user.id }, data: { isPlatformAdmin: grant } });
await audit(db, { tenantId: null, userId: user.id, action: grant ? 'platform.admin_granted' : 'platform.admin_revoked', entityType: 'User', entityId: user.id });
console.warn(`${email}: administrador da plataforma = ${grant}`);
await db.$disconnect();
