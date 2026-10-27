/**
 * Utilitário de Proteção contra CSRF e Ataques de Sessão por Cookies (PR 2 / v2.0)
 * 
 * Regras:
 * - Requisições idempotentes e seguras (GET, HEAD, OPTIONS) são permitidas.
 * - Requisições de mutação (POST, PUT, PATCH, DELETE) têm sua origem verificada
 *   contra o host da aplicação.
 * - Bloqueia requisições com 'Sec-Fetch-Site: cross-site'.
 * - Bloqueia cabeçalhos 'Origin' ou 'Referer' apontando para domínios externos.
 */

export interface CsrfValidationResult {
  valid: boolean;
  reason?: string;
}

export function validateCsrfProtection(req: Request): CsrfValidationResult {
  const method = req.method.toUpperCase();
  if (['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    return { valid: true };
  }

  // 1. Verificação de Sec-Fetch-Site (padrão Fetch Metadata dos navegadores modernos)
  const secFetchSite = req.headers.get('sec-fetch-site')?.toLowerCase();
  if (secFetchSite === 'cross-site') {
    return { valid: false, reason: 'CROSS_SITE_REQUEST_REJECTED' };
  }

  const hostHeader = req.headers.get('x-forwarded-host') || req.headers.get('host');
  const originHeader = req.headers.get('origin');
  const refererHeader = req.headers.get('referer');

  // Se nenhum host for detectável (ex: requisições manuais em testes ou mocks), permite prosseguir
  if (!hostHeader) {
    return { valid: true };
  }

  const normalizedHost = hostHeader.trim().toLowerCase();

  // 2. Validação estrita do cabeçalho Origin (prioritário para POST/PATCH/DELETE)
  if (originHeader) {
    try {
      const originUrl = new URL(originHeader);
      const originHost = originUrl.host.toLowerCase();

      if (originHost !== normalizedHost) {
        return {
          valid: false,
          reason: `ORIGIN_MISMATCH: origin '${originHost}' diverge de host '${normalizedHost}'.`
        };
      }
    } catch {
      return { valid: false, reason: 'MALFORMED_ORIGIN_HEADER' };
    }
  } else if (refererHeader) {
    // 3. Validação do cabeçalho Referer caso Origin esteja ausente
    try {
      const refererUrl = new URL(refererHeader);
      const refererHost = refererUrl.host.toLowerCase();

      if (refererHost !== normalizedHost) {
        return {
          valid: false,
          reason: `REFERER_MISMATCH: referer '${refererHost}' diverge de host '${normalizedHost}'.`
        };
      }
    } catch {
      return { valid: false, reason: 'MALFORMED_REFERER_HEADER' };
    }
  }

  return { valid: true };
}
