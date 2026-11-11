import { redirect } from 'next/navigation';
import { prisma } from '@/lib/db';
import { requireAuthenticatedUser } from '@/lib/auth';
import UsersManagerClient from './UsersManagerClient';

export const dynamic = 'force-dynamic';

export default async function AdminUsersPage() {
  const auth = await requireAuthenticatedUser();

  if (!auth.authenticated) {
    redirect('/login');
  }

  if (auth.user.role !== 'ADMIN') {
    redirect('/admin');
  }

  const users = await prisma.user.findMany({
    orderBy: [
      { role: 'asc' },
      { name: 'asc' }
    ],
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      isActive: true,
      createdAt: true,
      updatedAt: true,
      _count: {
        select: {
          reportsProcessed: true,
          scanSessions: true
        }
      }
    }
  });

  const serializedUsers = users.map(u => ({
    ...u,
    createdAt: u.createdAt.toISOString(),
    updatedAt: u.updatedAt.toISOString()
  }));

  return (
    <UsersManagerClient
      initialUsers={serializedUsers}
      currentUserId={auth.user.userId}
    />
  );
}
