import crypto from 'crypto';
import { getJwtSecret } from '@/lib/auth';

/**
 * Utilitário de Proteção contra CSRF e Ataques de Sessão por Cookies (PR 2 / v2.0)
 * 
 * Diretrizes de Segurança Estrita:
 * 1. Métodos idempotentes (GET, HEAD, OPTIONS) são permitidos.
 * 2. Rejeição imediata de objetos Request ou Headers inválidos (sem bypasses de teste).
 * 3. Requisições 'Sec-Fetch-Site: cross-site' são sumariamente bloqueadas.
 * 4. 'Sec-Fetch-Site: same-site' NÃO é considerado equivalente a 'same-origin'.
 * 5. Validação rigorosa de Host e X-Forwarded-Host contra domínios autorizados, sem confiança cega
 *    em cabeçalhos de encaminhamento e sem sufixos genéricos de domínios (ex.: .railway.app).
 * 6. Validação estrita da origem completa (protocolo, domínio e porta) via Origin ou Referer.
 * 7. Token CSRF real: caso utilizado em requisições sem Origin/Referer, deve ser criptograficamente
 *    seguro, emitido pelo servidor via HMAC-SHA256, vinculado à sessão (userId + sessionVersion)
 *    e validado com timingSafeEqual. Tokens inventados ou de outras sessões são rejeitados.
 * 8. Política estritamente fail-closed e idêntica em produção e testes.
 */

export interface CsrfValidationResult {
  valid: boolean;
  reason?: string;
}

export interface CsrfAuthContext {
  userId?: string | null;
  sessionVersion?: number | null;
}

/**
 * Retorna os hosts confiáveis rigorosamente configurados no ambiente.
 * Nenhum sufixo genérico de wildcard é permitido.
 */
export function getTrustedHosts(): Set<string> {
  const trusted = new Set<string>();

  if (process.env.APP_URL) {
    try {
      trusted.add(new URL(process.env.APP_URL).host.toLowerCase());
    } catch {}
  }

  if (process.env.NEXT_PUBLIC_APP_URL) {
    try {
      trusted.add(new URL(process.env.NEXT_PUBLIC_APP_URL).host.toLowerCase());
    } catch {}
  }

  if (process.env.RAILWAY_PUBLIC_DOMAIN) {
    trusted.add(process.env.RAILWAY_PUBLIC_DOMAIN.trim().toLowerCase());
  }

  // Em ambientes de teste e desenvolvimento local, autoriza explicitamente apenas loopback
  if (process.env.NODE_ENV !== 'production') {
    trusted.add('localhost');
    trusted.add('localhost:3000');
    trusted.add('127.0.0.1');
    trusted.add('127.0.0.1:3000');
  }

  return trusted;
}

/**
 * Retorna o conjunto de origens (protocolo + domínio + porta) expressamente autorizadas.
 */
export function getTrustedOrigins(): Set<string> {
  const origins = new Set<string>();

  if (process.env.APP_URL) {
    try {
      origins.add(new URL(process.env.APP_URL).origin.toLowerCase());
    } catch {}
  }

  if (process.env.NEXT_PUBLIC_APP_URL) {
    try {
      origins.add(new URL(process.env.NEXT_PUBLIC_APP_URL).origin.toLowerCase());
    } catch {}
  }

  if (process.env.RAILWAY_PUBLIC_DOMAIN) {
    // Domínios públicos do Railway operam sob HTTPS
    origins.add(`https://${process.env.RAILWAY_PUBLIC_DOMAIN.trim().toLowerCase()}`);
  }

  // Em ambientes de teste e desenvolvimento local
  if (process.env.NODE_ENV !== 'production') {
    origins.add('http://localhost:3000');
    origins.add('http://localhost');
    origins.add('http://127.0.0.1:3000');
    origins.add('http://127.0.0.1');
    origins.add('https://localhost:3000');
    origins.add('https://localhost');
  }

  return origins;
}

/**
 * Emite um token CSRF criptograficamente seguro e vinculado à sessão ativa (userId + sessionVersion).
 */
