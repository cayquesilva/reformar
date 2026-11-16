/**
 * Gráficos SVG acessíveis.
 * Paleta validada (scripts/validate_palette.js do método de dataviz, modo claro):
 *   Entradas #2a78d6 · Saídas #eb6834 — todas as checagens passaram (CVD ΔE 24,7; visão normal ΔE 33,6; contraste ≥ 3:1).
 *   O azul da marca (#0b4f8a) FALHA a faixa de luminosidade para séries; por isso não é usado nas barras.
 *   "Previsto" usa a MESMA cor com hachura (codificação secundária, não depende só de cor).
 * Cores de status (verde/vermelho) ficam reservadas para estados, nunca para séries.
 */
import { useEffect, useRef, useState } from 'react';
import { formatBRL } from '@reformar/shared';
import { intlLocale, t } from '../lib/i18n';

export const SERIES = { in: '#2a78d6', out: '#eb6834' } as const;

/** R$ 1,2 mil / R$ 3,4 mi — rótulos de eixo compactos. */
export function brlCompact(cents: number) {
  const reais = cents / 100;
  const abs = Math.abs(reais);
  const fmt = (n: number) => n.toLocaleString(intlLocale(), { maximumFractionDigits: 1 });
  if (abs >= 1_000_000) return t('R$ {n} mi', { n: fmt(reais / 1_000_000) });
  if (abs >= 1_000) return t('R$ {n} mil', { n: fmt(reais / 1_000) });
  return `R$ ${Math.round(reais)}`;
}

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.floor(e!.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, width };
}

/** Escala "agradável" (1, 2, 2,5, 5 × 10^n). */
function niceMax(v: number) {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 2, 2.5, 5, 10]) if (v <= m * p) return m * p;
  return 10 * p;
}

/** Barra com só o topo arredondado (4 px), ancorada na base. */
function barPath(x: number, y: number, w: number, h: number, round: boolean) {
  if (h <= 0) return '';
  const r = round ? Math.min(4, w / 2, h) : 0;
  return `M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h} Z`;
}

export interface CashFlowPoint {
  month: string; // AAAA-MM
  receivedCents: number;
  expectedInCents: number;
  paidCents: number;
  expectedOutCents: number;
}

