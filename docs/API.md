# API HTTP (v0 — Fase 1)

Base: `/api`. JSON UTF-8. Autenticação por cookie de sessão `rf_session` (httpOnly).

**Obrigatório em POST/PUT/DELETE:** cabeçalho `X-Reformar-Client: web` (proteção CSRF). Se houver `Origin`, ela precisa estar em `APP_ORIGIN`.

**Convenções:** dinheiro em **centavos inteiros** (`unitPriceCents: 5500` = R$ 55,00); quantidades e percentuais como **string decimal com ponto** (`"32.5"`, `"10"`); datas `AAAA-MM-DD`.

**Erros:** `{ "error": "CODIGO", "message": "texto para o usuário", "fields": { "items.0.quantity": "..." } }`. 400 validação · 401 sem login · 403 sem permissão/CSRF · 404 não encontrado (também para recursos de outra empresa) · 409 conflito (`STALE`, `LOCKED`, `EXPIRED`, `ALREADY_APPROVED`, `IN_PROGRESS`) · 429 limite de tentativas.

**Idempotência:** `Idempotency-Key: <8–100 caracteres [A-Za-z0-9_-]>` em `POST /quotes`, `/quotes/:id/approve`, `/quotes/:id/duplicate`. Reenvio devolve a mesma resposta (`Idempotent-Replayed: true`).

## Sistema
| Método | Rota | Descrição |
|---|---|---|
| GET | `/health` | Verifica API e banco |
| GET | `/config` | Recursos disponíveis (`passwordResetEmail`, `voiceAssistant`, `subscriptions`) |

## Autenticação
| Método | Rota | Corpo / observação |
|---|---|---|
| POST | `/auth/signup` | `{name, email, password, companyName, acceptTerms: true}` → cria usuário, empresa (OWNER), catálogo; abre sessão |
| POST | `/auth/login` | `{email, password}` |
| POST | `/auth/logout` | revoga a sessão atual |
| GET | `/auth/me` | usuário, empresa ativa (perfil e permissões), vínculos |
| POST | `/auth/switch-tenant` | `{tenantId}` — só empresas com vínculo ativo |
| GET | `/auth/sessions` | sessões ativas |
| DELETE | `/auth/sessions/:id` | revoga uma sessão própria |
| POST | `/auth/sessions/revoke-others` | revoga as demais |
| POST | `/auth/change-password` | `{currentPassword, newPassword}`; revoga outras sessões |
| POST | `/auth/password-reset/request` | `{email}`; resposta igual exista ou não; `{ok:false, reason:'EMAIL_NOT_CONFIGURED'}` sem provedor |
| POST | `/auth/password-reset/confirm` | `{token, password}`; revoga todas as sessões |

## Empresa — `company:read` / `company:manage`
| Método | Rota | |
|---|---|---|
| GET | `/company` | perfil |
| PUT | `/company` | perfil completo (ver `companyProfileSchema`) |
| PUT | `/company/logo` | corpo binário `image/png` ou `image/jpeg` (≤ 512 KB, validado por assinatura) |
| GET | `/company/logo` | imagem |
| DELETE | `/company/logo` | |

## Clientes — `customer:read` / `customer:write`
| Método | Rota | |
|---|---|---|
| GET | `/customers?q=&page=&pageSize=` | busca por nome, telefone ou documento |
| POST | `/customers` | `customerSchema` |
| GET | `/customers/:id` | inclui orçamentos do cliente (se `quote:read`) |
| PUT | `/customers/:id` | |
| DELETE | `/customers/:id` | exclusão lógica |

## Catálogo — `catalog:read` / `catalog:write`
| Método | Rota | |
|---|---|---|
| GET | `/services?all=true` | ativos (ou todos) |
| POST | `/services` | `{name, unit, defaultPriceCents?, description?, active}` |
| PUT | `/services/:id` | |

## Orçamentos
| Método | Rota | Permissão | |
|---|---|---|---|
| GET | `/quotes?status=DRAFT\|SENT\|APPROVED\|REFUSED\|EXPIRED\|OPEN&q=&customerId=` | `quote:read` | |
| POST | `/quotes` | `quote:write` | `quoteContentSchema` → `{id, number}`; totais calculados no servidor |
| GET | `/quotes/:id` | `quote:read` | conteúdo, cálculo (se `quote:view_costs`), revisões, aprovação, histórico, `lockVersion` |
| PUT | `/quotes/:id` | `quote:write` | `{lockVersion, content}`; se já emitido, abre nova revisão |
| DELETE | `/quotes/:id` | `quote:write` | só rascunho nunca emitido |
| POST | `/quotes/:id/send` | `quote:send` | emite (snapshot imutável da revisão) |
| POST | `/quotes/:id/approve` | `quote:approve` | `{approvedByName, channel, approvedOn, note?}` |
| POST | `/quotes/:id/refuse` | `quote:approve` | `{reason?}` (só SENT) |
| POST | `/quotes/:id/duplicate` | `quote:write` | novo rascunho |
| POST | `/quotes/:id/share` | `quote:send` | `{mode: detailed\|summary}` → `{url, expiresAt, whatsappUrl, message}` |
| GET | `/quotes/:id/pdf?mode=detailed\|summary\|internal&revision=&download=1` | `quote:read` (+ `quote:view_costs` p/ interno) | rascunho = prévia marcada |

