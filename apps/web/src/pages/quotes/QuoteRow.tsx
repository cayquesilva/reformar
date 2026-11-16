import { ChevronRight } from 'lucide-react';
import { Link } from 'react-router';
import { formatBRL, quoteNumberLabel, type QuoteSummaryDTO } from '@reformar/shared';
import { Avatar } from '../../components/kit';
import { StatusBadge } from '../../components/ui';
import { fmtDate, t } from '../../lib/i18n';

export function QuoteRow({ quote }: { quote: QuoteSummaryDTO }) {
  return (
    <li>
      <Link to={`/orcamentos/${quote.id}`} className="row-link" viewTransition>
        <Avatar name={quote.customer.name} />
        <div className="row-main">
          <span className="row-title">{t('Nº {number} · {title}', { number: quoteNumberLabel(quote.number), title: quote.title })}</span>
          <span className="muted small">
            {t('{customer} · válido até {date}', { customer: quote.customer.name, date: fmtDate(quote.validUntil) })}
          </span>
        </div>
        <div className="row-side">
          <span className="money">{formatBRL(quote.totalCents)}</span>
          <StatusBadge status={quote.displayStatus} />
        </div>
        <ChevronRight aria-hidden className="row-chevron" />
      </Link>
    </li>
  );
}
