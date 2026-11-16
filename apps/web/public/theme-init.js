// Aplica o tema salvo antes da primeira pintura (evita piscar claro/escuro). Ver src/lib/theme.ts.
(function () {
  var t = null;
  try {
    t = localStorage.getItem('reformar:tema');
  } catch {
    // aparelho sem armazenamento: segue o tema do sistema
  }
  if (t !== 'light' && t !== 'dark') t = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  document.documentElement.dataset.theme = t;
  if (t === 'dark') document.querySelector('meta[name="theme-color"]').setAttribute('content', '#0b1622');
})();
