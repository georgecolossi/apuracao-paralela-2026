import { cookies } from 'next/headers';
import * as jwt from 'jsonwebtoken';

export function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  
  if (!secret || secret.trim() === '') {
    throw new Error('JWT_SECRET_NOT_CONFIGURED');
  }
  
  return secret;
}

export const VALID_ROLES = ['ADMIN', 'OPERATOR', 'VIEWER'] as const;
export type UserRole = typeof VALID_ROLES[number];

export type AuthenticatedUser = {
  authenticated: true;
  user: {
    userId: string;
    role: string;
    name?: string;
    email?: string;
  };
};

export type UnauthenticatedUser = {
  authenticated: false;
  reason: string;
};

export type AuthResult = AuthenticatedUser | UnauthenticatedUser;

export async function requireAuthenticatedUser(): Promise<AuthResult> {
  const cookieStore = await cookies();
  const token = cookieStore.get('admin_session')?.value;

  if (!token) {
    return { authenticated: false, reason: 'NO_TOKEN' };
  }

  try {
    const payload = jwt.verify(token, getJwtSecret());
    
    if (typeof payload !== 'object' || payload === null) {
      return { authenticated: false, reason: 'INVALID_TOKEN' };
    }
    
    if (typeof (payload as jwt.JwtPayload).userId !== 'string' || ((payload as jwt.JwtPayload).userId as string).trim() === '') {
      return { authenticated: false, reason: 'INVALID_TOKEN_IDENTITY' };
    }

    const userId = (payload as jwt.JwtPayload).userId as string;

    const { prisma } = await import('@/lib/db');
    const userInDb = await prisma.user.findUnique({
      where: { id: userId }
    });

    if (!userInDb) {
      return { authenticated: false, reason: 'USER_DELETED' };
    }

    if (!userInDb.isActive) {
      return { authenticated: false, reason: 'USER_INACTIVE' };
    }

    // Controle estrito e fail-closed de sessões por versão explícita (sessionVersion)
    // Tokens legados ou tokens com versão divergente da versão ativa no banco são imediatamente rejeitados
    const tokenSessionVersion = (payload as jwt.JwtPayload).sessionVersion;
    if (typeof tokenSessionVersion !== 'number' || tokenSessionVersion !== userInDb.sessionVersion) {
      return { authenticated: false, reason: 'SESSION_REVOKED' };
    }

    return { 
      authenticated: true, 
      user: {
        userId: userInDb.id,
        role: userInDb.role,
        name: userInDb.name,
        email: userInDb.email
      }
    };
  } catch (err) {
    return { authenticated: false, reason: 'INVALID_TOKEN' };
  }
}

/**
 * Remove dados sensíveis (especialmente passwordHash) dos objetos de usuário.
 */
export function sanitizeUser<T extends { passwordHash?: string }>(user: T): Omit<T, 'passwordHash'> {
  const { passwordHash, ...safe } = user;
  return safe;
}

/**
 * Helper para verificar se uma operação deixaria o sistema sem nenhum ADMIN ativo.
 */
export async function assertNotLastActiveAdmin(
  prismaClient: any,
  targetUserId: string,
  action: 'DEACTIVATE' | 'DELETE' | 'DEMOTE'
): Promise<void> {
  const targetUser = await prismaClient.user.findUnique({
    where: { id: targetUserId },
    select: { id: true, role: true, isActive: true }
  });

  if (!targetUser) {
    return;
  }

  // Se o usuário alvo não for um ADMIN atualmente ativo, a ação não reduz os admins ativos
  if (targetUser.role !== 'ADMIN' || !targetUser.isActive) {
    return;
  }

  const activeAdminsCount = await prismaClient.user.count({
    where: {
      role: 'ADMIN',
      isActive: true
    }
  });

  if (activeAdminsCount <= 1) {
    const actionDesc = action === 'DEACTIVATE'
      ? 'desativar'
      : action === 'DEMOTE'
        ? 'alterar o papel de'
        : 'excluir';

    const err = new Error(
      `Operação bloqueada: não é permitido ${actionDesc} o único administrador ativo do sistema.`
    );
    (err as any).code = 'CANNOT_REMOVE_LAST_ADMIN';
    throw err;
  }
}
