import type { CSSProperties } from 'react';
import { t } from '../../lib/i18n';

/**
 * Fachada em desenho técnico, construída pelo scroll.
 * Cada grupo `.stN` lê o progresso `--bN` (0..1) publicado no palco pela página.
 *   .ln  traço que se desenha (stroke-dashoffset com pathLength=1)
 *   .fd  elemento que surge (opacidade)
 * `--o` atrasa e `--k` acelera um elemento dentro da etapa, para que as peças cheguem em sequência.
 * Decorativo: o conteúdo equivalente está nos capítulos de texto.
 */
const at = (o: number, k = 2): CSSProperties => ({ '--o': o, '--k': k }) as CSSProperties;

const GROUND = 520;
const lowerCourses = [486, 466, 446, 426, 406, 386];
const upperCourses = [334, 314, 294, 274, 254, 244];
const roofRows = [210, 196, 182, 168, 154, 140];
const roofX = (y: number) => 400 - (y - 116) * (196 / 108);
const lowerWindows = [262, 466];
const upperWindows = [262, 364, 466];

function Callout({ x1, y, label, o }: { x1: number; y: number; label: string; o: number }) {
  return (
    <g className="hs-callout fd" style={at(o, 3)}>
      <line x1={x1} y1={y} x2={132} y2={y} />
      <circle cx={x1} cy={y} r={2.5} />
      <text x={124} y={y + 4} textAnchor="end">
        {label}
      </text>
    </g>
  );
}

