# Reformar

SaaS de orçamentos e gestão de obras para pedreiros, mestres de obras, empreiteiros e pequenas construtoras.

**Situação:** Fases 1–4 implementadas (orçamentos, obras com medição e fotos, financeiro, estoque, assistente, assinatura via Asaas) e Fase 5 parcial (PWA e fila offline). Assistente e Asaas **dependem de credenciais** e não foram validados com os serviços reais. Detalhes em [docs/PLANO_IMPLEMENTACAO.md](docs/PLANO_IMPLEMENTACAO.md).

## Estrutura
```
packages/shared   domínio: dinheiro, cálculo do orçamento, validação (Zod), permissões, contratos
apps/api          Fastify + Prisma (PostgreSQL) + PDF (pdfkit)
apps/web          React + Vite (mobile-first)
e2e               Playwright (Chrome) + axe-core
docs              plano, decisões, modelo de dados, fluxos, API, Asaas, IA, critérios de aceite
```

## Requisitos
- Node.js 22+ (testado com 24) e npm 10+
- Docker (para o PostgreSQL local) — ou um PostgreSQL 15+ próprio
- Google Chrome (apenas para `npm run e2e`)

## Rodar localmente
```bash
npm install
cp .env.example apps/api/.env      # ajuste se necessário
npm run db:up                      # PostgreSQL 17 na porta 5433 (cria também reformar_test)
npm run db:migrate                 # aplica as migrations no banco de desenvolvimento
npm run dev                        # API em :3333 e web em http://localhost:5180
```
Opcional: `npm run db:seed:demo` cria uma empresa **de demonstração** (dados fictícios, marcada na interface) com login `demo@reformar.local` / `demonstracao123`.

Em desenvolvimento, o link de redefinição de senha aparece **no log da API** (`MAILER=console`). Não há envio real de e-mail.

## Qualidade
```bash
npm run lint        # ESLint
npm run typecheck   # TypeScript em todos os pacotes
npm test            # unitários (shared, web) + integração da API em PostgreSQL real (reformar_test)
npm run e2e         # jornada completa no Chrome (tela de celular) + acessibilidade
npm run check       # lint + typecheck + test + build
```
Os testes de integração exigem `DATABASE_URL_TEST` apontando para um banco cujo nome termina em `_test`: ele é **apagado** a cada execução.

## Produção
1. PostgreSQL gerenciado com backups automáticos e TLS.
2. Variáveis (ver `.env.example`): `NODE_ENV=production`, `DATABASE_URL`, `APP_ORIGIN` e `PUBLIC_APP_URL` com o domínio HTTPS, `COOKIE_SECURE=true` (obrigatório), `TRUST_PROXY=true` se houver proxy reverso, `SERVE_WEB_DIR=../web/dist`, `MAILER=none` (até haver provedor).
3. Build e migrations:
   ```bash
   npm ci
   npm run build
   npm run db:deploy -w @reformar/api     # prisma migrate deploy (não interativo)
   npm run start                          # node apps/api/dist/server.js
   ```
4. Coloque um proxy reverso com HTTPS (Caddy, Nginx ou o balanceador da plataforma) apontando para a porta `PORT`. Health check: `GET /api/health`.
5. Encerre com SIGTERM: a API fecha conexões de forma limpa.

6. Opcionais: assistente (`AI_PROVIDER=anthropic`, `ANTHROPIC_API_KEY`) e assinatura (`ASAAS_API_KEY`, `ASAAS_BASE_URL`, `ASAAS_WEBHOOK_TOKEN`) — ver `docs/ASSISTENTE_IA.md` e `docs/INTEGRACAO_ASAAS.md`. Administrador da plataforma: `npm run platform:admin -w @reformar/api -- email@dominio`.
7. Fotos e comprovantes ficam em `STORAGE_DIR` (disco): use volume persistente e inclua no backup. Com mais de uma instância, implemente o armazenamento S3 (interface `Storage`) e mova o worker de cobrança para fila distribuída.

**Ainda não configurado** (necessário antes de clientes reais): provedor de e-mail, monitoramento/alertas, textos jurídicos de termos e privacidade, validação do assistente e do Asaas com os serviços reais.

## Backup e restauração
Backup lógico (diário, com retenção ≥ 30 dias e cópia fora do provedor):
```bash
pg_dump --format=custom --no-owner --dbname="$DATABASE_URL" --file=reformar-$(date +%F).dump
```
Restauração (em banco **novo/vazio**, nunca sobre produção ativa):
```bash
createdb reformar_restore
pg_restore --no-owner --dbname=postgresql://.../reformar_restore reformar-AAAA-MM-DD.dump
# conferir: SELECT count(*) FROM "Tenant"; SELECT max("createdAt") FROM "AuditLog";
```
Teste a restauração ao menos uma vez por mês e registre o resultado. Os logotipos ficam no banco (incluídos no backup). **Fotos e comprovantes ficam em `STORAGE_DIR`**: copie essa pasta diariamente junto com o `pg_dump` (os registros `Attachment` apontam para esses arquivos).

**Rollback de versão:** as migrations do Prisma só avançam. Antes de aplicar uma migration destrutiva, faça backup. Para reverter, publique a versão anterior do código **e** uma nova migration compensatória; nunca edite migrations já aplicadas.

## Segurança (resumo)
Isolamento por empresa no servidor e no banco (FKs compostas), sessões revogáveis com hash, scrypt, CSRF (cabeçalho + Origin + SameSite), rate limit, helmet/CSP, validação Zod em toda entrada, uploads validados por assinatura binária, logs sem cookies/tokens e auditoria das ações. Detalhes em [docs/DECISOES_TECNICAS.md](docs/DECISOES_TECNICAS.md).
