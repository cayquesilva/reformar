# Decisões técnicas (ADR resumido)

Formato: contexto → decisão → consequências. Decisões marcadas **[confirmar]** dependem de validação do responsável pelo produto.

## DT-01 — Stack (repositório estava vazio)
- **Contexto:** nenhum código existente; requisito de SaaS multiempresa, TypeScript, PostgreSQL, migrations, testes.
- **Decisão:** monorepo npm workspaces com três pacotes:
  - `packages/shared` — domínio puro (dinheiro, quantidades, cálculo de orçamento, schemas Zod, permissões, contratos de API). Usado pela API (autoritativo) e pela web (prévia em tempo real).
  - `apps/api` — Node.js 22+, **Fastify 5**, **Prisma 7** (driver adapter `pg`), **Zod 4**, **pdfkit** para PDF.
  - `apps/web` — **React 19 + Vite 7**, React Router 7, TanStack Query 5, CSS próprio (sem framework de UI).
- **Por quê:** Fastify tem baixo overhead e bom ecossistema de segurança (helmet, rate-limit, cookie); Prisma oferece migrations versionadas e tipos fortes; compartilhar o cálculo elimina divergência entre prévia e valor gravado.
- **Versões fixadas** em majors conhecidas e estáveis (TypeScript 5.9, Vite 7, Vitest 4, React Router 7, Prisma 7.10). Já existem TypeScript 7, Vite 8 e Prisma 8 RC; atualizar exige verificação de compatibilidade (typescript-eslint ainda não suporta TS ≥ 6.1).

## DT-02 — Isolamento multiempresa (tenant)
- **Decisão:** coluna `tenantId` em todas as tabelas de negócio; o tenant é resolvido **no servidor** a partir da sessão (`Session.activeTenantId` + `Membership` ativa). Nenhuma rota aceita `tenantId` do cliente.
- **Defesa em profundidade no banco:** chaves estrangeiras **compostas** `(tenantId, id)` entre orçamento↔cliente, itens↔orçamento, versões↔orçamento etc. O banco recusa vínculo entre empresas diferentes mesmo que a aplicação erre.
- Recurso de outra empresa responde **404** (não revela existência).
- **Evolução planejada:** Row Level Security do PostgreSQL (exige `SET LOCAL app.tenant_id` por transação; avaliar custo com Prisma + pool).

## DT-03 — Autenticação e sessões
- Sessão opaca em cookie `httpOnly`, `SameSite=Lax`, `Secure` em produção. O banco guarda só o **SHA-256** do token → sessões revogáveis individualmente, por "sair de todos" e automaticamente ao trocar/redefinir senha.
- Senhas com **scrypt** nativo do Node (N=2¹⁵, r=8, p=1), sem dependência nativa. Login com tempo constante (hash fictício quando o e-mail não existe).
- **CSRF:** cookie Lax + cabeçalho obrigatório `X-Reformar-Client` em métodos que alteram dados + verificação de `Origin` contra lista permitida.
- **Rate limit:** global 300/min/IP; rotas de autenticação 10/min/IP.

## DT-04 — Permissões
- Perfis fixos (OWNER, MANAGER, ESTIMATOR, FINANCE, FIELD) mapeados para permissões granulares por ação (`quote:approve`, `quote:view_costs`…) em `packages/shared/src/permissions.ts`. Checadas em cada rota (`requireTenant(req, 'perm')`).
- Permissões personalizadas por empresa ficam para fase posterior (o modelo já é por permissão, não por perfil).

## DT-05 — Servir front e API na mesma origem
- Em produção a API serve `apps/web/dist` (`SERVE_WEB_DIR`). Em desenvolvimento o Vite faz proxy de `/api`. Elimina CORS e simplifica cookies/CSRF.
- Porta de desenvolvimento do front: **5180** com `strictPort` (a 5173 é usada por outro projeto local; evita servir o app errado).

## DT-06 — Dinheiro e quantidades
- Dinheiro **sempre em centavos inteiros**: `BigInt` no banco, `number` seguro na aplicação (verificado com `Number.isSafeInteger`). Nunca float.
- Quantidades `Decimal(14,4)`, coeficientes `Decimal(16,6)`, percentuais `Decimal(5,2)`; na aplicação, strings decimais com ponto e cálculo com **decimal.js**.
- Entrada brasileira ("1.760,50") é normalizada no navegador; a API só aceita formatos canônicos (centavos inteiros, decimais com ponto).

