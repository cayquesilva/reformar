import { execSync } from 'node:child_process';
import { config as loadEnv } from 'dotenv';
import pg from 'pg';

/** Aplica migrations no banco de TESTE e limpa os dados antes da suíte. */
export default async function setup() {
  loadEnv({ quiet: true });
  const url = process.env.DATABASE_URL_TEST;
  if (!url) throw new Error('Defina DATABASE_URL_TEST (veja .env.example).');
  if (!/_test\b/.test(new URL(url).pathname)) {
    throw new Error('Por segurança, DATABASE_URL_TEST precisa apontar para um banco cujo nome termina em _test.');
  }
  execSync('npx prisma migrate deploy', { env: { ...process.env, DATABASE_URL: url }, stdio: 'pipe' });

  const client = new pg.Client({ connectionString: url });
  await client.connect();
  const { rows } = await client.query<{ tablename: string }>(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'",
  );
  if (rows.length) {
    await client.query(`TRUNCATE ${rows.map((r) => `"${r.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);
  }
  await client.end();
}
