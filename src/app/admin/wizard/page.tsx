import { redirect } from 'next/navigation';
import { requireAuthenticatedUser } from '@/lib/auth';
import WizardClient from './WizardClient';

export const dynamic = 'force-dynamic';

export default async function WizardPage(props: {
  searchParams?: Promise<{ electionId?: string }> | { electionId?: string };
}) {
  const auth = await requireAuthenticatedUser();
  if (!auth.authenticated) {
    redirect('/login');
  }

  if (auth.user.role !== 'ADMIN') {
    redirect('/admin');
  }

  const resolvedParams = props.searchParams ? await props.searchParams : {};
  const electionId = resolvedParams?.electionId || undefined;

  return (
    <div className="w-full">
      <WizardClient initialElectionId={electionId} />
    </div>
  );
}
