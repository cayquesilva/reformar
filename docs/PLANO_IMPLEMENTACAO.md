# Plano de implementação

## 1. Visão
SaaS multiempresa para pedreiros, mestres de obras, empreiteiros e pequenas construtoras: do orçamento simples ao controle de várias obras com equipe, materiais, gastos, recebimentos e resultado. Princípio: **uma pessoa com pouca familiaridade com tecnologia faz o primeiro orçamento sem treinamento**.

## 2. Arquitetura

```
Navegador (React, mobile-first, PWA com service worker + fila offline)
   │  mesma origem (/api), cookie httpOnly
   ▼
API Fastify ── packages/shared (cálculos, validação Zod, permissões, contratos)
   │   ├─ auth/sessões, CSRF, rate limit, auditoria, idempotência, portão de assinatura
   │   ├─ orçamentos, PDF, obras, medição+fotos, diário, financeiro, estoque
   │   ├─ assistente (proposta tipada → confirmação)       → Claude (API oficial)
   │   ├─ assinatura da plataforma + webhook + worker       → Asaas (API v3)
   │   └─ painel da plataforma (sem dados de negócio)
   ▼
PostgreSQL (Prisma migrations, FKs compostas por empresa)
Armazenamento de arquivos: disco local (interface pronta para S3)
```

Decisões em [DECISOES_TECNICAS.md](DECISOES_TECNICAS.md); modelo em [MODELO_DADOS.md](MODELO_DADOS.md); endpoints em [API.md](API.md).

## 3. Status por fase

Legenda: ✅ implementado e testado · 🟡 parcial ou depende de configuração externa · ⏳ pendente

### Fase 1 — Núcleo comercial ✅
Cadastro/login/sessões, multiempresa e perfis, empresa e logomarca, clientes, catálogo sem preços inventados, orçamento em 6 passos, materiais (perda, embalagem, 3 modos de fornecimento), custos internos, lucro estimado, revisões imutáveis, aprovação com evidência, PDF (detalhado, resumido e interno), link público e WhatsApp, painel.
- 🟡 Recuperação de senha: fluxo pronto; **envio de e-mail depende de provedor** (não configurado).
- ⏳ Convite de membros pela interface; textos jurídicos (termos/privacidade); tour guiado.

### Fase 2 — Operação de obras ✅
| Item | Status |
|---|---|
| Orçamento aprovado → obra (confirmação explícita, vínculo com a revisão aprovada, uma obra por orçamento) | ✅ |
| Etapas (serviços do orçamento), ajuste de quantidade prevista (aditivo) auditado | ✅ |
| **Medição da obra**: quantidades executadas por etapa + **fotos** + observações; rascunho pelo campo, confirmação pelo gestor; nunca ultrapassa o previsto; gera cobrança conferida | ✅ |
| Diário de obra com fotos | ✅ |
| Galeria de fotos por etapa (compressão no aparelho, sem GPS) | ✅ |
| Andamento físico (ponderado por valor), alertas de atraso, estouro de custo, atrasos financeiros | ✅ |
| Despesas por obra/empresa, categorias (alimentação, hospedagem, transporte, equipe…), previsto/a pagar/pago, comprovante, rateio entre obras | ✅ |
| Contas a receber: entrada + parcelas exatas, medição, avulsas; pagamentos parciais; estorno com histórico | ✅ |
| Resumo financeiro por obra (contrato, recebido, a receber, custo previsto × lançado × pago, resultado estimado, caixa) | ✅ |
| Fluxo de caixa (6 meses, realizado + previsto), exportação CSV | ✅ |
| Estoque: materiais, depósitos e local por obra, compra (1 despesa + 1 entrada), uso/transferência/perda/devolução/ajuste, saldo nunca negativo, estoque mínimo, previsto × recebido × usado sem misturar unidades | ✅ |
| Pedidos de compra com recebimento parcial | ⏳ (compra direta já cobre o caso comum) |
| Despesas recorrentes | ⏳ |
| Exportação XLSX e relatórios PDF financeiros | ⏳ (CSV pronto, abre no Excel) |
| Tela de auditoria | ⏳ (auditoria gravada; consulta só via exportação) |

### Fase 3 — Assistente ✅ (🟡 depende de credencial)
Proposta tipada (structured outputs) validada no servidor; perguntas sobre o que falta; prévia editável no editor de orçamento; gasto confirmado com valores conferidos; consultas calculadas pelo servidor com dados rastreáveis; correções em sequência ("troque a metragem para 40"); limite mensal por plano; consumo de tokens registrado; voz pelo reconhecimento do navegador com aviso de privacidade.
- 🟡 **Não validado contra a API real** (sem `ANTHROPIC_API_KEY` neste ambiente); testado com modelo roteirizado.
- ⏳ Transcrição no servidor (provedor próprio) — hoje a voz usa o navegador; diário por voz usa o mesmo campo de texto com ditado do teclado.
- ⏳ Conjunto de avaliação com frases reais (sotaques, valores por extenso).

### Fase 4 — Monetização ✅ (🟡 depende de credencial)
Planos configuráveis, teste grátis, contratação via Asaas, webhook autenticado e idempotente, validação do valor pago, tolerância → somente leitura (sem perda de dados), cancelamento com acesso até o fim do período, reconciliação (manual e diária), worker de reprocessamento, painel da plataforma, exportação completa dos dados.
- 🟡 **Não validado no sandbox real do Asaas** (sem credenciais); testado com provedor simulado. URL de produção do Asaas **a confirmar** (não consta nas páginas consultadas).
- ⏳ Emissão de nota fiscal da assinatura; troca de plano com cobrança proporcional (hoje a troca vale a partir do próximo período).

### Fase 5 — Evolução 🟡
- ✅ PWA: manifest + service worker (abre sem internet); fila offline de gastos com sincronização segura (mesma chave de idempotência).
- ⏳ Offline de medições/fotos, agenda de equipe, modelos adicionais de PDF, indicadores avançados, cobrança opcional dos clientes das obras (desenho em INTEGRACAO_ASAAS.md).

## 4. Riscos
| Risco | Mitigação |
|---|---|
| Vazamento entre empresas | Tenant no servidor, FKs compostas, 404, testes de isolamento em todas as fases. Evoluir para RLS. |
| Erro de cálculo/arredondamento | Cálculo único compartilhado, centavos, decimal.js, divisão de parcelas que fecha ao centavo, testes. |
| Custo contado em dobro | Despesa = compromisso; estoque = físico; pagar = mudança de status (teste dedicado). |
| Lucro estimado × caixa | Indicadores separados e rotulados na tela e no PDF interno. |
| IA gravando sem conferência | Só propõe; gravação exige confirmação, permissão e é única por proposta. |
| Acesso pago liberado indevidamente | Só por webhook autenticado + valor conferido, ou reconciliação na API. |
| Medição acima do previsto | Atualização condicional atômica no banco. |
| Unidades misturadas (kg × saco) | Comparação só com unidade igual; sem fator, avisa em vez de converter. |
| Aviso de depreciação `pg` dentro do Prisma | Funciona hoje; manter `pg@8` até correção do `@prisma/adapter-pg`. |

## 5. Dependências externas (não validadas com serviço real)
- E-mail transacional: **não configurado**.
- Anthropic (assistente): **sem chave neste ambiente**.
- Asaas (assinatura): **sem chave/sandbox neste ambiente**; URL de produção a confirmar.
- Armazenamento S3: **não implementado** (disco local).
- Hospedagem, HTTPS, backups automáticos, monitoramento: **não configurados**.
