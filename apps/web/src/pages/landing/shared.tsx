/**
 * Partes comuns às duas versões da página pública (desenho 2D e casa 3D):
 * capítulos de texto, barra do topo, trena das etapas e o cálculo de progresso pelo scroll.
 */
import {
  ArrowRight,
  Boxes,
  CalendarRange,
  Camera,
  CheckCircle2,
  FileText,
  HandCoins,
  Link2,
  ListChecks,
  Receipt,
  Ruler,
  Smartphone,
  TrendingUp,
  WifiOff,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useRef, type ReactNode, type RefObject } from 'react';
import { Link } from 'react-router';
import { LanguageSwitch } from '../../components/LanguageSwitch';
import { t } from '../../lib/i18n';

/** Etapas da obra = capítulos da página = marcas da trena. */
export const STAGES = ['Terreno', 'Fundação', 'Paredes', 'Laje', 'Telhado', 'Acabamento', 'Chaves'] as const;
export const LAST = STAGES.length - 1;
export const CTA = 'Começar teste grátis';

/** Mesmo critério do CSS: lado a lado em telas largas e em celulares deitados. */
const SPLIT_QUERY = '(min-width: 900px), (min-width: 600px) and (max-height: 520px)';

export const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
export const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Liga o scroll à obra: calcula o progresso de cada etapa (0..1), publica `--b1..--b6` e `--t`
 * no palco, atualiza os percentuais e informa a etapa atual. Roda no máximo uma vez por quadro.
 * `onProgress` recebe [b1..b6] para quem desenha fora do CSS (a cena 3D).
 */
export function useBuild(
  root: RefObject<HTMLElement | null>,
  stage: RefObject<HTMLElement | null>,
  onStage: (i: number) => void,
  onProgress?: (b: number[]) => void,
) {
  const progressRef = useRef(onProgress);
  progressRef.current = onProgress;
  useEffect(() => {
    const el = root.current;
    const st = stage.current;
    if (!el || !st) return;
    const chapters = Array.from(el.querySelectorAll<HTMLElement>('[data-ch]'));
    const outs = Array.from(el.querySelectorAll<HTMLElement>('[data-pct]'));
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
    const split = window.matchMedia(SPLIT_QUERY);
    let raf = 0;
    let lastStage = -1;
    let lastPct = '';

    const frame = () => {
      raf = 0;
      const vh = window.innerHeight;
      const [start, end] = split.matches ? [0.85, 0.3] : [0.95, 0.55];
      const atBottom = window.scrollY + vh >= document.documentElement.scrollHeight - 2;
      const bs: number[] = [];
      let current = 0;
      for (let k = 1; k <= LAST; k++) {
        const ch = chapters[k];
        if (!ch) continue;
        const rect = ch.getBoundingClientRect();
        // Capítulos mais altos que a tela (o pico) desenham durante toda a sua passagem.
        const span = (start - end) * vh + Math.max(0, rect.height - vh);
        let b = atBottom ? 1 : clamp01((start * vh - rect.top) / span);
        if (reduce.matches) b = b >= 0.5 ? 1 : 0;
        st.style.setProperty(`--b${k}`, b.toFixed(4));
        bs.push(b);
        if (b > 0.5) current = k;
      }
      const t = bs.reduce((a, b) => a + b, 0) / LAST;
      st.style.setProperty('--t', t.toFixed(4));
      progressRef.current?.(bs);
      const pct = `${Math.round(t * 100)}%`;
      if (pct !== lastPct) {
        lastPct = pct;
        for (const o of outs) o.textContent = pct;
      }
      if (current !== lastStage) {
        lastStage = current;
        onStage(current);
      }
    };
    const schedule = () => {
      if (!raf) raf = window.requestAnimationFrame(frame);
    };
    frame();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    const ro = new ResizeObserver(schedule);
    ro.observe(el);
    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      ro.disconnect();
    };
  }, [root, stage, onStage]);
}

/** O terreno (gabarito do lote) se desenha sozinho ao abrir a página. */
export function useIntro(stage: RefObject<HTMLElement | null>, ready: boolean, onValue?: (b0: number) => void) {
  const valueRef = useRef(onValue);
  valueRef.current = onValue;
  useEffect(() => {
    const st = stage.current;
    if (!st || !ready) return;
    const set = (v: number) => {
      st.style.setProperty('--b0', v.toFixed(4));
      valueRef.current?.(v);
    };
    if (prefersReducedMotion()) {
      set(1);
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      const p = clamp01((now - t0 - 200) / 1700);
      set(1 - Math.pow(1 - p, 3));
      if (p < 1) raf = window.requestAnimationFrame(tick);
    };
    raf = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(raf);
  }, [stage, ready]);
}

