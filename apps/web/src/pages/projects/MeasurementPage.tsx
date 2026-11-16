import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, HardHat, Save, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import {
  addDaysISO,
  dec,
  decToString,
  formatBRL,
  formatQuantity,
  measurementValue,
  quoteNumberLabel,
  todayISO,
  unitShort,
  type MeasurementDTO,
  type ProjectDetailDTO,
  type QuoteDetailDTO,
} from '@reformar/shared';
import { api, ApiError, errorMessage } from '../../lib/api';
import { useCan } from '../../lib/auth';
import { useToast } from '../../lib/toast';
import { PhotoGrid, PhotoPicker } from '../../components/PhotoPicker';
import {
  Button,
  Checkbox,
  Dialog,
  ErrorBox,
  InfoBox,
  MoneyField,
  PageHeader,
  QuantityField,
  Spinner,
  TextAreaField,
  TextField,
} from '../../components/ui';
import { newKey } from '../quotes/quote-form';
import { fmtDate, fmtDateTime, t, tx } from '../../lib/i18n';

/** Nova medição ou edição/confirmação de uma medição existente. */
export function MeasurementPage() {
  const { id: projectId, mid } = useParams();
  const isNew = !mid;
  const navigate = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const can = useCan();
  const project = useQuery({ queryKey: ['project', projectId], queryFn: () => api<ProjectDetailDTO>(`/api/projects/${projectId}`) });
  const measurement = useQuery({
    queryKey: ['measurement', mid],
    queryFn: async () => (await api<MeasurementDTO[]>(`/api/projects/${projectId}/measurements`)).find((m) => m.id === mid) ?? null,
    enabled: !isNew,
  });
  const [date, setDate] = useState(todayISO());
  const [notes, setNotes] = useState('');
  const [qty, setQty] = useState<Record<string, string | null>>({});
  const [loaded, setLoaded] = useState(isNew);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [charge, setCharge] = useState(true);
  const [chargeCents, setChargeCents] = useState<number | null>(null);
  const [chargeDue, setChargeDue] = useState(addDaysISO(todayISO(), 7));
  const createKey = useRef(newKey());

  const m = measurement.data;
  if (!loaded && m) {
    setDate(m.measuredOn);
    setNotes(m.notes ?? '');
    setQty(Object.fromEntries(m.items.map((i) => [i.stageId, i.quantity])));
    setLoaded(true);
  }

  const body = () => ({
    measuredOn: date,
    notes: notes || null,
    items: Object.entries(qty)
      .filter(([, v]) => v && dec(v).greaterThan(0))
      .map(([stageId, quantity]) => ({ stageId, quantity })),
  });

  const save = useMutation({
    mutationFn: async () =>
      isNew
        ? api<{ id: string }>(`/api/projects/${projectId}/measurements`, {
            body: body(),
            headers: { 'Idempotency-Key': createKey.current },
          })
        : api<MeasurementDTO>(`/api/projects/${projectId}/measurements/${mid}`, { method: 'PUT', body: body() }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['measurements', projectId] });
      qc.invalidateQueries({ queryKey: ['measurement'] });
      toast(isNew ? t('Medição salva como rascunho. Agora adicione as fotos.') : t('Medição atualizada.'));
      if (isNew) navigate(`/obras/${projectId}/medicoes/${r.id}`, { replace: true });
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });

  const confirm = useMutation({
    mutationFn: () =>
      api<MeasurementDTO>(`/api/projects/${projectId}/measurements/${mid}/confirm`, {
        body: { receivable: charge && chargeCents ? { amountCents: chargeCents, dueDate: chargeDue } : null },
      }),
    onSuccess: () => {
      setConfirmOpen(false);
      qc.invalidateQueries({ queryKey: ['measurement', mid] });
      qc.invalidateQueries({ queryKey: ['measurements', projectId] });
      qc.invalidateQueries({ queryKey: ['project', projectId] });
      toast(t('Medição confirmada. O andamento da obra foi atualizado.'));
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });

  const remove = useMutation({
    mutationFn: () => api(`/api/projects/${projectId}/measurements/${mid}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['measurements', projectId] });
      toast(t('Rascunho excluído.'));
      navigate(`/obras/${projectId}?aba=medicoes`, { replace: true });
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });

  if (project.isLoading || (!isNew && measurement.isLoading)) return <Spinner />;
  if (project.isError || !project.data) return <ErrorBox>{errorMessage(project.error)}</ErrorBox>;
  if (!isNew && !m) return <ErrorBox>{t('Medição não encontrada.')}</ErrorBox>;
  const p = project.data;
  const locked = m?.status === 'CONFIRMED';
  const editable = !locked && can('project:field');

  const estimate = p.stages.reduce((acc, s) => {
    const v = qty[s.id];
    return v && s.unitPriceCents !== null ? acc + measurementValue(v, s.unitPriceCents) : acc;
  }, 0);

  return (
    <>
      <PageHeader
        title={isNew ? t('Nova medição') : t('Medição nº {n}', { n: m!.number })}
        subtitle={
          <Link to={`/obras/${p.id}?aba=medicoes`}>
            <HardHat aria-hidden /> {t('Obra {n} · {name}', { n: String(p.number).padStart(4, '0'), name: p.name })}
          </Link>
        }
      />
      {locked && (
        <InfoBox tone="success">
          {t('Confirmada por {name} em {when}. Não pode mais ser alterada.', {
            name: m!.confirmedByName ?? '',
            when: fmtDateTime(m!.confirmedAt!),
          })}
          {m!.receivableId && ` ${t('Cobrança gerada no Financeiro.')}`}
        </InfoBox>
      )}

      <section className="card">
        <TextField
          label={t('Data da medição')}
          type="date"
          max={todayISO()}
          value={date}
          disabled={!editable}
          onChange={(e) => setDate(e.target.value)}
        />
        <h2>{t('O que foi feito neste período?')}</h2>
        <p className="muted small">{t('Informe só a quantidade executada desde a última medição. Deixe em branco o que não avançou.')}</p>
        {p.stages.map((s) => {
          const remaining = decToString(dec(s.plannedQuantity).minus(s.measuredQuantity));
          return (
            <div key={s.id} className="subcard">
              <h3>{s.name}</h3>
              <p className="muted small">
                {tx('Previsto {planned} {unit} · já medido {measured} · falta {remaining}', {
                  planned: formatQuantity(s.plannedQuantity),
                  unit: t(unitShort(s.unit)),
                  measured: formatQuantity(s.measuredQuantity),
                  remaining: (
                    <strong>
                      {formatQuantity(remaining)} {t(unitShort(s.unit))}
                    </strong>
                  ),
                })}
              </p>
              <QuantityField
                label={t('Executado agora ({unit})', { unit: t(unitShort(s.unit)) })}
                suffix={t(unitShort(s.unit))}
                optional
                value={qty[s.id] ?? null}
                onChange={(v) => setQty({ ...qty, [s.id]: v })}
                error={
                  qty[s.id] && dec(qty[s.id]!).greaterThan(remaining) && !locked
                    ? t('Passa do que falta ({qty}).', { qty: formatQuantity(remaining) })
                    : undefined
                }
              />
              {editable && (
                <Button
                  variant="ghost"
                  onClick={() => setQty({ ...qty, [s.id]: remaining })}
                  disabled={dec(remaining).lessThanOrEqualTo(0)}
                >
                  {t('Marcar etapa como concluída ({qty})', { qty: formatQuantity(remaining) })}
                </Button>
              )}
            </div>
          );
        })}
        <TextAreaField label={t('Observações')} optional value={notes} disabled={!editable} onChange={(e) => setNotes(e.target.value)} />
        {can('finance:read') && estimate > 0 && (
          <p className="calc-line">{t('Valor estimado desta medição: {value}', { value: formatBRL(estimate) })}</p>
        )}
        {editable && (
          <div className="form-actions">
            <Button variant="primary" icon={<Save aria-hidden />} loading={save.isPending} onClick={() => save.mutate()}>
              {isNew ? t('Salvar e adicionar fotos') : t('Salvar alterações')}
            </Button>
            {!isNew && (
              <Button variant="ghost" icon={<Trash2 aria-hidden />} onClick={() => remove.mutate()}>
                {t('Excluir rascunho')}
              </Button>
            )}
          </div>
        )}
      </section>

      {!isNew && (
        <section className="card" aria-labelledby="fotos-med">
          <h2 id="fotos-med">{t('Fotos do serviço realizado')}</h2>
          {!locked && can('project:field') && (
            <PhotoPicker
              uploadUrl={`/api/projects/${p.id}/photos?measurementId=${mid}`}
              onUploaded={() => qc.invalidateQueries({ queryKey: ['measurement', mid] })}
            />
          )}
          {m!.photos.length === 0 && <p className="muted">{t('Nenhuma foto. Fotos ajudam a comprovar o andamento para o cliente.')}</p>}
          <PhotoGrid photos={m!.photos} />
        </section>
      )}

      {!isNew && !locked && can('measurement:confirm') && (
        <Button
          variant="primary"
          icon={<CheckCircle2 aria-hidden />}
          onClick={() => {
            setChargeCents(
              m!.items.reduce((a, i) => {
                const s = p.stages.find((x) => x.id === i.stageId);
                return a + (s?.unitPriceCents ? measurementValue(i.quantity, s.unitPriceCents) : 0);
              }, 0) || null,
            );
            setConfirmOpen(true);
          }}
        >
          {t('Confirmar medição')}
        </Button>
      )}
      {!isNew && !locked && !can('measurement:confirm') && (
        <p className="muted">{t('O gestor da obra confere e confirma esta medição.')}</p>
      )}

      <Dialog open={confirmOpen} title={t('Confirmar medição?')} onClose={() => setConfirmOpen(false)}>
        <p>
          {tx('Medição de {date}. Depois de confirmada, as quantidades entram no andamento da obra e {nao}.', {
            date: fmtDate(date),
            nao: <strong>{t('não podem mais ser alteradas')}</strong>,
          })}
        </p>
        {can('finance:write') && (
          <>
            <Checkbox label={t('Gerar cobrança do cliente para esta medição')} checked={charge} onChange={setCharge} />
            {charge && (
              <>
                <MoneyField
                  label={t('Valor a cobrar')}
                  hint={t('Calculado pelas quantidades × preço de cada etapa. Confira antes.')}
                  value={chargeCents}
                  onChange={setChargeCents}
                />
                <TextField label={t('Vencimento')} type="date" value={chargeDue} onChange={(e) => setChargeDue(e.target.value)} />
              </>
            )}
          </>
        )}
        <div className="form-actions">
          <Button variant="primary" loading={confirm.isPending} onClick={() => confirm.mutate()}>
            {t('Sim, confirmar')}
          </Button>
          <Button onClick={() => setConfirmOpen(false)}>{t('Cancelar')}</Button>
        </div>
      </Dialog>
    </>
  );
}

/** Confirmação para transformar orçamento aprovado em obra. */
export function ConvertQuotePage() {
  const [params] = useSearchParams();
  const quoteId = params.get('orcamento');
  const navigate = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const key = useRef(newKey());
  const [start, setStart] = useState(todayISO());
  const [end, setEnd] = useState('');
  const quote = useQuery({
    queryKey: ['quote', quoteId],
    queryFn: () => api<QuoteDetailDTO>(`/api/quotes/${quoteId}`),
    enabled: !!quoteId,
  });
  const create = useMutation({
    mutationFn: () =>
      api<{ id: string }>('/api/projects/from-quote', {
        body: { quoteId, confirm: true, startDate: start || null, expectedEndDate: end || null },
        headers: { 'Idempotency-Key': key.current },
      }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['projects'] });
      qc.invalidateQueries({ queryKey: ['quote', quoteId] });
      toast(t('Obra criada.'));
      navigate(`/obras/${r.id}`, { replace: true });
    },
    onError: (e) => {
      if (e instanceof ApiError && e.code === 'PROJECT_EXISTS') {
        toast(t('Este orçamento já virou obra.'), 'error');
        navigate(`/orcamentos/${quoteId}`);
      } else toast(errorMessage(e), 'error');
    },
  });
  if (!quoteId) return <ErrorBox>{t('Orçamento não informado.')}</ErrorBox>;
  if (quote.isLoading) return <Spinner />;
  if (!quote.data) return <ErrorBox>{errorMessage(quote.error)}</ErrorBox>;
  const q = quote.data;
  return (
    <>
      <PageHeader
        title={t('Transformar em obra')}
        subtitle={t('Orçamento nº {number} · {title}', { number: quoteNumberLabel(q.number), title: q.title })}
      />
      <section className="card">
        {q.status !== 'APPROVED' ? (
          <ErrorBox>{t('Só orçamentos aprovados podem virar obra.')}</ErrorBox>
        ) : (
          <>
            <p>
              {tx(
                'A obra será criada com os serviços do orçamento como {etapas} (para medição), os materiais previstos e o valor do contrato de {total} (revisão {rev}). Nenhuma cobrança é criada automaticamente.',
                { etapas: <strong>{t('etapas')}</strong>, total: <strong>{formatBRL(q.totalCents)}</strong>, rev: q.approval?.revision },
              )}
            </p>
            <div className="grid-2">
              <TextField label={t('Início')} type="date" optional value={start} onChange={(e) => setStart(e.target.value)} />
              <TextField label={t('Previsão de término')} type="date" optional value={end} onChange={(e) => setEnd(e.target.value)} />
            </div>
            <div className="form-actions">
              <Button variant="primary" loading={create.isPending} onClick={() => create.mutate()}>
                {t('Criar obra')}
              </Button>
              <Link to={`/orcamentos/${q.id}`} className="btn btn-ghost">
                {t('Cancelar')}
              </Link>
            </div>
          </>
        )}
      </section>
    </>
  );
}