## Público (sem login)
| Método | Rota | |
|---|---|---|
| GET | `/public/quotes/:token/pdf` | PDF da revisão do link (nunca o modo interno); 30 req/min/IP |

## Painel
| Método | Rota | |
|---|---|---|
| GET | `/dashboard` | aguardando resposta, aprovados no mês, rascunhos, vencidos, últimos orçamentos |

Os tipos de resposta estão em [`packages/shared/src/api-types.ts`](../packages/shared/src/api-types.ts) e os corpos validados em [`packages/shared/src/schemas.ts`](../packages/shared/src/schemas.ts).

## Obras (Fase 2) — `project:read` / `project:write` / `project:field` / `measurement:confirm`
| Método | Rota | |
|---|---|---|
| GET | `/projects?status=ACTIVE&q=` | lista com andamento (valores só com `finance:read`) |
| POST | `/projects/from-quote` | `{quoteId, confirm: true, startDate?, expectedEndDate?}` (idempotente) |
| POST | `/projects` | obra avulsa |
| GET/PUT | `/projects/:id` | detalhe (etapas, materiais, finanças, alertas) / situação e prazos |
| POST/PUT/DELETE | `/projects/:id/stages[/:stageId]` | etapas |
| GET/POST | `/projects/:id/measurements` | medições (criar = rascunho, idempotente) |
| PUT/DELETE | `/projects/:id/measurements/:mid` | só rascunho |
| POST | `/projects/:id/measurements/:mid/confirm` | `{receivable?: {amountCents, dueDate}}` |
| GET/POST/DELETE | `/projects/:id/diary[/:entryId]` | diário |
| GET/POST | `/projects/:id/photos?stageId&measurementId&diaryEntryId&caption` | POST com corpo binário JPEG/PNG/WebP até 10 MB |
| PUT | `/projects/:id/materials/:pmId` | `{materialId}` vincular ao estoque |
| GET/DELETE | `/attachments/:id` | arquivo |

## Financeiro — `finance:read` / `finance:write`
| Método | Rota | |
|---|---|---|
| GET/POST | `/expenses` | filtros `projectId, status (OPEN), category, from, to, noProject`; POST aceita `allocations` (rateio) e Idempotency-Key |
| PUT | `/expenses/:id` | |
| POST | `/expenses/:id/pay`, `/expenses/:id/cancel`, `/expenses/:id/receipts` | |
| GET/POST | `/receivables` | |
| POST | `/projects/:id/payment-plan` | `{downPaymentCents, downPaymentDate, installments, firstInstallmentDate, confirm: true}` |
| POST | `/receivables/:id/payments` | pagamento (parcial) com Idempotency-Key |
| POST | `/receivable-payments/:id/reverse`, `/receivables/:id/cancel` | `{reason}` |
| GET | `/finance/overview`, `/projects/:id/finance` | |
| GET | `/finance/export/expenses.csv`, `/finance/export/receivables.csv` | |

## Estoque — `stock:read` / `stock:write`
`GET/POST /materials`, `PUT /materials/:id`, `GET/POST /stock/locations`, `GET /stock/balances`, `GET/POST /stock/movements` (não aceita `IN`), `POST /stock/purchases` (exige também `finance:write`).

## Assistente — `ai:use`
`GET /ai/usage`, `GET /ai/interactions`, `POST /ai/messages {text, previousId?}`, `POST /ai/interactions/:id/confirm-expense` (corpo = gasto conferido; exige `finance:write`), `POST /ai/interactions/:id/applied {quoteId}`, `POST /ai/interactions/:id/reject`.

## Assinatura — `billing:manage`
`GET /billing` (inclui `providers` oferecidos e `provider` atual), `POST /billing/subscribe {provider: 'ASAAS', planId, billingType, cpfCnpj}` ou `{provider: 'PAYPAL', planId}` (sem `provider` = Asaas, compatibilidade) → `{provider, invoiceUrl, approveUrl, nextDueDate}`, `POST /billing/sync`, `POST /billing/cancel {confirm: true}`.
`POST /webhooks/asaas` — sem cookie; cabeçalho `asaas-access-token`.
`POST /webhooks/paypal` — sem cookie; assinatura digital conferida na API do PayPal (cabeçalhos `PAYPAL-*` + id do webhook do painel).
Assinatura inativa: escrita retorna **402 `SUBSCRIPTION_INACTIVE`** (exceto auth, assinatura e webhooks). Limite do plano: **402 `PLAN_LIMIT`**.

## Exportação — `company:manage`
`GET /company/export` — JSON completo da empresa (sempre disponível).

## Plataforma — usuário `isPlatformAdmin`
`GET /platform/payment-providers` (estado de Asaas e PayPal; credenciais só como "salva" + 4 últimos caracteres), `PUT /platform/payment-providers/:provider {enabled, environment, credentials?, settings?}` (campo vazio = manter; 503 `SECRETS_KEY_MISSING` sem chave no servidor), `POST /platform/payment-providers/:provider/test`,
`GET /platform/overview`, `GET/POST/PUT /platform/plans`, `GET /platform/tenants` (somente indicadores operacionais), `POST /platform/tenants/:id/reconcile`, `GET /platform/events?status=`, `POST /platform/events/:id/retry`.
