import { describe, expect, it } from 'vitest';
import {
  centsToInput,
  formatBRL,
  multiplyCents,
  normalizeDecimalInput,
  parseBRLToCents,
  percentOfCents,
} from '../src/money.js';
import { formatQuantity } from '../src/units.js';

describe('formatBRL', () => {
  it('formata centavos no padrão brasileiro', () => {
    expect(formatBRL(176000)).toBe('R$ 1.760,00');
    expect(formatBRL(5)).toBe('R$ 0,05');
    expect(formatBRL(123456789)).toBe('R$ 1.234.567,89');
    expect(formatBRL(-2550)).toBe('-R$ 25,50');
    expect(formatBRL(0)).toBe('R$ 0,00');
  });
});

describe('parseBRLToCents', () => {
  it.each([
    ['55', 5500],
    ['55,5', 5550],
    ['55,50', 5550],
    ['1.760,50', 176050],
    ['R$ 1.760,50', 176050],
    ['1760.50', 176050],
    ['1.760', 176000],
    ['0,05', 5],
    ['0.5', 50],
    ['1.234.567,89', 123456789],
  ])('"%s" => %d centavos', (input, expected) => {
    expect(parseBRLToCents(input)).toBe(expected);
  });

  it.each(['', 'abc', '1,2,3', '12,345', '1.2.3', '-5', '10,999'])('rejeita "%s"', (input) => {
    expect(parseBRLToCents(input)).toBeNull();
  });

  it('não sofre erro de ponto flutuante', () => {
    // 0.1 + 0.2 em float = 0.30000000000000004
    expect(parseBRLToCents('0,1')! + parseBRLToCents('0,2')!).toBe(30);
    expect(parseBRLToCents('19,99')).toBe(1999);
    expect(parseBRLToCents('1.005,07')).toBe(100507);
  });

  it('centsToInput gera texto editável', () => {
    expect(centsToInput(176050)).toBe('1760,50');
    expect(centsToInput(null)).toBe('');
  });
});

describe('normalizeDecimalInput', () => {
  it('normaliza quantidades', () => {
    expect(normalizeDecimalInput('32')).toBe('32');
    expect(normalizeDecimalInput('35,2')).toBe('35.2');
    expect(normalizeDecimalInput('2,5 m²')).toBe('2.5');
    expect(normalizeDecimalInput('10%')).toBe('10');
  });
});

describe('aritmética em centavos', () => {
  it('multiplica quantidade decimal por preço com arredondamento meio para cima', () => {
    expect(multiplyCents('32', 5500)).toBe(176000);
    expect(multiplyCents('0.333', 1999)).toBe(666); // 665,667 -> 666
    expect(multiplyCents('0.5', 1)).toBe(1); // 0,5 -> 1 (meio para cima)
    expect(multiplyCents('2.5', 3)).toBe(8); // 7,5 -> 8
  });

  it('calcula percentual', () => {
    expect(percentOfCents(176000, '10')).toBe(17600);
    expect(percentOfCents(999, '5')).toBe(50); // 49,95 -> 50
    expect(percentOfCents(100, '0')).toBe(0);
  });

  it('formata quantidades', () => {
    expect(formatQuantity('35.2')).toBe('35,2');
    expect(formatQuantity('1500')).toBe('1.500');
    expect(formatQuantity('0.0001')).toBe('0,0001');
  });
});
