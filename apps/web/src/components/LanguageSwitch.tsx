import { Languages } from 'lucide-react';
import { LOCALE_INFO, LOCALES } from '@reformar/shared';
import { setLocale, t, useLocale } from '../lib/i18n';

/** Troca de idioma compacta (PT | EN) para telas sem menu de conta: entrada e página pública. */
export function LanguageSwitch({ className = '' }: { className?: string }) {
  const current = useLocale();
  return (
    <div className={`lang-switch ${className}`} role="group" aria-label={t('Idioma')}>
      <Languages aria-hidden className="lang-ic" />
      {LOCALES.map((l) => (
        <button
          key={l}
          type="button"
          lang={LOCALE_INFO[l].htmlLang}
          aria-pressed={current === l}
          title={LOCALE_INFO[l].label}
          onClick={() => void setLocale(l)}
        >
          {LOCALE_INFO[l].short}
          <span className="sr-only"> {LOCALE_INFO[l].label}</span>
        </button>
      ))}
    </div>
  );
}