## DT-07 — Política de arredondamento ✅ confirmada pelo responsável do produto em 2026-11-05
- Cada **linha** é arredondada ao centavo com **meio para cima** (ROUND_HALF_UP); totais são **somas das linhas arredondadas** (o PDF sempre "fecha").
- Percentuais (desconto, imposto, reserva) são calculados sobre o total já arredondado e arredondados ao centavo.
- Quantidade com perda: 4 casas, meio para cima. Embalagens: **sempre para cima**.
- Alternativa considerada: arredondamento bancário (ABNT NBR 5891). Escolhido meio para cima por ser o esperado em documentos comerciais simples. Testado em `packages/shared/test`.

## DT-08 — Modelo de preço do orçamento ✅ confirmado em 2026-11-05 (material pelo custo; reserva sobre custos; imposto como custo)
Separação explícita entre **o que o cliente paga** e **o que a obra custa**:
- Cliente paga: mão de obra (serviços) + materiais "cobrados à parte" + despesas marcadas "cobrar do cliente" − desconto.
- Custos internos: materiais comprados pela empresa (cobrados ou incluídos) + custos da obra (equipe, alimentação, hospedagem, transporte, equipamentos, terceiros, indiretos, outros).
- Reserva para imprevistos = % sobre custos internos. Imposto estimado = % sobre o total (é custo, **não** é somado ao preço).
- **Lucro estimado** = total − imposto − custos − reserva. É previsão, não caixa.
- Materiais têm três modos: cliente compra / empresa compra e cobra / empresa compra e já está no preço. Material cobrado à parte entra **pelo valor de custo** (sem margem própria) — hipótese simples; margem sobre material pode ser adicionada depois.
- **Nenhum consumo/coeficiente é pré-preenchido**, exceto `1` como padrão neutro de "mesma quantidade do serviço". O catálogo inicial de serviços vem **sem preços**.

## DT-09 — Revisões, status e imutabilidade
- Status gravados: DRAFT, SENT, APPROVED, REFUSED. **EXPIRED é derivado** (SENT com validade < hoje em America/Sao_Paulo).
- Ao emitir, grava-se `QuoteVersion.snapshot` (empresa, cliente, conteúdo e cálculo congelados). PDFs de revisões emitidas são renderizados do snapshot — editar empresa/cliente depois não altera o que foi enviado.
- Editar um orçamento emitido abre **nova revisão** (DRAFT, `currentRevision+1`); a anterior permanece consultável.
- APPROVED é travado (só "Duplicar").
- Concorrência otimista com `lockVersion` (edição em dois aparelhos → 409 com mensagem clara).
- Aprovação exige nome, canal e data (não futura e não posterior à validade) e registra quem lançou. É controle interno; **não é assinatura nem contrato**.

## DT-10 — Idempotência
- Cabeçalho `Idempotency-Key` em criação, duplicação e aprovação. A chave é reservada antes de executar (linha `completed=false`), a resposta é gravada ao final; em falha a chave é liberada. Reenvio concorrente recebe 409 `IN_PROGRESS`.
- O front gera a chave uma vez por tela/ação (duplo toque e retransmissão não duplicam).

## DT-11 — PDF
- **pdfkit** com fontes padrão (WinAnsi), sem navegador headless → leve e rápido. Caracteres fora de WinAnsi são substituídos (`pdfText`).
- Três modelos: **detalhado** e **resumido** (para o cliente, sem custos/lucro) e **interno** (exige `quote:view_costs`, com faixa "USO INTERNO", memória de cálculo e lucro).
- Links públicos usam token aleatório de 192 bits guardado como hash, expiram (validade + 30 dias, mínimo 7) e **nunca** servem o modo interno.
- Limitação: fontes padrão não suportam emoji/caracteres fora do Latin-1. Se necessário, embutir fonte TTF (ex.: Noto Sans).

