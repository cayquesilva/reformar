# Modelo de dados

Fonte da verdade do que está implementado: [`apps/api/prisma/schema.prisma`](../apps/api/prisma/schema.prisma) e migrations em `apps/api/prisma/migrations`.

## Convenções
- Chaves `uuid`. Toda tabela de negócio tem `tenantId`; índices começam por `tenantId`.
- **FKs compostas `(tenantId, id)`** entre entidades da mesma empresa: o banco impede, por exemplo, orçamento da empresa A apontando para cliente da empresa B.
- Dinheiro: `BigInt` em centavos. Quantidade: `Decimal(14,4)`. Coeficiente: `Decimal(16,6)`. Percentual: `Decimal(5,2)`. Datas de negócio sem hora: `@db.Date`.
- Exclusão lógica (`deletedAt`) onde há histórico a preservar (clientes, orçamentos).
- Operações financeiras e de status em **transação** única, com registro em `AuditLog`.

## Implementado (Fase 1)

| Entidade | Papel | Pontos de atenção |
|---|---|---|
| `User` | Pessoa que acessa | e-mail único, senha scrypt, `isPlatformAdmin` reservado ao painel da plataforma (Fase 4) |
| `Tenant` | Empresa (isolamento) | `isDemo` marca dados fictícios; `quoteSeq` = numeração sequencial atômica |
| `CompanyProfile` | Identidade e padrões do PDF | logo em bytea (≤ 512 KB) |
| `Membership` | Vínculo usuário↔empresa com perfil | único por (usuário, empresa); `active` |
| `Session` | Sessão revogável | guarda só hash do token; `activeTenantId` |
| `PasswordResetToken` | Recuperação de acesso | hash, uso único, 1 h |
| `Customer` | Cliente PF/PJ | exclusão lógica |
| `ServiceCatalogItem` | Serviço do catálogo da empresa | preço padrão opcional; nome único por empresa |
| `Quote` | Orçamento (cabeçalho editável) | `status`, `currentRevision`, `lockVersion`, `totalCents` (cache) |
| `QuoteItem` | Serviço do orçamento | qtd × preço de mão de obra |
| `QuoteMaterial` | Material | fornecimento (cliente/cobrado/incluído), base manual ou `itemIndex × coefficient`, perda, embalagem |
| `QuoteCost` | Custo da obra | categoria, `chargeToClient` |
| `QuoteVersion` | Revisão emitida | `snapshot` JSON imutável (empresa, cliente, conteúdo, cálculo) |
| `QuoteApproval` | Evidência de aceite | quem aprovou, canal, data, nota, quem registrou, revisão |
| `QuoteShareLink` | Link público de PDF | hash do token, expiração, revogação, contagem de acessos |
| `AuditLog` | Trilha de auditoria | ação, entidade, usuário, IP, dados resumidos (sem segredos) |
| `IdempotencyKey` | Evita gravação duplicada | único por (tenant, usuário, chave) |

### Ciclo do orçamento
```
DRAFT ──emitir──▶ SENT ──aprovar──▶ APPROVED (travado; só duplicar)
  ▲                 │ └─recusar──▶ REFUSED
  └──editar (nova revisão)◀─┘           │
DRAFT ──aprovar (emite automaticamente)──▶ APPROVED
SENT + validade vencida ⇒ exibido como EXPIRED (derivado)
```

## Implementado — Fase 2 (obras, financeiro, estoque)
| Entidade | Papel | Pontos de atenção |
|---|---|---|
| `Project` | Obra | vínculo `(quoteId, quoteRevision)`; `contractTotalCents` imutável por recebimentos; custo/imposto/reserva previstos |
| `ProjectStage` | Etapa medível | `measuredQuantity` ≤ `plannedQuantity` garantido no banco na confirmação |
| `Measurement` / `MeasurementItem` | Medição do período | DRAFT → CONFIRMED (imutável); valor por item fixado na confirmação |
| `DiaryEntry` | Diário de obra | — |
| `Attachment` | Foto/comprovante | binário no `Storage`; FKs compostas para obra/etapa/medição/diário/despesa |
| `Expense` | Compromisso financeiro (gasto) | PLANNED/COMMITTED/PAID/CANCELED; `groupId` no rateio |
| `Receivable` / `ReceivablePayment` | A receber e pagamentos (parciais) | estorno preserva registro; `measurementId` único |
| `Material`, `StockLocation`, `StockMovement` | Estoque físico | local por obra; movimento não gera custo; compra liga `expenseId` |
| `ProjectMaterial` | Material previsto | quantidade na unidade do orçamento **e** em embalagens |

## Implementado — Fase 3 (assistente)
`AiInteraction` (pedido, saída validada, proposta, status PROPOSED/ANSWERED/EXECUTED/REJECTED, resultado, modelo, tokens) e `AiUsage` (consumo mensal por empresa).

## Implementado — Fase 4 (assinatura da plataforma)
`SubscriptionPlan` (preço, ciclo, limites, franquia de IA), `TenantSubscription` (status, teste, período pago, tolerância, `provider` ASAAS/PAYPAL, ids do Asaas e do PayPal), `PaymentProviderEvent` (evento bruto, único por provedor+id, status de processamento, tentativas), `PaymentProviderConfig` (meio de pagamento configurado no painel: ligado, ambiente, credenciais cifradas, dados não secretos como o id do webhook do PayPal, último teste), `PaymentProviderPlan` (plano criado no PayPal para cada plano/preço/ciclo/ambiente).

## Planejado
- `PurchaseOrder` / `PurchaseOrderItem` (pedido com recebimento parcial), despesas recorrentes, `Worker`/`Timesheet` (agenda e ponto da equipe), `Notification`.
- Cobrança dos clientes das obras via Asaas: entidades próprias por empresa (conta/subconta), nunca na conta da plataforma.
