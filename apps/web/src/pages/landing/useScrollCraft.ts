import { useEffect, useState, type RefObject } from 'react';
import engineCssUrl from '../../vendor/scrollcraft/scrollcraft.css?url';
import engineJsUrl from '../../vendor/scrollcraft/scrollcraft.js?url';

interface ScrollCraftApi {
  destroy(): void;
}
declare global {
  interface Window {
    ScrollCraft?: { mount(root: Element): ScrollCraftApi };
  }
}

function loadCss(href: string): Promise<HTMLLinkElement> {
  return new Promise((resolve, reject) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    link.dataset.scrollcraft = '1';
    link.onload = () => resolve(link);
    link.onerror = () => reject(new Error('css'));
    document.head.appendChild(link);
  });
}

let scriptPromise: Promise<void> | null = null;
function loadScript(src: string): Promise<void> {
  if (window.ScrollCraft) return Promise.resolve();
  scriptPromise ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => resolve();
    s.onerror = () => {
      scriptPromise = null;
      reject(new Error('js'));
    };
    document.head.appendChild(s);
  });
  return scriptPromise;
}

/**
 * Carrega o motor scrollcraft (terceiro, sem alterações) só enquanto a página pública está montada.
 * O CSS dele estiliza `body` e `svg`, então a folha é removida ao sair; `destroy()` desliga laços e ouvintes.
 * Se o motor falhar, o conteúdo aparece do mesmo jeito (sem as animações de entrada).
 */
export function useScrollCraft(root: RefObject<HTMLElement | null>): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let dead = false;
    let link: HTMLLinkElement | null = null;
    let api: ScrollCraftApi | null = null;
    const html = document.documentElement;
    html.classList.add('lp-on');

    const showAll = () => root.current?.querySelectorAll('[data-sc-in], [data-sc-stagger] > *').forEach((el) => el.classList.add('sc-in'));

    Promise.all([loadCss(engineCssUrl).then((l) => (link = l)), loadScript(engineJsUrl), document.fonts?.ready])
      .then(() => {
        if (dead || !root.current || !window.ScrollCraft) return;
        api = window.ScrollCraft.mount(root.current);
      })
      .catch(showAll)
      .finally(() => {
        if (!dead) setReady(true);
      });
    // Rede lenta: não segura a página em branco.
    const safety = window.setTimeout(() => setReady(true), 2500);

    return () => {
      dead = true;
      window.clearTimeout(safety);
      api?.destroy();
      link?.remove();
      document.querySelectorAll('link[data-scrollcraft]').forEach((l) => l.remove());
      html.classList.remove('lp-on');
    };
  }, [root]);
  return ready;
}
