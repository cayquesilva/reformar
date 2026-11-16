# scrollcraft (motor de scroll) — código de terceiros, NÃO editar

- Origem: https://github.com/nateherkai/scroll-craft (plugins/nateherk-design/skills/scroll-craft/engine)
- Versão 0.3.1, commit 75d81f74e83692add18cd7a8a8e078b8a887a579 (2026-09-30). Licença MIT (ver LICENSE).
- Auditado em 2026-11-11: sem `eval`, sem armazenamento, sem rede (o único `fetch` carrega o vídeo que a própria página indicar; não usamos vídeo).
- Carregado só na página inicial pública (ver `pages/landing/useScrollCraft.ts`), porque o CSS dele mexe em `body` e `svg`.
- Para atualizar: substituir os dois arquivos pela nova versão, reler o CHANGELOG e rodar `npm run telas`.
