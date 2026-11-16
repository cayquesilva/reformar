# Integração PayPal — assinatura da plataforma

> **Situação:** implementada e testada com provedor **simulado** (`apps/api/test/payments.test.ts`). **Não validada** no sandbox real do PayPal (sem credenciais neste ambiente). Antes de produção, execute o roteiro de validação no fim deste documento.

## Onde configurar
Painel da plataforma (`/plataforma` → **Meios de pagamento** → cartão PayPal):

| Campo | O que é |
|---|---|
| Oferecer para novas assinaturas | Liga/desliga o PayPal na tela de assinatura das empresas. Desligar não abandona quem já assina por ele. |
| Ambiente | Testes (sandbox) ou Produção |
| Client ID / Secret | Credenciais do app REST criado em developer.paypal.com (ficam cifradas; nunca voltam para a tela) |
| ID do webhook | ID do webhook cadastrado no app do PayPal (usado para conferir a assinatura digital de cada aviso) |
| Moeda dos planos | Padrão `BRL`. Pela regra do PayPal, BRL só funciona para contas PayPal do Brasil |

O servidor precisa de `SECRETS_KEY` (32 bytes em base64) para guardar as credenciais. Sem ela o painel mostra o aviso e não salva.

No app do PayPal, cadastre o webhook com o endereço mostrado no painel (`https://SEU_DOMINIO/api/webhooks/paypal`) e marque os eventos:
`BILLING.SUBSCRIPTION.ACTIVATED`, `BILLING.SUBSCRIPTION.CANCELLED`, `BILLING.SUBSCRIPTION.EXPIRED`, `BILLING.SUBSCRIPTION.SUSPENDED`, `BILLING.SUBSCRIPTION.PAYMENT.FAILED`, `PAYMENT.SALE.COMPLETED`, `PAYMENT.SALE.REFUNDED`, `PAYMENT.SALE.REVERSED`.

## O que foi conferido na documentação oficial (2026-11-13)
| Item | Valor | Fonte |
|---|---|---|
| URLs | sandbox `https://api-m.sandbox.paypal.com` · produção `https://api-m.paypal.com` | developer.paypal.com/api/rest/requests/ |
| Token | `POST /v1/oauth2/token`, Basic `client_id:secret`, `grant_type=client_credentials` → `access_token`, `expires_in` | /api/rest/authentication/ |
| Produto | `POST /v1/catalogs/products` `{name, type: SERVICE}` → `id` | /api/catalog-products/v1/products-create |
| Plano | `POST /v1/billing/plans` `{product_id, name, billing_cycles[{frequency{interval_unit MONTH/YEAR, interval_count}, tenure_type REGULAR, sequence, total_cycles 0, pricing_scheme.fixed_price{value, currency_code}}], payment_preferences}` | /api/subscriptions/v1/plans-create |
| Assinatura | `POST /v1/billing/subscriptions` `{plan_id, start_time, custom_id, application_context}` → `id`, `status`, `links[]` | /api/subscriptions/v1/subscriptions-create |
| Consulta | `GET /v1/billing/subscriptions/{id}` → `status`, `plan_id`, `custom_id`, `billing_info.last_payment{amount, time}`, `next_billing_time`, `failed_payments_count` | /api/subscriptions/v1/subscriptions-get |
| Cancelar | `POST /v1/billing/subscriptions/{id}/cancel` `{reason}` → 204 | /api/subscriptions/v1/subscriptions-cancel |
| Webhook | `POST /v1/notifications/verify-webhook-signature` com cabeçalhos `PAYPAL-AUTH-ALGO`, `PAYPAL-CERT-URL`, `PAYPAL-TRANSMISSION-ID`, `PAYPAL-TRANSMISSION-SIG`, `PAYPAL-TRANSMISSION-TIME`, `webhook_id` e o evento → `verification_status` | /api/webhooks/v1/verify-webhook-signature-post |
| Idempotência | cabeçalho `PayPal-Request-Id` nos POST de criação (guardado 72 h) | páginas de criação acima |
| Eventos | nomes listados acima | /api/rest/webhooks/event-names/ |

