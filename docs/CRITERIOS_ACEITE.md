# Critérios de aceite e evidências

Situação em 2026-11-05 (Fases 1–4 implementadas; Fase 5 parcial).

| # | Critério | Situação | Evidência |
|---|---|---|---|
| 1 | Pessoa sem conhecimento técnico emite orçamento em poucos passos | 🟡 Simulado | E2E `e2e/jornada-a.spec.ts` (celular). **Nenhum teste com usuários reais** — roteiro abaixo. |
| 2 | Cálculos: área, perdas, caixas, preço, desconto, **parcelas**, custos e lucro | ✅ | `packages/shared/test/quote-calc.test.ts`, `money.test.ts`, `finance.test.ts` |
| 3 | PDF com dados corretos, sem custos internos no modelo comercial | ✅ | `apps/api/test/quotes.test.ts` (texto do PDF) |
| 4 | Alterar valor via voz exige prévia e confirmação | ✅ (simulado) | `apps/api/test/ai.test.ts`: nada é gravado na interpretação; gasto só com confirmação, uma vez; orçamento só ao salvar no editor. **Não validado com a API real.** |
| 5 | Empresa A não lê, altera nem exporta dados da B | ✅ | `tenant-isolation.test.ts` + blocos de isolamento em `operations.test.ts` e `ai.test.ts` |
| 6 | Webhook duplicado não gera ativação/pagamento duplicado | ✅ (simulado) | `billing.test.ts` — mesmo `id` → 1 evento, sem reprocessar. **Não validado no sandbox real.** |
| 7 | Pagamento parcial atualiza saldo sem alterar o valor do contrato | ✅ | `operations.test.ts` (Jornada D) |
| 8 | Compra de material e baixa de estoque não duplicam custo | ✅ | `operations.test.ts` (custo +R$ 459 uma vez; uso não gera custo) |
| 9 | Tela pequena, conexão instável e teclado | 🟡 | Celular: 4 E2E em viewport Pixel 7; axe sem violações em 12 telas. Conexão: fila offline com idempotência (E2E `offline.spec.ts`), rascunho local, retry. Teclado: componentes nativos; **roteiro manual de teclado não executado**. |
| 10 | Sem botões falsos, métricas inventadas ou pagamento simulado como real | ✅ | Assistente e assinatura só aparecem quando configurados; telas informam "não configurado"; provedores simulados existem apenas nos testes. |
| 11 | Medição não ultrapassa o previsto e é imutável após confirmada | ✅ | `operations.test.ts` |
| 12 | Acesso pago não é liberado pelo retorno do navegador | ✅ | `billing.test.ts` |
| 13 | Inadimplência não apaga dados; exportação disponível | ✅ | `billing.test.ts` (somente leitura + `/api/company/export`) |

## Como executar
```bash
npm run db:up
npm test        # 165 testes: domínio, integração (PostgreSQL real) e front-end
npm run e2e     # 4 jornadas no Chrome (celular) + acessibilidade
npm run check   # lint + typecheck + testes + build
```

## Roteiro de teste de usabilidade (a executar com pessoas reais)
**Não executado.** 5 participantes do público, no próprio Android:
1. "Faça um orçamento para 32 m² de porcelanato a R$ 55 o metro; o cliente compra o piso." (manual e depois pelo assistente)
2. "Mande para o cliente pelo WhatsApp." 3. "O cliente aceitou; registre."
4. "Transforme em obra e registre a medição de hoje com uma foto."
5. "Lance 3 almoços de R$ 25 e um PIX de R$ 1.000 recebido do cliente."
6. "Quanto falta receber desta obra? Quanto sobra para você?"

Métricas: conclusão sem ajuda, tempo, erros, hesitações; compreensão de "resultado estimado" × "saldo de caixa".
