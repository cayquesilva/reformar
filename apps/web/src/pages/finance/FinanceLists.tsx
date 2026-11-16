import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import {
  EXPENSE_CATEGORY_LABEL,
  EXPENSE_STATUS_LABEL,
  formatBRL,
  PAYMENT_METHOD_LABEL,
  PAYMENT_METHODS,
  RECEIVABLE_KIND_LABEL,
  RECEIVABLE_STATUS_LABEL,
  todayISO,
  type ExpenseDTO,
  type PaymentMethod,
  type ReceivableDTO,
} from '@reformar/shared';
import { api, ApiError, errorMessage } from '../../lib/api';
import { useCan } from '../../lib/auth';
import { useToast } from '../../lib/toast';
import { Button, Dialog, MoneyField, SelectField, TextAreaField, TextField } from '../../components/ui';
import { newKey } from '../quotes/quote-form';
import { fmtDate, t, tMessage, tx } from '../../lib/i18n';

const STATUS_CLASS: Record<string, string> = {
  OPEN: 'badge-sent',
  PARTIAL: 'badge-expired',
  PAID: 'badge-approved',
  OVERDUE: 'badge-refused',
  CANCELED: 'badge-draft',
  PLANNED: 'badge-draft',
  COMMITTED: 'badge-sent',
};

function invalidateFinance(qc: ReturnType<typeof useQueryClient>) {
  for (const k of ['receivables', 'expenses', 'finance-overview', 'project', 'dashboard']) qc.invalidateQueries({ queryKey: [k] });
}

export function ReceivableList({ items, showProject = true }: { items: ReceivableDTO[]; showProject?: boolean }) {
  const can = useCan();
  const [paying, setPaying] = useState<ReceivableDTO | null>(null);
  const [details, setDetails] = useState<ReceivableDTO | null>(null);
  if (items.length === 0) return <p className="muted">{t('Nenhuma conta a receber.')}</p>;
  return (
    <>
      <ul className="list">
        {items.map((r) => (
          <li key={r.id}>
            <div className="row-link">
              <div className="row-main">
                <span className="row-title">{tMessage(r.description)}</span>
                <span className="muted small">
                  {t(RECEIVABLE_KIND_LABEL[r.kind])} · {r.customer.name}
                  {showProject && r.project ? ` · ${t('Obra {n}', { n: String(r.project.number).padStart(4, '0') })}` : ''} ·{' '}
                  {t('vence {date}', { date: fmtDate(r.dueDate) })}
                </span>
                {r.paidCents > 0 && r.balanceCents > 0 && (
                  <span className="small">
                    {t('Recebido {paid} · falta {left}', { paid: formatBRL(r.paidCents), left: formatBRL(r.balanceCents) })}
                  </span>
                )}
              </div>
              <div className="row-side">
                <span className="money">{formatBRL(r.amountCents)}</span>
                <span className={`badge ${STATUS_CLASS[r.status]}`}>{t(RECEIVABLE_STATUS_LABEL[r.status])}</span>
                <span className="actions">
                  {can('finance:write') && r.balanceCents > 0 && r.status !== 'CANCELED' && (
                    <Button variant="primary" onClick={() => setPaying(r)}>
                      {t('Receber')}
                    </Button>
                  )}
                  {r.payments.length > 0 && (
                    <Button variant="ghost" onClick={() => setDetails(r)}>
                      {t('Pagamentos')}
                    </Button>
                  )}
                </span>
              </div>
            </div>
          </li>
        ))}
      </ul>
      {paying && <PaymentDialog receivable={paying} onClose={() => setPaying(null)} />}
      {details && <PaymentsDialog receivable={details} onClose={() => setDetails(null)} />}
    </>
  );
}

