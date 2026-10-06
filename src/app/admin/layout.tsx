import { redirect } from 'next/navigation';
import { requireAuthenticatedUser } from '@/lib/auth';
import AdminShell from '@/components/AdminShell';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const auth = await requireAuthenticatedUser();
  if (!auth.authenticated) {
    redirect('/login');
  }

  return <AdminShell>{children}</AdminShell>;
}
