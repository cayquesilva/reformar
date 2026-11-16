import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  Boxes,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  FileText,
  HandCoins,
  HardHat,
  Images,
  LayoutDashboard,
  LayoutGrid,
  NotebookPen,
  Plus,
  Receipt,
  Ruler,
  TrendingUp,
  Wallet,
} from 'lucide-react';
import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import {
  EXPENSE_CATEGORY_LABEL,
  formatBRL,
  formatPercent,
  formatQuantity,
  MATERIAL_SUPPLY_INFO,
  PROJECT_STATUS_LABEL,
  PROJECT_STATUSES,
  todayISO,
  unitShort,
  type AttachmentDTO,
  type DiaryEntryDTO,
  type MeasurementDTO,
  type ProjectDetailDTO,
  type ProjectStatus,
  type ProjectSummaryDTO,
} from '@reformar/shared';
import { api, errorMessage } from '../../lib/api';
import { useCan } from '../../lib/auth';
import { useToast } from '../../lib/toast';
import { PhotoGrid, PhotoPicker } from '../../components/PhotoPicker';
import { Button, ErrorBox, InfoBox, PageHeader, SelectField, Spinner, TextAreaField, TextField } from '../../components/ui';
import { ProjectFinanceTab } from '../finance/ProjectFinanceTab';
import { Avatar, EmptyIllustrated, Kpi, ProgressRing, Segmented, Tabs } from '../../components/kit';
import { RankBars } from '../../components/charts';
import { fmtDate, t, tx } from '../../lib/i18n';

export function ProgressBar({ percent, label }: { percent: string; label: string }) {
  const v = Math.max(0, Math.min(100, Number(percent)));
  return (
    <div className="progress">
      <div className="progress-label">
        <span>{label}</span>
        <strong>{formatPercent(percent)}</strong>
      </div>
      <div className="progress-track" role="progressbar" aria-label={label} aria-valuenow={v} aria-valuemin={0} aria-valuemax={100}>
        <div className="progress-fill" style={{ width: `${v}%` }} />
      </div>
    </div>
  );
}

export function ProjectStatusBadge({ status, late }: { status: ProjectStatus; late?: boolean }) {
  return (
    <span className={`badge badge-project-${status.toLowerCase()}`}>
      {late && <AlertTriangle aria-hidden />}
      {t(PROJECT_STATUS_LABEL[status])}
      {late ? ` · ${t('atrasada')}` : ''}
    </span>
  );
}

