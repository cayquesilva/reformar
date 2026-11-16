import { useQuery } from '@tanstack/react-query';
import { Columns3, FileText, List, Plus, Search } from 'lucide-react';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import {
  formatBRL,
  quoteNumberLabel,
  QUOTE_STATUS_INFO,
  type Paginated,
  type QuoteDisplayStatus,
  type QuoteSummaryDTO,
} from '@reformar/shared';
import { api, errorMessage } from '../../lib/api';
import { useCan } from '../../lib/auth';
import { Avatar, EmptyIllustrated, Segmented } from '../../components/kit';
import { ErrorBox, PageHeader, Spinner } from '../../components/ui';
import { QuoteRow } from './QuoteRow';
import { t } from '../../lib/i18n';

const FILTERS = [
  { value: '', label: 'Todos' },
  { value: 'DRAFT', label: 'Rascunhos' },
  { value: 'SENT', label: 'Aguardando' },
  { value: 'APPROVED', label: 'Aprovados' },
  { value: 'REFUSED', label: 'Recusados' },
  { value: 'EXPIRED', label: 'Vencidos' },
];

const COLUMNS: QuoteDisplayStatus[] = ['DRAFT', 'SENT', 'EXPIRED', 'APPROVED', 'REFUSED'];
const VIEW_KEY = 'reformar:orcamentos-visao';

export function QuotesListPage() {
  const [params, setParams] = useSearchParams();
  const status = params.get('status') ?? '';
  const [view, setView] = useState<'lista' | 'quadro'>(() => (localStorage.getItem(VIEW_KEY) === 'quadro' ? 'quadro' : 'lista'));
  const [q, setQ] = useState('');
  const can = useCan();
  const board = view === 'quadro';
  const list = useQuery({
    queryKey: ['quotes', board ? 'board' : status, q],
    queryFn: () =>
      api<Paginated<QuoteSummaryDTO>>(
        `/api/quotes?pageSize=${board ? 100 : 50}${!board && status ? `&status=${status}` : ''}${q ? `&q=${encodeURIComponent(q)}` : ''}`,
      ),
    placeholderData: (prev) => prev,
  });
  const changeView = (v: 'lista' | 'quadro') => {
    localStorage.setItem(VIEW_KEY, v);
    setView(v);
  };

  return (
    <>
      <PageHeader
        title={t('Orçamentos')}
        subtitle={list.data ? t('{n} orçamento(s)', { n: list.data.total }) : undefined}
        actions={
          can('quote:write') && (
            <Link to="/orcamentos/novo" className="btn btn-primary" viewTransition>
              <Plus aria-hidden />
              <span>{t('Novo orçamento')}</span>
            </Link>
          )
        }
      />
      <div className="toolbar">
        <div className="search">
          <Search aria-hidden />
          <label className="sr-only" htmlFor="busca-orc">
            {t('Buscar orçamento por cliente, título ou número')}
          </label>
          <input
            id="busca-orc"
            className="input"
            type="search"
            placeholder={t('Buscar por cliente, título ou número')}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <Segmented
          label={t('Forma de visualização')}
          value={view}
          onChange={changeView}
          options={[
            { value: 'lista', label: t('Lista'), icon: List },
            { value: 'quadro', label: t('Quadro'), icon: Columns3 },
          ]}
        />
      </div>
      {!board && (
        <div className="toolbar">
          <Segmented
            size="sm"
            label={t('Filtrar por situação')}
            value={status}
            onChange={(v) => setParams(v ? { status: v } : {})}
            options={FILTERS.map((f) => ({ ...f, label: t(f.label) }))}
          />
        </div>
      )}

      {list.isLoading && <Spinner variant="list" />}
      {list.isError && <ErrorBox>{errorMessage(list.error)}</ErrorBox>}
      {list.data?.data.length === 0 && (
        <EmptyIllustrated
          icon={FileText}
          title={t('Nenhum orçamento aqui')}
          action={
            can('quote:write') && (
              <Link to="/orcamentos/novo" className="btn btn-primary" viewTransition>
                <Plus aria-hidden />
                <span>{t('Fazer um orçamento')}</span>
              </Link>
            )
          }
        >
          {status || q ? t('Tente outro filtro ou busca.') : t('Seu primeiro orçamento leva poucos minutos.')}
        </EmptyIllustrated>
      )}

      {list.data && list.data.data.length > 0 && !board && (
        <>
          <ul className="list">
            {list.data.data.map((quote) => (
              <QuoteRow key={quote.id} quote={quote} />
            ))}
          </ul>
          {list.data.total > list.data.data.length && (
            <p className="muted small">
              {t('Mostrando {shown} de {total}. Use a busca para encontrar orçamentos mais antigos.', {
                shown: list.data.data.length,
                total: list.data.total,
              })}
            </p>
          )}
        </>
      )}

      {list.data && list.data.data.length > 0 && board && <QuoteBoard quotes={list.data.data} />}
    </>
  );
}

/** Quadro por situação (somente visualização; mudar situação continua sendo feito no orçamento, com confirmação). */
function QuoteBoard({ quotes }: { quotes: QuoteSummaryDTO[] }) {
  return (
    <div className="kanban" role="region" aria-label={t('Quadro de orçamentos por situação')} tabIndex={0}>
      {COLUMNS.map((col) => {
        const items = quotes.filter((x) => x.displayStatus === col);
        const total = items.reduce((a, x) => a + x.totalCents, 0);
        return (
          <section key={col} className="kanban-col" aria-labelledby={`col-${col}`}>
            <h2 id={`col-${col}`}>
              <span className={`status-dot st-${col.toLowerCase()}`} aria-hidden />
              {t(QUOTE_STATUS_INFO[col].label)}
              <span className="count">{items.length}</span>
            </h2>
            <p className="col-total">{formatBRL(total)}</p>
            {items.length === 0 ? (
              <p className="k-empty">{t('Nenhum')}</p>
            ) : (
              <ul>
                {items.map((x) => (
                  <li key={x.id}>
                    <Link to={`/orcamentos/${x.id}`} className="k-card" viewTransition>
                      <span className="k-num">Nº {quoteNumberLabel(x.number)}</span>
                      <span className="k-title">{x.title}</span>
                      <span className="k-foot">
                        <span className="k-who">
                          <Avatar name={x.customer.name} size="sm" />
                          <span>{x.customer.name}</span>
                        </span>
                        <span className="money">{formatBRL(x.totalCents)}</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}
