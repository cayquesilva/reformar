import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, Check, Plus, Save, Trash2, UserPlus } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import {
  calculateQuote,
  COST_CATEGORIES,
  COST_CATEGORY_INFO,
  formatBRL,
  formatPercent,
  formatPhone,
  formatQuantity,
  MATERIAL_SUPPLY_INFO,
  SERVICE_UNIT_INFO,
  SERVICE_UNITS,
  todayISO,
  UF_LIST,
  unitShort,
  type CompanyProfileDTO,
  type CostCategory,
  type CustomerDTO,
  type QuoteCalculation,
  type QuoteDetailDTO,
  type ServiceDTO,
} from '@reformar/shared';
import { api, ApiError, errorMessage } from '../../lib/api';
import { useCan } from '../../lib/auth';
import { useToast } from '../../lib/toast';
import {
  Button,
  Checkbox,
  ChoiceGroup,
  ErrorBox,
  InfoBox,
  MoneyField,
  PageHeader,
  QuantityField,
  SelectField,
  Spinner,
  TextAreaField,
  TextField,
} from '../../components/ui';
import { useCustomerSearch } from '../customers/CustomerPages';
import {
  contentToForm,
  emptyQuoteForm,
  formToContent,
  formToPricing,
  newCost,
  newItem,
  newKey,
  newMaterial,
  stepOfPath,
  STEPS,
  validateForm,
  type CostForm,
  type ItemForm,
  type MaterialForm,
  type QuoteForm,
} from './quote-form';
import { AI_DRAFT_KEY } from '../ai/ai-draft';
import { useMediaQuery } from '../../lib/useMediaQuery';
import { fmtDate, fmtDateTime, t, tMessage, tx } from '../../lib/i18n';

type Errors = Record<string, string>;
type SetForm = (updater: (f: QuoteForm) => QuoteForm) => void;

interface LocalDraft {
  savedAt: string;
  form: QuoteForm;
  step: number;
}

