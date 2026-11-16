import {
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { t } from '../lib/i18n';
import { AlertTriangle, CheckCircle2, Clock, FileEdit, Hourglass, ArrowLeft, Loader2, XCircle } from 'lucide-react';
import { Link } from 'react-router';
import {
  centsToInput,
  formatBRL,
  formatQuantity,
  normalizeDecimalInput,
  parseBRLToCents,
  QUOTE_STATUS_INFO,
  type QuoteDisplayStatus,
} from '@reformar/shared';

// ---------- Botões ----------
type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
export function Button({
  variant = 'secondary',
  loading,
  icon,
  children,
  className,
  block,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; loading?: boolean; icon?: ReactNode; block?: boolean }) {
  return (
    <button
      type="button"
      {...rest}
      className={`btn btn-${variant}${block ? ' btn-block' : ''}${className ? ` ${className}` : ''}`}
      disabled={rest.disabled || loading}
      aria-busy={loading || undefined}
    >
      {loading ? <Loader2 className="spin" aria-hidden /> : icon}
      <span>{children}</span>
    </button>
  );
}

// ---------- Campo com rótulo, dica e erro ----------
export function Field({
  label,
  hint,
  error,
  children,
  optional,
}: {
  label: string;
  hint?: ReactNode;
  error?: string;
  optional?: boolean;
  children: (props: { id: string; 'aria-describedby'?: string; 'aria-invalid'?: boolean }) => ReactNode;
}) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errId = error ? `${id}-err` : undefined;
  const describedBy = [hintId, errId].filter(Boolean).join(' ') || undefined;
  return (
    <div className={`field${error ? ' has-error' : ''}`}>
      <label htmlFor={id}>
        {label}
        {optional && <span className="optional"> {t('(opcional)')}</span>}
      </label>
      {children({ id, 'aria-describedby': describedBy, 'aria-invalid': error ? true : undefined })}
      {hint && (
        <p className="hint" id={hintId}>
          {hint}
        </p>
      )}
      {error && (
        <p className="error-text" id={errId}>
          <AlertTriangle aria-hidden /> {error}
        </p>
      )}
    </div>
  );
}

export function TextField({
  label,
  hint,
  error,
  optional,
  ...input
}: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: ReactNode; error?: string; optional?: boolean }) {
  return (
    <Field label={label} hint={hint} error={error} optional={optional}>
      {(a11y) => <input className="input" {...input} {...a11y} />}
    </Field>
  );
}

export function TextAreaField({
  label,
  hint,
  error,
  optional,
  ...input
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string; hint?: ReactNode; error?: string; optional?: boolean }) {
  return (
    <Field label={label} hint={hint} error={error} optional={optional}>
      {(a11y) => <textarea className="input" rows={3} {...input} {...a11y} />}
    </Field>
  );
}

export function SelectField({
  label,
  hint,
  error,
  children,
  ...select
}: SelectHTMLAttributes<HTMLSelectElement> & { label: string; hint?: ReactNode; error?: string }) {
  return (
    <Field label={label} hint={hint} error={error}>
      {(a11y) => (
        <select className="input" {...select} {...a11y}>
          {children}
        </select>
      )}
    </Field>
  );
}

/**
 * Campo de dinheiro em reais. Aceita "55", "55,50", "1.760,50".
 * Mantém o texto digitado e entrega centavos inteiros (ou null) ao componente pai.
 */
export function MoneyField({
  label,
  hint,
  error,
  value,
  onChange,
  optional,
}: {
  label: string;
  hint?: ReactNode;
  error?: string;
  value: number | null;
  onChange: (cents: number | null) => void;
  optional?: boolean;
}) {
  const [text, setText] = useState(centsToInput(value));
  const last = useRef(value);
  useEffect(() => {
    if (value !== last.current) {
      last.current = value;
      setText(centsToInput(value));
    }
  }, [value]);
  const parsed = text.trim() === '' ? null : parseBRLToCents(text);
  const invalid = text.trim() !== '' && parsed === null;
  return (
    <Field label={label} hint={hint} optional={optional} error={error ?? (invalid ? t('Valor inválido. Exemplo: 55,00') : undefined)}>
      {(a11y) => (
        <div className="input-affix">
          <span className="affix" aria-hidden>
            R$
          </span>
          <input
            className="input"
            inputMode="decimal"
            autoComplete="off"
            placeholder="0,00"
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              const cents = e.target.value.trim() === '' ? null : parseBRLToCents(e.target.value);
              last.current = cents;
              onChange(cents);
            }}
            onBlur={() => {
              if (parsed !== null) setText(centsToInput(parsed));
            }}
            {...a11y}
          />
        </div>
      )}
    </Field>
  );
}

