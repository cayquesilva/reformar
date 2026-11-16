import { randomBytes } from 'node:crypto';
import { defineConfig, devices } from '@playwright/test';

/**
 * Testes ponta a ponta no navegador real (Chrome instalado na máquina).
 * Sobe API e front-end em portas DEDICADAS (3340/5190) para não reutilizar outros servidores locais.
 * Usa o banco de DESENVOLVIMENTO; cada execução cria contas novas com e-mails aleatórios.
 */
const API_PORT = 3340;
const WEB_PORT = 5190;
const WEB_URL = `http://localhost:${WEB_PORT}`;
// Chave de cifra só desta execução (o painel de meios de pagamento precisa dela; os testes não salvam credenciais).
const SECRETS_KEY = randomBytes(32).toString('base64');

export default defineConfig({
  testDir: '.',
  timeout: 90_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  outputDir: './test-results',
  use: {
    baseURL: WEB_URL,
    channel: 'chrome',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
  },
  projects: [
    { name: 'celular', testIgnore: ['tools/**'], use: { ...devices['Pixel 7'], channel: 'chrome' } },
    // Revisão visual sob demanda (SCREENS=1): fotografa telas em desktop e celular.
    ...(process.env.SCREENS ? [{ name: 'telas', testMatch: ['tools/**/*.spec.ts'], use: { channel: 'chrome' } }] : []),
  ],
  webServer: [
    {
      command: 'npx tsx --env-file-if-exists=.env src/server.ts',
      cwd: '../apps/api',
      url: `http://localhost:${API_PORT}/api/health`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: { PORT: String(API_PORT), APP_ORIGIN: WEB_URL, PUBLIC_APP_URL: WEB_URL, LOG_LEVEL: 'warn', SECRETS_KEY },
    },
    {
      command: 'npx vite',
      cwd: '../apps/web',
      url: WEB_URL,
      reuseExistingServer: false,
      timeout: 60_000,
      env: { WEB_PORT: String(WEB_PORT), API_URL: `http://localhost:${API_PORT}` },
    },
  ],
});
