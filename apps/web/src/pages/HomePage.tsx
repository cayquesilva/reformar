import { useQuery } from '@tanstack/react-query';
import {
  ArrowRight,
  BarChart3,
  CheckCircle2,
  Clock,
  FileEdit,
  FilePlus2,
  FileText,
  HandCoins,
  HardHat,
  Hourglass,
  Receipt,
  Sparkles,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';
import { formatBRL, type DashboardDTO, type FinanceOverviewDTO, type ProjectSummaryDTO, type PublicConfigResponse } from '@reformar/shared';
import { api } from '../lib/api';
import { useCan, useMe } from '../lib/auth';
import { CashFlowChart } from '../components/charts';
import { Avatar, EmptyIllustrated, IconTile, Kpi, ProgressRing } from '../components/kit';
import { ErrorBox, InfoBox, Spinner } from '../components/ui';
import { ProjectStatusBadge } from './projects/ProjectsPages';
import { QuoteRow } from './quotes/QuoteRow';
import { fmtDate, intlLocale, t } from '../lib/i18n';

function Action({ to, label, icon, tone, primary }: { to: string; label: string; icon: ReactNode; tone?: string; primary?: boolean }) {
  return (
    <Link to={to} className={`action${primary ? ' action-primary' : ''}${tone ? ` tone-${tone}` : ''}`} viewTransition>
      <span className="action-icon" aria-hidden>
        {icon}
      </span>
      <span>{label}</span>
    </Link>
  );
}

function todayLabel() {
  const s = new Date().toLocaleDateString(intlLocale(), { weekday: 'long', day: 'numeric', month: 'long' });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function HomePage() {
  const { data: me } = useMe();
  const can = useCan();
  const [params] = useSearchParams();
  const config = useQuery({ queryKey: ['config'], queryFn: () => api<PublicConfigResponse>('/api/config'), staleTime: 5 * 60_000 });
  const dashboard = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api<DashboardDTO>('/api/dashboard'),
    enabled: can('dashboard:read'),
  });
  const projects = useQuery({
    queryKey: ['projects', 'ACTIVE'],
    queryFn: () => api<ProjectSummaryDTO[]>('/api/projects?status=ACTIVE'),
    enabled: can('project:read'),
  });
  const finance = useQuery({
    queryKey: ['finance-overview'],
    queryFn: () => api<FinanceOverviewDTO>('/api/finance/overview'),
    enabled: can('finance:read'),
  });
  const firstName = me?.user.name.split(' ')[0];
  const d = dashboard.data;

  return (
    <>
      <div className="home-head">
        <div>
          <h1 className="greeting">{t('Olá, {name}!', { name: firstName })}</h1>
          <p className="home-date">{todayLabel()}</p>
        </div>
      </div>
      {params.get('bemvindo') && (
        <InfoBox tone="success">
          {t('Conta criada. Comece completando os')} <Link to="/empresa">{t('dados da sua empresa')}</Link>{' '}
          {t('(eles aparecem no PDF) ou já faça seu primeiro orçamento.')}
        </InfoBox>
      )}

      <nav className="actions-grid" aria-label={t('Ações principais')}>
        {can('quote:write') && <Action to="/orcamentos/novo" label={t('Novo orçamento')} icon={<FilePlus2 />} primary />}
        {can('ai:use') && config.data?.features.voiceAssistant && (
          <Action to="/assistente" label={t('Falar com assistente')} icon={<Sparkles />} tone="violet" />
        )}
        {can('project:read') && <Action to="/obras" label={t('Minhas obras')} icon={<HardHat />} tone="yellow" />}
        {can('finance:write') && <Action to="/financeiro?aba=receber" label={t('Receber pagamento')} icon={<HandCoins />} tone="green" />}
        {can('finance:write') && <Action to="/financeiro/gasto/novo" label={t('Registrar gasto')} icon={<Receipt />} tone="red" />}
        {can('quote:read') && <Action to="/orcamentos" label={t('Meus orçamentos')} icon={<FileText />} />}
      </nav>

      {dashboard.isLoading && <Spinner variant="list" />}
      {dashboard.isError && <ErrorBox>{t('Não foi possível carregar o resumo.')}</ErrorBox>}
      {d && (
        <section aria-labelledby="resumo">
          <h2 id="resumo" className="sr-only">
            {t('Resumo')}
          </h2>
          <div className="kpis">
            <Kpi
              label={t('Aguardando resposta')}
              value={d.awaiting.count}
              icon={Clock}
              sub={formatBRL(d.awaiting.totalCents)}
              to="/orcamentos?status=SENT"
            />
            <Kpi
              label={t('Aprovados este mês')}
              value={d.approvedThisMonth.count}
              icon={CheckCircle2}
              tone="green"
              sub={formatBRL(d.approvedThisMonth.totalCents)}
              to="/orcamentos?status=APPROVED"
            />
            <Kpi
              label={t('Rascunhos')}
              value={d.drafts}
              icon={FileEdit}
              tone="gray"
              sub={t('não enviados')}
              to="/orcamentos?status=DRAFT"
            />
            {finance.data && (
              <Kpi
                label={t('A receber')}
                value={finance.data.receivable.openCents}
                money
                icon={HandCoins}
                tone="green"
                sub={t('esta semana {value}', { value: formatBRL(finance.data.receivable.dueThisWeekCents) })}
                to="/financeiro?aba=receber"
              />
            )}
            {d.expired > 0 && (
              <Kpi
                label={t('Vencidos sem resposta')}
                value={d.expired}
                icon={Hourglass}
                tone="yellow"
                emphasis="warning"
                sub={t('atualize a validade')}
                to="/orcamentos?status=EXPIRED"
              />
            )}
          </div>
        </section>
      )}

      <div className="split section">
        {finance.data ? (
          <section className="card" aria-labelledby="fluxo-inicio">
            <div className="panel-title">
              <div className="section-title" style={{ margin: 0 }}>
                <IconTile icon={BarChart3} size="sm" />
                <h2 id="fluxo-inicio">{t('Fluxo de caixa')}</h2>
              </div>
              <Link to="/financeiro" className="btn btn-ghost" viewTransition>
                <span>{t('Detalhes')}</span>
                <ArrowRight aria-hidden />
              </Link>
            </div>
            <CashFlowChart data={finance.data.cashFlow} height={220} />
          </section>
        ) : (
          d && (
            <section aria-labelledby="recentes-a">
              <h2 id="recentes-a">{t('Últimos orçamentos')}</h2>
              <ul className="list">
                {d.recentQuotes.map((q) => (
                  <QuoteRow key={q.id} quote={q} />
                ))}
              </ul>
            </section>
          )
        )}

        {can('project:read') && (
          <section aria-labelledby="obras-andamento">
            <div className="panel-title">
              <h2 id="obras-andamento">{t('Obras em andamento')}</h2>
              <Link to="/obras" className="btn btn-ghost" viewTransition>
                <span>{t('Ver obras')}</span>
                <ArrowRight aria-hidden />
              </Link>
            </div>
            {projects.isLoading && <Spinner variant="list" />}
            {projects.data?.length === 0 && (
              <EmptyIllustrated icon={HardHat} title={t('Nenhuma obra em andamento')}>
                {t('Orçamentos aprovados podem virar obra.')}
              </EmptyIllustrated>
            )}
            {projects.data && projects.data.length > 0 && (
              <div className="cards-grid cards-stack">
                {projects.data.slice(0, 4).map((p) => (
                  <Link key={p.id} to={`/obras/${p.id}`} className="p-card p-card-compact" viewTransition>
                    <div className="p-card-body">
                      <ProgressRing
                        percent={p.progressPercent}
                        label={t('Andamento da obra {name}', { name: p.name })}
                        size={58}
                        stroke={7}
                      />
                      <div className="p-card-facts">
                        <span className="p-card-title">{p.name}</span>
                        <span className="p-card-meta">
                          <Avatar name={p.customer.name} size="sm" />
                          <span>{p.customer.name}</span>
                        </span>
                        {p.expectedEndDate && (
                          <span className="muted small">{t('Previsão {date}', { date: fmtDate(p.expectedEndDate) })}</span>
                        )}
                      </div>
                    </div>
                    <ProjectStatusBadge status={p.status} late={p.late} />
                  </Link>
                ))}
              </div>
            )}
          </section>
        )}
      </div>

      {finance.data && d && (
        <section className="section" aria-labelledby="recentes">
          <div className="panel-title">
            <h2 id="recentes">{t('Últimos orçamentos')}</h2>
            <Link to="/orcamentos" className="btn btn-ghost" viewTransition>
              <span>{t('Ver todos')}</span>
              <ArrowRight aria-hidden />
            </Link>
          </div>
          {d.recentQuotes.length === 0 ? (
            <EmptyIllustrated icon={FileText} title={t('Nenhum orçamento ainda')}>
              {t('Toque em')} <strong>{t('Novo orçamento')}</strong> {t('para começar.')}
            </EmptyIllustrated>
          ) : (
            <ul className="list">
              {d.recentQuotes.map((q) => (
                <QuoteRow key={q.id} quote={q} />
              ))}
            </ul>
          )}
        </section>
      )}
    </>
  );
}
