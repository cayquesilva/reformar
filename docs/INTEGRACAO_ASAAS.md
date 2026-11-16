# Integração Asaas — assinatura da plataforma (Fase 4)

> **Situação:** implementada e testada com provedor **simulado**. **Não validada** no sandbox real (sem credenciais neste ambiente). Antes de produção: criar conta sandbox, configurar as variáveis, cadastrar o webhook e executar o roteiro de validação abaixo.

## Finalidade
1. Cobrar a **assinatura da plataforma** das empresas clientes (implementado).
2. Cobrança dos clientes das obras pelas próprias empresas: **não implementado**. Exige módulo separado com a conta Asaas *da empresa* (subconta/chave própria), autorização explícita, responsabilidade pelas taxas e conciliação com `Receivable`. Pagamentos de obras **nunca** podem usar a chave da plataforma.

## O que foi conferido na documentação oficial (2026-11-05)
| Item | Valor |
|---|---|
| Sandbox | `https://api-sandbox.asaas.com` |
| Produção | `https://api.asaas.com` (conferido em 2026-11-13 em docs.asaas.com/reference/comece-por-aqui) |
| Teste de conexão | `GET /v3/customers?limit=1` (listar clientes; `limit` de 1 a 100) |
| Autenticação | cabeçalho `access_token` |
| Cliente | `POST /v3/customers` (`name`, `cpfCnpj` obrigatórios; `email`, `externalReference`) |
| Assinatura | `POST /v3/subscriptions` (`customer`, `billingType` UNDEFINED/BOLETO/CREDIT_CARD/PIX, `value`, `nextDueDate`, `cycle`, `description`, `externalReference`) |
| Consulta | `GET /v3/subscriptions/{id}` (status ACTIVE/EXPIRED/INACTIVE, `deleted`) |
| Cobranças | `GET /v3/subscriptions/{id}/payments` (status PENDING/RECEIVED/CONFIRMED/OVERDUE/REFUNDED…, `invoiceUrl`) |
| Cancelar | `DELETE /v3/subscriptions/{id}` |
| Webhook | cabeçalho `asaas-access-token` = `authToken` do webhook; responder 200 após persistir; entrega "pelo menos uma vez"; idempotência pelo `id` do evento; fila pausa após 15 falhas |
| Eventos usados | `PAYMENT_CONFIRMED`, `PAYMENT_RECEIVED` (ativa), `PAYMENT_OVERDUE`, `PAYMENT_REFUNDED`, `PAYMENT_CHARGEBACK_REQUESTED` (atraso/tolerância), `SUBSCRIPTION_DELETED`, `SUBSCRIPTION_INACTIVATED` (cancela); demais são registrados como ignorados |

## Fluxo implementado
1. Nova empresa → `TRIALING` por `BILLING_TRIAL_DAYS` no plano ativo mais barato (se houver planos e Asaas configurado).
2. Proprietário escolhe plano + CPF/CNPJ + forma de pagamento → cria cliente e assinatura no Asaas (1º vencimento após teste/período pago) → abre o link de pagamento do Asaas. **O acesso não muda pelo retorno do navegador.**
3. Webhook autenticado → evento gravado (único) → processado: pagamento confirmado com valor ≥ preço do plano → `ACTIVE`, período pago avança (nunca recua).
4. Atraso → `PAST_DUE` com tolerância (`BILLING_GRACE_DAYS`) → depois **somente leitura** (402 em escrita; consulta, exportação, conta e assinatura liberados). Nenhum dado é apagado.
5. Pagamento após atraso → volta a `ACTIVE`.
6. Cancelamento → `DELETE` no Asaas; acesso completo até o fim do período pago.
7. Worker: reprocessa eventos `FAILED` a cada minuto (até 10 tentativas) e reconcilia assinaturas 1×/dia; botão "Atualizar situação" e reconciliação pelo painel.

## Configuração
**Pelo painel (recomendado):** `/plataforma` → **Meios de pagamento** → cartão Asaas: ambiente (sandbox/produção), chave de API, token do webhook, **Testar conexão** e o endereço do webhook para copiar. As credenciais ficam cifradas com `SECRETS_KEY` e nunca voltam para a tela. O que está salvo no painel tem prioridade sobre as variáveis abaixo. O PayPal também pode ser oferecido (ver `INTEGRACAO_PAYPAL.md`).

**Pelas variáveis do servidor (forma antiga, ainda aceita enquanto o Asaas não for salvo no painel):**
```
ASAAS_API_KEY=...            # sandbox ou produção (somente servidor)
ASAAS_BASE_URL=...           # obrigatório em produção
ASAAS_WEBHOOK_TOKEN=...      # 32+ caracteres, sem espaços, diferente da chave
BILLING_TRIAL_DAYS=14
BILLING_GRACE_DAYS=7
```
Webhook no painel do Asaas: URL `https://SEU_DOMINIO/api/webhooks/asaas`, token = `ASAAS_WEBHOOK_TOKEN`, eventos de cobrança e assinatura.

Criar o administrador da plataforma: `npm run platform:admin -w @reformar/api -- voce@exemplo.com`. Os planos (preço, limites, franquia de IA) são cadastrados no painel `/plataforma`.

## Testes automatizados (`apps/api/test/billing.test.ts`)
Teste grátis; contratação sem liberar acesso; webhook com token inválido recusado; valor menor não ativa; ativação; **evento duplicado processado uma vez**; limites do plano; tolerância → somente leitura com exportação; recuperação; reconciliação corrigindo webhook perdido; cancelamento; painel sem dados de negócio.

## Roteiro de validação no sandbox (a executar)
1. Configurar variáveis com chave sandbox e cadastrar o webhook.
2. Criar plano no painel; contratar com PIX; pagar no sandbox → conferir `ACTIVE` e evento `PROCESSED`.
3. Reenviar o mesmo evento pelo painel do Asaas → conferir que não duplica.
4. Gerar cobrança vencida (sandbox) → conferir `PAST_DUE` e aviso; após tolerância, modo leitura.
5. Cancelar → conferir `DELETE` no Asaas e acesso até o fim do período.

## Decisões pendentes do produto
Preços e limites dos planos; plano anual; duração do teste e da tolerância; cobrança proporcional na troca de plano; nota fiscal da assinatura.