## DT-12 — Logomarca no banco
- Logo (PNG/JPEG ≤ 512 KB, validado por *magic bytes*) fica em `CompanyProfile.logo` (bytea). Simples, multiempresa por construção e incluído nos backups.
- Fotos, comprovantes e documentos (Fase 2+) irão para **armazenamento de objetos** (S3 compatível) com chave prefixada por tenant e URLs assinadas.

## DT-13 — E-mail
- Interface `Mailer`. Em desenvolvimento, `MAILER=console` escreve o link no log (bloqueado em produção). Sem provedor configurado, a tela informa que a recuperação por e-mail **não está disponível** (não finge enviar). Provedor SMTP/transacional: pendente.

## DT-14 — Filas
- Ainda não há tarefas assíncronas na Fase 1. Recomendação para Fase 3/4 (webhooks Asaas, IA, PDFs em lote): **pg-boss** (fila sobre PostgreSQL, sem Redis), mantendo a infraestrutura mínima.

## DT-15 — Testes
- Unitários do domínio (Vitest), integração da API contra **PostgreSQL real** (`reformar_test`, protegido: o nome precisa terminar em `_test`), unitários de componentes (Testing Library/jsdom) e **E2E no Chrome** (Playwright, viewport de celular) com verificação automática de acessibilidade (axe-core, WCAG 2.x A/AA).

## DT-16 — Obras e medição
- Obra nasce da **revisão aprovada** (snapshot imutável): etapas = serviços do orçamento (quantidade e preço), materiais previstos, custo/imposto/reserva previstos. Conversão exige `confirm: true` e só acontece uma vez por orçamento (unique `(tenantId, quoteId)`).
- **Medição** = quantidades executadas no período por etapa + fotos. Campo cria/edita rascunho; gestor (`measurement:confirm`) confirma. Confirmação é atômica: muda status com guarda (`DRAFT → CONFIRMED`), soma nas etapas com `UPDATE ... WHERE measured + q <= planned` (nunca ultrapassa o previsto, mesmo com confirmações simultâneas) e, opcionalmente, cria a conta a receber com **valor conferido pelo usuário** (pré-preenchido com quantidade × preço).
- Serviço que aumentou = ajuste da quantidade prevista da etapa (aditivo), auditado; não pode ficar abaixo do já medido.
- Andamento físico = valor medido ÷ valor previsto das etapas (ou média por quantidade quando não há preços).

## DT-17 — Fotos e arquivos
- Interface `Storage` com disco local (`STORAGE_DIR`, chave `tenantId/pasta/uuid.ext`, validação contra *path traversal*). S3 compatível: pendente, mesma interface.
- Tipo real verificado por assinatura binária (JPEG/PNG/WebP/PDF); até 10 MB; servido só para a própria empresa com permissão.
- O navegador redimensiona (1600 px, JPEG 80%) e, ao redesenhar no canvas, **remove EXIF/GPS** antes de enviar.

## DT-18 — Financeiro sem dupla contagem
- `Expense` é o compromisso financeiro (PLANNED/COMMITTED/PAID/CANCELED). Pagar altera o status — não cria outro lançamento.
- Compra de material = **1** despesa + **1** movimento `IN` vinculado (`expenseId`). Uso/transferência/perda só movem quantidade. Cancelar compra com entrada no estoque exige devolução antes.
- Recebimentos: `Receivable` + `ReceivablePayment` (parcial). Valor do contrato da obra nunca muda; estorno marca o pagamento (fica no histórico). Pagamento e plano de parcelas rodam em transação **SERIALIZABLE** com nova tentativa.
- Divisão de valores (parcelas, rateio) pelo **método do maior resto**: soma sempre exata ao centavo.
- Resultado estimado (competência) = contrato − custos lançados − imposto previsto. Saldo de caixa = recebido − pago. Indicadores separados.
- CSV: separador `;`, BOM UTF-8, vírgula decimal, proteção contra injeção de fórmula.

## DT-19 — Unidades de material
- O orçamento guarda a quantidade na unidade do material (ex.: 160 kg) **e** em embalagens (8 sacos). Ao vincular ao estoque, só compara se a unidade do estoque for igual a uma das duas (normalização simples: minúsculas, sem acento, sem "s" final). Caso contrário, mostra "unidades diferentes" — **não converte por suposição**.

