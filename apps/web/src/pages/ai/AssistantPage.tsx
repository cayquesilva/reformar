import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, FilePlus2, Mic, Send, Square, Trash2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import {
  COST_CATEGORY_INFO,
  EXPENSE_CATEGORIES,
  EXPENSE_CATEGORY_LABEL,
  formatBRL,
  formatQuantity,
  MATERIAL_SUPPLY_INFO,
  PAYMENT_METHOD_LABEL,
  PAYMENT_METHODS,
  todayISO,
  unitShort,
  type AiInteractionDTO,
  type AiUsageDTO,
  type ExpenseCategory,
  type PaymentMethod,
  type ProjectSummaryDTO,
} from '@reformar/shared';
import { api, errorMessage } from '../../lib/api';
import { useCan } from '../../lib/auth';
import { useToast } from '../../lib/toast';
import { Button, ChoiceGroup, ErrorBox, InfoBox, MoneyField, PageHeader, SelectField, Spinner, TextField } from '../../components/ui';
import { aiDraftToForm, AI_DRAFT_KEY } from './ai-draft';
import { intlLocale, t, tMessage } from '../../lib/i18n';

// API de reconhecimento de voz do navegador (não padronizada em todos os navegadores).
type Recognition = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: { results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
};
const SpeechCtor: (new () => Recognition) | undefined =
  typeof window !== 'undefined'
    ? (((window as unknown as Record<string, unknown>).SpeechRecognition as new () => Recognition) ??
      ((window as unknown as Record<string, unknown>).webkitSpeechRecognition as new () => Recognition))
    : undefined;
const CONSENT_KEY = 'reformar:voz-consentimento';

