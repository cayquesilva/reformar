/**
 * Componentes visuais modernos (acessíveis por teclado e leitor de tela).
 * Animações respeitam `prefers-reduced-motion`.
 */
import { Check, ChevronDown, MoreHorizontal, type LucideIcon } from 'lucide-react';
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Link } from 'react-router';
import { formatBRL } from '@reformar/shared';
import { t } from '../lib/i18n';

export type Tone = 'brand' | 'green' | 'yellow' | 'red' | 'violet' | 'gray';

export function prefersReducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

// ---------------------------------------------------------------------------
// Ícone em "pastilha" colorida
export function IconTile({ icon: Icon, tone = 'brand', size = 'md' }: { icon: LucideIcon; tone?: Tone; size?: 'sm' | 'md' | 'lg' }) {
  return (
    <span className={`icon-tile tone-${tone} tile-${size}`} aria-hidden>
      <Icon />
    </span>
  );
}

// ---------------------------------------------------------------------------
// Avatar com iniciais (cor estável derivada do nome)
const AVATAR_TONES: Tone[] = ['brand', 'violet', 'green', 'yellow', 'red'];
export function initials(name: string) {
  return (
    name
      .split(/\s+/)
      .filter((w) => w.length > 2 || /^[A-ZÀ-Ú]/.test(w))
      .slice(0, 2)
      .map((w) => w[0]!.toUpperCase())
      .join('') || name.slice(0, 1).toUpperCase()
  );
}
export function Avatar({ name, size = 'md' }: { name: string; size?: 'sm' | 'md' }) {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const tone = AVATAR_TONES[h % AVATAR_TONES.length];
  return (
    <span className={`avatar-chip tone-${tone} avatar-${size}`} aria-hidden>
      {initials(name)}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Número que "conta" até o valor final (o leitor de tela recebe só o valor final)
export function useCountUp(target: number, duration = 650) {
  const [value, setValue] = useState(() => (prefersReducedMotion() ? target : 0));
  const from = useRef(0);
  useEffect(() => {
    if (prefersReducedMotion()) {
      setValue(target);
      return;
    }
    const start = performance.now();
    const initial = from.current;
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setValue(Math.round(initial + (target - initial) * eased));
      if (t < 1) raf = requestAnimationFrame(tick);
      else from.current = target;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);
  return value;
}

export function AnimatedNumber({ value, money }: { value: number; money?: boolean }) {
  const shown = useCountUp(value);
  const final = money ? formatBRL(value) : String(value);
  return (
    <>
      <span aria-hidden>{money ? formatBRL(shown) : shown}</span>
      <span className="sr-only">{final}</span>
    </>
  );
}

// ---------------------------------------------------------------------------
// Cartão de indicador (KPI)
export function Kpi({
  label,
  value,
  money,
  sub,
  icon,
  tone = 'brand',
  to,
  onClick,
  emphasis,
}: {
  label: string;
  value: number;
  money?: boolean;
  sub?: ReactNode;
  icon: LucideIcon;
  tone?: Tone;
  to?: string;
  onClick?: () => void;
  emphasis?: 'warning' | 'danger';
}) {
  const body = (
    <>
      <span className="kpi-top">
        <span className="kpi-label">{label}</span>
        <IconTile icon={icon} tone={tone} size="sm" />
      </span>
      <span className="kpi-value">
        <AnimatedNumber value={value} money={money} />
      </span>
      {sub && <span className="kpi-sub">{sub}</span>}
    </>
  );
  const cls = `kpi${emphasis ? ` kpi-${emphasis}` : ''}${to || onClick ? ' kpi-link' : ''}`;
  if (to) {
    return (
      <Link to={to} className={cls} viewTransition>
        {body}
      </Link>
    );
  }
  if (onClick) {
    return (
      <button type="button" className={cls} onClick={onClick}>
        {body}
      </button>
    );
  }
  return <div className={cls}>{body}</div>;
}

// ---------------------------------------------------------------------------
// Indicador deslizante compartilhado por abas e controle segmentado
function useSlidingIndicator<T extends string>(value: T) {
  const container = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<{ left: number; width: number } | null>(null);
  const measure = useCallback(() => {
    const el = container.current?.querySelector<HTMLElement>('[data-active="true"]');
    if (el) setStyle({ left: el.offsetLeft, width: el.offsetWidth });
  }, []);
  useLayoutEffect(() => {
    measure();
  }, [value, measure]);
  useEffect(() => {
    const ro = new ResizeObserver(measure);
    if (container.current) ro.observe(container.current);
    return () => ro.disconnect();
  }, [measure]);
  return { container, style };
}

// ---------------------------------------------------------------------------
// Abas (ARIA tabs) com ícone e indicador animado; setas ←/→ trocam de aba
export interface TabDef<T extends string> {
  id: T;
  label: string;
  icon?: LucideIcon;
  badge?: number;
}
export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  label,
}: {
  tabs: TabDef<T>[];
  value: T;
  onChange: (v: T) => void;
  label: string;
}) {
  const { container, style } = useSlidingIndicator(value);
  const onKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft' && e.key !== 'Home' && e.key !== 'End') return;
    e.preventDefault();
    const n = tabs.length;
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + n) % n;
    onChange(tabs[next]!.id);
    container.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
  };
  return (
    <div className="tabs2" role="tablist" aria-label={label} ref={container}>
      {tabs.map((t, i) => {
        const selected = t.id === value;
        return (
          <button
            key={t.id}
            role="tab"
            type="button"
            id={`tab-${t.id}`}
            aria-selected={selected}
            aria-controls={`panel-${t.id}`}
            tabIndex={selected ? 0 : -1}
            data-active={selected}
            className={`tab2${selected ? ' selected' : ''}`}
            onClick={() => onChange(t.id)}
            onKeyDown={(e) => onKey(e, i)}
          >
            {t.icon && <t.icon aria-hidden />}
            <span>{t.label}</span>
            {t.badge ? <span className="tab-badge">{t.badge}</span> : null}
          </button>
        );
      })}
      {style && (
        <span
          className="tab-indicator"
          style={{
            transform: `translateX(${style.left}px)`,
            width: style.width,
          }}
          aria-hidden
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Controle segmentado (alternância de visualização/filtro)
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  size = 'md',
}: {
  options: { value: T; label: string; icon?: LucideIcon; count?: number }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
  size?: 'sm' | 'md';
}) {
  const { container, style } = useSlidingIndicator(value);
  return (
    <div className={`segmented seg-${size}`} role="group" aria-label={label} ref={container}>
      {style && (
        <span
          className="seg-indicator"
          style={{
            transform: `translateX(${style.left}px)`,
            width: style.width,
          }}
          aria-hidden
        />
      )}
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={active}
            data-active={active}
            className={`seg-btn${active ? ' active' : ''}`}
            onClick={() => onChange(o.value)}
          >
            {o.icon && <o.icon aria-hidden />}
            <span>{o.label}</span>
            {o.count !== undefined && <span className="seg-count">{o.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Menu de ações (botão + lista), padrão ARIA menu button
export interface MenuItem {
  label: string;
  icon?: LucideIcon;
  onSelect?: () => void;
  href?: string;
  download?: boolean;
  newTab?: boolean;
  danger?: boolean;
  /** opção de escolha única (ex.: tema): vira menuitemradio */
  checked?: boolean;
  /** linha divisória antes deste item */
  separator?: boolean;
}
export function ActionMenu({
  label = t('Mais ações'),
  items,
  compact,
  icon: TriggerIcon = MoreHorizontal,
  variant = 'secondary',
  trigger,
  triggerClass,
  align = 'right',
  header,
}: {
  label?: string;
  items: MenuItem[];
  compact?: boolean;
  /** ícone do botão (padrão: reticências) */
  icon?: LucideIcon;
  variant?: 'secondary' | 'primary' | 'ghost';
  /** conteúdo próprio do botão (ex.: avatar); o rótulo vira nome acessível */
  trigger?: ReactNode;
  triggerClass?: string;
  align?: 'right' | 'left' | 'up';
  /** cabeçalho informativo no topo do menu (ex.: nome do usuário) */
  header?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const btn = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const focusItem = (i: number) => {
    const els = menu.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]');
    if (!els?.length) return;
    els[(i + els.length) % els.length]!.focus();
  };
  useEffect(() => {
    if (!open) return;
    focusItem(0);
    const onDoc = (e: MouseEvent) => {
      if (!menu.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);
  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) btn.current?.focus();
  };
  const onMenuKey = (e: KeyboardEvent) => {
    const els = [...(menu.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? [])];
    const i = els.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      focusItem(i + 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      focusItem(i - 1);
    } else if (e.key === 'Home') {
      e.preventDefault();
      focusItem(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      focusItem(els.length - 1);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'Tab') setOpen(false);
  };
  if (items.length === 0) return null;
  return (
    <div className="menu-wrap">
      <button
        ref={btn}
        type="button"
        className={triggerClass ?? `btn ${compact ? 'btn-icon' : `btn-${variant}`}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-label={compact && !trigger ? label : undefined}
        title={compact || trigger ? label : undefined}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        {trigger ? (
          <>
            {trigger}
            <span className="sr-only">{label}</span>
          </>
        ) : (
          <TriggerIcon aria-hidden />
        )}
        {!compact && !trigger && (
          <>
            <span>{label}</span>
            <ChevronDown aria-hidden className={`chev${open ? ' open' : ''}`} />
          </>
        )}
      </button>
      {open && (
        <div
          className={`menu${align === 'left' ? ' menu-left' : align === 'up' ? ' menu-up menu-left' : ''}`}
          role="menu"
          id={id}
          ref={menu}
          aria-label={label}
          onKeyDown={onMenuKey}
        >
          {header && <div className="menu-head">{header}</div>}
          {items.map((it) => {
            const content = (
              <>
                {it.icon && <it.icon aria-hidden />}
                <span>{it.label}</span>
                {it.checked && <Check aria-hidden className="menu-check" />}
              </>
            );
            const cls = `menu-item${it.danger ? ' danger' : ''}`;
            const sep = it.separator ? <div className="menu-sep" role="separator" key={`${it.label}-sep`} /> : null;
            return it.href
              ? [
                  sep,
                  <a
                    key={it.label}
                    role="menuitem"
                    tabIndex={-1}
                    className={cls}
                    href={it.href}
                    download={it.download || undefined}
                    target={it.newTab ? '_blank' : undefined}
                    rel={it.newTab ? 'noopener' : undefined}
                    onClick={() => close(false)}
                  >
                    {content}
                  </a>,
                ]
              : [
                  sep,
                  <button
                    key={it.label}
                    role={it.checked === undefined ? 'menuitem' : 'menuitemradio'}
                    aria-checked={it.checked === undefined ? undefined : it.checked}
                    tabIndex={-1}
                    type="button"
                    className={cls}
                    onClick={() => {
                      close();
                      it.onSelect?.();
                    }}
                  >
                    {content}
                  </button>,
                ];
          })}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Anel de progresso (um único valor: andamento da obra)
export function ProgressRing({
  percent,
  label,
  size = 88,
  stroke = 9,
}: {
  percent: string | number;
  label: string;
  size?: number;
  stroke?: number;
}) {
  const v = Math.max(0, Math.min(100, Number(percent)));
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const [shown, setShown] = useState(prefersReducedMotion() ? v : 0);
  useEffect(() => {
    const t = requestAnimationFrame(() => setShown(v));
    return () => cancelAnimationFrame(t);
  }, [v]);
  const display = Number.isInteger(v) ? String(v) : v.toFixed(1).replace('.', ',');
  return (
    <div
      className="ring"
      style={{ width: size, height: size }}
      role="progressbar"
      aria-label={label}
      aria-valuenow={Math.round(v)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuetext={`${display}%`}
    >
      <svg width={size} height={size} style={{ width: size, height: size }} viewBox={`0 0 ${size} ${size}`} aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} className="ring-track" strokeWidth={stroke} fill="none" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          className="ring-value"
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - shown / 100)}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <span className="ring-text" aria-hidden>
        {display}
        <small>%</small>
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Estado vazio ilustrado
export function EmptyIllustrated({
  icon,
  title,
  children,
  action,
}: {
  icon: LucideIcon;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty2">
      <span className="empty2-icon" aria-hidden>
        <IconTile icon={icon} size="lg" />
      </span>
      <h2>{title}</h2>
      {children && <div className="muted">{children}</div>}
      {action && <div className="empty-action">{action}</div>}
    </div>
  );
}