## DT-20 — Assistente (Claude)
- Provedor intercambiável (`AssistantModel`); `AI_PROVIDER=none` desliga sem afetar o resto. Implementação: SDK oficial `@anthropic-ai/sdk` 1.6.0, modelo `claude-opus-5-5` (padrão recomendado), `client.beta.messages.parse` + `betaZodOutputFormat` (structured outputs; *tool_choice* forçado retorna 400 nesse modelo), `output_config.effort` configurável (padrão `low` para extração), fallback do servidor em recusas (`fallbacks: 'default'`, beta `server-side-fallback-2026-07-01`), prompt de sistema fixo com cache, timeout 60 s e 2 novas tentativas.
- A saída do modelo é validada de novo com Zod; dinheiro/quantidade chegam como texto e são convertidos pelo servidor; valores ausentes viram `null` + pergunta. O modelo não gera SQL nem grava: gastos exigem confirmação (`PROPOSED → EXECUTED` atômico), orçamentos são abertos no editor e só gravam ao salvar.
- Consultas ("quanto gastei de almoço…") são resolvidas por código determinístico com as linhas usadas na resposta.
- Voz: reconhecimento do **navegador** (Web Speech API, pt-BR), com consentimento e aviso de que o Chrome processa o áudio no Google. O áudio não chega ao Reformar. Transcrição no servidor: pendente.
- Custo: pedido contado antes da chamada (inclusive falhas); tokens somados por empresa/mês; limite do plano ou `AI_MONTHLY_REQUEST_LIMIT`; rate limit 20/min.

## DT-21 — Assinatura (Asaas)
- Endpoints usados **somente** os conferidos na documentação oficial em 2026-11-05: `POST /v3/customers`, `POST /v3/subscriptions`, `GET /v3/subscriptions/{id}`, `GET /v3/subscriptions/{id}/payments`, `DELETE /v3/subscriptions/{id}`; autenticação `access_token`; webhook autenticado por `asaas-access-token`; entrega "pelo menos uma vez" ⇒ idempotência por `id` do evento.
- Webhook: autentica (comparação em tempo constante) → grava evento (único por provedor+id) → processa → 200. Falhas ficam `FAILED` e o worker (60 s) reprocessa; reconciliação diária consulta a API. Pagamento com valor menor que o plano **não ativa**.
- Acesso: `accessFor()` puro (testado). Atraso → tolerância (`BILLING_GRACE_DAYS`) → somente leitura (HTTP 402 em escrita), mantendo consulta, exportação, conta e assinatura. Cancelamento mantém acesso até o fim do período pago.
- Troca de plano: remove a assinatura anterior e cria a nova com 1º vencimento após o período pago/teste (sem cobrança dupla; sem pró-rata).
- Fila: worker em processo sobre o banco (tabela de eventos). Com várias instâncias, migrar para pg-boss/trava distribuída.

## DT-22 — Offline (PWA)
- Service worker guarda só a "casca" do app; **nunca** respostas da API.
- Fila local de gastos com a mesma `Idempotency-Key` em todas as tentativas; envio ao reconectar; erros de validação ficam visíveis para descartar/corrigir.
- Mutations do TanStack Query com `networkMode: 'always'` (o padrão pausava ações offline e deixava o botão carregando para sempre — encontrado pelo E2E).

## Problema conhecido
- `@prisma/adapter-pg` 7.10.1 emite *DeprecationWarning* do `pg` ("client.query() when the client is already executing") dentro de transações. Funciona (o `pg` enfileira), mas será erro no `pg@9`: manter `pg@8` até correção.

