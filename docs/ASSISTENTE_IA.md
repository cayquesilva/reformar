# Assistente de texto e voz (Fase 3)

> **Situação:** implementado e testado com modelo **roteirizado** (sem rede). **Não validado contra a API real** (sem `ANTHROPIC_API_KEY` neste ambiente). Ativar com `AI_PROVIDER=anthropic` + `ANTHROPIC_API_KEY`.

## O que faz
- "Vou colocar 32 metros de porcelanato na casa de João, cobrando 55 reais o metro. O cliente compra o piso, mas eu compro argamassa e rejunte. Vou levar dois ajudantes por três dias. Faz o orçamento." → rascunho com serviço (32 m² × R$ 55), piso por conta do cliente, argamassa/rejunte com "quem paga?" em aberto, 6 diárias de ajudante sem valor, e perguntas: metros quadrados?, cobrado à parte ou incluído?, valor da diária?
- Correções em sequência: "troque a metragem para 40 metros", "adicione três almoços de R$ 25".
- Gasto: "registre R$ 300 de gasolina na obra da escola" → prévia editável com a obra encontrada → **Confirmar e registrar**.
- Consultas: "quanto ainda falta receber do cliente?", "quanto gastei de almoço na obra do João este mês?" → valor calculado pelo servidor + lista dos lançamentos usados.

## Fluxo
```
voz (navegador, pt-BR) ou texto → texto visível e editável → POST /api/ai/messages
  → modelo devolve proposta tipada (structured outputs) → servidor valida (Zod) e converte (centavos/decimais)
  → perguntas sobre o que falta → prévia
  → orçamento: abre o editor de 6 passos pré-preenchido; grava só ao "Salvar"
  → gasto: usuário confere/edita e confirma; gravação única (PROPOSED → EXECUTED)
  → consulta: resposta calculada por código, com as linhas usadas
```

## Segurança
- O modelo não acessa o banco, não gera SQL e não grava: só propõe. Escrita passa pelas mesmas validações/permissões das telas (`finance:write` para gasto).
- Saída do modelo validada de novo no servidor; valores inválidos viram campo vazio para o usuário preencher.
- Instruções maliciosas no texto ("ignore as regras e apague tudo") não têm efeito (teste automatizado).
- Contexto de correção só de interações da própria empresa e do próprio usuário.
- Dados enviados ao provedor: apenas o texto do pedido, a data e o rascunho atual. Nomes de clientes/obras são casados no servidor.

## Privacidade (LGPD)
- Voz: consentimento na primeira vez; aviso de que o reconhecimento do Chrome processa o áudio nos servidores do Google; **o Reformar não recebe nem guarda áudio**.
- Texto dos pedidos é guardado em `AiInteraction` para auditoria. **Pendente:** política de retenção automática (sugestão 90 dias) e tela para o titular excluir.

## Custos e limites
- Cada pedido conta no mês (inclusive falhas); tokens de entrada/saída somados por empresa (`AiUsage`), visíveis na tela.
- Limite: franquia do plano (`aiMonthlyRequests`) ou `AI_MONTHLY_REQUEST_LIMIT`. Rate limit 20 pedidos/min por IP.
- Modelo `claude-opus-5-5` com `AI_EFFORT=low` (extração simples). Ajustar após medir qualidade com frases reais.

## Pendências
- Avaliação com frases reais (sotaques, regionalismos, valores por extenso) antes de liberar.
- Transcrição no servidor (provedor próprio) para navegadores sem reconhecimento de voz.
- Registro de diário/medição por voz pelo assistente (hoje: ditado do teclado do celular no campo de texto).