export function AssistantPage() {
  const toast = useToast();
  const qc = useQueryClient();
  const usage = useQuery({ queryKey: ['ai-usage'], queryFn: () => api<AiUsageDTO>('/api/ai/usage') });
  const [text, setText] = useState('');
  const [current, setCurrent] = useState<AiInteractionDTO | null>(null);
  const [listening, setListening] = useState(false);
  const [consentAsk, setConsentAsk] = useState(false);
  const recRef = useRef<Recognition | null>(null);
  const baseText = useRef('');

  useEffect(() => () => recRef.current?.abort(), []);

  const send = useMutation({
    mutationFn: (previousId: string | null) => api<AiInteractionDTO>('/api/ai/messages', { body: { text, previousId } }),
    onSuccess: (r) => {
      setCurrent(r);
      setText('');
      qc.invalidateQueries({ queryKey: ['ai-usage'] });
    },
    onError: (e) => {
      qc.invalidateQueries({ queryKey: ['ai-usage'] });
      toast(errorMessage(e), 'error');
    },
  });

  const startVoice = () => {
    if (!SpeechCtor) return;
    if (localStorage.getItem(CONSENT_KEY) !== 'sim') {
      setConsentAsk(true);
      return;
    }
    const rec = new SpeechCtor();
    rec.lang = intlLocale();
    rec.interimResults = true;
    rec.continuous = true;
    baseText.current = text ? `${text} ` : '';
    rec.onresult = (e) => {
      let transcript = '';
      for (let i = 0; i < e.results.length; i++) transcript += e.results[i]![0].transcript;
      setText(baseText.current + transcript);
    };
    rec.onerror = (e) => {
      toast(
        e.error === 'not-allowed'
          ? t('Permissão do microfone negada. Você pode digitar.')
          : t('Não consegui ouvir. Tente de novo ou digite.'),
        'error',
      );
      setListening(false);
    };
    rec.onend = () => setListening(false);
    recRef.current = rec;
    rec.start();
    setListening(true);
  };
  const stopVoice = () => recRef.current?.stop();
  const cancelVoice = () => {
    recRef.current?.abort();
    setText(baseText.current.trim());
    setListening(false);
  };

  const u = usage.data;
  if (usage.isLoading) return <Spinner />;
  if (u && !u.enabled) {
    return (
      <>
        <PageHeader title={t('Assistente')} />
        <InfoBox tone="warning">{t('O assistente ainda não está configurado neste servidor. Use os formulários normalmente.')}</InfoBox>
      </>
    );
  }
  const limitReached = !!u && u.requests >= u.limit;

  return (
    <>
      <PageHeader
        title={t('Assistente')}
        subtitle={t('Fale ou escreva. O assistente monta a proposta; você confere e confirma antes de gravar qualquer coisa.')}
      />
      {u && (
        <p className="muted small" aria-live="polite">
          {t('Uso no mês: {used} de {limit} pedidos.', { used: u.requests, limit: u.limit })}
        </p>
      )}
      {limitReached && <ErrorBox>{t('Limite mensal do assistente atingido. Use os formulários ou mude de plano.')}</ErrorBox>}

      <section className="card">
        <label htmlFor="ai-text" className="label-strong">
          {current?.quoteDraft ? t('Quer corrigir algo? (ex.: “troque a metragem para 40 metros”)') : t('O que você precisa?')}
        </label>
        <textarea
          id="ai-text"
          className="input"
          rows={4}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t('Ex.: Vou colocar 32 metros de porcelanato na casa do João, cobrando 55 reais o metro. O cliente compra o piso.')}
        />
        {listening && (
          <p className="recording" role="status">
            <span className="rec-dot" aria-hidden /> {t('Gravando… fale normalmente. O texto aparece acima para você conferir.')}
          </p>
        )}
        <div className="form-actions">
          {SpeechCtor &&
            (listening ? (
              <>
                <Button variant="primary" icon={<Square aria-hidden />} onClick={stopVoice}>
                  {t('Parar')}
                </Button>
                <Button icon={<X aria-hidden />} onClick={cancelVoice}>
                  {t('Cancelar gravação')}
                </Button>
              </>
            ) : (
              <Button icon={<Mic aria-hidden />} onClick={startVoice} disabled={limitReached}>
                {t('Falar')}
              </Button>
            ))}
          <Button
            variant="primary"
            icon={<Send aria-hidden />}
            loading={send.isPending}
            disabled={text.trim().length < 2 || listening || limitReached}
            onClick={() => send.mutate(current?.quoteDraft ? current.id : null)}
          >
            {current?.quoteDraft ? t('Enviar correção') : t('Enviar')}
          </Button>
        </div>
        {!SpeechCtor && <p className="muted small">{t('Seu navegador não oferece reconhecimento de voz. Digite o pedido.')}</p>}
      </section>

      {consentAsk && (
        <InfoBox tone="warning">
          <p>
            <strong>{t('Antes de usar a voz:')}</strong>{' '}
            {t(
              'o reconhecimento de fala é feito pelo seu navegador (no Chrome, o áudio é processado pelos servidores do Google). O Reformar não grava nem guarda o áudio — só o texto que você enviar.',
            )}
          </p>
          <div className="form-actions">
            <Button
              variant="primary"
              onClick={() => {
                localStorage.setItem(CONSENT_KEY, 'sim');
                setConsentAsk(false);
                startVoice();
              }}
            >
              {t('Entendi, usar a voz')}
            </Button>
            <Button onClick={() => setConsentAsk(false)}>{t('Prefiro digitar')}</Button>
          </div>
        </InfoBox>
      )}

      {current && <Result interaction={current} onDone={() => setCurrent(null)} />}
    </>
  );
}

