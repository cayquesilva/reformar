import { describe, expect, it } from 'vitest';
import { accessFor, resolveLocale, translate, translateMessage } from '../src/index.js';
import { EN } from '../src/i18n-en.js';

describe('idioma', () => {
  it('lê o idioma de preferências e do cabeçalho Accept-Language', () => {
    expect(resolveLocale('en')).toBe('en');
    expect(resolveLocale('en-US,en;q=0.9')).toBe('en');
    expect(resolveLocale('pt-BR,pt;q=0.9,en;q=0.8')).toBe('pt-BR');
    expect(resolveLocale('fr-FR')).toBe('pt-BR');
    expect(resolveLocale(undefined)).toBe('pt-BR');
  });

  it('traduz texto com variáveis e cai no português quando não há tradução', () => {
    expect(translate(EN, 'Novo orçamento')).toBe('New quote');
    expect(translate(EN, 'Olá, {name}!', { name: 'Ana' })).toBe('Hi, Ana!');
    expect(translate(null, 'Olá, {name}!', { name: 'Ana' })).toBe('Olá, Ana!');
    expect(translate(EN, 'Texto sem tradução')).toBe('Texto sem tradução');
  });

  it('traduz mensagens já montadas pelos modelos do dicionário', () => {
    expect(translateMessage(EN, 'Não há assinatura ativa.')).toBe('There is no active subscription.');
    expect(translateMessage(EN, 'Seu plano permite 3 obra(s) em andamento. Conclua uma obra ou mude de plano.')).toBe(
      'Your plan allows 3 project(s) in progress. Complete a project or change your plan.',
    );
    // pedaços conhecidos dentro do modelo também são traduzidos (unidade "diária")
    expect(translateMessage(EN, '6 diária × R$ 120,00 = R$ 720,00')).toBe('6 day × R$ 120,00 = R$ 720,00');
    expect(translateMessage(EN, 'Mensagem que ninguém traduziu')).toBe('Mensagem que ninguém traduziu');
    expect(translateMessage(null, 'Não há assinatura ativa.')).toBe('Não há assinatura ativa.');
  });

  it('avisos de acesso da assinatura têm tradução (inclusive com data)', () => {
    const w = accessFor(
      { status: 'PAST_DUE', trialEndsAt: null, currentPeriodEnd: null, graceUntil: '2026-12-10' },
      new Date('2026-12-01T12:00:00Z'),
      '2026-12-01',
    );
    expect(translateMessage(EN, w.warning!)).toBe('Subscription payment overdue. Settle it by 10/12/2026 to avoid read-only mode.');
    expect(translateMessage(EN, w.reason)).toBe('Payment overdue (grace period).');
  });

  it('toda entrada do dicionário tem as mesmas variáveis nos dois idiomas', () => {
    const vars = (s: string) => [...new Set(s.match(/\{\w+\}/g) ?? [])].sort();
    const wrong = Object.entries(EN).filter(([pt, en]) => vars(pt).join() !== vars(en).join());
    expect(wrong).toEqual([]);
  });
});
