import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, createTestEnv, signup, uniqueEmail, type TestEnv } from './helpers.js';

let env: TestEnv;
beforeAll(async () => {
  env = await createTestEnv();
});
afterAll(async () => env.close());

describe('cadastro e login', () => {
  it('cria conta, empresa (proprietário) e catálogo inicial sem preços', async () => {
    const { client } = await signup(env.app, 'Reformas Silva');
    const me = (await client.get('/api/auth/me')).json();
    expect(me.activeTenant.name).toBe('Reformas Silva');
    expect(me.activeTenant.role).toBe('OWNER');
    const services = (await client.get('/api/services')).json();
    expect(services.length).toBeGreaterThan(5);
    expect(services.every((s: { defaultPriceCents: number | null }) => s.defaultPriceCents === null)).toBe(true);
  });

  it('não guarda a senha em texto puro', async () => {
    const { email } = await signup(env.app);
    const user = await env.db.user.findUniqueOrThrow({ where: { email } });
    expect(user.passwordHash).not.toContain('senha-forte-123');
    expect(user.passwordHash.startsWith('scrypt$')).toBe(true);
  });

  it('exige aceite dos termos e valida campos com mensagens em português', async () => {
    const c = new Client(env.app);
    const res = await c.post('/api/auth/signup', { name: 'A', email: 'x', password: '123', companyName: '' });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.fields.email).toBe('E-mail inválido.');
    expect(body.fields.password).toContain('8 caracteres');
    expect(body.fields.acceptTerms).toBeTruthy();
  });

  it('recusa e-mail duplicado', async () => {
    const { email } = await signup(env.app);
    const c = new Client(env.app);
    const res = await c.post('/api/auth/signup', {
      name: 'Outro',
      email,
      password: 'senha-forte-123',
      companyName: 'Outra',
      acceptTerms: true,
    });
    expect(res.statusCode).toBe(409);
  });

  it('login com senha errada não revela se o e-mail existe', async () => {
    const { email } = await signup(env.app);
    const c = new Client(env.app);
    const wrong = await c.post('/api/auth/login', { email, password: 'errada-123' });
    const unknown = await c.post('/api/auth/login', { email: uniqueEmail(), password: 'errada-123' });
    expect(wrong.statusCode).toBe(401);
    expect(unknown.statusCode).toBe(401);
    expect(wrong.json().message).toBe(unknown.json().message);
  });

  it('logout revoga a sessão no servidor', async () => {
    const { client } = await signup(env.app);
    const cookie = client.cookie;
    await client.post('/api/auth/logout');
    const replay = new Client(env.app);
    replay.cookie = cookie;
    expect((await replay.get('/api/auth/me')).statusCode).toBe(401);
  });

  it('lista sessões e revoga as outras', async () => {
    const { client, email } = await signup(env.app);
    const other = new Client(env.app);
    await other.post('/api/auth/login', { email, password: 'senha-forte-123' });
    const sessions = (await client.get('/api/auth/sessions')).json();
    expect(sessions).toHaveLength(2);
    const res = await client.post('/api/auth/sessions/revoke-others');
    expect(res.json().revoked).toBe(1);
    expect((await other.get('/api/auth/me')).statusCode).toBe(401);
    expect((await client.get('/api/auth/me')).statusCode).toBe(200);
  });

  it('não permite revogar sessão de outro usuário', async () => {
    const a = await signup(env.app);
    const b = await signup(env.app);
    const sessionB = (await b.client.get('/api/auth/sessions')).json()[0].id;
    expect((await a.client.del(`/api/auth/sessions/${sessionB}`)).statusCode).toBe(404);
    expect((await b.client.get('/api/auth/me')).statusCode).toBe(200);
  });

  it('redefinição de senha: token único, expira sessões antigas', async () => {
    const { client, email } = await signup(env.app);
    const anon = new Client(env.app);
    await anon.post('/api/auth/password-reset/request', { email });
    const sent = env.mailer.sent.find((s) => s.to === email);
    expect(sent).toBeTruthy();
    const token = new URL(sent!.link).searchParams.get('token')!;
    const ok = await anon.post('/api/auth/password-reset/confirm', { token, password: 'nova-senha-456' });
    expect(ok.statusCode).toBe(200);
    // reutilização do token é recusada
    expect((await anon.post('/api/auth/password-reset/confirm', { token, password: 'outra-senha-789' })).statusCode).toBe(400);
    // sessão antiga foi encerrada
    expect((await client.get('/api/auth/me')).statusCode).toBe(401);
    expect((await anon.post('/api/auth/login', { email, password: 'nova-senha-456' })).statusCode).toBe(200);
  });

  it('pedido de redefinição para e-mail inexistente responde igual', async () => {
    const anon = new Client(env.app);
    const res = await anon.post('/api/auth/password-reset/request', { email: uniqueEmail() });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });
});

describe('proteção CSRF', () => {
  it('recusa alteração sem o cabeçalho do aplicativo', async () => {
    const { client } = await signup(env.app);
    const res = await env.app.inject({
      method: 'POST',
      url: '/api/customers',
      headers: { cookie: client.cookie!, 'content-type': 'application/json' },
      payload: JSON.stringify({ name: 'Cliente' }),
    });
    expect(res.statusCode).toBe(403);
  });

  it('recusa origem não permitida', async () => {
    const { client } = await signup(env.app);
    const res = await client.post('/api/customers', { name: 'Cliente' }, { origin: 'https://site-malicioso.example' });
    expect(res.statusCode).toBe(403);
  });

  it('rotas protegidas exigem login', async () => {
    const anon = new Client(env.app);
    expect((await anon.get('/api/quotes')).statusCode).toBe(401);
    expect((await anon.get('/api/customers')).statusCode).toBe(401);
  });
});
