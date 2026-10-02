import { redirect } from 'next/navigation';
import { requireAuthenticatedUser } from '@/lib/auth';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const auth = await requireAuthenticatedUser();
  if (!auth.authenticated) {
    redirect('/login');
  }

  return <>{children}</>;
}
