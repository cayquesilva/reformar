import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Languages,
  Boxes,
  Building2,
  ChevronsLeft,
  ChevronsRight,
  CreditCard,
  FilePlus2,
  FileText,
  HardHat,
  Home,
  ListChecks,
  LogOut,
  Menu,
  Monitor,
  Moon,
  Plus,
  Receipt,
  Search,
  ShieldCheck,
  Sparkles,
  Sun,
  UserPlus,
  UserRound,
  Users,
  Wallet,
  WifiOff,
  type LucideIcon,
} from 'lucide-react';
import { getLocale, setLocale, t, tMessage } from '../lib/i18n';
import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate, useNavigation } from 'react-router';
import type { Permission, PublicConfigResponse } from '@reformar/shared';
import { api } from '../lib/api';
import { useCan, useLogout, useMe } from '../lib/auth';
import { discard, flushOutbox, useOutbox } from '../lib/outbox';
import { setTheme, THEME_LABEL, useTheme } from '../lib/theme';
import { CommandPalette } from './CommandPalette';
import { ActionMenu, type MenuItem } from './kit';

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
  perm?: Permission;
  feature?: 'voiceAssistant' | 'subscriptions';
  platform?: boolean;
}

/** Navegação agrupada por área de trabalho (barra lateral em telas grandes). */
const GROUPS: { title: string | null; items: NavItem[] }[] = [
  { title: null, items: [{ to: '/', label: 'Início', icon: Home, end: true }] },
  {
    title: 'Comercial',
    items: [
      { to: '/orcamentos', label: 'Orçamentos', icon: FileText, perm: 'quote:read' },
      { to: '/clientes', label: 'Clientes', icon: Users, perm: 'customer:read' },
      { to: '/empresa/servicos', label: 'Serviços e preços', icon: ListChecks, perm: 'catalog:read' },
    ],
  },
  {
    title: 'Obras',
    items: [
      { to: '/obras', label: 'Obras', icon: HardHat, perm: 'project:read' },
      { to: '/estoque', label: 'Materiais e estoque', icon: Boxes, perm: 'stock:read' },
    ],
  },
  {
    title: 'Financeiro',
    items: [{ to: '/financeiro', label: 'Financeiro', icon: Wallet, perm: 'finance:read' }],
  },
  {
    title: 'Ferramentas',
    items: [{ to: '/assistente', label: 'Assistente', icon: Sparkles, perm: 'ai:use', feature: 'voiceAssistant' }],
  },
  {
    title: 'Empresa',
    items: [
      { to: '/empresa', label: 'Minha empresa', icon: Building2, end: true },
      { to: '/assinatura', label: 'Plano e assinatura', icon: CreditCard, perm: 'billing:manage', feature: 'subscriptions' },
      { to: '/plataforma', label: 'Plataforma', icon: ShieldCheck, platform: true },
    ],
  },
];

const BOTTOM: NavItem[] = [
  { to: '/', label: 'Início', icon: Home, end: true },
  { to: '/orcamentos', label: 'Orçamentos', icon: FileText },
  { to: '/obras', label: 'Obras', icon: HardHat },
  { to: '/financeiro', label: 'Financeiro', icon: Wallet },
  { to: '/mais', label: 'Mais', icon: Menu },
];

const COLLAPSE_KEY = 'reformar:menu-recolhido';

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');
}

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

/** Barra fina no topo enquanto uma tela carrega (navegação mais fluida). */
function RouteProgress() {
  const navigation = useNavigation();
  return <div className={`route-progress${navigation.state !== 'idle' ? ' active' : ''}`} aria-hidden />;
}

