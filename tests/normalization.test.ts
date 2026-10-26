import { describe, it, expect } from 'vitest';
import {
  normalizeText,
  getConfirmationAliases,
  validateAdminConfirmation
} from '../src/lib/normalization';

describe('normalizeText', () => {
  it('converte para minúsculas e remove espaços extras', () => {
    expect(normalizeText('  ZERAR APURAÇÃO  ')).toBe('zerar apuracao');
    expect(normalizeText('ZERAR    PRIMEIRO   TURNO')).toBe('zerar primeiro turno');
  });

  it('remove acentos e diacríticos (Unicode NFD)', () => {
    expect(normalizeText('APURAÇÃO')).toBe('apuracao');
    expect(normalizeText('Eleições')).toBe('eleicoes');
    expect(normalizeText('Concórdia')).toBe('concordia');
    expect(normalizeText('É À Ô Ü Ç')).toBe('e a o u c');
  });

  it('remove símbolos ordinais (º, ª, °)', () => {
    expect(normalizeText('1º Turno')).toBe('1 turno');
    expect(normalizeText('2ª Seção')).toBe('2 secao');
    expect(normalizeText('3° Turno')).toBe('3 turno');
  });

  it('lida com entradas nulas ou vazias de forma segura', () => {
    expect(normalizeText('')).toBe('');
    expect(normalizeText(null)).toBe('');
    expect(normalizeText(undefined)).toBe('');
    expect(normalizeText('   ')).toBe('');
  });
});

describe('validateAdminConfirmation', () => {
  it('aceita confirmação exata', () => {
    expect(validateAdminConfirmation('ZERAR APURAÇÃO', 'ZERAR APURAÇÃO')).toBe(true);
  });

  it('aceita variações em minúsculas e sem acento', () => {
    expect(validateAdminConfirmation('zerar apuracao', 'ZERAR APURAÇÃO')).toBe(true);
    expect(validateAdminConfirmation('zerar apuração', 'ZERAR APURAÇÃO')).toBe(true);
    expect(validateAdminConfirmation('Zerar Apuração', 'ZERAR APURAÇÃO')).toBe(true);
    expect(validateAdminConfirmation('ZERAR APURACAO', 'ZERAR APURAÇÃO')).toBe(true);
  });

  it('aceita espaços múltiplos e espaçamento externo', () => {
    expect(validateAdminConfirmation('   zerar   apuração   ', 'ZERAR APURAÇÃO')).toBe(true);
  });

  it('aceita correspondência contra lista de aliases contextuais para o 1º turno', () => {
    const { canonical, aliases } = getConfirmationAliases('RESET', 1);
    expect(canonical).toBe('ZERAR PRIMEIRO TURNO');
    expect(validateAdminConfirmation('zerar primeiro turno', aliases)).toBe(true);
    expect(validateAdminConfirmation('ZERAR 1º TURNO', aliases)).toBe(true);
    expect(validateAdminConfirmation('zerar 1 turno', aliases)).toBe(true);
    expect(validateAdminConfirmation('zerar turno 1', aliases)).toBe(true);
    // Deve rejeitar comando genérico ou de outro turno no reset contextual
    expect(validateAdminConfirmation('zerar apuração', aliases)).toBe(false);
    expect(validateAdminConfirmation('zerar apuracao', aliases)).toBe(false);
    expect(validateAdminConfirmation('zerar segundo turno', aliases)).toBe(false);
  });

  it('aceita correspondência contra lista de aliases contextuais para o 2º turno', () => {
    const { canonical, aliases } = getConfirmationAliases('RESET', 2);
    expect(canonical).toBe('ZERAR SEGUNDO TURNO');
    expect(validateAdminConfirmation('zerar segundo turno', aliases)).toBe(true);
    expect(validateAdminConfirmation('ZERAR 2º TURNO', aliases)).toBe(true);
    expect(validateAdminConfirmation('zerar 2 turno', aliases)).toBe(true);
    expect(validateAdminConfirmation('zerar turno 2', aliases)).toBe(true);
    // Deve rejeitar comando genérico ou do primeiro turno
    expect(validateAdminConfirmation('zerar apuração', aliases)).toBe(false);
    expect(validateAdminConfirmation('zerar apuracao', aliases)).toBe(false);
    expect(validateAdminConfirmation('zerar primeiro turno', aliases)).toBe(false);
  });

  it('aceita confirmação genérica exclusivamente para reset global (sem roundNumber)', () => {
    const { canonical, aliases } = getConfirmationAliases('RESET');
    expect(canonical).toBe('ZERAR APURAÇÃO');
    expect(validateAdminConfirmation('ZERAR APURAÇÃO', aliases)).toBe(true);
    expect(validateAdminConfirmation('zerar apuracao', aliases)).toBe(true);
    expect(validateAdminConfirmation('zerar primeiro turno', aliases)).toBe(false);
  });

  it('aceita confirmações de ativação de turno flexíveis', () => {
    const { aliases } = getConfirmationAliases('ACTIVATE', 2);
    expect(validateAdminConfirmation('ativar segundo turno', aliases)).toBe(true);
    expect(validateAdminConfirmation('ATIVAR 2º TURNO', aliases)).toBe(true);
    expect(validateAdminConfirmation('ativar 2 turno', aliases)).toBe(true);
    expect(validateAdminConfirmation('ativar turno 2', aliases)).toBe(true);
  });

  it('rejeita textos divergentes ou incompletos', () => {
    const { aliases } = getConfirmationAliases('RESET', 1);
    expect(validateAdminConfirmation('zerar', aliases)).toBe(false);
    expect(validateAdminConfirmation('primeiro turno', aliases)).toBe(false);
    expect(validateAdminConfirmation('zerar segundo turno', aliases)).toBe(false);
    expect(validateAdminConfirmation('', aliases)).toBe(false);
    expect(validateAdminConfirmation(null, aliases)).toBe(false);
    expect(validateAdminConfirmation('CONFIRMAR', aliases)).toBe(false);
  });

  it('preserva integridade: não aceita substrings parciais', () => {
    expect(validateAdminConfirmation('zerar ap', 'ZERAR APURAÇÃO')).toBe(false);
    expect(validateAdminConfirmation('zerar apuração e mais coisas', 'ZERAR APURAÇÃO')).toBe(false);
  });
});