export function LandingBar() {
  return (
    <header className="lp-bar">
      <Link to="/" className="lp-brand" aria-label={t('Reformar, início')}>
        <svg viewBox="0 0 32 32" aria-hidden="true" focusable="false">
          <path d="M4 15 16 5l12 10M7 13v13h18V13M13 26v-8h6v8" />
        </svg>
        <span className="lp-brand-name">Reformar</span>
      </Link>
      <nav className="lp-bar-nav" aria-label={t('Conta')}>
        <LanguageSwitch className="lp-lang" />
        <Link to="/entrar" className="lp-link lp-bar-login">
          {t('Entrar')}
        </Link>
        <Link to="/criar-conta" className="lp-btn lp-btn-sm">
          {t(CTA)}
        </Link>
      </nav>
    </header>
  );
}

/** Leitura da etapa atual + trena com as etapas (botões que levam a cada capítulo). */
export function Gauge({ current, root }: { current: number; root: RefObject<HTMLElement | null> }) {
  const goTo = (i: number) => {
    const behavior: ScrollBehavior = prefersReducedMotion() ? 'auto' : 'smooth';
    if (i === 0) window.scrollTo({ top: 0, behavior });
    else root.current?.querySelector(`#etapa-${i}`)?.scrollIntoView({ behavior, block: 'start' });
  };
  return (
    <>
      <p className="lp-readout" aria-hidden="true">
        <span className="lp-readout-stage">{t(STAGES[current]!)}</span>
        <span className="lp-readout-pct">
          <span data-pct>0%</span> {t('medido')}
        </span>
      </p>
      <nav className="lp-trena" aria-label={t('Etapas da obra')}>
        <ol>
          {STAGES.map((name, i) => (
            <li key={name}>
              <button type="button" onClick={() => goTo(i)} aria-current={i === current ? 'step' : undefined}>
                <span className="lp-tick" aria-hidden="true" />
                <span className="lp-tick-label">{t(name)}</span>
              </button>
            </li>
          ))}
        </ol>
      </nav>
    </>
  );
}

function Facts({ items }: { items: [LucideIcon, string][] }) {
  return (
    <ul className="lp-facts">
      {items.map(([Icon, text]) => (
        <li key={text}>
          <span className="lp-fact-ic">
            <Icon aria-hidden />
          </span>
          <span>{t(text)}</span>
        </li>
      ))}
    </ul>
  );
}

function Chapter({ index, peak, children }: { index: number; peak?: boolean; children: ReactNode }) {
  return (
    <section className={`lp-ch${peak ? ' lp-ch-peak' : ''}${index === LAST ? ' lp-ch-close' : ''}`} data-ch={index} id={`etapa-${index}`}>
      <div className="lp-ch-in" data-sc-in data-sc-stagger="70">
        {children}
      </div>
    </section>
  );
}