## NÃO confirmado na documentação lida (validar no sandbox)
- O `rel` do link de aprovação no retorno da criação da assinatura. O código procura `rel = "approve"`; se não vier, a assinatura criada é cancelada e o usuário vê um erro claro (nada fica pela metade).
- A lista completa de status da assinatura. Só `ACTIVE` e `APPROVAL_PENDING` aparecem nas páginas. O código trata `CANCELLED`/`EXPIRED` como cancelada e `SUSPENDED` como atraso (nomes dos eventos `BILLING.SUBSCRIPTION.*`); status desconhecido não muda nada.
- `application_context.return_url/cancel_url` aparecem como obsoletos, sem substituto indicado; o guia atual usa o SDK de JavaScript no navegador, que a política de segurança do site (`script-src 'self'`) não carrega. Por isso o fluxo usa o link de aprovação.
- O corpo dos webhooks. Por isso o evento **só avisa**: o servidor identifica a assinatura (`resource.id` em `BILLING.SUBSCRIPTION.*`, `resource.billing_agreement_id` em `PAYMENT.SALE.*`) e consulta o estado real com `GET /v1/billing/subscriptions/{id}`.

## Fluxo implementado
1. Empresa escolhe o plano e **PayPal** → o servidor garante o produto e o plano equivalentes no PayPal (criados uma vez por plano/preço/ciclo/ambiente; preço novo ⇒ plano novo lá) → cria a assinatura com `custom_id` = id da empresa e `start_time` no fim do teste/período pago (00:00 de São Paulo) → devolve o link de aprovação.
2. O navegador vai ao PayPal e volta para `/assinatura?paypal=ok` (ou `cancelado`). Na volta a tela consulta a situação. **O acesso não muda pelo retorno do navegador.**
3. Webhook com assinatura digital válida → evento gravado (id único) → reconciliação pelo `GET`:
   - `ACTIVE` com último pagamento na moeda configurada e valor ≥ preço do plano contratado → `ACTIVE` e o período pago avança (nunca recua);
   - `ACTIVE` sem pagamento e com falhas → atraso com tolerância;
   - `SUSPENDED` → atraso com tolerância; `CANCELLED`/`EXPIRED` → cancelada, acesso até o fim do período pago.
4. Troca de meio de pagamento: a assinatura antiga do Asaas só é encerrada quando a do PayPal fica ativa (ninguém fica sem assinatura se desistir no meio). Contratar pelo Asaas cancela uma assinatura PayPal pendente.
5. Cancelamento pela tela → `POST .../cancel` no PayPal.
6. Worker: reprocessa eventos com falha e reconcilia assinaturas PayPal 1×/dia, junto com as do Asaas.

## Testes automatizados (`apps/api/test/payments.test.ts`)
Só a administração vê e altera; credenciais exigidas para ligar; credenciais cifradas e nunca devolvidas (nem no log de auditoria); teste de conexão; contratação cria produto/plano/assinatura com `start_time` após o teste; plano reaproveitado; webhook com assinatura inválida recusado e não gravado; pagamento em outra moeda não libera acesso; pagamento confirmado libera e evento repetido não duplica; evento de assinatura desconhecida ignorado com motivo; cancelamento; Asaas configurado pelo painel passa a valer para webhook e contratação; desligar um meio tira das novas contratações; sem `SECRETS_KEY` o painel não salva.

## Roteiro de validação no sandbox (a executar)
1. Criar app REST no sandbox do PayPal; cadastrar o webhook (eventos acima); preencher Client ID, Secret e ID do webhook no painel (ambiente Testes); **Testar conexão**.
2. Criar um plano no painel; numa empresa em teste, contratar pelo PayPal; aprovar com uma conta compradora do sandbox.
3. Conferir: link de aprovação veio (rel `approve`); volta para `/assinatura?paypal=ok`; após o pagamento do sandbox, evento `PAYMENT.SALE.COMPLETED` → `PROCESSED` e assinatura `ACTIVE`.
4. Reenviar o mesmo evento pelo painel do PayPal → não duplica.
5. Cancelar pela tela → assinatura cancelada no PayPal; acesso até o fim do período.
6. Registrar no documento os status reais vistos e ajustar o código se algum nome divergir.