## DT-23 — Interface (navegação e sistema visual)
- **Navegação por tamanho de tela:** celular (< 768 px) com barra inferior de 5 itens + "Mais"; tablet (768–1199 px) com barra lateral só de ícones; desktop (≥ 1200 px) com barra lateral completa, agrupada por área (Comercial, Obras, Financeiro, Ferramentas, Empresa), botão fixo "Novo orçamento" e opção de recolher (preferência salva no aparelho). Itens aparecem conforme permissão e recursos configurados.
- **Ícones-only acessível:** no modo trilho o texto do link fica *visualmente* oculto (não `display: none`), mantendo o nome acessível; há dica (`title`) em todos os itens. (Bug encontrado pela verificação automática no tablet.)
- **Fluidez:** barra de progresso no topo durante a troca de tela (`useNavigation`), transição suave de entrada, "esqueletos" no lugar de ícone girando; todas as animações respeitam `prefers-reduced-motion`.
- **Layouts em colunas no desktop:** início (orçamentos recentes × obras em andamento), detalhe do orçamento (conteúdo × painel com valor/ações/PDF), resumo da obra (etapas × dinheiro), assistente de orçamento (formulário de até 780 px × painel com total e "sobra para você" ao vivo). O painel do assistente só é montado em telas largas (sem conteúdo duplicado para leitores de tela).
- **Tokens:** paleta com texto AA, bordas de campos ≥ 3:1 (WCAG 1.4.11 — antes eram mais claras), cantos 10/14 px, sombras suaves, fonte do sistema (sem download de fontes).
- **Revisão visual reproduzível:** `npm run telas` cria dados de exemplo e fotografa 9 telas em celular, tablet e desktop, rodando a verificação de acessibilidade (axe, WCAG 2.x A/AA) em todas — 27 telas sem violações em 2026-11-06.

## DT-24 — Linguagem visual v2 (componentes e transições)
- **Tipografia** Inter (variável, auto-hospedada via `@fontsource-variable/inter`; subconjunto latino ≈ 48 KB, funciona offline).
- **Componentes** (`apps/web/src/components/kit.tsx`): KPI com ícone e número animado (leitor de tela recebe só o valor final), pastilhas de ícone, avatares com iniciais, abas ARIA com indicador deslizante e setas ←/→, controle segmentado, menu de ações (padrão ARIA *menu button*: setas, Home/End, Esc), anel de progresso (`role="progressbar"`), estados vazios ilustrados.
- **Novas visualizações:** orçamentos em **lista** ou **quadro (kanban)** por situação (com contagem e soma); obras em **cartões com anel de andamento**; obra com "herói" (anel + KPIs); custos por categoria em **ranking**; **gráfico de fluxo de caixa**.
- **Gráficos** (`charts.tsx`): paleta validada com o validador do método de dataviz — Entradas `#2a78d6` × Saídas `#eb6834` passam todas as checagens (inclusive daltonismo); o azul da marca `#0b4f8a` **falhou** a faixa de luminosidade para séries e não é usado em barras. Previsto = mesma cor com hachura (não depende só de cor). Uma única escala, passos "redondos" no eixo, dica ao passar o mouse **ou focar pelo teclado** (Tab percorre os meses), legenda sempre visível e tabela equivalente em "Ver os mesmos dados em tabela". Verde/vermelho ficam reservados a estados.
- **Transições:** View Transitions API nas navegações (links com `viewTransition`; barra lateral/inferior fixas durante a troca), entrada em sequência de listas/cartões/KPIs, indicador deslizante em abas e segmentado, menus e dicas com animação curta, elevação no *hover*. Tudo desligado com `prefers-reduced-motion`.
- **Testes de acessibilidade** passam a medir o **estado final** (aguardam o fim das animações de entrada), evitando falso positivo de contraste durante o *fade-in*.
- Bugs encontrados na revisão visual e corrigidos: SVGs de gráfico/anel herdavam o tamanho de ícone (`svg { 1.2em }`); KPIs do herói quebrando 3+1; 5ª coluna do quadro cortada; nome longo vazando do cartão do quadro.