function monthShort(m: string) {
  const [y, mm] = m.split('-').map(Number) as [number, number];
  return new Date(y, mm - 1, 1).toLocaleDateString(intlLocale(), { month: 'short' }).replace('.', '');
}
function monthLong(m: string) {
  const [y, mm] = m.split('-').map(Number) as [number, number];
  const s = new Date(y, mm - 1, 1).toLocaleDateString(intlLocale(), { month: 'long', year: 'numeric' });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Fluxo de caixa: barras agrupadas por mês (Entradas × Saídas), cada uma empilhando
 * realizado (sólido) + previsto (hachurado). Uma única escala. Dica ao passar o mouse ou focar.
 */
export function CashFlowChart({ data, height = 240 }: { data: CashFlowPoint[]; height?: number }) {
  const { ref, width } = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const pad = { top: 12, right: 8, bottom: 28, left: 64 };
  const innerW = Math.max(0, width - pad.left - pad.right);
  const innerH = height - pad.top - pad.bottom;
  // Passo "redondo" (1, 2, 2,5, 5 × 10ⁿ) e eixo até o múltiplo seguinte: rótulos legíveis (R$ 2 mil, 4 mil...).
  const peak = Math.max(...data.flatMap((d) => [d.receivedCents + d.expectedInCents, d.paidCents + d.expectedOutCents]), 0);
  const step = niceMax(peak / 4);
  const steps = Math.max(1, Math.ceil(peak / step));
  const max = step * steps;
  const y = (v: number) => innerH - (v / max) * innerH;
  const groupW = data.length ? innerW / data.length : 0;
  const barW = Math.max(6, Math.min(22, (groupW - 12) / 2));
  const ticks = Array.from({ length: steps + 1 }, (_, i) => i * step);
  const gap = 2;

  const segments = (x: number, real: number, forecast: number, color: string, pattern: string) => {
    const hReal = innerH - y(real);
    const hFore = innerH - y(forecast);
    const realTop = innerH - hReal;
    const out = [];
    if (hReal > 0) out.push(<path key="r" d={barPath(x, realTop, barW, hReal, hFore <= 0)} fill={color} />);
    if (hFore > 0) {
      const top = realTop - hFore - (hReal > 0 ? gap : 0);
      out.push(<path key="f" d={barPath(x, top, barW, hFore, true)} fill={`url(#${pattern})`} stroke={color} strokeWidth={1} />);
    }
    return out;
  };

  const tip = active !== null ? data[active] : null;
  const tipX = active !== null ? pad.left + groupW * active + groupW / 2 : 0;

  return (
    <div className="chart" ref={ref}>
      <ul className="chart-legend" aria-label={t('Legenda')}>
        <li>
          <span className="swatch" style={{ background: SERIES.in }} aria-hidden /> {t('Entradas')}
        </li>
        <li>
          <span className="swatch" style={{ background: SERIES.out }} aria-hidden /> {t('Saídas')}
        </li>
        <li>
          <span className="swatch swatch-hatch" aria-hidden /> {t('Previsto (ainda não pago/recebido)')}
        </li>
      </ul>
      {width > 0 && (
        <svg
          width={width}
          height={height}
          style={{ width, height }}
          role="group"
          aria-label={t('Gráfico de fluxo de caixa por mês. Use Tab para percorrer os meses.')}
        >
          <defs>
            <pattern id="hatch-in" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="6" height="6" className="chart-hatch-bg" />
              <line x1="0" y1="0" x2="0" y2="6" stroke={SERIES.in} strokeWidth="2.5" />
            </pattern>
            <pattern id="hatch-out" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="6" height="6" className="chart-hatch-bg" />
              <line x1="0" y1="0" x2="0" y2="6" stroke={SERIES.out} strokeWidth="2.5" />
            </pattern>
          </defs>
          <g transform={`translate(${pad.left},${pad.top})`}>
            {ticks.map((t) => (
              <g key={t} aria-hidden>
                <line x1={0} x2={innerW} y1={y(t)} y2={y(t)} className={t === 0 ? 'chart-baseline' : 'chart-grid'} />
                <text x={-8} y={y(t)} dy="0.32em" textAnchor="end" className="chart-tick">
                  {brlCompact(t)}
                </text>
              </g>
            ))}
            {data.map((d, i) => {
              const gx = groupW * i;
              const cx = gx + groupW / 2;
              const x1 = cx - barW - gap / 2;
              const x2 = cx + gap / 2;
              const summary = t(
                '{month}: entradas {received} recebidas e {expectedIn} previstas; saídas {paid} pagas e {expectedOut} previstas.',
                {
                  month: monthLong(d.month),
                  received: formatBRL(d.receivedCents),
                  expectedIn: formatBRL(d.expectedInCents),
                  paid: formatBRL(d.paidCents),
                  expectedOut: formatBRL(d.expectedOutCents),
                },
              );
              return (
                <g
                  key={d.month}
                  tabIndex={0}
                  role="img"
                  aria-label={summary}
                  className={`chart-group${active === i ? ' active' : ''}`}
                  onMouseEnter={() => setActive(i)}
                  onMouseLeave={() => setActive(null)}
                  onFocus={() => setActive(i)}
                  onBlur={() => setActive(null)}
                >
                  <rect x={gx} y={0} width={groupW} height={innerH} className="chart-hit" />
                  {segments(x1, d.receivedCents, d.expectedInCents, SERIES.in, 'hatch-in')}
                  {segments(x2, d.paidCents, d.expectedOutCents, SERIES.out, 'hatch-out')}
                  <text x={cx} y={innerH + 18} textAnchor="middle" className="chart-tick chart-x" aria-hidden>
                    {monthShort(d.month)}
                  </text>
                </g>
              );
            })}
          </g>
        </svg>
      )}
      {tip && (
        <div className="chart-tip" style={{ left: Math.min(Math.max(tipX, 110), width - 110) }} aria-hidden>
          <strong>{monthLong(tip.month)}</strong>
          <span>
            <i className="dot" style={{ background: SERIES.in }} />
            {t('Recebido')} <b>{formatBRL(tip.receivedCents)}</b>
          </span>
          {tip.expectedInCents > 0 && (
            <span>
              <i className="dot dot-hatch-in" />
              {t('A receber')} <b>{formatBRL(tip.expectedInCents)}</b>
            </span>
          )}
          <span>
            <i className="dot" style={{ background: SERIES.out }} />
            {t('Pago')} <b>{formatBRL(tip.paidCents)}</b>
          </span>
          {tip.expectedOutCents > 0 && (
            <span>
              <i className="dot dot-hatch-out" />
              {t('A pagar')} <b>{formatBRL(tip.expectedOutCents)}</b>
            </span>
          )}
          <span className="tip-total">
            {t('Saldo do mês')} <b>{formatBRL(tip.receivedCents + tip.expectedInCents - tip.paidCents - tip.expectedOutCents)}</b>
          </span>
        </div>
      )}
    </div>
  );
}

/** Ranking horizontal de uma única série (ex.: custos por categoria). Rótulo e valor diretos, sem legenda. */
export function RankBars({ items, label }: { items: { label: string; cents: number }[]; label: string }) {
  const max = Math.max(...items.map((i) => i.cents), 1);
  const total = items.reduce((a, i) => a + i.cents, 0);
  const [grown, setGrown] = useState(false);
  useEffect(() => {
    const t = requestAnimationFrame(() => setGrown(true));
    return () => cancelAnimationFrame(t);
  }, []);
  return (
    <ul className="rank" aria-label={label}>
      {items
        .slice()
        .sort((a, b) => b.cents - a.cents)
        .map((i) => (
          <li key={i.label}>
            <span className="rank-label">{i.label}</span>
            <span className="rank-value">
              {formatBRL(i.cents)}
              <small> · {Math.round((i.cents / total) * 100)}%</small>
            </span>
            <span className="rank-track" aria-hidden>
              <span className="rank-bar" style={{ width: grown ? `${(i.cents / max) * 100}%` : 0, background: SERIES.in }} />
            </span>
          </li>
        ))}
    </ul>
  );
}