export function ProjectsListPage() {
  const [params, setParams] = useSearchParams();
  const status = params.get('status') ?? 'ACTIVE';
  const list = useQuery({
    queryKey: ['projects', status],
    queryFn: () => api<ProjectSummaryDTO[]>(`/api/projects${status === 'ALL' ? '' : `?status=${status}`}`),
  });
  return (
    <>
      <PageHeader title={t('Obras')} subtitle={t('Obras nascem de orçamentos aprovados (botão “Transformar em obra”).')} />
      <div className="toolbar">
        <Segmented
          label={t('Filtrar obras')}
          value={status}
          onChange={(v) => setParams({ status: v })}
          options={[
            { value: 'ACTIVE', label: t('Em aberto'), icon: HardHat },
            { value: 'COMPLETED', label: t('Concluídas'), icon: CheckCircle2 },
            { value: 'ALL', label: t('Todas'), icon: LayoutGrid },
          ]}
        />
      </div>
      {list.isLoading && <Spinner variant="list" />}
      {list.isError && <ErrorBox>{errorMessage(list.error)}</ErrorBox>}
      {list.data?.length === 0 && (
        <EmptyIllustrated
          icon={HardHat}
          title={t('Nenhuma obra aqui')}
          action={
            <Link className="btn btn-primary" to="/orcamentos?status=APPROVED" viewTransition>
              {t('Ver orçamentos aprovados')}
            </Link>
          }
        >
          {t('Abra um orçamento aprovado e toque em “Transformar em obra”.')}
        </EmptyIllustrated>
      )}
      {list.data && list.data.length > 0 && (
        <div className="cards-grid">
          {list.data.map((p) => (
            <Link key={p.id} to={`/obras/${p.id}`} className="p-card" viewTransition>
              <div className="p-card-head">
                <div>
                  <div className="k-num">{t('Obra {n}', { n: String(p.number).padStart(4, '0') })}</div>
                  <div className="p-card-title">{p.name}</div>
                </div>
                <ProjectStatusBadge status={p.status} late={p.late} />
              </div>
              <div className="p-card-body">
                <ProgressRing percent={p.progressPercent} label={t('Andamento da obra {name}', { name: p.name })} size={72} stroke={8} />
                <div className="p-card-facts">
                  {p.contractTotalCents !== null && (
                    <>
                      <span className="fact-label">{t('Contrato')}</span>
                      <strong>{formatBRL(p.contractTotalCents)}</strong>
                    </>
                  )}
                  {p.expectedEndDate && (
                    <span className={p.late ? 'error-text small' : 'muted small'}>
                      <CalendarDays aria-hidden /> {t('Previsão {date}', { date: fmtDate(p.expectedEndDate) })}
                    </span>
                  )}
                </div>
              </div>
              <div className="p-card-meta">
                <Avatar name={p.customer.name} size="sm" />
                <span>{p.customer.name}</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}

const TABS = [
  { id: 'resumo', label: 'Resumo', icon: LayoutDashboard },
  { id: 'medicoes', label: 'Medições', icon: Ruler },
  { id: 'diario', label: 'Diário', icon: NotebookPen },
  { id: 'fotos', label: 'Fotos', icon: Images },
  { id: 'materiais', label: 'Materiais', icon: Boxes },
  { id: 'financeiro', label: 'Financeiro', icon: Wallet },
] as const;
type TabId = (typeof TABS)[number]['id'];

export function ProjectDetailPage() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const can = useCan();
  const tab = (params.get('aba') as TabId) ?? 'resumo';
  const project = useQuery({ queryKey: ['project', id], queryFn: () => api<ProjectDetailDTO>(`/api/projects/${id}`) });

  if (project.isLoading) return <Spinner />;
  if (project.isError || !project.data) return <ErrorBox>{errorMessage(project.error)}</ErrorBox>;
  const p = project.data;
  const f = p.finance;
  const tabs = TABS.filter((tab) => tab.id !== 'financeiro' || can('finance:read')).map((tab) => ({ ...tab, label: t(tab.label) }));

  return (
    <>
      <PageHeader
        title={t('Obra {n} · {name}', { n: String(p.number).padStart(4, '0'), name: p.name })}
        back={{ to: '/obras', label: t('Obras') }}
        subtitle={
          <>
            <Link to={`/clientes/${p.customer.id}`}>{p.customer.name}</Link>
            {p.quote && (
              <>
                {' · '}
                <Link to={`/orcamentos/${p.quote.id}`}>
                  {t('Orçamento nº {number} (rev. {rev})', { number: String(p.quote.number).padStart(4, '0'), rev: p.quote.revision })}
                </Link>
              </>
            )}
          </>
        }
        actions={
          can('project:field') && (
            <Link to={`/obras/${p.id}/medicoes/nova`} className="btn btn-primary" viewTransition>
              <Ruler aria-hidden />
              <span>{t('Nova medição')}</span>
            </Link>
          )
        }
      />

      <section className="hero" aria-label={t('Situação da obra')}>
        <div className="hero-ring">
          <ProgressRing percent={p.progressPercent} label={t('Andamento físico (serviços medidos)')} size={104} stroke={10} />
          <div className="ring-caption">
            <p className="label-strong">{t('Andamento físico')}</p>
            <ProjectStatusBadge status={p.status} late={p.late} />
            {p.expectedEndDate && <span className="muted small">{t('Previsão: {date}', { date: fmtDate(p.expectedEndDate) })}</span>}
          </div>
        </div>
        {f && (
          <div className="kpis">
            <Kpi label={t('Contrato')} value={f.contractTotalCents} money icon={FileText} />
            <Kpi
              label={t('Recebido')}
              value={f.receivedCents}
              money
              icon={HandCoins}
              tone="green"
              sub={t('falta {value}', { value: formatBRL(f.toReceiveCents) })}
            />
            <Kpi
              label={t('Custo lançado')}
              value={f.actualCostCents}
              money
              icon={Receipt}
              tone={f.budgetOverrun ? 'red' : 'yellow'}
              emphasis={f.budgetOverrun ? 'danger' : undefined}
              sub={t('previsto {value}', { value: formatBRL(f.plannedCostCents) })}
            />
            <Kpi
              label={t('Resultado estimado')}
              value={f.estimatedResultCents}
              money
              icon={TrendingUp}
              tone="violet"
              sub={t('caixa {value}', { value: formatBRL(f.cashBalanceCents) })}
            />
          </div>
        )}
      </section>

      {p.alerts.length > 0 && (
        <InfoBox tone="warning">
          <ul>
            {p.alerts.map((a) => (
              <li key={a.code}>{a.message}</li>
            ))}
          </ul>
        </InfoBox>
      )}

      <Tabs label={t('Seções da obra')} tabs={tabs} value={tab} onChange={(v) => setParams({ aba: v }, { replace: true })} />
      <section key={tab} role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="card tab-panel">
        {tab === 'resumo' && <SummaryTab p={p} />}
        {tab === 'medicoes' && <MeasurementsTab p={p} />}
        {tab === 'diario' && <DiaryTab p={p} />}
        {tab === 'fotos' && <PhotosTab p={p} />}
        {tab === 'materiais' && <MaterialsTab p={p} />}
        {tab === 'financeiro' && <ProjectFinanceTab project={p} />}
      </section>
    </>
  );
}

function SummaryTab({ p }: { p: ProjectDetailDTO }) {
  const can = useCan();
  const toast = useToast();
  const qc = useQueryClient();
  const [form, setForm] = useState({
    status: p.status,
    startDate: p.startDate ?? '',
    expectedEndDate: p.expectedEndDate ?? '',
  });
  const save = useMutation({
    mutationFn: () =>
      api<ProjectDetailDTO>(`/api/projects/${p.id}`, {
        method: 'PUT',
        body: {
          name: p.name,
          status: form.status,
          siteAddress: p.siteAddress,
          siteCity: p.siteCity,
          siteState: p.siteState,
          startDate: form.startDate || null,
          expectedEndDate: form.expectedEndDate || null,
          notes: p.notes,
        },
      }),
    onSuccess: (d) => {
      qc.setQueryData(['project', p.id], d);
      qc.invalidateQueries({ queryKey: ['projects'] });
      toast(t('Obra atualizada.'));
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  const f = p.finance;
  return (
    <>
      <div className="split">
        <section aria-labelledby="etapas">
          <h2 id="etapas" style={{ marginTop: 0 }}>
            {t('Etapas')}
          </h2>
          {p.stages.length === 0 && (
            <p className="muted">{t('Sem etapas. Obras criadas de orçamento já vêm com os serviços como etapas.')}</p>
          )}
          <ul className="plain-list">
            {p.stages.map((s) => (
              <li key={s.id} className="stage-row">
                <span>
                  <strong>{s.name}</strong>
                  <span className="muted small block">
                    {t('{done} de {planned} {unit}', {
                      done: formatQuantity(s.measuredQuantity),
                      planned: formatQuantity(s.plannedQuantity),
                      unit: t(unitShort(s.unit)),
                    })}
                    {s.unitPriceCents !== null && ` · ${formatBRL(s.unitPriceCents)}/${t(unitShort(s.unit))}`}
                  </span>
                </span>
                <ProgressBar percent={s.progressPercent} label={s.status === 'DONE' ? t('Concluída') : t('Executado')} />
              </li>
            ))}
          </ul>
        </section>
        {f && (
          <section aria-labelledby="dinheiro">
            <h2 id="dinheiro" style={{ marginTop: 0 }}>
              {t('Dinheiro da obra')}
            </h2>
            <dl className="totals">
              <div>
                <dt>{t('Valor do contrato')}</dt>
                <dd>{formatBRL(f.contractTotalCents)}</dd>
              </div>
              <div>
                <dt>{t('Recebido')}</dt>
                <dd>{formatBRL(f.receivedCents)}</dd>
              </div>
              <div>
                <dt>{t('A receber')}</dt>
                <dd>{formatBRL(f.toReceiveCents)}</dd>
              </div>
              {f.unscheduledCents > 0 && (
                <div>
                  <dt>{t('Ainda sem cobrança lançada')}</dt>
                  <dd>{formatBRL(f.unscheduledCents)}</dd>
                </div>
              )}
              <div>
                <dt>{t('Custo previsto (orçamento)')}</dt>
                <dd>{formatBRL(f.plannedCostCents)}</dd>
              </div>
              <div className={f.budgetOverrun ? 'negative' : ''}>
                <dt>{t('Custo lançado até agora')}</dt>
                <dd>{formatBRL(f.actualCostCents)}</dd>
              </div>
              <div>
                <dt>{t('Contas a pagar')}</dt>
                <dd>{formatBRL(f.payableCents)}</dd>
              </div>
              <div className="total-strong">
                <dt>{t('Resultado estimado (lucro)')}</dt>
                <dd>{formatBRL(f.estimatedResultCents)}</dd>
              </div>
              <div className="total-strong">
                <dt>{t('Saldo de caixa da obra')}</dt>
                <dd>{formatBRL(f.cashBalanceCents)}</dd>
              </div>
            </dl>
            <p className="muted small">
              <strong>{t('Resultado estimado')}</strong> {t('= contrato − custos lançados − imposto estimado.')}{' '}
              <strong>{t('Saldo de caixa')}</strong>{' '}
              {t('= dinheiro recebido − dinheiro pago. São coisas diferentes: a obra pode dar lucro e ainda estar com caixa negativo.')}
            </p>
            {Object.entries(f.costsByCategory).some(([, v]) => v > 0) && (
              <>
                <h3>{t('Custos por tipo')}</h3>
                <RankBars
                  label={t('Custos lançados por tipo')}
                  items={Object.entries(f.costsByCategory)
                    .filter(([, v]) => v > 0)
                    .map(([k, v]) => ({ label: t(EXPENSE_CATEGORY_LABEL[k as keyof typeof EXPENSE_CATEGORY_LABEL]), cents: v }))}
                />
              </>
            )}
          </section>
        )}
      </div>

      {can('project:write') && (
        <>
          <h2>{t('Situação e prazo')}</h2>
          <div className="grid-3">
            <SelectField
              label={t('Situação')}
              value={form.status}
              onChange={(e) => setForm({ ...form, status: e.target.value as ProjectStatus })}
            >
              {PROJECT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(PROJECT_STATUS_LABEL[s])}
                </option>
              ))}
            </SelectField>
            <TextField
              label={t('Início')}
              type="date"
              value={form.startDate}
              onChange={(e) => setForm({ ...form, startDate: e.target.value })}
            />
            <TextField
              label={t('Previsão de término')}
              type="date"
              value={form.expectedEndDate}
              onChange={(e) => setForm({ ...form, expectedEndDate: e.target.value })}
            />
          </div>
          <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>
            {t('Salvar')}
          </Button>
        </>
      )}
      <p className="muted small">
        {t(
          'Este sistema acompanha execução e custos. Não substitui responsável técnico (engenheiro/arquiteto) nem atesta segurança estrutural ou conformidade com normas.',
        )}
      </p>
    </>
  );
}

function MeasurementsTab({ p }: { p: ProjectDetailDTO }) {
  const can = useCan();
  const list = useQuery({ queryKey: ['measurements', p.id], queryFn: () => api<MeasurementDTO[]>(`/api/projects/${p.id}/measurements`) });
  return (
    <>
      <p className="muted">
        {tx(
          'Medição = registro do que foi feito no período (quantidades por etapa) com fotos. Depois de {confirmada}, não muda mais e pode gerar a cobrança do cliente.',
          { confirmada: <strong>{t('confirmada')}</strong> },
        )}
      </p>
      {can('project:field') && (
        <Link to={`/obras/${p.id}/medicoes/nova`} className="btn btn-primary">
          <Ruler aria-hidden />
          <span>{t('Nova medição')}</span>
        </Link>
      )}
      {list.isLoading && <Spinner />}
      {list.data?.length === 0 && <p className="muted">{t('Nenhuma medição ainda.')}</p>}
      <ul className="list section">
        {list.data?.map((m) => (
          <li key={m.id}>
            <Link to={`/obras/${p.id}/medicoes/${m.id}`} className="row-link">
              <div className="row-main">
                <span className="row-title">{t('Medição nº {n} · {date}', { n: m.number, date: fmtDate(m.measuredOn) })}</span>
                <span className="muted small">
                  {m.items.map((i) => `${i.stageName}: ${formatQuantity(i.quantity)} ${t(unitShort(i.unit))}`).join(' · ') ||
                    t('Sem quantidades')}
                  {` · ${t('{n} foto(s)', { n: m.photos.length })}`}
                </span>
              </div>
              <div className="row-side">
                {m.totalCents !== null && m.status === 'CONFIRMED' && <span className="money">{formatBRL(m.totalCents)}</span>}
                <span className={`badge ${m.status === 'CONFIRMED' ? 'badge-approved' : 'badge-draft'}`}>
                  {m.status === 'CONFIRMED' ? <ClipboardCheck aria-hidden /> : null}
                  {m.status === 'CONFIRMED' ? t('Confirmada') : t('Rascunho')}
                </span>
              </div>
              <ChevronRight aria-hidden className="row-chevron" />
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}

function DiaryTab({ p }: { p: ProjectDetailDTO }) {
  const can = useCan();
  const toast = useToast();
  const qc = useQueryClient();
  const [form, setForm] = useState({ date: todayISO(), text: '', weather: '', workersCount: '' });
  const [created, setCreated] = useState<string | null>(null);
  const diary = useQuery({ queryKey: ['diary', p.id], queryFn: () => api<DiaryEntryDTO[]>(`/api/projects/${p.id}/diary`) });
  const add = useMutation({
    mutationFn: () =>
      api<{ id: string }>(`/api/projects/${p.id}/diary`, {
        body: {
          date: form.date,
          text: form.text,
          weather: form.weather || null,
          workersCount: form.workersCount ? Number(form.workersCount) : null,
        },
      }),
    onSuccess: (r) => {
      setCreated(r.id);
      setForm({ date: todayISO(), text: '', weather: '', workersCount: '' });
      qc.invalidateQueries({ queryKey: ['diary', p.id] });
      toast(t('Registro salvo. Se quiser, adicione fotos.'));
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  return (
    <>
      {can('project:field') && (
        <div className="subcard">
          <h3>
            <NotebookPen aria-hidden /> Registrar o dia
          </h3>
          <div className="grid-3">
            <TextField
              label={t('Data')}
              type="date"
              max={todayISO()}
              value={form.date}
              onChange={(e) => setForm({ ...form, date: e.target.value })}
            />
            <TextField
              label={t('Tempo')}
              optional
              placeholder={t('sol, chuva…')}
              value={form.weather}
              onChange={(e) => setForm({ ...form, weather: e.target.value })}
            />
            <TextField
              label={t('Pessoas na obra')}
              optional
              inputMode="numeric"
              value={form.workersCount}
              onChange={(e) => setForm({ ...form, workersCount: e.target.value.replace(/\D/g, '') })}
            />
          </div>
          <TextAreaField
            label={t('O que foi feito / aconteceu')}
            value={form.text}
            onChange={(e) => setForm({ ...form, text: e.target.value })}
          />
          <Button variant="primary" loading={add.isPending} onClick={() => add.mutate()}>
            {t('Salvar registro')}
          </Button>
          {created && (
            <PhotoPicker
              uploadUrl={`/api/projects/${p.id}/photos?diaryEntryId=${created}`}
              label={t('Fotos deste registro')}
              onUploaded={() => qc.invalidateQueries({ queryKey: ['diary', p.id] })}
            />
          )}
        </div>
      )}
      {diary.isLoading && <Spinner />}
      {diary.data?.length === 0 && <p className="muted">{t('Nenhum registro no diário.')}</p>}
      <ol className="timeline">
        {diary.data?.map((d) => (
          <li key={d.id}>
            <strong>
              {fmtDate(d.date)}
              {d.weather ? ` · ${d.weather}` : ''}
              {d.workersCount !== null ? ` · ${t('{n} pessoa(s)', { n: d.workersCount })}` : ''}
            </strong>
            <span style={{ whiteSpace: 'pre-wrap' }}>{d.text}</span>
            <span className="muted small">{d.createdByName}</span>
            <PhotoGrid photos={d.photos} />
          </li>
        ))}
      </ol>
    </>
  );
}

function PhotosTab({ p }: { p: ProjectDetailDTO }) {
  const can = useCan();
  const qc = useQueryClient();
  const [stageId, setStageId] = useState('');
  const photos = useQuery({
    queryKey: ['photos', p.id, stageId],
    queryFn: () => api<AttachmentDTO[]>(`/api/projects/${p.id}/photos${stageId ? `?stageId=${stageId}` : ''}`),
  });
  return (
    <>
      <SelectField label={t('Mostrar fotos de')} value={stageId} onChange={(e) => setStageId(e.target.value)}>
        <option value="">{t('Toda a obra')}</option>
        {p.stages.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </SelectField>
      {can('project:field') && (
        <PhotoPicker
          uploadUrl={`/api/projects/${p.id}/photos${stageId ? `?stageId=${stageId}` : ''}`}
          onUploaded={() => qc.invalidateQueries({ queryKey: ['photos', p.id] })}
        />
      )}
      {photos.isLoading && <Spinner />}
      {photos.data?.length === 0 && <p className="muted">{t('Nenhuma foto ainda.')}</p>}
      <PhotoGrid photos={photos.data ?? []} />
    </>
  );
}

function MaterialsTab({ p }: { p: ProjectDetailDTO }) {
  return (
    <>
      <p className="muted">
        {tx(
          'Materiais previstos no orçamento. Para acompanhar {cxu}, registre compras e uso em {estoque} e vincule o material abaixo (as unidades precisam ser iguais — o sistema não converte por suposição).',
          { cxu: <strong>{t('comprado × usado')}</strong>, estoque: <Link to="/estoque">{t('Estoque')}</Link> },
        )}
      </p>
      {p.materials.length === 0 && <p className="muted">{t('Sem materiais previstos.')}</p>}
      <ul className="plain-list">
        {p.materials.map((m) => (
          <li key={m.id}>
            <span>
              <strong>{m.description}</strong>
              <span className="muted small block">
                {t('Previsto: {qty} {unit}', { qty: formatQuantity(m.plannedQuantity), unit: m.unit })}
                {m.plannedPackages !== null && ` (${m.plannedPackages} ${m.packageLabel ?? t('emb.')})`} ·{' '}
                {t(MATERIAL_SUPPLY_INFO[m.supply].short)}
              </span>
              {m.materialId && !m.unitMismatch && (
                <span className="small block">
                  {t('Recebido na obra: {received} {unit} · Usado: {used} {unit} (previsto {planned} {unit})', {
                    received: formatQuantity(m.receivedQuantity ?? '0'),
                    used: formatQuantity(m.usedQuantity ?? '0'),
                    planned: formatQuantity(m.plannedInStockUnit ?? '0'),
                    unit: m.stockUnit ?? '',
                  })}
                </span>
              )}
              {m.unitMismatch && (
                <span className="error-text small">
                  {t('Unidade do estoque ({unit}) diferente da prevista — sem comparação.', { unit: m.stockUnit ?? '' })}
                </span>
              )}
            </span>
            <MaterialLink project={p} pmId={m.id} current={m.materialId} />
          </li>
        ))}
      </ul>
      <p className="muted small">
        <HardHat aria-hidden /> {t('Material comprado direto para a obra entra no local de estoque desta obra.')}
      </p>
    </>
  );
}

function MaterialLink({ project, pmId, current }: { project: ProjectDetailDTO; pmId: string; current: string | null }) {
  const can = useCan();
  const qc = useQueryClient();
  const toast = useToast();
  const materials = useQuery({
    queryKey: ['materials'],
    queryFn: () => api<{ id: string; name: string; unit: string }[]>('/api/materials'),
    enabled: can('stock:read'),
  });
  const link = useMutation({
    mutationFn: (materialId: string | null) =>
      api(`/api/projects/${project.id}/materials/${pmId}`, { method: 'PUT', body: { materialId } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['project', project.id] }),
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  if (!can('project:write') || !materials.data) return null;
  return (
    <SelectField label={t('Material do estoque')} value={current ?? ''} onChange={(e) => link.mutate(e.target.value || null)}>
      <option value="">{t('Não vinculado')}</option>
      {materials.data.map((m) => (
        <option key={m.id} value={m.id}>
          {m.name} ({m.unit})
        </option>
      ))}
    </SelectField>
  );
}

export function NewProjectButton({ quoteId, projectId }: { quoteId: string; projectId: string | null }) {
  const can = useCan();
  if (projectId) {
    return (
      <Link to={`/obras/${projectId}`} className="btn btn-secondary">
        <HardHat aria-hidden />
        <span>{t('Ver obra')}</span>
      </Link>
    );
  }
  if (!can('project:write')) return null;
  return (
    <Link to={`/obras/nova?orcamento=${quoteId}`} className="btn btn-primary">
      <Plus aria-hidden />
      <span>{t('Transformar em obra')}</span>
    </Link>
  );
}