## DT-25 — Página inicial pública ("a casa construída pelo scroll")
- **Onde:** visitante sem sessão em `/` vê a apresentação (`apps/web/src/pages/landing/`); qualquer outra rota protegida continua levando a `/entrar`. A página é carregada sob demanda: quem já está logado nunca baixa o código dela.
- **scroll-craft** (MIT, v0.3.1, commit `75d81f7`): a *skill* foi instalada no projeto (`.claude/skills/scroll-craft/`, porque o comando `claude` não estava disponível no terminal) e o motor foi copiado **sem alterações** para `apps/web/src/vendor/scrollcraft/` (auditado: sem `eval`, sem armazenamento local, sem rede). O motor e a folha de estilo dele só são carregados enquanto a página pública está montada e são removidos ao sair (a folha estiliza `body` e `svg` globalmente). Se falharem, o texto aparece normalmente.
- **Briefing e direção** em `scrollcraft/builds/landing/BRIEF.md`; linha registrada em `scrollcraft/FINGERPRINTS.md`.
- **Mecânica:** fachada em desenho técnico (SVG, sem imagens nem vídeo). Cada traço usa `pathLength=1` e `stroke-dashoffset` calculado em CSS a partir do progresso da etapa (`--b0..--b6`), que a página publica a partir do scroll de cada capítulo (no máximo uma vez por quadro). Etapas: terreno (gabarito) → fundação = **orçamento** → paredes = **obra e etapas** → laje e 2º andar = **medição com fotos** (capítulo mais longo, percentual grande) → telhado = **financeiro** → acabamento = **estoque, celular e offline** → chaves (janelas acendem, chamada final).
- **Trena:** régua das etapas (horizontal no celular, vertical em telas largas) com botões que levam a cada capítulo e `aria-current` na etapa atual; o percentual "medido" é o progresso real da página, não um número de produto.
- **Conteúdo honesto:** só funções que existem no sistema; o único número é o exemplo de linha do próprio produto (32 m² × R$ 55,00 = R$ 1.760,00), identificado como exemplo; nenhuma tela falsa do sistema; um único rótulo de ação ("Começar teste grátis"; o teste existe: `BILLING_TRIAL_DAYS`, padrão 14).
- **Responsivo:** lado a lado em telas ≥ 900 px e em celular deitado; empilhado (desenho fixo no topo, texto embaixo) no celular e no tablet em pé. Movimento reduzido: as etapas mudam de uma vez, sem animação de traço nem efeito de ponteiro.
- **Telas de entrada** passaram a usar a mesma prancha azul-noite e a fonte de títulos (Archivo, auto-hospedada); a marca leva de volta à página inicial.
- **Auditoria de responsividade** (`e2e/tools/screens.spec.ts`, "responsivo em todas as larguras"): 23 telas × 6 larguras (320, 390, 768, 1024, 1440, 1920 px) sem rolagem horizontal nem elemento vazando. Encontrou e corrigiu: atalhos do início e cartão de obra vazando em 320 px, botões com rótulo longo (agora quebram linha em telas ≤ 480 px), tabela do fluxo de caixa (agora rola dentro de uma área própria).
- **Revisão visual da página pública** (`e2e/tools/landing.spec.ts`): 8 tamanhos (1920, 1440, 1280, 768, 390, 320, celular deitado e movimento reduzido), 7 posições de scroll cada, com axe sem violações, sem rolagem horizontal, trena navegando e motor removido ao entrar.
- **Observação de ambiente:** no Git Bash do Windows o Vitest falha com "failed to find the runner" (letra do drive em minúsculo carrega o módulo duas vezes). Rodar `npm run check` pelo PowerShell/cmd.

