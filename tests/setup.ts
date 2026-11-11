import { beforeAll } from 'vitest';

beforeAll(() => {
  const dbUrl = process.env.DATABASE_URL || '';

  if (dbUrl.includes('dev.db')) {
    throw new Error('FAIL-CLOSED: Refusing to run database-backed tests against prisma/dev.db. Aborting.');
  }

  if (dbUrl.includes('e2e.db')) {
    throw new Error('FAIL-CLOSED: Refusing to run database-backed tests against prisma/e2e.db. Aborting.');
  }

  if (!dbUrl.includes('test.db')) {
    throw new Error('FAIL-CLOSED: DATABASE_URL must be explicitly set to test.db for automated tests. Current: ' + dbUrl);
  }
});

// Em ambiente de testes, garante que requisições HTTP construídas sem cabeçalhos explícitos
// simulem o comportamento real de um cliente HTTP / navegador padrão (com Host e Origin da URL).
// Quando um teste define cabeçalhos explicitamente, eles são preservados com exatidão.
const OriginalRequest = globalThis.Request;

globalThis.Request = class RealisticTestRequest extends OriginalRequest {
  constructor(input: RequestInfo | URL, init?: RequestInit) {
    const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url;
    let urlObj: URL | null = null;
    try {
      urlObj = new URL(urlStr, 'http://localhost:3000');
    } catch {}

    const headers = new Headers(
      init?.headers || (typeof input === 'object' && input !== null && 'headers' in input ? (input as any).headers : undefined)
    );

    // 1. Simulação realista de cabeçalho Host padrão de navegador/cliente HTTP:
    if (!headers.has('host') && !headers.has('x-omit-host') && urlObj) {
      headers.set('host', urlObj.host || 'localhost:3000');
    }
    if (headers.has('x-omit-host')) {
      headers.delete('x-omit-host');
    }

    // 2. Simulação realista de Origin e Sec-Fetch-Site padrão de navegador em mutações:
    if (!headers.has('origin') && !headers.has('referer') && !headers.has('x-omit-origin') && urlObj) {
      headers.set('origin', urlObj.origin);
      if (!headers.has('sec-fetch-site')) {
        headers.set('sec-fetch-site', 'same-origin');
      }
    }
    if (headers.has('x-omit-origin')) {
      headers.delete('x-omit-origin');
    }

    super(input, {
      ...init,
      headers
    });
  }
} as any;