/** Os sete capítulos: cada etapa da casa apresenta uma parte real do sistema. */
export function LandingCopy() {
  return (
    <div className="lp-copy">
      <Chapter index={0}>
        <h1>{t('Do orçamento às chaves, sem perder a conta.')}</h1>
        <p className="lp-lead">
          {t(
            'Orçamento, obra, medição e financeiro em um só lugar. Cada etapa desta casa é uma parte do sistema. Role a página e veja a obra subir.',
          )}
        </p>
        <div className="lp-actions">
          <Link to="/criar-conta" className="lp-btn">
            {t(CTA)}
            <ArrowRight aria-hidden />
          </Link>
          <Link to="/entrar" className="lp-link">
            {t('Já tenho conta')}
          </Link>
        </div>
      </Chapter>

      <Chapter index={1}>
        <h2>{t('A fundação é o orçamento.')}</h2>
        <p>
          {t(
            'Monte o orçamento por serviço, com mão de obra, material, reserva e imposto. O sistema faz a conta inteira no centavo e mostra de onde veio cada valor.',
          )}
        </p>
        <p className="lp-calc">
          <span className="lp-calc-what">{t('Exemplo de linha, com o preço que você definir')}</span>
          <span className="lp-calc-line">
            <span>32 m² × R$ 55,00</span>
            <strong>R$ 1.760,00</strong>
          </span>
        </p>
        <Facts
          items={[
            [FileText, 'PDF com a sua marca, completo ou resumido'],
            [Link2, 'Link seguro para o cliente ler o orçamento'],
            [CheckCircle2, 'Aprovação registrada, com nome e data'],
          ]}
        />
      </Chapter>

      <Chapter index={2}>
        <h2>{t('Aprovou, as paredes sobem.')}</h2>
        <p>
          {t(
            'O orçamento aprovado vira obra, com os mesmos serviços e quantidades. Nada é digitado duas vezes, e você enxerga o que está em andamento e o que ainda falta.',
          )}
        </p>
        <Facts
          items={[
            [ListChecks, 'Serviços do orçamento viram etapas da obra'],
            [CalendarRange, 'Datas de início e de entrega em um só lugar'],
          ]}
        />
      </Chapter>

      <Chapter index={3} peak>
        <h2>{t('Cada medição sobe um andar.')}</h2>
        <p>
          {t(
            'Registre o que foi executado em cada serviço e anexe as fotos tiradas na obra. O andamento avança com prova, e a conversa com o cliente deixa de ser no olho.',
          )}
        </p>
        <p className="lp-meter" aria-hidden="true">
          <span className="lp-meter-n" data-pct>
            0%
          </span>
          <span className="lp-meter-l">{t('desta casa medido até aqui')}</span>
        </p>
        <Facts
          items={[
            [Ruler, 'Quantidade executada por serviço'],
            [Camera, 'Fotos da obra em cada medição'],
            [TrendingUp, 'Percentual de andamento sempre atualizado'],
          ]}
        />
      </Chapter>

      <Chapter index={4}>
        <h2>{t('O telhado protege o seu lucro.')}</h2>
        <p>
          {t(
            'Gastos, recebimentos e contas a pagar, separados por obra. Você compara o previsto com o realizado enquanto ainda dá tempo de corrigir.',
          )}
        </p>
        <Facts
          items={[
            [Receipt, 'Gastos lançados na obra certa'],
            [HandCoins, 'A receber e a pagar com vencimento'],
            [TrendingUp, 'Previsto e realizado lado a lado'],
          ]}
        />
      </Chapter>

      <Chapter index={5}>
        <h2>{t('No acabamento, nada fica solto.')}</h2>
        <p>
          {t(
            'A compra de material entra no gasto e no estoque de uma vez só. E tudo cabe no bolso: o sistema abre no celular como aplicativo e guarda o gasto lançado sem sinal para enviar depois.',
          )}
        </p>
        <Facts
          items={[
            [Boxes, 'Estoque de materiais com entrada e uso na obra'],
            [Smartphone, 'Instala no celular como aplicativo'],
            [WifiOff, 'Gasto lançado sem internet sobe quando o sinal volta'],
          ]}
        />
      </Chapter>

      <Chapter index={6}>
        <h2>{t('Chaves na mão. Contas também.')}</h2>
        <p>{t('Comece pelo primeiro orçamento. O resto da obra vem junto.')}</p>
        <div className="lp-actions">
          <Link to="/criar-conta" className="lp-btn lp-btn-lg">
            {t(CTA)}
            <ArrowRight aria-hidden />
          </Link>
          <Link to="/entrar" className="lp-link">
            {t('Já tenho conta')}
          </Link>
        </div>
      </Chapter>
    </div>
  );
}

/** Capítulos que o rodapé lista: cada um leva à etapa da casa que apresenta aquela parte do sistema. */
const FOOT_TOUR: [number, string][] = [
  [1, 'Orçamentos'],
  [2, 'Obras'],
  [3, 'Medições com fotos'],
  [4, 'Financeiro'],
  [5, 'Estoque e celular'],
];

/** Rodapé na largura toda, depois da casa pronta. Só links que existem. */
export function LandingFooter() {
  return (
    <footer className="lp-footer">
      <div className="lp-footer-in">
        <div className="lp-footer-brand">
          <Link to="/" className="lp-brand" aria-label={t('Reformar, início')}>
            <svg viewBox="0 0 32 32" aria-hidden="true" focusable="false">
              <path d="M4 15 16 5l12 10M7 13v13h18V13M13 26v-8h6v8" />
            </svg>
            <span>Reformar</span>
          </Link>
          <p>{t('Orçamento, obra, medição e financeiro em um só lugar, para quem trabalha com construção e reforma.')}</p>
        </div>
        <nav className="lp-footer-col" aria-labelledby="lp-foot-tour">
          <h2 id="lp-foot-tour">{t('O sistema')}</h2>
          <ul>
            {FOOT_TOUR.map(([i, label]) => (
              <li key={i}>
                <a href={`#etapa-${i}`}>{t(label)}</a>
              </li>
            ))}
          </ul>
        </nav>
        <nav className="lp-footer-col" aria-labelledby="lp-foot-conta">
          <h2 id="lp-foot-conta">{t('Acesso')}</h2>
          <ul>
            <li>
              <Link to="/criar-conta">{t(CTA)}</Link>
            </li>
            <li>
              <Link to="/entrar">{t('Entrar')}</Link>
            </li>
            <li>
              <Link to="/esqueci-senha">{t('Esqueci minha senha')}</Link>
            </li>
          </ul>
        </nav>
      </div>
      <div className="lp-footer-base">
        <span>© {new Date().getFullYear()} Reformar</span>
        <LanguageSwitch className="lp-foot-lang" />
        <span>{t('Gestão de obras e orçamentos')}</span>
      </div>
    </footer>
  );
}