## DT-26 — Maquete 3D na página pública (seletor 2D/3D)
- **Onde:** na própria `/`. Um seletor no palco da casa ("Desenho 2D" / "Maquete 3D") troca a vista; as duas camadas leem o mesmo progresso de scroll, então a troca acontece na mesma etapa, com transição (a que sai esmaece, encolhe e desfoca). `/apresentacao-3d` continua existindo (aberta para todos) e abre direto no 3D.
- **Vista inicial:** a escolha salva no aparelho (`reformar:vista-casa`); sem escolha, 3D, exceto com "economia de dados" ligada (2D). Sem WebGL o 3D aparece desabilitado ("indisponível neste aparelho") e fica o desenho.
- **Seletor:** dois botões de opção nativos (setas do teclado funcionam) dentro de um `fieldset`; marcador amarelo que desliza com mola; o compasso "risca" ao escolher 2D e o cubo gira ao escolher 3D; o cubo pulsa enquanto a maquete carrega (o desenho fica no palco até ela ficar pronta). Abaixo de 380 px só os ícones aparecem (o nome continua para leitores de tela); a partir de 1100 px aparecem as palavras completas.
- **Desempenho:** a maquete só é baixada na primeira vez que o 3D é escolhido e continua montada até sair da página; enquanto o 2D está à vista ela não recebe o scroll nem redesenha.
- **Mesmo conteúdo:** capítulos, trena, barra, chamada e rodapé ficam em `pages/landing/shared.tsx`, então texto e regras (sem números inventados, um rótulo de ação) são idênticos nas duas vistas.
- **Rodapé** na largura toda, depois da casa pronta: marca, os capítulos (links para as etapas) e o acesso (criar conta, entrar, esqueci minha senha). Só links que existem; a borda de cima é uma trena.
- **Three.js r187** (`three@0.187.0`), carregado sob demanda (não entra no pacote do sistema). Na r187 `PCFSoftShadowMap` foi removido; usamos `PCFShadowMap`.
- **Cena** (`pages/landing3d/houseScene.ts`): casa de 8 × 6 m em metros reais. Terreno com gabarito (estacas e linha) e o **projeto em linhas azuis** da casa pronta, que vai sendo preenchido pela obra; fundação (sapatas, baldrame, contrapiso); térreo e 2º andar **fiada por fiada** (10 fiadas por andar, com vãos de porta e janelas); laje; andaime que monta na laje e desmonta no acabamento; telhado de duas águas com oitões e cumeeira; acabamento (o tijolo vira reboco pintado, esquadrias, porta, jardim, árvore); chaves (janelas e varanda acendem, a luz do dia cai).
- **Câmera:** começa vendo a planta de cima e desce girando em volta da casa conforme a obra avança; leve paralaxe com o mouse. Com movimento reduzido, câmera fixa e etapas que mudam de uma vez.
- **Desempenho:** as fiadas de cada altura são **mescladas em uma malha** (`mergeGeometries`: uma malha por fiada em vez de um bloco por trecho de parede); sombras 2048 px no desktop e 1024 px no celular; resolução limitada a 2× (1,75× no celular); o quadro só é desenhado enquanto algo se move (sem laço contínuo com a página parada); tudo é descartado ao sair.
- **Sem WebGL** (ou falha ao carregar): mostra o desenho 2D da DT-25 no lugar.
- **Verificação** (`e2e/tools/landing3d.spec.ts`): desktop, celular, tablet e movimento reduzido, 7 posições de scroll, axe sem violações, sem rolagem horizontal, sem erros no console. No Chrome sem janela o WebGL é por software; **não testado em celular físico**.

## DT-28 — Idiomas (português e inglês)
- **O texto em português é a chave** (estilo gettext): `t('Novo orçamento')`. Sem tradução, aparece o português — nunca uma chave técnica. Variáveis com `{nome}`; frases com negrito/link no meio usam `tx()` (a frase inteira é traduzida e os elementos entram no lugar de cada `{nome}`, então a ordem das palavras segue o idioma).
- **Dicionário** em `packages/shared/src/i18n-en.ts` (≈1.300 entradas), fora do índice do pacote: o site só baixa quando o inglês é escolhido; o servidor usa o mesmo arquivo.
- **Escolha do idioma:** salva no aparelho (`reformar:idioma`); sem escolha, segue o navegador. Trocar remonta a interface (o cache de dados continua), por isso `t()` é chamado direto na renderização. `<html lang>` acompanha.
- **Servidor:** o site manda `Accept-Language` com o idioma escolhido; o tratador de erros traduz `message` e `fields` (inclusive mensagens montadas com números, por modelos do dicionário). O assistente de IA recebe o idioma e escreve perguntas e respostas nele.
- **Textos gerados e guardados pelo sistema** (ex.: "Medição nº 3 - …", local de estoque "Obra 0001 - …", memória de cálculo) são traduzidos na exibição pelos mesmos modelos. Textos digitados pelo usuário não são traduzidos.
- **Fica em português de propósito:** PDF do orçamento e página pública do orçamento (são do cliente final, no Brasil), valores em reais com formato brasileiro (os campos de dinheiro aceitam "55,00").
- **Garantia:** `apps/web/src/lib/i18n.test.ts` falha se algum texto marcado no site não tiver tradução; `packages/shared/test/i18n.test.ts` confere modelos e variáveis; `e2e/tools/ingles.spec.ts` navega as telas em inglês (desktop e celular) procurando sobras em português, com axe.

