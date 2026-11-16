# Fluxos do usuário

## Visitante (antes do login) ✅
Abre `/` sem conta → página "a casa construída pelo scroll": cada etapa da obra apresenta uma parte do sistema (orçamento, obra, medição, financeiro, estoque/celular/offline). A trena permite pular para qualquer etapa. Ações: "Começar teste grátis" (→ `/criar-conta`) e "Já tenho conta"/"Entrar" (→ `/entrar`). Detalhes em DT-25.
No palco da casa, o seletor **Desenho 2D / Maquete 3D** troca a vista na mesma etapa; a escolha fica salva no aparelho. `/apresentacao-3d` abre direto no 3D (DT-26). No fim, rodapé com os capítulos e os links de acesso.

## Jornada A — orçamento manual ✅ (implementada e coberta por E2E)
1. **Criar conta** (`/criar-conta`): nome, nome da empresa, e-mail, senha, aceite → a conta já nasce com empresa, perfil de proprietário e catálogo de serviços **sem preços**.
2. (Opcional) **Minha empresa**: CPF/CNPJ, telefones, endereço, logomarca, cor, rodapé, validade padrão, forma de pagamento e exclusões padrão.
3. **Novo orçamento** (botão grande na tela inicial) — 6 passos, um assunto por tela, total sempre visível no rodapé:
   1. *Cliente e obra*: buscar cliente ou "Cadastrar novo cliente" (nome + telefone, sem sair da tela); nome do orçamento; endereço da obra.
   2. *Serviços*: tocar no serviço do catálogo (ou "Outro serviço"); informar quantidade e preço por unidade. Mostra na hora: `32 m² × R$ 55,00 = R$ 1.760,00`.
   3. *Materiais* (pode pular): quem compra; quantidade a partir do serviço × consumo do fabricante, ou digitada; perda %; embalagem. Mostra memória de cálculo e "Comprar: 15 caixa(s) = 37,5 m²".
   4. *Custos da obra* (pode pular): atalhos "Ajudante / servente", "Alimentação", "Combustível", "Hospedagem"…; opção "cobrar do cliente à parte".
   5. *Condições*: validade, forma de pagamento (sugestões), desconto R$/%, o que não está incluído, observações; avançado: imposto estimado e reserva.
   6. *Conferir*: total do cliente, custos, **lucro estimado**, avisos (ex.: prejuízo, material sem preço), memória de cálculo → **Salvar orçamento** (fica como rascunho).
4. **Detalhe do orçamento**: ver PDF (cliente detalhado, resumido, interno) → **Emitir orçamento** (congela a revisão) → **Enviar ao cliente** (link seguro + botão WhatsApp + copiar link) → **Cliente aprovou** (nome, canal, data, observação) ou **Cliente recusou** (motivo).

Recuperação de erros: validação por passo com mensagens em português perto do campo; ao salvar com erro, o assistente leva ao passo do problema; rascunho local salvo a cada alteração e oferecido de volta ("Recuperar / Descartar"); edição simultânea em outro aparelho é detectada.

## Jornada B — orçamento por voz ✅ (requer assistente configurado)
Início → **Falar com assistente** → **Falar** (consentimento na 1ª vez; indicador "Gravando…", Parar/Cancelar) → texto aparece para conferir → **Enviar** → "O que eu entendi" + perguntas → responder por voz/texto (correções) → **Abrir no editor para conferir e salvar** (6 passos pré-preenchidos; aviso para revisar) → salvar → PDF. A voz nunca substitui a conferência.

## Jornada C — obra, medição e despesas ✅ (E2E `jornada-obra.spec.ts`)
Orçamento aprovado → **Transformar em obra** (datas, confirmação) → obra com etapas = serviços → **Nova medição**: quantidade executada por etapa (mostra quanto falta; "Marcar etapa como concluída"), observações → **Salvar e adicionar fotos** (tirar foto/galeria) → gestor **Confirmar medição** (opção de gerar cobrança com valor conferido) → andamento atualizado. Diário do dia com fotos. **Registrar gasto** (atalhos almoço, diária, combustível, hospedagem…), já pago ou a pagar, comprovante. Estoque: **Registrar compra** (gasto + entrada) e **Uso na obra**. Resumo: previsto × lançado, resultado estimado e caixa, alertas.

## Jornada D — recebimentos ✅
Aba Financeiro da obra → **Lançar entrada e parcelas** (prévia exata) → **Receber** (valor parcial, forma, data, observação) → saldo e situação (em aberto, pago em parte, atrasado, pago) → estorno com motivo. Financeiro geral: a receber/pagar da semana e do mês, atrasos, fluxo de caixa, CSV.