export function QuoteEditorPage() {
  const { id } = useParams();
  const isNew = !id;
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const can = useCan();
  const storageKey = `reformar:orcamento:${id ?? 'novo'}`;

  const company = useQuery({ queryKey: ['company'], queryFn: () => api<CompanyProfileDTO>('/api/company') });
  const services = useQuery({ queryKey: ['services'], queryFn: () => api<ServiceDTO[]>('/api/services') });
  const existing = useQuery({
    queryKey: ['quote', id],
    queryFn: () => api<QuoteDetailDTO>(`/api/quotes/${id}`),
    enabled: !isNew,
  });
  const preselected = params.get('cliente');
  const preCustomer = useQuery({
    queryKey: ['customer', preselected],
    queryFn: () => api<CustomerDTO>(`/api/customers/${preselected}`),
    enabled: isNew && !!preselected,
  });

  const [form, setFormState] = useState<QuoteForm | null>(null);
  const [step, setStep] = useState(0);
  const [errors, setErrors] = useState<Errors>({});
  const [restore, setRestore] = useState<LocalDraft | null>(null);
  const idempotencyKey = useRef(newKey());
  const wide = useMediaQuery('(min-width: 1100px)');
  const aiInteraction = useRef<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  // Inicializa o formulário (novo ou edição) e verifica rascunho local não salvo.
  useEffect(() => {
    if (form) return;
    if (isNew && company.data && (!preselected || preCustomer.data || preCustomer.isError)) {
      const f = emptyQuoteForm({
        validityDays: company.data.defaultValidityDays,
        paymentTerms: company.data.defaultPaymentTerms,
        exclusions: company.data.defaultExclusions,
        notes: company.data.defaultNotes,
      });
      if (preCustomer.data) {
        f.customerId = preCustomer.data.id;
        f.customerName = preCustomer.data.name;
      }
      // Rascunho vindo do assistente: abre preenchido para conferência (nada foi gravado ainda).
      const ai = params.get('ia') ? sessionStorage.getItem(AI_DRAFT_KEY) : null;
      if (ai) {
        const parsed = JSON.parse(ai) as { interactionId: string; form: QuoteForm };
        aiInteraction.current = parsed.interactionId;
        setFormState({
          ...parsed.form,
          validUntil: f.validUntil,
          paymentTerms: parsed.form.paymentTerms ?? f.paymentTerms,
          exclusions: f.exclusions,
          notes: f.notes,
        });
        dirty.current = true;
        return;
      }
      setFormState(f);
    } else if (!isNew && existing.data) {
      setFormState(contentToForm(existing.data.content, existing.data.customer.name));
    } else return;
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) setRestore(JSON.parse(raw) as LocalDraft);
    } catch {
      /* armazenamento indisponível */
    }
  }, [form, isNew, company.data, existing.data, preselected, preCustomer.data, preCustomer.isError, storageKey, params]);

  // Salva rascunho local a cada alteração (recupera em caso de queda de conexão ou fechamento da aba).
  const dirty = useRef(false);
  useEffect(() => {
    if (!form || !dirty.current) return;
    const timer = window.setTimeout(() => {
      try {
        localStorage.setItem(storageKey, JSON.stringify({ savedAt: new Date().toISOString(), form, step } satisfies LocalDraft));
      } catch {
        /* sem espaço/privado */
      }
    }, 400);
    return () => window.clearTimeout(timer);
  }, [form, step, storageKey]);

  const setForm: SetForm = (updater) => {
    dirty.current = true;
    setFormState((f) => (f ? updater(f) : f));
  };

  const calc = useMemo<QuoteCalculation | null>(() => (form ? calculateQuote(formToPricing(form)) : null), [form]);

  const save = useMutation({
    mutationFn: async (f: QuoteForm) => {
      const content = formToContent(f);
      if (isNew) {
        return api<{ id: string }>('/api/quotes', { body: content, headers: { 'Idempotency-Key': idempotencyKey.current } });
      }
      return api<QuoteDetailDTO>(`/api/quotes/${id}`, {
        method: 'PUT',
        body: { lockVersion: existing.data!.lockVersion, content },
      });
    },
    onSuccess: (res) => {
      localStorage.removeItem(storageKey);
      if (aiInteraction.current) {
        sessionStorage.removeItem(AI_DRAFT_KEY);
        void api(`/api/ai/interactions/${aiInteraction.current}/applied`, { body: { quoteId: res.id } }).catch(() => undefined);
        aiInteraction.current = null;
      }
      dirty.current = false;
      qc.invalidateQueries({ queryKey: ['quotes'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      qc.invalidateQueries({ queryKey: ['quote', res.id] });
      toast(t('Orçamento salvo.'));
      navigate(`/orcamentos/${res.id}`, { replace: true });
    },
    onError: (e) => {
      if (e instanceof ApiError && Object.keys(e.fields).length) {
        setErrors(e.fields);
        setStep(Math.min(...Object.keys(e.fields).map(stepOfPath)));
      }
      toast(errorMessage(e), 'error');
    },
  });

  useEffect(() => {
    headingRef.current?.focus();
  }, [step]);

  if (!can('quote:write')) return <ErrorBox>{t('Você não tem permissão para criar ou editar orçamentos.')}</ErrorBox>;
  if (company.isError || existing.isError) return <ErrorBox>{errorMessage(company.error ?? existing.error)}</ErrorBox>;
  if (existing.data && !existing.data.canEdit) {
    return (
      <ErrorBox>
        {tx('Este orçamento está aprovado e não pode ser alterado. {voltar} e use “Duplicar”.', {
          voltar: <Link to={`/orcamentos/${id}`}>{t('Voltar')}</Link>,
        })}
      </ErrorBox>
    );
  }
  if (!form || !calc) return <Spinner />;

  const goTo = (next: number) => {
    // Valida apenas o passo atual antes de avançar.
    if (next > step) {
      const all = validateForm(form);
      const current = Object.fromEntries(Object.entries(all).filter(([k]) => stepOfPath(k) === step));
      if (step === 1 && form.items.length === 0) current.items = t('Adicione pelo menos um serviço.');
      setErrors(current);
      if (Object.keys(current).length) {
        toast(t('Confira os campos destacados antes de continuar.'), 'error');
        return;
      }
    }
    setStep(next);
    window.scrollTo({ top: 0 });
  };

  const submit = () => {
    const all = validateForm(form);
    if (form.items.length === 0) all.items = t('Adicione pelo menos um serviço.');
    setErrors(all);
    if (Object.keys(all).length) {
      setStep(Math.min(...Object.keys(all).map(stepOfPath)));
      toast(t('Há campos para corrigir. Levamos você até eles.'), 'error');
      return;
    }
    save.mutate(form);
  };

  const services_ = services.data ?? [];

  return (
    <>
      <PageHeader
        title={isNew ? t('Novo orçamento') : t('Editar orçamento nº {number}', { number: String(existing.data?.number).padStart(4, '0') })}
        subtitle={
          !isNew && existing.data?.status !== 'DRAFT'
            ? t('Este orçamento já foi emitido. Ao salvar, será criada uma nova revisão; a anterior fica guardada.')
            : undefined
        }
      />

      {params.get('ia') && aiInteraction.current && (
        <InfoBox>
          {tx('Rascunho montado pelo assistente. {confira} (cliente, quantidades, preços e quem compra os materiais) antes de salvar.', {
            confira: <strong>{t('Confira cada passo')}</strong>,
          })}
        </InfoBox>
      )}
      {restore && (
        <InfoBox tone="warning">
          <p>{t('Encontramos alterações não salvas de {when}. Deseja recuperar?', { when: fmtDateTime(restore.savedAt) })}</p>
          <div className="form-actions">
            <Button
              variant="primary"
              onClick={() => {
                setFormState(restore.form);
                setStep(restore.step);
                dirty.current = true;
                setRestore(null);
              }}
            >
              {t('Recuperar')}
            </Button>
            <Button
              onClick={() => {
                localStorage.removeItem(storageKey);
                setRestore(null);
              }}
            >
              {t('Descartar')}
            </Button>
          </div>
        </InfoBox>
      )}

      <ol className="stepper" aria-label={t('Etapas do orçamento')}>
        {STEPS.map((s, i) => (
          <li key={s} className={i === step ? 'current' : i < step ? 'done' : ''} aria-current={i === step ? 'step' : undefined}>
            <button
              type="button"
              onClick={() => (i < step ? goTo(i) : undefined)}
              disabled={i > step}
              aria-label={t('Etapa {n}: {name}', { n: i + 1, name: t(s) })}
            >
              {i < step ? <Check aria-hidden /> : i + 1}
            </button>
            <span>{t(s)}</span>
          </li>
        ))}
      </ol>

      <div className="wizard-layout">
        <div className="wizard-main">
          <h2 ref={headingRef} tabIndex={-1} className="step-title">
            {t('Passo {n} de {total}: {name}', { n: step + 1, total: STEPS.length, name: t(STEPS[step]!) })}
          </h2>

          <div className="card">
            {step === 0 && <StepCustomer form={form} setForm={setForm} errors={errors} />}
            {step === 1 && <StepItems form={form} setForm={setForm} errors={errors} services={services_} calc={calc} />}
            {step === 2 && <StepMaterials form={form} setForm={setForm} errors={errors} calc={calc} />}
            {step === 3 && <StepCosts form={form} setForm={setForm} errors={errors} calc={calc} />}
            {step === 4 && <StepConditions form={form} setForm={setForm} errors={errors} calc={calc} />}
            {step === 5 && <StepReview form={form} calc={calc} />}
          </div>

          {!wide && (
            <div className="wizard-total" aria-live="polite">
              <span>{t('Total para o cliente')}</span>
              <strong>{formatBRL(calc.totals.totalCents)}</strong>
            </div>
          )}

          <div className="wizard-nav">
            {step > 0 && (
              <Button icon={<ArrowLeft aria-hidden />} onClick={() => goTo(step - 1)}>
                {t('Voltar')}
              </Button>
            )}
            {step < STEPS.length - 1 ? (
              <Button variant="primary" icon={<ArrowRight aria-hidden />} onClick={() => goTo(step + 1)}>
                {t('Continuar')}
              </Button>
            ) : (
              <Button variant="primary" icon={<Save aria-hidden />} loading={save.isPending} onClick={submit}>
                {t('Salvar orçamento')}
              </Button>
            )}
            {step < STEPS.length - 1 && (
              <Button variant="ghost" icon={<Save aria-hidden />} loading={save.isPending} onClick={submit}>
                {t('Salvar rascunho')}
              </Button>
            )}
          </div>
        </div>
        {wide && (
          <aside className="wizard-aside card" aria-label={t('Resumo do orçamento')}>
            <p className="stat-label">{t('Total para o cliente')}</p>
            <p className="big-money" aria-live="polite">
              {formatBRL(calc.totals.totalCents)}
            </p>
            <ul className="mini-totals">
              <li>
                <span>{t('Mão de obra')}</span>
                <span>{formatBRL(calc.totals.laborCents)}</span>
              </li>
              {calc.totals.materialsBilledCents > 0 && (
                <li>
                  <span>{t('Materiais cobrados')}</span>
                  <span>{formatBRL(calc.totals.materialsBilledCents)}</span>
                </li>
              )}
              {calc.totals.discountCents > 0 && (
                <li>
                  <span>{t('Desconto')}</span>
                  <span>− {formatBRL(calc.totals.discountCents)}</span>
                </li>
              )}
              <li>
                <span>{t('Custos da obra')}</span>
                <span>{formatBRL(calc.totals.internalCostsCents)}</span>
              </li>
              <li className={calc.totals.estimatedProfitCents < 0 ? 'negative' : 'strong'}>
                <span>{t('Sobra para você')}</span>
                <span>{formatBRL(calc.totals.estimatedProfitCents)}</span>
              </li>
            </ul>
            {form.customerName && <p className="small muted">{t('Cliente: {name}', { name: form.customerName })}</p>}
            {form.items.length > 0 && calc.warnings.length > 0 && (
              <p className="small error-text">{t('{n} ponto(s) para revisar no passo “Conferir”.', { n: calc.warnings.length })}</p>
            )}
            <p className="small muted">{t('Valores atualizados a cada alteração. Nada é salvo até você tocar em “Salvar”.')}</p>
          </aside>
        )}
      </div>
    </>
  );
}

// ======================= Passo 1: cliente e obra =======================
function StepCustomer({ form, setForm, errors }: { form: QuoteForm; setForm: SetForm; errors: Errors }) {
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [createErrors, setCreateErrors] = useState<Errors>({});
  const toast = useToast();
  const qc = useQueryClient();
  const list = useCustomerSearch(q);

  const create = useMutation({
    mutationFn: () => api<CustomerDTO>('/api/customers', { body: { name: newName, phone: newPhone || null } }),
    onSuccess: (c) => {
      qc.invalidateQueries({ queryKey: ['customers'] });
      setForm((f) => ({ ...f, customerId: c.id, customerName: c.name }));
      setCreating(false);
      setNewName('');
      setNewPhone('');
      toast(t('Cliente {name} cadastrado.', { name: c.name }));
    },
    onError: (e) => {
      setCreateErrors(e instanceof ApiError ? e.fields : {});
      toast(errorMessage(e), 'error');
    },
  });

  return (
    <>
      <fieldset className="plain">
        <legend className="label-strong">{t('Para quem é o orçamento?')}</legend>
        {form.customerId ? (
          <div className="selected-customer">
            <span>
              Cliente: <strong>{form.customerName}</strong>
            </span>
            <Button variant="ghost" onClick={() => setForm((f) => ({ ...f, customerId: null, customerName: null }))}>
              {t('Trocar cliente')}
            </Button>
          </div>
        ) : creating ? (
          <div className="subcard">
            <TextField
              label={t('Nome do cliente')}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              error={createErrors.name}
              autoFocus
            />
            <TextField
              label={t('Telefone / WhatsApp')}
              optional
              type="tel"
              inputMode="tel"
              placeholder="(11) 98765-4321"
              value={newPhone}
              onChange={(e) => setNewPhone(e.target.value)}
              error={createErrors.phone}
            />
            <div className="form-actions">
              <Button variant="primary" loading={create.isPending} onClick={() => create.mutate()}>
                {t('Cadastrar e usar')}
              </Button>
              <Button onClick={() => setCreating(false)}>{t('Cancelar')}</Button>
            </div>
          </div>
        ) : (
          <>
            <TextField
              label={t('Buscar cliente cadastrado')}
              type="search"
              placeholder={t('Digite o nome ou telefone')}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              error={errors.customerId}
            />
            <ul className="pick-list">
              {list.data?.data.slice(0, 8).map((c) => (
                <li key={c.id}>
                  <button type="button" className="pick" onClick={() => setForm((f) => ({ ...f, customerId: c.id, customerName: c.name }))}>
                    <strong>{c.name}</strong>
                    <span className="muted small">{formatPhone(c.whatsapp ?? c.phone) || c.city || ''}</span>
                  </button>
                </li>
              ))}
            </ul>
            {list.data?.data.length === 0 && <p className="muted">{t('Nenhum cliente encontrado.')}</p>}
            <Button icon={<UserPlus aria-hidden />} onClick={() => setCreating(true)}>
              {t('Cadastrar novo cliente')}
            </Button>
          </>
        )}
      </fieldset>

      <TextField
        label={t('Nome do orçamento')}
        hint={t('Algo curto para você e o cliente reconhecerem. Ex.: "Piso da sala e cozinha"')}
        value={form.title}
        onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
        error={errors.title}
      />
      <TextAreaField
        label={t('Descrição do serviço')}
        optional
        hint={t('Aparece no PDF, logo abaixo do nome do orçamento.')}
        value={form.description ?? ''}
        onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
        error={errors.description}
      />
      <TextField
        label={t('Endereço da obra')}
        optional
        value={form.siteAddress ?? ''}
        onChange={(e) => setForm((f) => ({ ...f, siteAddress: e.target.value }))}
        error={errors.siteAddress}
      />
      <div className="grid-2">
        <TextField
          label={t('Cidade')}
          optional
          value={form.siteCity ?? ''}
          onChange={(e) => setForm((f) => ({ ...f, siteCity: e.target.value }))}
        />
        <SelectField
          label={t('UF')}
          value={form.siteState ?? ''}
          onChange={(e) => setForm((f) => ({ ...f, siteState: e.target.value || null }))}
          error={errors.siteState}
        >
          <option value="">—</option>
          {UF_LIST.map((uf) => (
            <option key={uf}>{uf}</option>
          ))}
        </SelectField>
      </div>
    </>
  );
}

// ======================= Passo 2: serviços =======================
function StepItems({
  form,
  setForm,
  errors,
  services,
  calc,
}: {
  form: QuoteForm;
  setForm: SetForm;
  errors: Errors;
  services: ServiceDTO[];
  calc: QuoteCalculation;
}) {
  const update = (key: string, patch: Partial<ItemForm>) =>
    setForm((f) => ({ ...f, items: f.items.map((i) => (i.key === key ? { ...i, ...patch } : i)) }));
  const remove = (key: string) =>
    setForm((f) => ({
      ...f,
      items: f.items.filter((i) => i.key !== key),
      // materiais ligados ao serviço removido passam a quantidade manual
      materials: f.materials.map((m) => (m.itemKey === key ? { ...m, source: 'MANUAL', itemKey: null } : m)),
    }));
  const add = (s?: ServiceDTO) =>
    setForm((f) => ({
      ...f,
      items: [...f.items, newItem(s ? { serviceId: s.id, description: s.name, unit: s.unit, unitPriceCents: s.defaultPriceCents } : {})],
    }));

  return (
    <>
      <p className="muted">
        {tx('Informe cada serviço com a quantidade e o preço da mão de obra. Exemplo: {qty} × {price} por m² = {total}.', {
          qty: <strong>32 m²</strong>,
          price: <strong>R$ 55,00</strong>,
          total: <strong>R$ 1.760,00</strong>,
        })}
      </p>
      {errors.items && <ErrorBox>{errors.items}</ErrorBox>}

      {form.items.map((item, n) => {
        const line = calc.items[n];
        const u = t(unitShort(item.unit));
        return (
          <section key={item.key} className="subcard" aria-label={t('Serviço {n}', { n: n + 1 })}>
            <div className="subcard-head">
              <h3>{t('Serviço {n}', { n: n + 1 })}</h3>
              <Button
                variant="ghost"
                icon={<Trash2 aria-hidden />}
                onClick={() => remove(item.key)}
                aria-label={t('Remover serviço {n}', { n: n + 1 })}
              >
                {t('Remover')}
              </Button>
            </div>
            <TextField
              label={t('O que será feito')}
              value={item.description}
              onChange={(e) => update(item.key, { description: e.target.value })}
              error={errors[`items.${n}.description`]}
            />
            <SelectField
              label={t('Cobrado por')}
              value={item.unit}
              onChange={(e) => update(item.key, { unit: e.target.value as ItemForm['unit'] })}
            >
              {SERVICE_UNITS.map((unit) => (
                <option key={unit} value={unit}>
                  {t(SERVICE_UNIT_INFO[unit].label)}
                </option>
              ))}
            </SelectField>
            <div className="grid-2">
              <QuantityField
                label={item.unit === 'LUMP_SUM' ? t('Quantidade') : `Quantidade (${u})`}
                suffix={u}
                value={item.quantity}
                onChange={(quantity) => update(item.key, { quantity })}
                error={errors[`items.${n}.quantity`]}
              />
              <MoneyField
                label={item.unit === 'LUMP_SUM' ? t('Preço fechado') : t('Preço por {unit}', { unit: u })}
                value={item.unitPriceCents}
                onChange={(unitPriceCents) => update(item.key, { unitPriceCents })}
                error={errors[`items.${n}.unitPriceCents`]}
              />
            </div>
            {line && (
              <p className="calc-line" aria-live="polite">
                {tMessage(line.explanation)}
              </p>
            )}
            <TextField
              label={t('Detalhe para o cliente')}
              optional
              hint={t('Ex.: inclui rejunte e limpeza final')}
              value={item.notes ?? ''}
              onChange={(e) => update(item.key, { notes: e.target.value })}
            />
          </section>
        );
      })}

      <div className="add-block">
        <p className="label-strong">{t('Adicionar serviço')}</p>
        <div className="chips">
          {services.map((s) => (
            <button key={s.id} type="button" className="chip" onClick={() => add(s)}>
              <Plus aria-hidden /> {s.name}
            </button>
          ))}
          <button type="button" className="chip chip-strong" onClick={() => add()}>
            <Plus aria-hidden /> {t('Outro serviço')}
          </button>
        </div>
        <p className="muted small">
          {tx('Os preços padrão de cada serviço podem ser definidos em {link}.', {
            link: <Link to="/empresa/servicos">{t('Empresa › Serviços')}</Link>,
          })}
        </p>
      </div>
    </>
  );
}

// ======================= Passo 3: materiais =======================
function StepMaterials({ form, setForm, errors, calc }: { form: QuoteForm; setForm: SetForm; errors: Errors; calc: QuoteCalculation }) {
  const update = (key: string, patch: Partial<MaterialForm>) =>
    setForm((f) => ({ ...f, materials: f.materials.map((m) => (m.key === key ? { ...m, ...patch } : m)) }));
  const remove = (key: string) => setForm((f) => ({ ...f, materials: f.materials.filter((m) => m.key !== key) }));
  const firstItem = form.items[0];

  return (
    <>
      <p className="muted">
        {t('Liste os materiais da obra e diga quem compra. O sistema calcula a quantidade com a perda e quantas caixas/sacos comprar.')}{' '}
        {tx('{use} — não usamos valores prontos porque cada produto é diferente.', {
          use: <strong>{t('Use o consumo informado pelo fabricante')}</strong>,
        })}
      </p>
      <InfoBox>
        {tx(
          'Se o orçamento é {so} e o cliente compra tudo, você pode pular este passo — ou listar os materiais como “O cliente compra” para ele saber quanto comprar.',
          {
            so: <strong>{t('só de mão de obra')}</strong>,
          },
        )}
      </InfoBox>

      {form.materials.map((m, n) => {
        const line = calc.materials[n];
        const linkedItem = form.items.find((i) => i.key === m.itemKey);
        return (
          <section key={m.key} className="subcard" aria-label={t('Material {n}', { n: n + 1 })}>
            <div className="subcard-head">
              <h3>{t('Material {n}', { n: n + 1 })}</h3>
              <Button
                variant="ghost"
                icon={<Trash2 aria-hidden />}
                onClick={() => remove(m.key)}
                aria-label={t('Remover material {n}', { n: n + 1 })}
              >
                {t('Remover')}
              </Button>
            </div>
            <div className="grid-2">
              <TextField
                label={t('Material')}
                placeholder={t('Ex.: Porcelanato 60x60')}
                value={m.description}
                onChange={(e) => update(m.key, { description: e.target.value })}
                error={errors[`materials.${n}.description`]}
              />
              <TextField
                label={t('Unidade de medida')}
                hint={t('m², kg, L, m, un...')}
                value={m.unit}
                onChange={(e) => update(m.key, { unit: e.target.value })}
                error={errors[`materials.${n}.unit`]}
              />
            </div>
            <ChoiceGroup
              legend={t('Quem compra?')}
              value={m.supply}
              onChange={(supply) => update(m.key, { supply })}
              options={[
                {
                  value: 'CLIENT',
                  label: t(MATERIAL_SUPPLY_INFO.CLIENT.label),
                  hint: t('Não entra no valor. Aparece no PDF como lista de compra.'),
                },
                { value: 'COMPANY_BILLED', label: t(MATERIAL_SUPPLY_INFO.COMPANY_BILLED.label), hint: t('Soma no total do orçamento.') },
                {
                  value: 'COMPANY_INCLUDED',
                  label: t(MATERIAL_SUPPLY_INFO.COMPANY_INCLUDED.label),
                  hint: t('Não soma no total; diminui o seu lucro.'),
                },
              ]}
            />
            <ChoiceGroup
              legend={t('Como calcular a quantidade?')}
              value={m.source}
              onChange={(source) => update(m.key, { source, itemKey: source === 'ITEM' ? (m.itemKey ?? firstItem?.key ?? null) : null })}
              options={[
                { value: 'ITEM', label: t('A partir de um serviço'), hint: t('Ex.: piso = mesma área do assentamento') },
                { value: 'MANUAL', label: t('Vou digitar a quantidade') },
              ]}
            />
            {m.source === 'ITEM' ? (
              form.items.length === 0 ? (
                <p className="error-text">{t('Cadastre um serviço no passo anterior para usar esta opção.')}</p>
              ) : (
                <div className="grid-2">
                  <SelectField label={t('Serviço')} value={m.itemKey ?? ''} onChange={(e) => update(m.key, { itemKey: e.target.value })}>
                    {form.items.map((i, k) => (
                      <option key={i.key} value={i.key}>
                        {k + 1}. {i.description || t('Serviço')} ({formatQuantity(i.quantity ?? '0')} {t(unitShort(i.unit))})
                      </option>
                    ))}
                  </SelectField>
                  <QuantityField
                    label={t('Consumo de {what} por {per}', {
                      what: m.unit || t('material'),
                      per: linkedItem ? t(unitShort(linkedItem.unit)) : t('unidade'),
                    })}
                    hint={t('Para piso: 1 (1 m² de piso por m²). Para argamassa, veja a embalagem.')}
                    maxDecimals={6}
                    value={m.coefficient}
                    onChange={(coefficient) => update(m.key, { coefficient })}
                    error={errors[`materials.${n}.coefficient`]}
                  />
                </div>
              )
            ) : (
              <QuantityField
                label={t('Quantidade necessária')}
                suffix={m.unit}
                value={m.baseQuantity}
                onChange={(baseQuantity) => update(m.key, { baseQuantity })}
                error={errors[`materials.${n}.baseQuantity`]}
              />
            )}
            <QuantityField
              label={t('Perda / quebra')}
              optional
              suffix="%"
              maxDecimals={2}
              hint={t('Ex.: 10% para piso com recortes. Deixe vazio se não houver.')}
              value={m.lossPercent}
              onChange={(lossPercent) => update(m.key, { lossPercent })}
              error={errors[`materials.${n}.lossPercent`]}
            />
            <div className="grid-2">
              <TextField
                label={t('Vende em')}
                optional
                placeholder={t('caixa, saco, lata...')}
                value={m.packageLabel ?? ''}
                onChange={(e) => update(m.key, { packageLabel: e.target.value })}
              />
              <QuantityField
                label={t('Quanto vem em cada {pkg}', { pkg: m.packageLabel || t('embalagem') })}
                optional
                suffix={m.unit}
                hint={t('Veja na embalagem. Ex.: caixa com 2,5 m²')}
                value={m.packageSize}
                onChange={(packageSize) => update(m.key, { packageSize })}
                error={errors[`materials.${n}.packageSize`]}
              />
            </div>
            {m.supply !== 'CLIENT' && (
              <MoneyField
                label={
                  m.packageSize
                    ? t('Preço de cada {pkg}', { pkg: m.packageLabel || t('embalagem') })
                    : t('Preço por {unit}', { unit: m.unit || t('unidade') })
                }
                value={m.unitPriceCents}
                onChange={(unitPriceCents) => update(m.key, { unitPriceCents })}
                error={errors[`materials.${n}.unitPriceCents`]}
              />
            )}
            {line && (
              <div className="calc-box" aria-live="polite">
                <p className="label-strong">{t('Cálculo')}</p>
                <ul>
                  {line.steps.map((s) => (
                    <li key={s}>{tMessage(s)}</li>
                  ))}
                </ul>
                <p>
                  <strong>
                    {t('Comprar:')}{' '}
                    {line.packages !== null
                      ? t('{n} {label}(s) = {qty} {unit}', {
                          n: line.packages,
                          label: line.packageLabel ?? t('embalagem'),
                          qty: formatQuantity(line.purchaseQuantity),
                          unit: line.unit,
                        })
                      : `${formatQuantity(line.calculatedQuantity)} ${line.unit}`}
                  </strong>
                </p>
              </div>
            )}
          </section>
        );
      })}

      <Button
        icon={<Plus aria-hidden />}
        onClick={() =>
          setForm((f) => ({
            ...f,
            materials: [...f.materials, newMaterial(firstItem ? { source: 'ITEM', itemKey: firstItem.key } : {})],
          }))
        }
      >
        {t('Adicionar material')}
      </Button>
    </>
  );
}

// ======================= Passo 4: custos da obra =======================
const COST_PRESETS: { category: CostCategory; label: string; unit: string }[] = [
  { category: 'TEAM', label: 'Ajudante / servente', unit: 'diária' },
  { category: 'FOOD', label: 'Alimentação', unit: 'refeição' },
  { category: 'TRANSPORT', label: 'Combustível / transporte', unit: 'viagem' },
  { category: 'LODGING', label: 'Hospedagem', unit: 'diária' },
  { category: 'EQUIPMENT', label: 'Aluguel de equipamento', unit: 'dia' },
  { category: 'THIRD_PARTY', label: 'Terceirizado', unit: 'serviço' },
  { category: 'OTHER', label: 'Outro custo', unit: 'un' },
];

function StepCosts({ form, setForm, errors, calc }: { form: QuoteForm; setForm: SetForm; errors: Errors; calc: QuoteCalculation }) {
  const update = (key: string, patch: Partial<CostForm>) =>
    setForm((f) => ({ ...f, costs: f.costs.map((c) => (c.key === key ? { ...c, ...patch } : c)) }));
  const remove = (key: string) => setForm((f) => ({ ...f, costs: f.costs.filter((c) => c.key !== key) }));

  return (
    <>
      <p className="muted">
        {tx(
          'Quanto você vai gastar para fazer a obra? Ajudantes, almoço, gasolina, hospedagem… Esses valores {nao} — servem para mostrar quanto sobra para você. Exemplo: 2 ajudantes × 3 dias = {diarias}.',
          { nao: <strong>{t('não aparecem para o cliente')}</strong>, diarias: <strong>{t('6 diárias')}</strong> },
        )}
      </p>
      {form.costs.map((c, n) => (
        <section key={c.key} className="subcard" aria-label={t('Custo {n}', { n: n + 1 })}>
          <div className="subcard-head">
            <h3>{t(COST_CATEGORY_INFO[c.category].label)}</h3>
            <Button
              variant="ghost"
              icon={<Trash2 aria-hidden />}
              onClick={() => remove(c.key)}
              aria-label={t('Remover custo {n}', { n: n + 1 })}
            >
              {t('Remover')}
            </Button>
          </div>
          <SelectField
            label={t('Tipo de custo')}
            value={c.category}
            onChange={(e) => update(c.key, { category: e.target.value as CostCategory })}
          >
            {COST_CATEGORIES.map((cat) => (
              <option key={cat} value={cat}>
                {t(COST_CATEGORY_INFO[cat].label)}
              </option>
            ))}
          </SelectField>
          <TextField
            label={t('Descrição')}
            placeholder={t(COST_CATEGORY_INFO[c.category].example)}
            value={c.description}
            onChange={(e) => update(c.key, { description: e.target.value })}
            error={errors[`costs.${n}.description`]}
          />
          <div className="grid-3">
            <QuantityField
              label={t('Quantidade')}
              value={c.quantity}
              onChange={(quantity) => update(c.key, { quantity })}
              error={errors[`costs.${n}.quantity`]}
            />
            <TextField label={t('Unidade')} optional value={c.unit ?? ''} onChange={(e) => update(c.key, { unit: e.target.value })} />
            <MoneyField
              label={t('Valor de cada')}
              value={c.unitCostCents}
              onChange={(unitCostCents) => update(c.key, { unitCostCents })}
              error={errors[`costs.${n}.unitCostCents`]}
            />
          </div>
          {calc.costs[n] && <p className="calc-line">{tMessage(calc.costs[n]!.explanation)}</p>}
          <Checkbox
            label={t('Cobrar este valor do cliente à parte')}
            hint={t('Marque se este gasto vai aparecer no orçamento como cobrança extra (ex.: deslocamento).')}
            checked={c.chargeToClient}
            onChange={(chargeToClient) => update(c.key, { chargeToClient })}
          />
        </section>
      ))}

      <div className="add-block">
        <p className="label-strong">{t('Adicionar custo')}</p>
        <div className="chips">
          {COST_PRESETS.map((p) => (
            <button
              key={p.label}
              type="button"
              className="chip"
              onClick={() =>
                setForm((f) => ({ ...f, costs: [...f.costs, newCost(p.category, { description: t(p.label), unit: t(p.unit) })] }))
              }
            >
              <Plus aria-hidden /> {t(p.label)}
            </button>
          ))}
        </div>
      </div>
      {form.costs.length > 0 && (
        <p className="calc-line">
          {tx('Total de custos (sem materiais): {total}', { total: <strong>{formatBRL(calc.totals.otherCostsCents)}</strong> })}
        </p>
      )}
    </>
  );
}

// ======================= Passo 5: condições =======================
const PAYMENT_SUGGESTIONS = [
  'À vista na entrega.',
  '50% de entrada e 50% na entrega.',
  'Pagamento por etapa concluída.',
  'PIX ou dinheiro.',
];

function StepConditions({ form, setForm, errors, calc }: { form: QuoteForm; setForm: SetForm; errors: Errors; calc: QuoteCalculation }) {
  return (
    <>
      <TextField
        label={t('Válido até')}
        type="date"
        min={todayISO()}
        value={form.validUntil}
        onChange={(e) => setForm((f) => ({ ...f, validUntil: e.target.value }))}
        error={errors.validUntil}
        hint={form.validUntil ? t('O cliente tem até {date} para aceitar.', { date: fmtDate(form.validUntil) }) : undefined}
      />
      <TextAreaField
        label={t('Forma de pagamento')}
        optional
        value={form.paymentTerms ?? ''}
        onChange={(e) => setForm((f) => ({ ...f, paymentTerms: e.target.value }))}
        error={errors.paymentTerms}
      />
      <div className="chips" aria-label={t('Sugestões de forma de pagamento')}>
        {PAYMENT_SUGGESTIONS.map((s) => (
          <button key={s} type="button" className="chip" onClick={() => setForm((f) => ({ ...f, paymentTerms: t(s) }))}>
            {t(s)}
          </button>
        ))}
      </div>

      <ChoiceGroup
        legend={t('Desconto')}
        value={form.discountType}
        onChange={(discountType) => setForm((f) => ({ ...f, discountType }))}
        options={[
          { value: 'NONE', label: t('Sem desconto') },
          { value: 'AMOUNT', label: t('Desconto em reais (R$)') },
          { value: 'PERCENT', label: t('Desconto em porcentagem (%)') },
        ]}
      />
      {form.discountType === 'AMOUNT' && (
        <MoneyField
          label={t('Valor do desconto')}
          value={form.discountCents}
          onChange={(discountCents) => setForm((f) => ({ ...f, discountCents }))}
          error={errors.discountCents}
        />
      )}
      {form.discountType === 'PERCENT' && (
        <QuantityField
          label={t('Percentual de desconto')}
          suffix="%"
          maxDecimals={2}
          value={form.discountPercent}
          onChange={(discountPercent) => setForm((f) => ({ ...f, discountPercent }))}
          error={errors.discountPercent}
        />
      )}
      {calc.totals.discountCents > 0 && (
        <p className="calc-line">
          {tx('Desconto: {discount} — total passa de {from} para {to}', {
            discount: formatBRL(calc.totals.discountCents),
            from: formatBRL(calc.totals.subtotalCents),
            to: <strong>{formatBRL(calc.totals.totalCents)}</strong>,
          })}
        </p>
      )}

      <TextAreaField
        label={t('O que NÃO está incluído')}
        optional
        hint={t('Evita mal-entendidos. Ex.: retirada de entulho, material elétrico.')}
        value={form.exclusions ?? ''}
        onChange={(e) => setForm((f) => ({ ...f, exclusions: e.target.value }))}
        error={errors.exclusions}
      />
      <TextAreaField
        label={t('Observações')}
        optional
        value={form.notes ?? ''}
        onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
        error={errors.notes}
      />

      <details className="advanced">
        <summary>{t('Opções avançadas (imposto e reserva para imprevistos)')}</summary>
        <p className="muted small">{t('Usadas só no cálculo do seu lucro. Não mudam o valor cobrado do cliente.')}</p>
        <QuantityField
          label={t('Imposto estimado sobre o total')}
          optional
          suffix="%"
          maxDecimals={2}
          hint={t('Se você paga imposto sobre o que recebe, informe a alíquota aproximada. Confirme com seu contador.')}
          value={form.taxPercent}
          onChange={(taxPercent) => setForm((f) => ({ ...f, taxPercent }))}
          error={errors.taxPercent}
        />
        <QuantityField
          label={t('Reserva para imprevistos (sobre os custos)')}
          optional
          suffix="%"
          maxDecimals={2}
          value={form.contingencyPercent}
          onChange={(contingencyPercent) => setForm((f) => ({ ...f, contingencyPercent }))}
          error={errors.contingencyPercent}
        />
      </details>
    </>
  );
}

// ======================= Passo 6: conferir =======================
export function CalculationSummary({ calc, showInternal = true }: { calc: QuoteCalculation; showInternal?: boolean }) {
  const tot = calc.totals;
  return (
    <>
      <dl className="totals">
        <div>
          <dt>{t('Mão de obra')}</dt>
          <dd>{formatBRL(tot.laborCents)}</dd>
        </div>
        {tot.materialsBilledCents > 0 && (
          <div>
            <dt>{t('Materiais cobrados')}</dt>
            <dd>{formatBRL(tot.materialsBilledCents)}</dd>
          </div>
        )}
        {tot.costsBilledCents > 0 && (
          <div>
            <dt>{t('Despesas cobradas')}</dt>
            <dd>{formatBRL(tot.costsBilledCents)}</dd>
          </div>
        )}
        {tot.discountCents > 0 && (
          <div>
            <dt>{t('Desconto')}</dt>
            <dd>− {formatBRL(tot.discountCents)}</dd>
          </div>
        )}
        <div className="total-strong">
          <dt>{t('Total para o cliente')}</dt>
          <dd>{formatBRL(tot.totalCents)}</dd>
        </div>
      </dl>
      {showInternal && (
        <>
          <h3>{t('Só para você (não aparece para o cliente)')}</h3>
          <dl className="totals">
            <div>
              <dt>{t('Materiais comprados por você')}</dt>
              <dd>{formatBRL(tot.materialsCostCents)}</dd>
            </div>
            <div>
              <dt>{t('Outros custos da obra')}</dt>
              <dd>{formatBRL(tot.otherCostsCents)}</dd>
            </div>
            {tot.contingencyCents > 0 && (
              <div>
                <dt>{t('Reserva para imprevistos')}</dt>
                <dd>{formatBRL(tot.contingencyCents)}</dd>
              </div>
            )}
            {tot.taxCents > 0 && (
              <div>
                <dt>{t('Imposto estimado')}</dt>
                <dd>{formatBRL(tot.taxCents)}</dd>
              </div>
            )}
            <div className={`total-strong${tot.estimatedProfitCents < 0 ? ' negative' : ''}`}>
              <dt>
                {t('Lucro estimado')}
                {tot.marginPercent ? ` (${formatPercent(tot.marginPercent)})` : ''}
              </dt>
              <dd>{formatBRL(tot.estimatedProfitCents)}</dd>
            </div>
          </dl>
          <p className="muted small">{t('Lucro estimado é uma previsão com os valores informados — não é dinheiro em caixa.')}</p>
          <details className="advanced">
            <summary>{t('Ver memória de cálculo')}</summary>
            <ul>
              {calc.items.map((i) => (
                <li key={`i${i.index}`}>
                  {i.description}: {tMessage(i.explanation)}
                </li>
              ))}
              {calc.materials.map((m) => (
                <li key={`m${m.index}`}>
                  {m.description}: {m.steps.join(' · ')}
                </li>
              ))}
              {calc.costs.map((c) => (
                <li key={`c${c.index}`}>
                  {c.description}: {tMessage(c.explanation)}
                </li>
              ))}
              {calc.summarySteps.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
          </details>
        </>
      )}
    </>
  );
}

function StepReview({ form, calc }: { form: QuoteForm; calc: QuoteCalculation }) {
  return (
    <>
      <p>
        {tx('{title} para {customer}, válido até {date}.', {
          title: <strong>{form.title || t('Sem nome')}</strong>,
          customer: <strong>{form.customerName ?? '—'}</strong>,
          date: form.validUntil ? fmtDate(form.validUntil) : '—',
        })}
      </p>
      {calc.warnings.length > 0 && (
        <InfoBox tone="warning">
          <ul>
            {calc.warnings.map((w) => (
              <li key={`${w.code}-${w.index ?? ''}`}>{tMessage(w.message)}</li>
            ))}
          </ul>
        </InfoBox>
      )}
      <CalculationSummary calc={calc} />
      <p className="muted small">
        {tx('Ao salvar, o orçamento fica como {rascunho}. Você poderá ver o PDF, conferir e só então emitir e enviar ao cliente.', {
          rascunho: <strong>{t('rascunho')}</strong>,
        })}
      </p>
    </>
  );
}