export function generateCsrfToken(userId: string, sessionVersion: number = 0): string {
  const version = typeof sessionVersion === 'number' ? sessionVersion : 0;
  if (!userId) {
    throw new Error('CSRF_CONTEXT_REQUIRED: userId é obrigatório para emissão de token CSRF.');
  }

  const secret = getJwtSecret();
  const subkey = crypto.createHmac('sha256', secret).update('PURPOSE_CSRF_PROTECTION').digest();
  const hmac = crypto.createHmac('sha256', subkey);
  hmac.update(`csrf_v2:${userId}:${version}`);
  return hmac.digest('hex');
}

/**
 * Valida o token CSRF recebido contra o usuário e a versão de sessão ativos usando timingSafeEqual.
 */
export function verifyCsrfToken(
  token: string | null | undefined,
  userId: string,
  sessionVersion: number = 0
): boolean {
  if (!token || typeof token !== 'string') {
    return false;
  }

  const cleanToken = token.trim();
  if (cleanToken.length !== 64 || !/^[0-9a-f]{64}$/i.test(cleanToken)) {
    return false;
  }

  const version = typeof sessionVersion === 'number' ? sessionVersion : 0;
  if (!userId) {
    return false;
  }

  try {
    const expectedToken = generateCsrfToken(userId, version);
    const bufA = Buffer.from(cleanToken, 'hex');
    const bufB = Buffer.from(expectedToken, 'hex');

    if (bufA.length !== bufB.length) {
      return false;
    }

    return crypto.timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

/**
 * Valida a proteção CSRF de uma requisição de mutação sob política fail-closed.
 */
export function validateCsrfProtection(
  req: Request,
  authContext?: CsrfAuthContext
): CsrfValidationResult {
  // 1. Rejeição de requisição nula, indefinida ou malformada
  if (!req || typeof req !== 'object' || typeof req.method !== 'string') {
    return { valid: false, reason: 'INVALID_REQUEST: Objeto Request ausente ou inválido.' };
  }

  // 2. Rejeição estrita de requisições sem objeto Headers funcional
  if (!req.headers || typeof req.headers.get !== 'function') {
    return { valid: false, reason: 'INVALID_HEADERS: Objeto Headers ausente ou inválido na requisição.' };
  }

  const method = req.method.toUpperCase();
  // 3. Métodos idempotentes e de leitura são permitidos
  if (['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    return { valid: true };
  }

  // 4. Verificação estrita de Sec-Fetch-Site (Fetch Metadata)
  const secFetchSite = req.headers.get('sec-fetch-site')?.toLowerCase().trim();
  if (secFetchSite === 'cross-site') {
    return { valid: false, reason: 'CROSS_SITE_REQUEST_REJECTED: Requisição cross-site bloqueada.' };
  }

  const trustedHosts = getTrustedHosts();
  const trustedOrigins = getTrustedOrigins();

  const directHost = req.headers.get('host')?.trim().toLowerCase();
  const forwardedHost = req.headers.get('x-forwarded-host')?.trim().toLowerCase();

  // 5. Validação rigorosa de Host e X-Forwarded-Host:
  // Não confia em cabeçalhos de encaminhamento arbitrariamente fornecidos pelo cliente.
  let resolvedHost: string | null = null;
  if (forwardedHost) {
    if (trustedHosts.has(forwardedHost)) {
      resolvedHost = forwardedHost;
    } else {
      return {
        valid: false,
        reason: `UNTRUSTED_FORWARDED_HOST: O host encaminhado '${forwardedHost}' não consta na lista de domínios autorizados.`
      };
    }
  } else if (directHost) {
    if (trustedHosts.has(directHost)) {
      resolvedHost = directHost;
    } else {
      return {
        valid: false,
        reason: `UNTRUSTED_HOST: O cabeçalho Host '${directHost}' não consta na lista de domínios autorizados.`
      };
    }
  } else {
    return {
      valid: false,
      reason: 'MISSING_HOST: Requisição de mutação sem cabeçalho Host ou X-Forwarded-Host.'
    };
  }

  const originHeader = req.headers.get('origin')?.trim();
  const refererHeader = req.headers.get('referer')?.trim();
  const csrfTokenHeader = req.headers.get('x-csrf-token')?.trim();

  // 6. Validação estrita do cabeçalho Origin:
  if (originHeader) {
    let originUrl: URL;
    try {
      originUrl = new URL(originHeader);
    } catch {
      return { valid: false, reason: 'MALFORMED_ORIGIN_HEADER: Cabeçalho Origin malformado.' };
    }

    // Em produção, exige protocolo HTTPS estrito
    if (process.env.NODE_ENV === 'production' && originUrl.protocol !== 'https:') {
      return {
        valid: false,
        reason: 'INSECURE_ORIGIN_SCHEME: Requisições de mutação em produção devem utilizar HTTPS.'
      };
    }

    const normalizedOrigin = originUrl.origin.toLowerCase();
    const originHost = originUrl.host.toLowerCase();

    const isOriginTrusted =
      trustedOrigins.has(normalizedOrigin) ||
      (originHost === resolvedHost && (process.env.NODE_ENV !== 'production' || originUrl.protocol === 'https:'));

    if (!isOriginTrusted) {
      return {
        valid: false,
        reason: `ORIGIN_MISMATCH: origin '${originHeader}' diverge dos domínios autorizados para host '${resolvedHost}'.`
      };
    }

    return { valid: true };
  }

  // 7. Validação estrita do cabeçalho Referer caso Origin esteja ausente:
  if (refererHeader) {
    let refererUrl: URL;
    try {
      refererUrl = new URL(refererHeader);
    } catch {
      return { valid: false, reason: 'MALFORMED_REFERER_HEADER: Cabeçalho Referer malformado.' };
    }

    if (process.env.NODE_ENV === 'production' && refererUrl.protocol !== 'https:') {
      return {
        valid: false,
        reason: 'INSECURE_REFERER_SCHEME: Referer em produção deve utilizar HTTPS.'
      };
    }

    const normalizedRefererOrigin = refererUrl.origin.toLowerCase();
    const refererHost = refererUrl.host.toLowerCase();

    const isRefererTrusted =
      trustedOrigins.has(normalizedRefererOrigin) ||
      (refererHost === resolvedHost && (process.env.NODE_ENV !== 'production' || refererUrl.protocol === 'https:'));

    if (!isRefererTrusted) {
      return {
        valid: false,
        reason: `REFERER_MISMATCH: referer '${refererHeader}' diverge dos domínios autorizados para host '${resolvedHost}'.`
      };
    }

    return { valid: true };
  }

  // 8. Se Origin e Referer estiverem ausentes:
  // - Sec-Fetch-Site: same-origin é aceito (stamped pelo navegador nativamente em chamadas de mesma origem)
  // - Sec-Fetch-Site: same-site NÃO é aceito como same-origin
  if (secFetchSite === 'same-origin') {
    return { valid: true };
  }

  // - Ou validação criptográfica estrita do token CSRF vinculado à sessão ativa
  if (csrfTokenHeader && authContext?.userId) {
    const sessionVersion = typeof authContext.sessionVersion === 'number' ? authContext.sessionVersion : 0;
    const isValidToken = verifyCsrfToken(csrfTokenHeader, authContext.userId, sessionVersion);
    if (isValidToken) {
      return { valid: true };
    }
    return {
      valid: false,
      reason: 'INVALID_CSRF_TOKEN: O token CSRF é inválido, expirado, forjado ou pertence a outra sessão.'
    };
  }

  if (csrfTokenHeader && !authContext?.userId) {
    return {
      valid: false,
      reason: 'INVALID_CSRF_TOKEN: Sessão de autenticação ausente para validação de token CSRF.'
    };
  }

  // 9. Fail-Closed absoluto
  return {
    valid: false,
    reason: 'MISSING_ORIGIN_AND_REFERER: Requisição de mutação rejeitada por ausência de cabeçalho Origin, Referer ou token CSRF válido vinculado à sessão (política fail-closed).'
  };
}
