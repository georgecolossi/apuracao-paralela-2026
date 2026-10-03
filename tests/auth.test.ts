import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as jwt from 'jsonwebtoken';
import { requireAuthenticatedUser, getJwtSecret } from '../src/lib/auth';

// Mock cookies
vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({
    get: vi.fn().mockImplementation((name) => {
      if (name === 'admin_session') return { value: 'mocked_token' };
      return undefined;
    }),
  }),
}));

vi.mock('jsonwebtoken', () => ({
  verify: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  prisma: {
    user: {
      findUnique: vi.fn().mockImplementation(async ({ where }) => {
        if (where.id === '123' || where.id === 'admin-id') return { id: where.id, role: 'ADMIN', isActive: true };
        return null;
      }),
    },
  },
}));

describe('Auth validation', () => {
  const originalEnv = process.env.JWT_SECRET;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env.JWT_SECRET = originalEnv;
  });

  describe('getJwtSecret()', () => {
    it('A) should return exactly the configured value when defined', () => {
      process.env.JWT_SECRET = 'my_secure_test_secret_123';
      expect(getJwtSecret()).toBe('my_secure_test_secret_123');
    });

    it('B) should throw JWT_SECRET_NOT_CONFIGURED when absent', () => {
      delete process.env.JWT_SECRET;
      expect(() => getJwtSecret()).toThrow('JWT_SECRET_NOT_CONFIGURED');
    });

    it('C) should throw JWT_SECRET_NOT_CONFIGURED when empty', () => {
      process.env.JWT_SECRET = '';
      expect(() => getJwtSecret()).toThrow('JWT_SECRET_NOT_CONFIGURED');
    });

    it('D) should throw JWT_SECRET_NOT_CONFIGURED when whitespace', () => {
      process.env.JWT_SECRET = '    ';
      expect(() => getJwtSecret()).toThrow('JWT_SECRET_NOT_CONFIGURED');
    });
  });

  describe('requireAuthenticatedUser()', () => {
    it('E) should return valid user if JWT is valid and has userId', async () => {
      process.env.JWT_SECRET = 'valid_secret';
      vi.mocked(jwt.verify).mockImplementationOnce(() => ({ userId: '123' }) as jwt.JwtPayload);
      const result = await requireAuthenticatedUser();
      expect(result.authenticated).toBe(true);
      if (result.authenticated) {
        expect(result.user.userId).toBe('123');
      }
    });

    it('F) should throw and not authenticate if JWT_SECRET is absent (no fallback)', async () => {
      delete process.env.JWT_SECRET;
      const result = await requireAuthenticatedUser();
      expect(result.authenticated).toBe(false);
      if (!result.authenticated) {
        expect(result.reason).toBe('INVALID_TOKEN');
      }
    });

    it('should reject if JWT is invalid', async () => {
      process.env.JWT_SECRET = 'valid_secret';
      vi.mocked(jwt.verify).mockImplementationOnce(() => { throw new Error('invalid'); });
      const result = await requireAuthenticatedUser();
      expect(result.authenticated).toBe(false);
    });

    it('should reject if JWT is valid but missing userId', async () => {
      process.env.JWT_SECRET = 'valid_secret';
      vi.mocked(jwt.verify).mockImplementationOnce(() => ({ role: 'admin' }) as jwt.JwtPayload);
      const result = await requireAuthenticatedUser();
      expect(result.authenticated).toBe(false);
      if (!result.authenticated) {
        expect(result.reason).toBe('INVALID_TOKEN_IDENTITY');
      }
    });

    it('should reject if JWT has empty userId', async () => {
      process.env.JWT_SECRET = 'valid_secret';
      vi.mocked(jwt.verify).mockImplementationOnce(() => ({ userId: '   ' }) as jwt.JwtPayload);
      const result = await requireAuthenticatedUser();
      expect(result.authenticated).toBe(false);
      if (!result.authenticated) {
        expect(result.reason).toBe('INVALID_TOKEN_IDENTITY');
      }
    });
  });
});
