import crypto from 'crypto';

/**
 * Validador e gerador de senhas seguras (PR 2 / v2.0)
 * 
 * Regras de complexidade:
 * - Mínimo de 8 caracteres
 * - Pelo menos uma letra maiúscula
 * - Pelo menos uma letra minúscula
 * - Pelo menos um dígito numérico ou caractere especial
 * - Não pode constar na lista de senhas fracas comuns
 */

const COMMON_WEAK_PASSWORDS = new Set([
  '12345678',
  'password',
  'admin123',
  '123456789',
  'qwerty123',
  'apuracao2026',
  'senha123',
  'mudar123',
  'brasil2026',
  'eleicoes2026'
]);

export interface PasswordValidationResult {
  valid: boolean;
  errors: string[];
}

export function validatePasswordStrength(password: string): PasswordValidationResult {
  const errors: string[] = [];

  if (!password || typeof password !== 'string') {
    return { valid: false, errors: ['A senha não pode ser vazia.'] };
  }

  const trimmed = password.trim();

  if (trimmed.length < 8) {
    errors.push('A senha deve ter no mínimo 8 caracteres.');
  }

  if (trimmed.length > 128) {
    errors.push('A senha deve ter no máximo 128 caracteres.');
  }

  if (!/[A-Z]/.test(trimmed)) {
    errors.push('A senha deve conter pelo menos uma letra maiúscula.');
  }

  if (!/[a-z]/.test(trimmed)) {
    errors.push('A senha deve conter pelo menos uma letra minúscula.');
  }

  if (!/[0-9]/.test(trimmed) && !/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(trimmed)) {
    errors.push('A senha deve conter pelo menos um número ou símbolo especial.');
  }

  if (COMMON_WEAK_PASSWORDS.has(trimmed.toLowerCase())) {
    errors.push('A senha escolhida é excessivamente comum e insegura.');
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Gera uma senha aleatória de alta entropia para provisionamento de novos usuários.
 */
export function generateSecureRandomPassword(length = 16): string {
  const uppers = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // sem I, O para evitar confusão visual
  const lowers = 'abcdefghijkmnopqrstuvwxyz'; // sem l
  const numbers = '23456789'; // sem 0, 1
  const symbols = '!@#$%^&*_-+=';

  const all = uppers + lowers + numbers + symbols;

  let pwd = '';
  pwd += uppers[crypto.randomInt(0, uppers.length)];
  pwd += lowers[crypto.randomInt(0, lowers.length)];
  pwd += numbers[crypto.randomInt(0, numbers.length)];
  pwd += symbols[crypto.randomInt(0, symbols.length)];

  for (let i = pwd.length; i < length; i++) {
    pwd += all[crypto.randomInt(0, all.length)];
  }

  // Embaralha os caracteres usando Fisher-Yates com randomInt
  const arr = pwd.split('');
  for (let i = arr.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }

  return arr.join('');
}