function Result({ interaction, onDone }: { interaction: AiInteractionDTO; onDone: () => void }) {
  const toast = useToast();
  const reject = useMutation({
    mutationFn: () => api(`/api/ai/interactions/${interaction.id}/reject`, { method: 'POST', body: {} }),
    onSuccess: () => {
      toast(t('Proposta descartada.'));
      onDone();
    },
  });
  return (
    <section className="card" aria-live="polite" aria-labelledby="ai-result">
      <h2 id="ai-result">{t('O que eu entendi')}</h2>
      <p>{interaction.reply}</p>
      {interaction.questions.length > 0 && (
        <InfoBox tone="warning">
          <p className="label-strong">{t('Preciso saber:')}</p>
          <ul>
            {interaction.questions.map((q) => (
              <li key={q}>{tMessage(q)}</li>
            ))}
          </ul>
          <p className="small">{t('Responda acima (por voz ou texto) ou complete no editor.')}</p>
        </InfoBox>
      )}
      {interaction.quoteDraft && <QuoteDraftPreview interaction={interaction} />}
      {interaction.expenseDraft && interaction.status === 'PROPOSED' && <ExpenseDraftForm interaction={interaction} onDone={onDone} />}
      {interaction.answer && (
        <>
          <p className="calc-line">{tMessage(interaction.answer.text)}</p>
          {interaction.answer.rows.length > 0 && (
            <ul className="plain-list" aria-label={t('Dados usados na resposta')}>
              {interaction.answer.rows.map((r, i) => (
                <li key={i}>
                  <span>
                    {tMessage(r.label)}
                    <span className="muted small block">{tMessage(r.detail)}</span>
                  </span>
                  {r.amountCents !== null && <strong>{formatBRL(r.amountCents)}</strong>}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {interaction.status === 'PROPOSED' && (
        <Button variant="ghost" icon={<Trash2 aria-hidden />} onClick={() => reject.mutate()}>
          {t('Descartar proposta')}
        </Button>
      )}
    </section>
  );
}

function Missing() {
  return <span className="error-text small">{t('falta')}</span>;
}

function QuoteDraftPreview({ interaction }: { interaction: AiInteractionDTO }) {
  const d = interaction.quoteDraft!;
  const navigate = useNavigate();
  const can = useCan();
  const [customerId, setCustomerId] = useState(d.customerCandidates.length === 1 ? d.customerCandidates[0]!.id : '');
  const open = () => {
    const chosen = d.customerCandidates.find((c) => c.id === customerId) ?? null;
    sessionStorage.setItem(AI_DRAFT_KEY, JSON.stringify({ interactionId: interaction.id, form: aiDraftToForm(d, chosen) }));
    navigate('/orcamentos/novo?ia=1');
  };
  return (
    <>
      <h3>
        {t('Rascunho do orçamento')} {d.title ? `“${d.title}”` : ''}
      </h3>
      <ul className="plain-list">
        {d.items.map((i, n) => (
          <li key={`i${n}`}>
            <span>{i.description}</span>
            <span>
              {i.quantity ? `${formatQuantity(i.quantity)} ${t(unitShort(i.unit))}` : <Missing />} ×{' '}
              {i.unitPriceCents !== null ? formatBRL(i.unitPriceCents) : <Missing />}
            </span>
          </li>
        ))}
        {d.materials.map((m, n) => (
          <li key={`m${n}`}>
            <span>{t('Material: {name}', { name: m.description })}</span>
            <span>
              {m.supply ? t(MATERIAL_SUPPLY_INFO[m.supply].short) : <span className="error-text small">{t('quem compra?')}</span>}
            </span>
          </li>
        ))}
        {d.costs.map((c, n) => (
          <li key={`c${n}`}>
            <span>
              {t(COST_CATEGORY_INFO[c.category].label)}: {c.description}
            </span>
            <span>
              {c.quantity ? `${formatQuantity(c.quantity)} ${c.unit ?? ''}` : <Missing />} ×{' '}
              {c.unitCostCents !== null ? formatBRL(c.unitCostCents) : <Missing />}
            </span>
          </li>
        ))}
      </ul>
      {d.customerName && (
        <SelectField
          label={t('Cliente (“{name}”)', { name: d.customerName ?? '' })}
          value={customerId}
          onChange={(e) => setCustomerId(e.target.value)}
          hint={
            d.customerCandidates.length
              ? t('Confira se é este cliente.')
              : t('Não encontrei esse cliente. Você poderá cadastrá-lo no editor.')
          }
        >
          <option value="">{t('Escolher no editor / cadastrar novo')}</option>
          {d.customerCandidates.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </SelectField>
      )}
      {interaction.status === 'PROPOSED' && can('quote:write') && (
        <Button variant="primary" icon={<FilePlus2 aria-hidden />} onClick={open}>
          {t('Abrir no editor para conferir e salvar')}
        </Button>
      )}
      <p className="muted small">
        {t('Nada foi gravado ainda. O orçamento só é salvo quando você conferir e tocar em “Salvar” no editor.')}
      </p>
    </>
  );
}

function ExpenseDraftForm({ interaction, onDone }: { interaction: AiInteractionDTO; onDone: () => void }) {
  const d = interaction.expenseDraft!;
  const toast = useToast();
  const qc = useQueryClient();
  const can = useCan();
  const projects = useQuery({ queryKey: ['projects', 'ACTIVE'], queryFn: () => api<ProjectSummaryDTO[]>('/api/projects?status=ACTIVE') });
  const [f, setF] = useState({
    projectId: d.projectCandidates.length === 1 ? d.projectCandidates[0]!.id : '',
    category: d.category as ExpenseCategory,
    description: d.description,
    amountCents: d.amountCents,
    date: d.date,
    paid: d.paid === false ? 'NO' : 'YES',
    method: 'PIX' as PaymentMethod,
  });
  const confirm = useMutation({
    mutationFn: () =>
      api(`/api/ai/interactions/${interaction.id}/confirm-expense`, {
        body: {
          projectId: f.projectId || null,
          category: f.category,
          description: f.description,
          quantity: d.quantity,
          unit: d.unit,
          amountCents: f.amountCents,
          date: f.date,
          status: f.paid === 'YES' ? 'PAID' : 'COMMITTED',
          paidOn: f.paid === 'YES' ? f.date : null,
          paymentMethod: f.paid === 'YES' ? f.method : null,
        },
      }),
    onSuccess: () => {
      for (const k of ['expenses', 'project', 'finance-overview']) qc.invalidateQueries({ queryKey: [k] });
      toast(t('Gasto registrado.'));
      onDone();
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  if (!can('finance:write')) return <p className="muted">{t('Você não tem permissão para registrar gastos.')}</p>;
  return (
    <div className="subcard">
      <h3>{t('Confira o gasto antes de registrar')}</h3>
      <SelectField
        label={t('Obra')}
        value={f.projectId}
        onChange={(e) => setF({ ...f, projectId: e.target.value })}
        hint={d.projectHint ? t('Você disse: “{text}”.', { text: d.projectHint }) : undefined}
      >
        <option value="">{t('Empresa (sem obra)')}</option>
        {(projects.data ?? []).map((p) => (
          <option key={p.id} value={p.id}>
            Obra {String(p.number).padStart(4, '0')} · {p.name}
          </option>
        ))}
      </SelectField>
      <SelectField label={t('Tipo')} value={f.category} onChange={(e) => setF({ ...f, category: e.target.value as ExpenseCategory })}>
        {EXPENSE_CATEGORIES.map((c) => (
          <option key={c} value={c}>
            {t(EXPENSE_CATEGORY_LABEL[c])}
          </option>
        ))}
      </SelectField>
      <TextField label={t('Descrição')} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
      <MoneyField label={t('Valor')} value={f.amountCents} onChange={(v) => setF({ ...f, amountCents: v })} />
      <TextField label={t('Data')} type="date" max={todayISO()} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />
      <ChoiceGroup
        legend={t('Já foi pago?')}
        value={f.paid}
        onChange={(paid) => setF({ ...f, paid })}
        options={[
          { value: 'YES', label: t('Sim') },
          { value: 'NO', label: t('Não, vou pagar depois') },
        ]}
      />
      {f.paid === 'YES' && (
        <SelectField
          label={t('Forma de pagamento')}
          value={f.method}
          onChange={(e) => setF({ ...f, method: e.target.value as PaymentMethod })}
        >
          {PAYMENT_METHODS.map((m) => (
            <option key={m} value={m}>
              {t(PAYMENT_METHOD_LABEL[m])}
            </option>
          ))}
        </SelectField>
      )}
      <Button
        variant="primary"
        icon={<Check aria-hidden />}
        loading={confirm.isPending}
        disabled={!f.amountCents}
        onClick={() => confirm.mutate()}
      >
        Confirmar e registrar {f.amountCents ? formatBRL(f.amountCents) : ''}
      </Button>
    </div>
  );
}