## DT-29 — Meios de pagamento da assinatura (Asaas e PayPal) configuráveis no painel
- **Configuração no banco** (`PaymentProviderConfig`), editada pelo painel da plataforma; credenciais cifradas com AES-256-GCM (`SECRETS_KEY` do servidor) e nunca devolvidas (só "salva" e o final); auditoria registra só quais campos mudaram. Sem `SECRETS_KEY` o painel não salva. As variáveis `ASAAS_*` continuam valendo enquanto o Asaas não for salvo no painel.
- **"Oferecer" separado de "funcionar":** desligar um meio o tira das novas contratações, mas quem já assina por ele continua sendo cobrado, cancelado e reconciliado.
- **PayPal:** só endpoints conferidos na documentação (ver `INTEGRACAO_PAYPAL.md`); plano equivalente criado no PayPal por plano/preço/ciclo/ambiente (`PaymentProviderPlan`); o webhook só avisa e o estado vem do `GET` da assinatura (o corpo dos webhooks não foi confirmado na documentação); acesso pago só com pagamento na moeda configurada e valor ≥ preço contratado.
- **Troca de meio sem ficar descoberto:** a assinatura do Asaas só é encerrada quando a do PayPal fica ativa.
- **Assinatura da empresa** guarda `provider` e os ids de cada provedor (`asaasSubscriptionId`, `paypalSubscriptionId`).
- Testes com provedores simulados; **nenhum dos dois foi validado no sandbox real** (sem credenciais neste ambiente).

## DT-27 — Sistema visual v3 (tema claro/escuro, componentes atuais)
- **Folhas novas** em `apps/web/src/styles/` (substituem `styles.css` + `styles-v2.css`): `tokens.css` (cores, sombras, raios, medidas), `base.css`, `layout.css`, `components.css`, `pages.css`. **Toda cor passa por variável**, o que permite o tema escuro em todas as telas sem regra duplicada.
- **Identidade única com a página pública:** azul-noite da "prancha" na barra lateral (nos dois temas), amarelo da marca no item ativo, no botão "Novo orçamento" e no foco; títulos e números grandes em Archivo (auto-hospedada); textos em Inter.
- **Tema claro, escuro ou automático** (`lib/theme.ts`): escolha salva no aparelho; `public/theme-init.js` aplica antes da primeira pintura (arquivo separado porque a CSP do servidor é `script-src 'self'`); troca com transição suave quando o navegador permite. Contrastes conferidos nos dois temas: texto ≥ 4,5:1, bordas de campo e foco ≥ 3:1. As cores das séries dos gráficos são as mesmas validadas (DT-24) e mantêm ≥ 3:1 sobre o fundo escuro; a hachura do "previsto" usa a cor da superfície.
- **Novos componentes:**
  - **Paleta de comandos** (`Ctrl/⌘ + K` ou botão de busca no topo): ir para qualquer tela, criar (orçamento, cliente, gasto, obra), trocar tema, sair, e **busca real** em clientes, orçamentos e obras pela API existente (`?q=`), respeitando permissões. Padrão ARIA combobox/listbox, setas, Enter, Esc; ocupa a tela toda no celular.
  - **Barra de topo** (tablet/desktop): busca, menu "Novo", tema e menu da conta (com nome da empresa, tema e sair).
  - **Menu de ações** ampliado: gatilho próprio (avatar/ícone), cabeçalho, opções de escolha única (`menuitemradio`) e separadores.
  - **Diálogos viram "folha" de baixo** no celular; navegação inferior flutuante com indicador da aba ativa; avisos flutuantes com animação de mola; botões com brilho superior e sombra colorida; campos com anel de foco; selos com borda suave; tabelas com cabeçalho fixo em tom de superfície.
- **Ergonomia:** formulários limitados a 760 px de largura em telas grandes; botões de opção e caixas de seleção com 24 px (WCAG 2.5.8, apontado pelo axe na jornada A); painel lateral do detalhe fica fixo ao rolar.
- **Acessibilidade:** botões de avatar usam texto oculto em vez de `aria-label` (axe 2.5.3, nome visível ≠ nome acessível); tudo continua respeitando `prefers-reduced-motion`.
- **Formatação:** `.prettierrc.json` registra o padrão já usado no projeto (aspas simples, 140 colunas).
- **Verificação:** `npm run telas` agora fotografa as telas em claro e escuro (desktop e celular), a paleta de comandos aberta com resultado real e o menu da conta, com axe em todas.