function PaymentDialog({ receivable, onClose }: { receivable: ReceivableDTO; onClose: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const key = useRef(newKey());
  const [amount, setAmount] = useState<number | null>(receivable.balanceCents);
  const [paidOn, setPaidOn] = useState(todayISO());
  const [method, setMethod] = useState<PaymentMethod>('PIX');
  const [note, setNote] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const pay = useMutation({
    mutationFn: () =>
      api<ReceivableDTO>(`/api/receivables/${receivable.id}/payments`, {
        body: { amountCents: amount, paidOn, method, note: note || null },
        headers: { 'Idempotency-Key': key.current },
      }),
    onSuccess: (r) => {
      invalidateFinance(qc);
      toast(
        r.balanceCents > 0 ? `Pagamento registrado. Ainda falta ${formatBRL(r.balanceCents)}.` : t('Pagamento registrado. Conta quitada.'),
      );
      onClose();
    },
    onError: (e) => {
      key.current = newKey();
      setFields(e instanceof ApiError ? e.fields : {});
      toast(errorMessage(e), 'error');
    },
  });
  return (
    <Dialog open title={t('Registrar pagamento recebido')} onClose={onClose}>
      <p>
        {tMessage(receivable.description)} ·{' '}
        {tx('saldo {balance}. Pode ser pagamento parcial; o valor do contrato não muda.', {
          balance: <strong>{formatBRL(receivable.balanceCents)}</strong>,
        })}
      </p>
      <MoneyField label={t('Valor recebido')} value={amount} onChange={setAmount} error={fields.amountCents} />
      <TextField
        label={t('Data')}
        type="date"
        max={todayISO()}
        value={paidOn}
        onChange={(e) => setPaidOn(e.target.value)}
        error={fields.paidOn}
      />
      <SelectField label={t('Forma de pagamento')} value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
        {PAYMENT_METHODS.map((m) => (
          <option key={m} value={m}>
            {t(PAYMENT_METHOD_LABEL[m])}
          </option>
        ))}
      </SelectField>
      <TextAreaField
        label={t('Observação / comprovante')}
        optional
        hint={t('Ex.: PIX recebido às 10h, comprovante no WhatsApp.')}
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      <div className="form-actions">
        <Button variant="primary" loading={pay.isPending} onClick={() => pay.mutate()}>
          {t('Confirmar recebimento')}
        </Button>
        <Button onClick={onClose}>{t('Cancelar')}</Button>
      </div>
    </Dialog>
  );
}

function PaymentsDialog({ receivable, onClose }: { receivable: ReceivableDTO; onClose: () => void }) {
  const can = useCan();
  const toast = useToast();
  const qc = useQueryClient();
  const [reversing, setReversing] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const reverse = useMutation({
    mutationFn: () => api(`/api/receivable-payments/${reversing}/reverse`, { body: { reason } }),
    onSuccess: () => {
      invalidateFinance(qc);
      toast(t('Pagamento estornado. O registro continua no histórico.'));
      onClose();
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  return (
    <Dialog open title={t('Pagamentos recebidos')} onClose={onClose}>
      <ul className="plain-list">
        {receivable.payments.map((p) => (
          <li key={p.id}>
            <span>
              <strong>{formatBRL(p.amountCents)}</strong> · {fmtDate(p.paidOn)} · {t(PAYMENT_METHOD_LABEL[p.method])}
              <span className="muted small block">
                {p.recordedByName}
                {p.note ? ` · ${p.note}` : ''}
                {p.reversedAt ? ` · ${t('ESTORNADO: {reason}', { reason: p.reverseReason ?? '' })}` : ''}
              </span>
            </span>
            {can('finance:write') && !p.reversedAt && (
              <Button variant="ghost" onClick={() => setReversing(p.id)}>
                {t('Estornar')}
              </Button>
            )}
          </li>
        ))}
      </ul>
      {reversing && (
        <>
          <TextField label={t('Motivo do estorno')} value={reason} onChange={(e) => setReason(e.target.value)} />
          <Button variant="danger" loading={reverse.isPending} onClick={() => reverse.mutate()}>
            {t('Confirmar estorno')}
          </Button>
        </>
      )}
      <div className="form-actions">
        <Button onClick={onClose}>{t('Fechar')}</Button>
      </div>
    </Dialog>
  );
}

export function ExpenseList({ items, showProject = true }: { items: ExpenseDTO[]; showProject?: boolean }) {
  const can = useCan();
  const toast = useToast();
  const qc = useQueryClient();
  const [paying, setPaying] = useState<ExpenseDTO | null>(null);
  const [method, setMethod] = useState<PaymentMethod>('PIX');
  const [paidOn, setPaidOn] = useState(todayISO());
  const pay = useMutation({
    mutationFn: () => api(`/api/expenses/${paying!.id}/pay`, { body: { paidOn, paymentMethod: method } }),
    onSuccess: () => {
      invalidateFinance(qc);
      toast(t('Pagamento registrado.'));
      setPaying(null);
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  if (items.length === 0) return <p className="muted">{t('Nenhum gasto lançado.')}</p>;
  return (
    <>
      <ul className="list">
        {items.map((e) => (
          <li key={e.id}>
            <div className="row-link">
              <div className="row-main">
                <span className="row-title">{tMessage(e.description)}</span>
                <span className="muted small">
                  {t(EXPENSE_CATEGORY_LABEL[e.category])} · {fmtDate(e.date)}
                  {showProject ? ` · ${e.project ? t('Obra {n}', { n: String(e.project.number).padStart(4, '0') }) : t('Empresa')}` : ''}
                  {e.supplier ? ` · ${e.supplier}` : ''}
                  {e.status !== 'PAID' && e.dueDate ? ` · ${t('vence {date}', { date: fmtDate(e.dueDate) })}` : ''}
                </span>
              </div>
              <div className="row-side">
                <span className="money">{formatBRL(e.amountCents)}</span>
                <span className={`badge ${e.overdue ? 'badge-refused' : STATUS_CLASS[e.status]}`}>
                  {e.overdue ? t('Atrasado') : EXPENSE_STATUS_LABEL[e.status]}
                </span>
                {can('finance:write') && (e.status === 'COMMITTED' || e.status === 'PLANNED') && (
                  <Button variant="primary" onClick={() => setPaying(e)}>
                    {t('Pagar')}
                  </Button>
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>
      <Dialog open={!!paying} title={t('Registrar pagamento')} onClose={() => setPaying(null)}>
        {paying && (
          <p>
            {paying.description} · <strong>{formatBRL(paying.amountCents)}</strong>
          </p>
        )}
        <TextField label={t('Pago em')} type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
        <SelectField label={t('Forma de pagamento')} value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
          {PAYMENT_METHODS.map((m) => (
            <option key={m} value={m}>
              {t(PAYMENT_METHOD_LABEL[m])}
            </option>
          ))}
        </SelectField>
        <div className="form-actions">
          <Button variant="primary" loading={pay.isPending} onClick={() => pay.mutate()}>
            {t('Confirmar pagamento')}
          </Button>
          <Button onClick={() => setPaying(null)}>{t('Cancelar')}</Button>
        </div>
      </Dialog>
    </>
  );
}
