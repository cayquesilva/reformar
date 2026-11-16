/**
 * Paleta de comandos (Ctrl/⌘ + K): ir para qualquer tela, criar algo novo, trocar o tema
 * e buscar clientes, orçamentos e obras de verdade (API), tudo pelo teclado.
 * Padrão ARIA combobox + listbox; Esc fecha; ↑/↓ escolhem; Enter abre.
 */
import { useQuery } from '@tanstack/react-query';
import {
  Languages,
  Building2,
  CornerDownLeft,
  CreditCard,
  FilePlus2,
  FileText,
  HardHat,
  Home,
  ListChecks,
  LogOut,
  Monitor,
  Moon,
  Receipt,
  Search,
  Sparkles,
  Sun,
  UserPlus,
  UserRound,
  Users,
  Wallet,
  Boxes,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import {
  formatBRL,
  formatPhone,
  type CustomerDTO,
  type Paginated,
  type Permission,
  type ProjectSummaryDTO,
  type QuoteSummaryDTO,
} from '@reformar/shared';
import { api } from '../lib/api';
import { getLocale, intlLocale, setLocale, t } from '../lib/i18n';
import { useCan, useLogout } from '../lib/auth';
import { setTheme, THEME_LABEL, useTheme, type ThemeChoice } from '../lib/theme';
import { IconTile, type Tone } from './kit';

interface Command {
  id: string;
  group: string;
  label: string;
  hint?: string;
  icon: LucideIcon;
  tone?: Tone;
  keywords?: string;
  run: () => void;
}

/** Busca sem acento e sem diferença de maiúsculas. */
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function useDebounced<T>(value: T, ms: number) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function CommandPalette({
  open,
  onClose,
  features,
}: {
  open: boolean;
  onClose: () => void;
  features: { voiceAssistant?: boolean; subscriptions?: boolean };
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  const navigate = useNavigate();
  const can = useCan();
  const logout = useLogout();
  const theme = useTheme();
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const dq = useDebounced(q.trim(), 220);
  const searching = dq.length >= 2;

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      setQ('');
      setActive(0);
      d.showModal?.();
      requestAnimationFrame(() => input.current?.focus());
    }
    if (!open && d.open) d.close?.();
  }, [open]);

  const go = (to: string) => () => navigate(to, { viewTransition: true });

  const customers = useQuery({
    queryKey: ['cmdk', 'customers', dq],
    queryFn: () => api<Paginated<CustomerDTO>>(`/api/customers?pageSize=5&q=${encodeURIComponent(dq)}`),
    enabled: open && searching && can('customer:read'),
    staleTime: 30_000,
  });
  const quotes = useQuery({
    queryKey: ['cmdk', 'quotes', dq],
    queryFn: () => api<Paginated<QuoteSummaryDTO>>(`/api/quotes?pageSize=5&q=${encodeURIComponent(dq)}`),
    enabled: open && searching && can('quote:read'),
    staleTime: 30_000,
  });
  const projects = useQuery({
    queryKey: ['cmdk', 'projects', dq],
    queryFn: () => api<ProjectSummaryDTO[]>(`/api/projects?q=${encodeURIComponent(dq)}`),
    enabled: open && searching && can('project:read'),
    staleTime: 30_000,
  });

  const commands = useMemo(() => {
    const allow = (p?: Permission) => !p || can(p);
    const pages: (Omit<Command, 'group' | 'run'> & { to: string; perm?: Permission; show?: boolean })[] = [
      { id: 'p-inicio', label: 'Início', icon: Home, to: '/', keywords: 'painel dashboard' },
      { id: 'p-orc', label: 'Orçamentos', icon: FileText, to: '/orcamentos', perm: 'quote:read', keywords: 'propostas' },
      { id: 'p-cli', label: 'Clientes', icon: Users, to: '/clientes', perm: 'customer:read' },
      { id: 'p-obras', label: 'Obras', icon: HardHat, to: '/obras', perm: 'project:read', keywords: 'medicao medição' },
      { id: 'p-fin', label: 'Financeiro', icon: Wallet, to: '/financeiro', perm: 'finance:read', keywords: 'caixa gastos receber pagar' },
      { id: 'p-est', label: 'Materiais e estoque', icon: Boxes, to: '/estoque', perm: 'stock:read' },
      {
        id: 'p-serv',
        label: 'Serviços e preços',
        icon: ListChecks,
        to: '/empresa/servicos',
        perm: 'catalog:read',
        keywords: 'catalogo catálogo',
      },
      {
        id: 'p-ass',
        label: 'Assistente',
        icon: Sparkles,
        to: '/assistente',
        perm: 'ai:use',
        show: !!features.voiceAssistant,
        keywords: 'voz ia',
      },
      { id: 'p-emp', label: 'Minha empresa', icon: Building2, to: '/empresa', keywords: 'logo marca dados' },
      {
        id: 'p-plano',
        label: 'Plano e assinatura',
        icon: CreditCard,
        to: '/assinatura',
        perm: 'billing:manage',
        show: !!features.subscriptions,
      },
      { id: 'p-conta', label: 'Minha conta', icon: UserRound, to: '/conta', keywords: 'senha perfil equipe' },
    ];
    const creates: (Omit<Command, 'group' | 'run'> & { to: string; perm: Permission })[] = [
      { id: 'c-orc', label: 'Novo orçamento', icon: FilePlus2, tone: 'brand', to: '/orcamentos/novo', perm: 'quote:write' },
      { id: 'c-cli', label: 'Novo cliente', icon: UserPlus, tone: 'violet', to: '/clientes/novo', perm: 'customer:write' },
      { id: 'c-gasto', label: 'Registrar gasto', icon: Receipt, tone: 'red', to: '/financeiro/gasto/novo', perm: 'finance:write' },
      { id: 'c-obra', label: 'Nova obra a partir de orçamento', icon: HardHat, tone: 'yellow', to: '/obras/nova', perm: 'project:write' },
    ];
    const themes: [ThemeChoice, LucideIcon][] = [
      ['light', Sun],
      ['dark', Moon],
      ['system', Monitor],
    ];
    const list: Command[] = [
      ...creates.filter((c) => allow(c.perm)).map((c) => ({ ...c, label: t(c.label), group: t('Criar'), run: go(c.to) })),
      ...pages
        .filter((p) => allow(p.perm) && p.show !== false)
        .map((p) => ({ ...p, label: t(p.label), group: t('Ir para'), tone: 'gray' as Tone, run: go(p.to) })),
      ...themes.map(([c, icon]) => ({
        id: `t-${c}`,
        group: t('Preferências'),
        label: t('Tema: {name}', { name: t(THEME_LABEL[c]) }),
        hint: theme.choice === c ? t('Em uso') : undefined,
        icon,
        tone: 'gray' as Tone,
        keywords: 'tema aparencia aparência modo escuro claro theme dark light',
        run: () => setTheme(c),
      })),
      ...(
        [
          ['pt-BR', 'Português'],
          ['en', 'English'],
        ] as const
      ).map(([l, name]) => ({
        id: `l-${l}`,
        group: t('Preferências'),
        label: t('Idioma: {name}', { name }),
        hint: getLocale() === l ? t('Em uso') : undefined,
        icon: Languages,
        tone: 'gray' as Tone,
        keywords: 'idioma lingua língua language english portugues português',
        run: () => void setLocale(l),
      })),
      {
        id: 'sair',
        group: t('Preferências'),
        label: t('Sair da conta'),
        icon: LogOut,
        tone: 'red',
        keywords: 'logout',
        run: () => void logout(),
      },
    ];
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [can, features.voiceAssistant, features.subscriptions, theme.choice]);

  const results = useMemo(() => {
    const term = norm(q.trim());
    const local = term ? commands.filter((c) => norm(`${c.label} ${c.keywords ?? ''}`).includes(term)) : commands;
    const remote: Command[] = [];
    if (searching) {
      for (const c of customers.data?.data ?? []) {
        remote.push({
          id: `cu-${c.id}`,
          group: t('Clientes'),
          label: c.name,
          hint: [c.city, c.phone ? formatPhone(c.phone) : null].filter(Boolean).join(' · ') || undefined,
          icon: Users,
          tone: 'violet',
          run: go(`/clientes/${c.id}`),
        });
      }
      for (const o of quotes.data?.data ?? []) {
        remote.push({
          id: `qu-${o.id}`,
          group: t('Orçamentos'),
          label: t('Nº {number} · {title}', { number: o.number, title: o.title }),
          hint: `${o.customer.name} · ${formatBRL(o.totalCents)}`,
          icon: FileText,
          tone: 'brand',
          run: go(`/orcamentos/${o.id}`),
        });
      }
      for (const p of (projects.data ?? []).slice(0, 5)) {
        remote.push({
          id: `pr-${p.id}`,
          group: t('Obras'),
          label: p.name,
          hint: t('{customer} · {pct}% medido', { customer: p.customer.name, pct: Number(p.progressPercent).toLocaleString(intlLocale()) }),
          icon: HardHat,
          tone: 'yellow',
          run: go(`/obras/${p.id}`),
        });
      }
    }
    return [...remote, ...local];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, commands, searching, customers.data, quotes.data, projects.data]);

  useEffect(() => setActive(0), [q]);
  useEffect(() => {
    document.getElementById(`${listId}-${active}`)?.scrollIntoView({ block: 'nearest' });
  }, [active, listId]);

  const choose = (c: Command | undefined) => {
    if (!c) return;
    onClose();
    c.run();
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => (results.length ? (a + 1) % results.length : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => (results.length ? (a - 1 + results.length) % results.length : 0));
    } else if (e.key === 'Home') {
      e.preventDefault();
      setActive(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      setActive(Math.max(0, results.length - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choose(results[active]);
    }
  };

  const loading = searching && (customers.isFetching || quotes.isFetching || projects.isFetching);
  let lastGroup = '';

  return (
    <dialog
      ref={ref}
      className="cmdk"
      aria-label={t('Buscar ou ir para')}
      onClose={onClose}
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose(); // clique fora fecha
      }}
    >
      {open && (
        <>
          <div className="cmdk-head">
            <Search aria-hidden />
            <input
              ref={input}
              className="cmdk-input"
              role="combobox"
              aria-expanded="true"
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={results.length ? `${listId}-${active}` : undefined}
              aria-label={t('Buscar telas, ações, clientes, orçamentos e obras')}
              placeholder={t('Buscar ou ir para…')}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={onKey}
              autoComplete="off"
              spellCheck={false}
            />
            <button type="button" className="icon-btn" onClick={onClose} aria-label={t('Esc: fechar busca')}>
              <kbd>Esc</kbd>
            </button>
          </div>
          <ul className="cmdk-list" id={listId} role="listbox" aria-label={t('Resultados')}>
            {results.map((c, i) => {
              const head = c.group !== lastGroup ? c.group : null;
              lastGroup = c.group;
              return (
                <li key={c.id} role="presentation">
                  {head && (
                    <div className="cmdk-group" role="presentation" aria-hidden>
                      {head}
                    </div>
                  )}
                  <div
                    id={`${listId}-${i}`}
                    role="option"
                    aria-selected={i === active}
                    className="cmdk-item"
                    onMouseMove={() => setActive(i)}
                    onClick={() => choose(c)}
                  >
                    <IconTile icon={c.icon} tone={c.tone ?? 'gray'} size="sm" />
                    <span className="cmdk-item-main">
                      <strong>{c.label}</strong>
                      {c.hint && <span>{c.hint}</span>}
                    </span>
                    <span className="sr-only">{c.group}</span>
                    <CornerDownLeft className="cmdk-enter" aria-hidden />
                  </div>
                </li>
              );
            })}
          </ul>
          {results.length === 0 && (
            <p className="cmdk-empty">{loading ? t('Buscando…') : t('Nada encontrado para “{q}”.', { q: q.trim() })}</p>
          )}
          <p className="sr-only" role="status" aria-live="polite">
            {loading ? t('Buscando') : results.length === 1 ? t('1 resultado') : t('{n} resultados', { n: results.length })}
          </p>
          <div className="cmdk-foot" aria-hidden>
            <span>
              <kbd>↑</kbd>
              <kbd>↓</kbd> {t('escolher')}
            </span>
            <span>
              <kbd>Enter</kbd> {t('abrir')}
            </span>
            <span>
              <kbd>Esc</kbd> {t('fechar')}
            </span>
            {loading && <span>{t('Buscando…')}</span>}
          </div>
        </>
      )}
    </dialog>
  );
}