/** Campo de quantidade decimal (padrão brasileiro). Entrega string com ponto ("32.5") ou null. */
export function QuantityField({
  label,
  hint,
  error,
  value,
  onChange,
  suffix,
  maxDecimals = 4,
  optional,
}: {
  label: string;
  hint?: ReactNode;
  error?: string;
  value: string | null;
  onChange: (value: string | null) => void;
  suffix?: string;
  maxDecimals?: number;
  optional?: boolean;
}) {
  const toText = (v: string | null) => (v === null ? '' : formatQuantity(v, maxDecimals).replace(/\./g, ''));
  const [text, setText] = useState(toText(value));
  const last = useRef(value);
  useEffect(() => {
    if (value !== last.current) {
      last.current = value;
      setText(toText(value));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  const parse = (t: string) => {
    if (t.trim() === '') return null;
    const n = normalizeDecimalInput(t);
    if (n === null) return null;
    const decimals = n.split('.')[1]?.length ?? 0;
    return decimals > maxDecimals ? null : n;
  };
  const invalid = text.trim() !== '' && parse(text) === null;
  return (
    <Field label={label} hint={hint} optional={optional} error={error ?? (invalid ? t('Número inválido. Exemplo: 32,5') : undefined)}>
      {(a11y) => (
        <div className="input-affix">
          <input
            className="input"
            inputMode="decimal"
            autoComplete="off"
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              const v = parse(e.target.value);
              last.current = v;
              onChange(v);
            }}
            {...a11y}
          />
          {suffix && (
            <span className="affix affix-end" aria-hidden>
              {suffix}
            </span>
          )}
        </div>
      )}
    </Field>
  );
}

export function Checkbox({
  label,
  checked,
  onChange,
  hint,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  hint?: string;
}) {
  const id = useId();
  return (
    <div className="checkbox">
      <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <label htmlFor={id}>
        {label}
        {hint && <span className="hint block">{hint}</span>}
      </label>
    </div>
  );
}

/** Grupo de opções grandes (rádio), mais fácil de tocar que um select. */
export function ChoiceGroup<T extends string>({
  legend,
  value,
  options,
  onChange,
  hint,
}: {
  legend: string;
  value: T;
  options: { value: T; label: string; hint?: string }[];
  onChange: (v: T) => void;
  hint?: string;
}) {
  const name = useId();
  return (
    <fieldset className="choices">
      <legend>{legend}</legend>
      {hint && <p className="hint">{hint}</p>}
      {options.map((o) => (
        <label key={o.value} className={`choice${value === o.value ? ' selected' : ''}`}>
          <input type="radio" name={name} value={o.value} checked={value === o.value} onChange={() => onChange(o.value)} />
          <span>
            <strong>{o.label}</strong>
            {o.hint && <span className="hint block">{o.hint}</span>}
          </span>
        </label>
      ))}
    </fieldset>
  );
}

// ---------- Apresentação ----------
/** Carregamento com "esqueleto" (forma do conteúdo), mais suave que um ícone girando. */
export function Spinner({ label = t('Carregando…'), variant = 'page' }: { label?: string; variant?: 'page' | 'list' | 'inline' }) {
  if (variant === 'inline') {
    return (
      <div className="spinner" role="status">
        <Loader2 className="spin" aria-hidden />
        <span>{label}</span>
      </div>
    );
  }
  return (
    <div className="skeleton-block" role="status" aria-live="polite">
      <span className="sr-only">{label}</span>
      {variant === 'page' && <span className="skeleton lg" aria-hidden />}
      <span className="skeleton card-sk" aria-hidden />
      <span className="skeleton" style={{ width: '85%' }} aria-hidden />
      <span className="skeleton" style={{ width: '60%' }} aria-hidden />
    </div>
  );
}

export function ErrorBox({ children }: { children: ReactNode }) {
  return (
    <div className="alert alert-error" role="alert">
      <AlertTriangle aria-hidden />
      <div>{children}</div>
    </div>
  );
}

export function InfoBox({ children, tone = 'info' }: { children: ReactNode; tone?: 'info' | 'warning' | 'success' }) {
  return <div className={`alert alert-${tone}`}>{children}</div>;
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <h2>{title}</h2>
      {children && <div className="muted">{children}</div>}
      {action && <div className="empty-action">{action}</div>}
    </div>
  );
}

const STATUS_ICON: Record<QuoteDisplayStatus, ReactNode> = {
  DRAFT: <FileEdit aria-hidden />,
  SENT: <Clock aria-hidden />,
  APPROVED: <CheckCircle2 aria-hidden />,
  REFUSED: <XCircle aria-hidden />,
  EXPIRED: <Hourglass aria-hidden />,
};

/** Status sempre com ícone + texto (não depende só de cor). */
export function StatusBadge({ status }: { status: QuoteDisplayStatus }) {
  return (
    <span className={`badge badge-${status.toLowerCase()}`} title={t(QUOTE_STATUS_INFO[status].hint)}>
      {STATUS_ICON[status]}
      {t(QUOTE_STATUS_INFO[status].label)}
    </span>
  );
}

export function Money({ cents, className }: { cents: number; className?: string }) {
  return <span className={`money${className ? ` ${className}` : ''}`}>{formatBRL(cents)}</span>;
}

export function PageHeader({
  title,
  subtitle,
  actions,
  back,
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  /** Link de volta para a tela anterior na hierarquia (ex.: lista). */
  back?: { to: string; label: string };
}) {
  return (
    <header className="page-header">
      <div>
        {back && (
          <Link to={back.to} className="back-link">
            <ArrowLeft aria-hidden /> {back.label}
          </Link>
        )}
        <h1>{title}</h1>
        {subtitle && <p className="muted">{subtitle}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  );
}

/** Diálogo modal nativo (<dialog>), com foco e tecla Esc tratados pelo navegador. */
export function Dialog({ open, title, onClose, children }: { open: boolean; title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal?.();
    if (!open && d.open) d.close?.();
  }, [open]);
  return (
    <dialog ref={ref} className="dialog" aria-labelledby={titleId} onClose={onClose} onCancel={onClose}>
      {open && (
        <>
          <h2 id={titleId}>{title}</h2>
          {children}
        </>
      )}
    </dialog>
  );
}