## Jornada F — assinatura pelo PayPal ✅ (requer PayPal ligado no painel)
Plano e assinatura → escolher plano → **PayPal** → aprovar no site do PayPal → volta para a tela, que confere a situação → acesso pago só após o pagamento confirmado pelo PayPal. Cancelar pela tela encerra no PayPal e mantém o acesso até o fim do período pago.

## Idioma
Português ou inglês. A primeira visita segue o idioma do navegador; a escolha fica salva no aparelho. Troca: menu da conta (avatar), busca rápida ("Idioma"/"Language") ou o seletor PT | EN nas telas de entrada e na página pública. As mensagens do servidor também chegam no idioma escolhido. Valores continuam em reais (R$ 1.234,56); datas seguem o idioma.

## Painel da plataforma — meios de pagamento
`/plataforma` → **Meios de pagamento**: um cartão para o Asaas e outro para o PayPal, cada um com "Oferecer para novas assinaturas", ambiente (sandbox/produção), credenciais (cifradas; em branco = manter), endereço do webhook com botão copiar, eventos a marcar, **Testar conexão** e quantas assinaturas usam aquele meio. A lista de empresas mostra o meio de pagamento de cada uma.

## Jornada E — assinatura ✅ (requer Asaas configurado)
Teste grátis → Mais › **Plano e assinatura** → escolher plano, CPF/CNPJ e forma → pagamento no site do Asaas → acesso ativo após confirmação → atraso: aviso no topo durante a tolerância, depois modo consulta (com exportação) → pagar → volta ao normal → cancelar mantém acesso até o fim do período.

## Offline ✅ (parcial)
Sem internet: aviso no topo; o app abre pelo service worker; gastos ficam em "aguardando envio" e são enviados sozinhos ao reconectar, sem duplicar.

## Mapa de telas (implementado)
| Rota | Tela |
|---|---|
| `/entrar`, `/criar-conta`, `/esqueci-senha`, `/redefinir-senha` | Acesso |
| `/` | Início: ações principais + resumo |
| `/orcamentos` | Lista com filtros (rascunho, aguardando, aprovado, recusado, vencido) e busca |
| `/orcamentos/novo`, `/orcamentos/:id/editar` | Assistente de 6 passos |
| `/orcamentos/:id` | Detalhe, PDFs, emitir, compartilhar, aprovar/recusar, duplicar, histórico |
| `/clientes`, `/clientes/novo`, `/clientes/:id` | Clientes e histórico |
| `/empresa`, `/empresa/servicos` | Dados da empresa, logo, padrões; serviços e preços |
| `/conta` | Aparelhos conectados, troca de senha, troca de empresa, sair |
| `/obras`, `/obras/:id` (abas resumo, medições, diário, fotos, materiais, financeiro) | Obras |
| `/obras/nova?orcamento=`, `/obras/:id/medicoes/nova`, `/obras/:id/medicoes/:mid` | Converter orçamento, medição |
| `/financeiro`, `/financeiro/gasto/novo` | Financeiro e registro de gasto |
| `/estoque` | Materiais, saldos, compras e movimentações |
| `/assistente` | Assistente (texto e voz) |
| `/assinatura`, `/plataforma` | Assinatura da empresa; painel da plataforma |
| `/mais` | Menu com as demais opções |

## Navegação
- **Celular:** barra inferior flutuante (Início, Orçamentos, Obras, Financeiro, Mais); no topo, busca e menu da conta (minha conta, empresa, tema, sair).
- **Tablet:** barra lateral com ícones + barra de topo.
- **Desktop:** barra lateral completa agrupada por área, com "Novo orçamento" sempre visível e opção de recolher; barra de topo com busca, menu "Novo", tema e conta. Telas de detalhe têm link "← Voltar" para a lista.
- **Busca e atalhos:** `Ctrl/⌘ + K` (ou o campo de busca) abre a paleta de comandos: telas, criar algo novo, tema e busca de clientes, orçamentos e obras.
- **Tema:** claro, escuro ou automático (segue o aparelho), pelo menu da conta, pelo botão do topo ou pela busca.

## Princípios de UX aplicados
- Botões e campos com no mínimo 48 px de altura; fonte base 17 px; contraste AA.
- Ícone sempre acompanhado de texto; status com ícone + palavra (não só cor).
- Teclado numérico (`inputmode="decimal"`) em valores; aceita "1.760,50", "55", "32,5".
- Exemplos curtos nos campos ("Ex.: caixa com 2,5 m²").
- Avisos de resultado de cada ação (anunciados a leitores de tela via `aria-live`).
- Funções ainda não disponíveis são **informadas em texto**, sem botões falsos.
