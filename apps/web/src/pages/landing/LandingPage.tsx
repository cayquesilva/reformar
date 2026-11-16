import { Box, DraftingCompass } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import '@fontsource-variable/archivo/wght.css';
import type { HouseScene } from '../landing3d/houseScene';
import { House } from './House';
import './landing.css';
import { Gauge, LandingBar, LandingCopy, LandingFooter, prefersReducedMotion, useBuild, useIntro } from './shared';
import { useScrollCraft } from './useScrollCraft';
import { t } from '../../lib/i18n';

type View = '2d' | '3d';
type SceneState = 'off' | 'ready' | 'failed';

const VIEW_KEY = 'reformar:vista-casa';

/** Testa se o aparelho cria um contexto WebGL (e o devolve logo em seguida). */
function hasWebGL() {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') ?? c.getContext('webgl');
    if (!gl) return false;
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return true;
  } catch {
    return false;
  }
}

/** Escolha salva > economia de dados (2D) > 3D. Sem WebGL é sempre 2D. */
function initialView(can3d: boolean, prefer?: View): View {
  if (!can3d) return '2d';
  if (prefer) return prefer;
  try {
    const saved = localStorage.getItem(VIEW_KEY);
    if (saved === '2d' || saved === '3d') return saved;
  } catch {
    // armazenamento bloqueado: segue o padrão
  }
  const saveData = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData;
  return saveData ? '2d' : '3d';
}

/**
 * Página pública: a casa se constrói conforme o visitante rola a página.
 * Duas vistas da mesma obra, trocadas pelo seletor no palco: desenho técnico (SVG, 2D) e maquete (Three.js, 3D,
 * carregado só quando escolhido). As duas leem o mesmo progresso de scroll, então a troca acontece na mesma etapa.
 */
export function LandingPage({ prefer }: { prefer?: View }) {
  const root = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const sceneApi = useRef<HouseScene | null>(null);
  const latest = useRef<{ b?: number[]; b0?: number }>({});
  const ready = useScrollCraft(root);
  const [current, setCurrent] = useState(0);
  const [can3d, setCan3d] = useState(hasWebGL);
  const [view, setView] = useState<View>(() => initialView(can3d, prefer));
  const [scene, setScene] = useState<SceneState>('off');
  const viewRef = useRef(view);
  viewRef.current = view;

  // A cena só recebe o progresso enquanto está à vista; o último valor fica guardado para a volta.
  const onProgress = useCallback((b: number[]) => {
    latest.current.b = b;
    if (viewRef.current === '3d') sceneApi.current?.setStages(b);
  }, []);
  const onIntro = useCallback((b0: number) => {
    latest.current.b0 = b0;
    if (viewRef.current === '3d') sceneApi.current?.setIntro(b0);
  }, []);
  useBuild(root, stage, setCurrent, onProgress);
  useIntro(stage, ready, onIntro);

  const want3d = view === '3d';
  // A cena é montada na primeira vez que o 3D é escolhido e fica viva até sair da página.
  const [armed, setArmed] = useState(want3d);
  if (want3d && !armed) setArmed(true);

  useEffect(() => {
    const el = canvas.current;
    if (!armed || !el) return;
    let dead = false;
    let api: HouseScene | null = null;
    let ro: ResizeObserver | null = null;
    const host = el.parentElement!;
    const onPointer = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse' || viewRef.current !== '3d') return;
      const r = host.getBoundingClientRect();
      api?.setPointer(((e.clientX - r.left) / r.width - 0.5) * 2, ((e.clientY - r.top) / r.height - 0.5) * 2);
    };
    import('../landing3d/houseScene')
      .then(({ createHouseScene }) => {
        if (dead) return;
        api = createHouseScene(el, { reducedMotion: prefersReducedMotion(), mobile: window.matchMedia('(max-width: 899px)').matches });
        sceneApi.current = api;
        const { b, b0 } = latest.current;
        if (b0 !== undefined) api.setIntro(b0);
        if (b) api.setStages(b);
        ro = new ResizeObserver(() => api?.resize());
        ro.observe(host);
        window.addEventListener('pointermove', onPointer, { passive: true });
        setScene('ready');
      })
      .catch(() => {
        // Sem WebGL (ou falha ao carregar): fica o desenho 2D e o 3D sai do seletor.
        if (dead) return;
        setScene('failed');
        setCan3d(false);
        setView('2d');
      });
    return () => {
      dead = true;
      ro?.disconnect();
      window.removeEventListener('pointermove', onPointer);
      api?.dispose();
      sceneApi.current = null;
    };
  }, [armed]);

  // Ao voltar para o 3D, a cena alcança a etapa em que o scroll está.
  useEffect(() => {
    const api = sceneApi.current;
    if (!want3d || !api) return;
    const { b, b0 } = latest.current;
    if (b0 !== undefined) api.setIntro(b0);
    if (b) api.setStages(b);
  }, [want3d, scene]);

  const choose = (v: View) => {
    setView(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      // sem armazenamento: a escolha vale só nesta visita
    }
  };

  // Enquanto a maquete carrega, o desenho continua no palco.
  const shown: View = want3d && scene === 'ready' ? '3d' : '2d';

  return (
    <div className={`lp${ready ? ' is-ready' : ''}`} ref={root} data-show={shown}>
      <div className="sc-grain" aria-hidden="true" />
      <LandingBar />
      <main className="lp-main">
        <div className="lp-stage" ref={stage} data-sc-spotlight>
          <div className="lp-draw">
            <House />
            <canvas ref={canvas} className="lp-canvas" aria-hidden="true" />
          </div>
          <ViewToggle view={view} onChange={choose} can3d={can3d} busy={want3d && scene === 'off'} />
          <Gauge current={current} root={root} />
        </div>
        <LandingCopy />
      </main>
      <LandingFooter />
    </div>
  );
}

/** Seletor 2D/3D: dois botões de opção nativos (setas do teclado funcionam) com um marcador que desliza. */
function ViewToggle({ view, onChange, can3d, busy }: { view: View; onChange: (v: View) => void; can3d: boolean; busy: boolean }) {
  return (
    <fieldset className="lp-view" data-view={view} aria-busy={busy || undefined}>
      <legend className="sr-only">{t('Ver a casa como')}</legend>
      <span className="lp-view-thumb" aria-hidden="true" />
      <label className="lp-view-opt" title={t('Desenho técnico')}>
        <input type="radio" name="lp-view" value="2d" checked={view === '2d'} onChange={() => onChange('2d')} />
        <DraftingCompass className="lp-view-ic lp-view-ic-2d" aria-hidden />
        <span className="lp-view-txt">
          <span className="lp-view-word">{t('Desenho')} </span>2D
        </span>
      </label>
      <label className="lp-view-opt" title={can3d ? t('Maquete em 3D') : t('3D indisponível neste aparelho')} data-busy={busy || undefined}>
        <input type="radio" name="lp-view" value="3d" checked={view === '3d'} onChange={() => onChange('3d')} disabled={!can3d} />
        <Box className="lp-view-ic lp-view-ic-3d" aria-hidden />
        <span className="lp-view-txt">
          <span className="lp-view-word">{t('Maquete')} </span>3D
          {!can3d && <span className="sr-only"> {t('(indisponível neste aparelho)')}</span>}
        </span>
      </label>
    </fieldset>
  );
}