export function House() {
  return (
    <svg className="hs" viewBox="40 84 720 552" preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false">
      <defs>
        <pattern id="hs-grid" width="40" height="40" patternUnits="userSpaceOnUse">
          <path d="M40 0H0V40" className="hs-gridline" />
        </pattern>
        <radialGradient id="hs-fade" cx="0.5" cy="0.62" r="0.62">
          <stop offset="0.35" stopColor="#fff" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
        <mask id="hs-grid-mask" maskContentUnits="userSpaceOnUse">
          <rect x="-80" y="-80" width="960" height="800" fill="url(#hs-fade)" />
        </mask>
      </defs>

      {/* plano 1: malha da prancha */}
      <g className="hs-p1">
        <rect x="-80" y="-80" width="960" height="800" fill="url(#hs-grid)" mask="url(#hs-grid-mask)" />
      </g>

      {/* plano 2: vizinhança ao fundo */}
      <g className="hs-p2 hs-far">
        <path d="M-40 520V470h70v-28l40-24 40 24v28h60v-60h90v60h50v-40l36-22 36 22v40h60v-74h80v74h70v-34l44-26 44 26v34h66v-52h84v52h60" />
      </g>

      <g className="hs-p3">
        {/* pintura (chega no acabamento, fica atrás das linhas) */}
        <g className="st5">
          <rect className="hs-fill-wall fd" style={at(0.25, 2.2)} x="230" y="366" width="340" height="140" />
          <rect className="hs-fill-wall fd" style={at(0.35, 2.2)} x="230" y="224" width="340" height="130" />
          <path className="hs-fill-roof fd" style={at(0.45, 2.2)} d="M204 224 400 116 596 224Z" />
        </g>

        {/* 0 · terreno */}
        <g className="st0">
          <path className="ln hs-strong" style={at(0, 1.6)} pathLength={1} d="M30 520H770" />
          {Array.from({ length: 12 }, (_, i) => 60 + i * 60).map((x, i) => (
            <path key={x} className="fd hs-soft" style={at(0.3 + i * 0.03, 4)} d={`M${x} 534l12-14`} />
          ))}
          <g className="fd hs-dim" style={at(0.55, 3)}>
            <path d="M230 596H570M230 588v16M570 588v16" />
            <text x="400" y="618" textAnchor="middle">
              {t('frente do lote')}
            </text>
          </g>
        </g>

        {/* 1 · fundação */}
        <g className="st1">
          {[222, 374, 526].map((x, i) => (
            <g key={x}>
              <rect className="ln" style={at(i * 0.12, 2.4)} pathLength={1} x={x} y={GROUND} width="52" height="40" />
              <rect className="ln" style={at(0.1 + i * 0.12, 2.4)} pathLength={1} x={x - 10} y="560" width="72" height="12" />
            </g>
          ))}
          <rect className="ln hs-strong" style={at(0.45, 2)} pathLength={1} x="216" y="506" width="368" height="14" />
          <Callout x1={222} y={548} label={t('fundação')} o={0.7} />
        </g>

        {/* 2 · paredes do térreo */}
        <g className="st2">
          {lowerCourses.map((y, i) => (
            <path key={y} className="fd hs-course" style={at(i * 0.09, 5)} d={`M230 ${y}H570`} />
          ))}
          <path className="ln hs-strong" style={at(0, 1.5)} pathLength={1} d="M230 506V366H570V506" />
          <rect className="ln hs-hole" style={at(0.45, 3)} pathLength={1} x="378" y="416" width="54" height="90" />
          {lowerWindows.map((x, i) => (
            <rect key={x} className="ln hs-hole" style={at(0.5 + i * 0.1, 3)} pathLength={1} x={x} y="412" width="72" height="58" />
          ))}
          <Callout x1={230} y={440} label={t('alvenaria')} o={0.7} />
        </g>

        {/* 3 · laje e segundo piso (com andaime) */}
        <g className="st3">
          <rect className="ln hs-strong" style={at(0, 3)} pathLength={1} x="220" y="354" width="360" height="12" />
          {upperCourses.map((y, i) => (
            <path key={y} className="fd hs-course" style={at(0.25 + i * 0.07, 5)} d={`M230 ${y}H570`} />
          ))}
          <path className="ln hs-strong" style={at(0.2, 1.8)} pathLength={1} d="M230 354V224H570V354" />
          {upperWindows.map((x, i) => (
            <rect key={x} className="ln hs-hole" style={at(0.6 + i * 0.07, 3.5)} pathLength={1} x={x} y="262" width="72" height="56" />
          ))}
          <g className="hs-scaffold">
            <path className="ln" style={at(0.05, 2)} pathLength={1} d="M596 520V212M640 520V212" />
            <path className="ln" style={at(0.3, 2.5)} pathLength={1} d="M590 440H646M590 360H646M590 280H646" />
            <path className="ln hs-soft" style={at(0.45, 2.5)} pathLength={1} d="M596 520 640 440 596 360 640 280 596 212" />
          </g>
          <Callout x1={220} y={360} label={t('laje')} o={0.75} />
        </g>

        {/* 4 · telhado */}
        <g className="st4">
          {roofRows.map((y, i) => (
            <path
              key={y}
              className="fd hs-course"
              style={at(0.3 + i * 0.08, 5)}
              d={`M${roofX(y).toFixed(1)} ${y}H${(800 - roofX(y)).toFixed(1)}`}
            />
          ))}
          <path className="ln hs-strong" style={at(0, 1.4)} pathLength={1} d="M204 224 400 116 596 224Z" />
          <path className="ln" style={at(0.5, 3)} pathLength={1} d="M196 224H604" />
          <Callout x1={289} y={177} label={t('cobertura')} o={0.75} />
        </g>

        {/* 6 · chaves: luz nas janelas (fica sob as esquadrias) */}
        <g className="st6">
          <ellipse className="hs-spill fd" style={at(0.3, 2)} cx="400" cy="524" rx="210" ry="9" />
          {lowerWindows.map((x, i) => (
            <rect key={x} className="hs-lit fd" style={at(0.1 + i * 0.25, 3)} x={x} y="412" width="72" height="58" />
          ))}
          {upperWindows.map((x, i) => (
            <rect key={x} className="hs-lit fd" style={at(0.2 + i * 0.2, 3)} x={x} y="262" width="72" height="56" />
          ))}
          <rect className="hs-lit fd" style={at(0.7, 3)} x="392" y="430" width="26" height="20" />
        </g>
      </g>

      {/* plano 4 (frente): gabarito do terreno e jardim */}
      <g className="hs-p4">
        <g className="st0 hs-stakes">
          <path
            className="ln"
            style={at(0.45, 3)}
            pathLength={1}
            d="M170 520V486M196 520V486M164 492H202M604 520V486M630 520V486M598 492H636"
          />
          <path className="fd hs-string" style={at(0.75, 4)} d="M183 492H617" />
        </g>
        <g className="st5">
          {[...lowerWindows.map((x) => [x, 412, 58] as const), ...upperWindows.map((x) => [x, 262, 56] as const)].map(([x, y, h], i) => (
            <path
              key={`${x}-${y}`}
              className="ln"
              style={at(0.05 + i * 0.06, 3)}
              pathLength={1}
              d={`M${x + 36} ${y}v${h}M${x} ${y + h / 2}h72M${x - 5} ${y + h + 4}h82`}
            />
          ))}
          <rect className="ln" style={at(0.4, 3)} pathLength={1} x="384" y="422" width="42" height="84" />
          <circle className="fd hs-knob" style={at(0.6, 5)} cx="419" cy="468" r="2.6" />
          <path className="ln" style={at(0.5, 3)} pathLength={1} d="M366 506H444V513H356V520M444 513H454V520" />
          <circle className="hs-fill-tree fd" style={at(0.75, 3)} cx="692" cy="424" r="38" />
          <path className="ln" style={at(0.55, 2.5)} pathLength={1} d="M692 520V462" />
          <circle className="ln" style={at(0.6, 2.5)} pathLength={1} cx="692" cy="424" r="38" />
          <path className="ln" style={at(0.7, 3)} pathLength={1} d="M150 520q16-34 32 0q14-26 28 0" />
        </g>
      </g>
    </svg>
  );
}
