import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Copy, FileDown, FileLock2, FileText, Link2, MessageCircle, Pencil, Send, Trash2, XCircle } from 'lucide-react';
import { useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import {
  APPROVAL_CHANNEL_INFO,
  APPROVAL_CHANNELS,
  formatBRL,
  formatQuantity,
  MATERIAL_SUPPLY_INFO,
  quoteNumberLabel,
  todayISO,
  unitShort,
  type ApprovalChannel,
  type QuoteDetailDTO,
  type QuoteShareDTO,
} from '@reformar/shared';
import { api, ApiError, errorMessage } from '../../lib/api';
import { useCan } from '../../lib/auth';
import { useToast } from '../../lib/toast';
import {
  Button,
  ChoiceGroup,
  Dialog,
  ErrorBox,
  InfoBox,
  PageHeader,
  SelectField,
  Spinner,
  StatusBadge,
  TextAreaField,
  TextField,
} from '../../components/ui';
import { newKey } from './quote-form';
import { CalculationSummary } from './QuoteEditorPage';
import { ActionMenu } from '../../components/kit';
import { NewProjectButton } from '../projects/ProjectsPages';
import { fmtDate, fmtDateTime, fmtDay, t, tMessage, tx } from '../../lib/i18n';

export function QuoteDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const can = useCan();
  const [dialog, setDialog] = useState<'send' | 'approve' | 'refuse' | 'delete' | null>(null);
  const [share, setShare] = useState<QuoteShareDTO | null>(null);
  const [shareMode, setShareMode] = useState<'detailed' | 'summary'>('detailed');

  const quote = useQuery({ queryKey: ['quote', id], queryFn: () => api<QuoteDetailDTO>(`/api/quotes/${id}`) });

  const refresh = (data?: QuoteDetailDTO) => {
    if (data) qc.setQueryData(['quote', id], data);
    qc.invalidateQueries({ queryKey: ['quotes'] });
    qc.invalidateQueries({ queryKey: ['dashboard'] });
  };

  const send = useMutation({
    mutationFn: () => api<QuoteDetailDTO>(`/api/quotes/${id}/send`, { method: 'POST', body: {} }),
    onSuccess: (d) => {
      refresh(d);
      setDialog(null);
      toast(t('Orçamento emitido. Agora você pode enviar ao cliente.'));
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });

  const makeShare = useMutation({
    mutationFn: (mode: 'detailed' | 'summary') => api<QuoteShareDTO>(`/api/quotes/${id}/share`, { body: { mode } }),
    onSuccess: (s) => {
      setShare(s);
      refresh();
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });

  const duplicate = useMutation({
    mutationFn: () =>
      api<{ id: string }>(`/api/quotes/${id}/duplicate`, { method: 'POST', body: {}, headers: { 'Idempotency-Key': newKey() } }),
    onSuccess: (r) => {
      refresh();
      toast(t('Cópia criada como rascunho.'));
      navigate(`/orcamentos/${r.id}`);
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });

  const remove = useMutation({
    mutationFn: () => api(`/api/quotes/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      refresh();
      toast(t('Rascunho excluído.'));
      navigate('/orcamentos', { replace: true });
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });

  if (quote.isLoading) return <Spinner />;
  if (quote.isError || !quote.data) return <ErrorBox>{errorMessage(quote.error)}</ErrorBox>;
  const q = quote.data;
  const c = q.content;
  const calc = q.calculation;
  const issued = q.versions.length > 0;
  const pdfUrl = (mode: string, download = false) => `/api/quotes/${q.id}/pdf?mode=${mode}${download ? '&download=1' : ''}`;

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast(t('Link copiado.'));
    } catch {
      toast(t('Não foi possível copiar. Selecione e copie o link manualmente.'), 'error');
    }
  };

  return (
    <>
      <PageHeader
        title={t('Orçamento nº {number}', { number: quoteNumberLabel(q.number) })}
        back={{ to: '/orcamentos', label: t('Orçamentos') }}
        subtitle={
          <>
            {q.title} · <Link to={`/clientes/${q.customer.id}`}>{q.customer.name}</Link>
            {q.currentRevision > 1 && ` · ${t('Revisão {n}', { n: q.currentRevision })}`}
          </>
        }
      />
      <div className="detail-layout">
        <div className="detail-aside">
          <section className="card summary-card" aria-label={t('Resumo do orçamento')}>
            <StatusBadge status={q.displayStatus} />
            <span className="big-money">{formatBRL(q.totalCents)}</span>
            <p className="muted small">{t('válido até {date}', { date: fmtDate(q.validUntil) })}</p>
            {/* ---------- Ações ---------- */}
            <div className="stack-actions" role="group" aria-label={t('Ações')}>
              {q.status === 'APPROVED' && <NewProjectButton quoteId={q.id} projectId={q.projectId} />}
              {q.canEdit && (
                <Link to={`/orcamentos/${q.id}/editar`} className="btn btn-secondary">
                  <Pencil aria-hidden />
                  <span>{t('Editar')}</span>
                </Link>
              )}
              {q.status === 'DRAFT' && can('quote:send') && (
                <Button variant="primary" icon={<Send aria-hidden />} onClick={() => setDialog('send')}>
                  {t('Emitir orçamento')}
                </Button>
              )}
              {(q.status === 'SENT' || q.status === 'APPROVED' || q.status === 'REFUSED') && can('quote:send') && (
                <Button
                  variant="primary"
                  icon={<Link2 aria-hidden />}
                  loading={makeShare.isPending}
                  onClick={() => makeShare.mutate(shareMode)}
                >
                  {t('Enviar ao cliente')}
                </Button>
              )}
              {q.status !== 'APPROVED' && can('quote:approve') && (
                <Button icon={<CheckCircle2 aria-hidden />} onClick={() => setDialog('approve')}>
                  {t('Cliente aprovou')}
                </Button>
              )}
              {q.status === 'SENT' && can('quote:approve') && (
                <Button icon={<XCircle aria-hidden />} onClick={() => setDialog('refuse')}>
                  {t('Cliente recusou')}
                </Button>
              )}
              <a className="btn btn-secondary" href={pdfUrl('detailed')} target="_blank" rel="noopener">
                <FileText aria-hidden />
                <span>{t('Ver PDF do cliente')}</span>
              </a>
              <ActionMenu
                items={[
                  ...(can('quote:write') ? [{ label: t('Duplicar orçamento'), icon: Copy, onSelect: () => duplicate.mutate() }] : []),
                  { label: t('PDF resumido'), icon: FileText, href: pdfUrl('summary'), newTab: true },
                  { label: t('Baixar PDF'), icon: FileDown, href: pdfUrl('detailed', true) },
                  ...(can('quote:view_costs')
                    ? [{ label: t('PDF interno (com custos)'), icon: FileLock2, href: pdfUrl('internal'), newTab: true }]
                    : []),
                  ...(q.status === 'DRAFT' && !issued && can('quote:write')
                    ? [{ label: t('Excluir rascunho'), icon: Trash2, danger: true, onSelect: () => setDialog('delete') }]
                    : []),
                ]}
              />
            </div>
            {q.status === 'DRAFT' && <p className="muted small">{t('Ainda é rascunho: o PDF sai marcado como “RASCUNHO”.')}</p>}
          </section>
          {(q.status === 'SENT' || q.status === 'APPROVED' || q.status === 'REFUSED') && can('quote:send') && !share && (
            <section className="card">
              <ChoiceGroup
                legend={t('Tipo de PDF para enviar')}
                value={shareMode}
                onChange={setShareMode}
                options={[
                  { value: 'detailed', label: t('Detalhado'), hint: t('Com quantidades e preços de cada serviço.') },
                  { value: 'summary', label: t('Resumido'), hint: t('Só o que será feito e o valor total.') },
                ]}
              />
            </section>
          )}

          {share && (
            <section className="card share" aria-label={t('Compartilhar')}>
              <h2>{t('Enviar ao cliente')}</h2>
              <p className="muted small">
                {t('Link seguro, só para leitura, válido até {date}. Mostra o PDF para o cliente — nunca os seus custos.', {
                  date: fmtDay(share.expiresAt),
                })}
              </p>
              <div className="actions">
                <a className="btn btn-primary btn-whatsapp" href={share.whatsappUrl} target="_blank" rel="noopener noreferrer">
                  <MessageCircle aria-hidden />
                  <span>{t('Enviar pelo WhatsApp')}</span>
                </a>
                <Button icon={<Copy aria-hidden />} onClick={() => copy(share.url)}>
                  {t('Copiar link')}
                </Button>
              </div>
              <label className="sr-only" htmlFor="share-url">
                {t('Link do orçamento')}
              </label>
              <input id="share-url" className="input" readOnly value={share.url} onFocus={(e) => e.currentTarget.select()} />
            </section>
          )}
        </div>
        <div className="detail-main">
          {q.displayStatus === 'EXPIRED' && (
            <InfoBox tone="warning">
              {tx('A validade passou sem resposta do cliente. Para reenviar, toque em {editar}, escolha uma nova data e emita de novo.', {
                editar: <strong>{t('Editar')}</strong>,
              })}
            </InfoBox>
          )}
          {q.status === 'DRAFT' && issued && (
            <InfoBox>
              {t('Você está editando a revisão {current}. O cliente ainda vê a revisão {sent} até você emitir esta.', {
                current: q.currentRevision,
                sent: q.versions[0]?.revision,
              })}
            </InfoBox>
          )}

          {/* ---------- Conteúdo ---------- */}
          <section className="card" aria-labelledby="servicos">
            <h2 id="servicos">{t('Serviços')}</h2>
            <ul className="plain-list">
              {c.items.map((i, n) => (
                <li key={n}>
                  <strong>{i.description}</strong>
                  <span>
                    {formatQuantity(i.quantity)} {t(unitShort(i.unit))} × {formatBRL(i.unitPriceCents)} ={' '}
                    <strong>{formatBRL(calc?.items[n]?.totalCents ?? 0)}</strong>
                  </span>
                </li>
              ))}
            </ul>
            {calc && calc.materials.length > 0 && (
              <>
                <h3>{t('Materiais')}</h3>
                <ul className="plain-list">
                  {calc.materials.map((m) => (
                    <li key={m.index}>
                      <strong>{m.description}</strong>
                      <span>
                        {m.packages !== null
                          ? t('{n} {label}(s) ({qty} {unit})', {
                              n: m.packages,
                              label: m.packageLabel ?? t('embalagem'),
                              qty: formatQuantity(m.purchaseQuantity),
                              unit: m.unit,
                            })
                          : `${formatQuantity(m.calculatedQuantity)} ${m.unit}`}{' '}
                        · {t(MATERIAL_SUPPLY_INFO[m.supply].short)}
                        {m.totalCents > 0 && ` · ${formatBRL(m.totalCents)}`}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}
            {c.paymentTerms && (
              <p>
                <strong>{t('Pagamento:')}</strong> {c.paymentTerms}
              </p>
            )}
          </section>

          {calc && (
            <section className="card" aria-labelledby="valores">
              <h2 id="valores">{t('Valores e lucro estimado')}</h2>
              <CalculationSummary calc={calc} />
            </section>
          )}

          {q.approval && (
            <section className="card" aria-labelledby="aprov">
              <h2 id="aprov">{t('Aprovação')}</h2>
              <p>
                {tx('Aprovado por {name} em {date} ({channel}), revisão {rev}.', {
                  name: <strong>{q.approval.approvedByName}</strong>,
                  date: fmtDate(q.approval.approvedOn),
                  channel: t(APPROVAL_CHANNEL_INFO[q.approval.channel]),
                  rev: q.approval.revision,
                })}
              </p>
              {q.approval.note && <p>{t('Observação: {note}', { note: q.approval.note })}</p>}
              <p className="muted small">
                {t('Registrado por {name} em {when}. Este registro é um controle interno e não substitui contrato assinado.', {
                  name: q.approval.recordedByName ?? '—',
                  when: fmtDateTime(q.approval.recordedAt),
                })}
              </p>
            </section>
          )}
          {q.status === 'REFUSED' && q.refusedReason && (
            <InfoBox>{tx('Motivo da recusa: {reason}', { reason: <strong>{q.refusedReason}</strong> })}</InfoBox>
          )}

          <section className="card" aria-labelledby="hist">
            <h2 id="hist">{t('Histórico')}</h2>
            {q.versions.length > 0 && (
              <>
                <h3>{t('Revisões emitidas')}</h3>
                <ul className="plain-list">
                  {q.versions.map((v) => (
                    <li key={v.revision}>
                      <span>
                        {t('Revisão {n}', { n: v.revision })} · {fmtDay(v.createdAt)} · {formatBRL(v.totalCents)}
                      </span>
                      <a href={`/api/quotes/${q.id}/pdf?revision=${v.revision}`} target="_blank" rel="noopener">
                        {t('Ver PDF')}
                      </a>
                    </li>
                  ))}
                </ul>
              </>
            )}
            <ol className="timeline">
              {q.history.map((h, n) => (
                <li key={n}>
                  <span>{tMessage(h.label)}</span>
                  <span className="muted small">
                    {fmtDateTime(h.at)}
                    {h.userName ? ` · ${h.userName}` : ''}
                  </span>
                </li>
              ))}
            </ol>
          </section>
        </div>
      </div>

      {/* ---------- Diálogos ---------- */}
      <Dialog open={dialog === 'send'} title={t('Emitir orçamento?')} onClose={() => setDialog(null)}>
        <p>
          {tx(
            'O orçamento de {total} será emitido como revisão {rev}. Depois de emitido, o PDF dessa revisão fica guardado como foi enviado. Se precisar mudar algo, você poderá editar e emitir uma nova revisão.',
            { total: <strong>{formatBRL(q.totalCents)}</strong>, rev: q.currentRevision },
          )}
        </p>
        <div className="form-actions">
          <Button variant="primary" loading={send.isPending} onClick={() => send.mutate()}>
            {t('Sim, emitir')}
          </Button>
          <Button onClick={() => setDialog(null)}>{t('Cancelar')}</Button>
        </div>
      </Dialog>

      <ApproveDialog
        open={dialog === 'approve'}
        quote={q}
        onClose={() => setDialog(null)}
        onDone={(d) => {
          refresh(d);
          setDialog(null);
        }}
      />
      <RefuseDialog
        open={dialog === 'refuse'}
        quoteId={q.id}
        onClose={() => setDialog(null)}
        onDone={(d) => {
          refresh(d);
          setDialog(null);
        }}
      />

      <Dialog open={dialog === 'delete'} title={t('Excluir rascunho?')} onClose={() => setDialog(null)}>
        <p>{t('Este rascunho nunca foi emitido e será removido da sua lista.')}</p>
        <div className="form-actions">
          <Button variant="danger" loading={remove.isPending} onClick={() => remove.mutate()}>
            {t('Sim, excluir')}
          </Button>
          <Button onClick={() => setDialog(null)}>{t('Cancelar')}</Button>
        </div>
      </Dialog>
    </>
  );
}

function ApproveDialog({
  open,
  quote,
  onClose,
  onDone,
}: {
  open: boolean;
  quote: QuoteDetailDTO;
  onClose: () => void;
  onDone: (d: QuoteDetailDTO) => void;
}) {
  const toast = useToast();
  const [form, setForm] = useState({
    approvedByName: quote.customer.name,
    channel: 'WHATSAPP' as ApprovalChannel,
    approvedOn: todayISO(),
    note: '',
  });
  const [fields, setFields] = useState<Record<string, string>>({});
  const key = useRef(newKey());
  const approve = useMutation({
    mutationFn: () =>
      api<QuoteDetailDTO>(`/api/quotes/${quote.id}/approve`, {
        body: { ...form, note: form.note || null },
        headers: { 'Idempotency-Key': key.current },
      }),
    onSuccess: (d) => {
      toast(t('Aprovação registrada.'));
      onDone(d);
    },
    onError: (e) => {
      key.current = newKey();
      setFields(e instanceof ApiError ? e.fields : {});
      toast(errorMessage(e), 'error');
    },
  });
  return (
    <Dialog open={open} title={t('Registrar aprovação do cliente')} onClose={onClose}>
      {quote.status === 'DRAFT' && (
        <InfoBox>{t('Este orçamento ainda é rascunho: ao registrar a aprovação, ele também será emitido.')}</InfoBox>
      )}
      <p>
        {tx('Valor aprovado: {total}. Depois de aprovado, o orçamento não pode mais ser alterado.', {
          total: <strong>{formatBRL(quote.totalCents)}</strong>,
        })}
      </p>
      <TextField
        label={t('Quem aprovou')}
        value={form.approvedByName}
        onChange={(e) => setForm({ ...form, approvedByName: e.target.value })}
        error={fields.approvedByName}
      />
      <SelectField
        label={t('Como o cliente aprovou')}
        value={form.channel}
        onChange={(e) => setForm({ ...form, channel: e.target.value as ApprovalChannel })}
      >
        {APPROVAL_CHANNELS.map((ch) => (
          <option key={ch} value={ch}>
            {t(APPROVAL_CHANNEL_INFO[ch])}
          </option>
        ))}
      </SelectField>
      <TextField
        label={t('Data da aprovação')}
        type="date"
        max={todayISO()}
        value={form.approvedOn}
        onChange={(e) => setForm({ ...form, approvedOn: e.target.value })}
        error={fields.approvedOn}
      />
      <TextAreaField
        label={t('Observação / evidência')}
        optional
        hint={t('Ex.: "Aceitou por mensagem no WhatsApp às 14h"')}
        value={form.note}
        onChange={(e) => setForm({ ...form, note: e.target.value })}
      />
      <div className="form-actions">
        <Button variant="primary" loading={approve.isPending} onClick={() => approve.mutate()}>
          {t('Confirmar aprovação')}
        </Button>
        <Button onClick={onClose}>{t('Cancelar')}</Button>
      </div>
    </Dialog>
  );
}

function RefuseDialog({
  open,
  quoteId,
  onClose,
  onDone,
}: {
  open: boolean;
  quoteId: string;
  onClose: () => void;
  onDone: (d: QuoteDetailDTO) => void;
}) {
  const toast = useToast();
  const [reason, setReason] = useState('');
  const refuse = useMutation({
    mutationFn: () => api<QuoteDetailDTO>(`/api/quotes/${quoteId}/refuse`, { body: { reason: reason || null } }),
    onSuccess: (d) => {
      toast(t('Marcado como recusado.'));
      onDone(d);
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  return (
    <Dialog open={open} title={t('O cliente recusou?')} onClose={onClose}>
      <TextAreaField
        label={t('Motivo')}
        optional
        hint={t('Ajuda a melhorar os próximos orçamentos. Ex.: achou caro, fechou com outro.')}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />
      <div className="form-actions">
        <Button variant="danger" loading={refuse.isPending} onClick={() => refuse.mutate()}>
          {t('Marcar como recusado')}
        </Button>
        <Button onClick={onClose}>{t('Cancelar')}</Button>
      </div>
    </Dialog>
  );
}