export function Layout() {
  const { data } = useMe();
  const can = useCan();
  const qc = useQueryClient();
  const location = useLocation();
  const pending = useOutbox();
  const config = useQuery({ queryKey: ['config'], queryFn: () => api<PublicConfigResponse>('/api/config'), staleTime: 5 * 60_000 });
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(COLLAPSE_KEY) === '1');
  const [searchOpen, setSearchOpen] = useState(false);
  const navigate = useNavigate();
  const logout = useLogout();
  const theme = useTheme();

  // Ctrl/Cmd + K abre a busca de qualquer tela.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    const sync = () => {
      setOnline(navigator.onLine);
      if (navigator.onLine) {
        void flushOutbox().then((n) => {
          if (n > 0) for (const k of ['expenses', 'project', 'finance-overview']) qc.invalidateQueries({ queryKey: [k] });
        });
      }
    };
    sync();
    window.addEventListener('online', sync);
    window.addEventListener('offline', sync);
    return () => {
      window.removeEventListener('online', sync);
      window.removeEventListener('offline', sync);
    };
  }, [qc]);

  // Nova tela começa do topo.
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [location.pathname]);

  const toggle = () =>
    setCollapsed((c) => {
      localStorage.setItem(COLLAPSE_KEY, c ? '0' : '1');
      return !c;
    });

  const visible = (i: NavItem) =>
    (!i.perm || can(i.perm)) && (!i.feature || !!config.data?.features[i.feature]) && (!i.platform || !!data?.isPlatformAdmin);
  const access = data?.activeTenant?.access;
  const tenantName = data?.activeTenant?.name ?? t('Minha conta');
  const userInitials = initials(data?.user.name ?? '?');

  const go = (to: string) => () => navigate(to, { viewTransition: true });
  const createItems: MenuItem[] = [
    ...(can('quote:write') ? [{ label: t('Orçamento'), icon: FilePlus2, onSelect: go('/orcamentos/novo') }] : []),
    ...(can('customer:write') ? [{ label: t('Cliente'), icon: UserPlus, onSelect: go('/clientes/novo') }] : []),
    ...(can('finance:write') ? [{ label: t('Gasto'), icon: Receipt, onSelect: go('/financeiro/gasto/novo') }] : []),
    ...(can('project:write') ? [{ label: t('Obra a partir de orçamento'), icon: HardHat, onSelect: go('/obras/nova') }] : []),
  ];
  const themeItems: MenuItem[] = (
    [
      ['light', Sun],
      ['dark', Moon],
      ['system', Monitor],
    ] as const
  ).map(([c, icon]) => ({
    label: t('Tema {name}', { name: t(THEME_LABEL[c]).toLowerCase() }),
    icon,
    checked: theme.choice === c,
    onSelect: () => setTheme(c),
  }));
  const locale = getLocale();
  const languageItems: MenuItem[] = (
    [
      ['pt-BR', 'Português'],
      ['en', 'English'],
    ] as const
  ).map(([l, name], i) => ({
    label: name,
    icon: Languages,
    checked: locale === l,
    separator: i === 0,
    onSelect: () => void setLocale(l),
  }));
  const accountHeader = (
    <>
      <span className="avatar" aria-hidden>
        {userInitials}
      </span>
      <span className="menu-head-text">
        <strong>{data?.user.name}</strong>
        <span>{tenantName}</span>
      </span>
    </>
  );
  const accountItems: MenuItem[] = [
    { label: t('Minha conta'), icon: UserRound, onSelect: go('/conta') },
    { label: t('Minha empresa'), icon: Building2, onSelect: go('/empresa') },
    ...themeItems.map((it, i) => (i === 0 ? { ...it, separator: true } : it)),
    ...languageItems,
    { label: t('Sair'), icon: LogOut, danger: true, separator: true, onSelect: () => void logout() },
  ];
  const ThemeIcon = theme.resolved === 'dark' ? Moon : Sun;
  const accountMenu = (
    <ActionMenu
      label={t('Minha conta ({name})', { name: tenantName })}
      items={accountItems}
      header={accountHeader}
      triggerClass="avatar-btn"
      trigger={
        <span className="avatar" aria-hidden>
          {userInitials}
        </span>
      }
    />
  );

  return (
    <div className={`shell${collapsed ? ' collapsed' : ''}`}>
      <a href="#conteudo" className="skip-link">
        {t('Pular para o conteúdo')}
      </a>
      <RouteProgress />

      {/* ---------- Barra lateral (tablet e desktop) ---------- */}
      <aside className="sidebar" aria-label={t('Barra lateral')}>
        <div className="sb-head">
          <Link to="/" className="sb-brand" aria-label={t('Reformar — ir para o início')}>
            <img src="/icon.svg" alt="" width={32} height={32} />
            <span className="sb-text">Reformar</span>
          </Link>
          <button
            type="button"
            className="sb-toggle"
            onClick={toggle}
            aria-label={collapsed ? t('Expandir menu') : t('Recolher menu')}
            aria-expanded={!collapsed}
            title={collapsed ? t('Expandir menu') : t('Recolher menu')}
          >
            {collapsed ? <ChevronsRight aria-hidden /> : <ChevronsLeft aria-hidden />}
          </button>
        </div>
        {can('quote:write') && (
          <Link to="/orcamentos/novo" className="sb-cta" viewTransition title={t('Novo orçamento')}>
            <FilePlus2 aria-hidden />
            <span className="sb-text">{t('Novo orçamento')}</span>
          </Link>
        )}
        <nav className="sb-nav" aria-label={t('Menu principal')}>
          {GROUPS.map((g) => {
            const items = g.items.filter(visible);
            if (!items.length) return null;
            return (
              <div key={g.title ?? 'inicio'} className="sb-group">
                {g.title && <p className="sb-group-title">{t(g.title)}</p>}
                <ul>
                  {items.map((i) => (
                    <li key={i.to}>
                      <NavLink to={i.to} end={i.end} className="sb-link" viewTransition title={t(i.label)}>
                        <i.icon aria-hidden />
                        <span className="sb-text">{t(i.label)}</span>
                      </NavLink>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </nav>
        <div className="sb-foot">
          <Link to="/conta" className="sb-account" title={t('{name} — minha conta', { name: tenantName })}>
            <span className="avatar" aria-hidden>
              {userInitials}
            </span>
            <span className="sb-text sb-account-text">
              <strong>{data?.user.name}</strong>
              <span>{tenantName}</span>
            </span>
          </Link>
        </div>
      </aside>

      {/* ---------- Topo (celular) ---------- */}
      <header className="mobile-top">
        <Link to="/" className="sb-brand" aria-label={t('Reformar — ir para o início')}>
          <img src="/icon.svg" alt="" width={28} height={28} />
          <span>Reformar</span>
        </Link>
        <div className="mobile-top-actions">
          <button type="button" className="top-icon" onClick={() => setSearchOpen(true)} aria-label={t('Buscar ou ir para')}>
            <Search aria-hidden />
          </button>
          {accountMenu}
        </div>
      </header>

      <div className="main-area">
        {/* ---------- Barra de topo (tablet e desktop) ---------- */}
        <header className="topbar">
          <button
            type="button"
            className="search-trigger"
            onClick={() => setSearchOpen(true)}
            aria-keyshortcuts={isMac ? 'Meta+K' : 'Control+K'}
          >
            <Search aria-hidden />
            <span className="st-label">{t('Buscar clientes, orçamentos, obras…')}</span>
            <span aria-hidden>
              <kbd>{isMac ? '⌘' : 'Ctrl'}</kbd> <kbd>K</kbd>
            </span>
          </button>
          <div className="topbar-actions">
            {createItems.length > 0 && <ActionMenu label={t('Novo')} icon={Plus} variant="primary" items={createItems} />}
            <ActionMenu
              label={t('Tema: {name}', { name: t(THEME_LABEL[theme.choice]) })}
              items={themeItems}
              triggerClass="top-icon"
              trigger={<ThemeIcon aria-hidden />}
            />
            {accountMenu}
          </div>
        </header>

        {data?.activeTenant?.isDemo && (
          <div className="banner banner-warning" role="note">
            {t('Empresa de DEMONSTRAÇÃO — todos os dados são fictícios.')}
          </div>
        )}
        {!online && (
          <div className="banner banner-dark" role="status">
            <WifiOff aria-hidden />{' '}
            {t('Sem internet. Você pode consultar o que já abriu; gastos registrados agora ficam guardados e são enviados depois.')}
          </div>
        )}
        {pending.length > 0 && (
          <div className="banner banner-warning" role="status">
            {t('{n} lançamento(s) aguardando envio.', { n: pending.length })}
            {pending.some((p) => p.lastError) && (
              <ul className="small">
                {pending
                  .filter((p) => p.lastError)
                  .map((p) => (
                    <li key={p.id}>
                      {t(p.label)}: {tMessage(p.lastError ?? '')}{' '}
                      <button type="button" className="link-btn" onClick={() => discard(p.id)}>
                        {t('Descartar')}
                      </button>
                    </li>
                  ))}
              </ul>
            )}
          </div>
        )}
        {access?.level === 'READ_ONLY' && (
          <div className="banner banner-danger" role="alert">
            {tMessage(access.reason)} <Link to="/assinatura">{t('Ver assinatura')}</Link>
          </div>
        )}
        {access?.warning && access.level === 'FULL' && (
          <div className="banner banner-warning" role="status">
            {tMessage(access.warning)} <Link to="/assinatura">{t('Ver assinatura')}</Link>
          </div>
        )}
        <main id="conteudo" className="page" tabIndex={-1}>
          <div key={location.pathname} className="page-enter">
            <Outlet />
          </div>
        </main>
      </div>

      <CommandPalette open={searchOpen} onClose={() => setSearchOpen(false)} features={config.data?.features ?? {}} />

      {/* ---------- Navegação inferior (celular) ---------- */}
      <nav className="bottomnav" aria-label={t('Menu principal (celular)')}>
        {BOTTOM.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end} viewTransition>
            <n.icon aria-hidden />
            <span>{t(n.label)}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
