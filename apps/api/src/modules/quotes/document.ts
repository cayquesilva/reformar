import { calculateQuote, todayISO, type QuoteCalculation, type QuoteContentInput } from '@reformar/shared';
import type { QuoteFullRow } from './mapper.js';
import { rowsToContent } from './mapper.js';

/**
 * Documento completo de um orçamento, congelado no momento da emissão (QuoteVersion.snapshot).
 * Garante que o PDF de uma revisão enviada não muda se a empresa/cliente forem editados depois.
 */
export interface QuoteDocument {
  schemaVersion: 1;
  number: number;
  revision: number;
  issuedOn: string;
  isDraft: boolean;
  company: {
    tradeName: string;
    legalName: string | null;
    document: string | null;
    phone: string | null;
    whatsapp: string | null;
    email: string | null;
    addressLine: string | null;
    city: string | null;
    state: string | null;
    zipCode: string | null;
    primaryColor: string;
    pdfFooter: string | null;
  };
  customer: {
    name: string;
    type: 'INDIVIDUAL' | 'COMPANY';
    document: string | null;
    phone: string | null;
    whatsapp: string | null;
    email: string | null;
    addressLine: string | null;
    city: string | null;
    state: string | null;
  };
  content: QuoteContentInput;
  calculation: QuoteCalculation;
}

export type CompanyForDoc = QuoteDocument['company'];

export function buildQuoteDocument(
  quote: QuoteFullRow,
  company: CompanyForDoc,
  opts: { isDraft: boolean; issuedOn?: string },
): QuoteDocument {
  const content = rowsToContent(quote);
  const c = quote.customer;
  return {
    schemaVersion: 1,
    number: quote.number,
    revision: quote.currentRevision,
    issuedOn: opts.issuedOn ?? todayISO(),
    isDraft: opts.isDraft,
    company: {
      tradeName: company.tradeName,
      legalName: company.legalName,
      document: company.document,
      phone: company.phone,
      whatsapp: company.whatsapp,
      email: company.email,
      addressLine: company.addressLine,
      city: company.city,
      state: company.state,
      zipCode: company.zipCode,
      primaryColor: company.primaryColor,
      pdfFooter: company.pdfFooter,
    },
    customer: {
      name: c.name,
      type: c.type,
      document: c.document,
      phone: c.phone,
      whatsapp: c.whatsapp,
      email: c.email,
      addressLine: c.addressLine,
      city: c.city,
      state: c.state,
    },
    content,
    calculation: calculateQuote(content),
  };
}
