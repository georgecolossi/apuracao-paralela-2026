import { NextResponse } from 'next/server';
import { requireAuthenticatedUser } from '@/lib/auth';
import { validateCsrfProtection } from '@/lib/security/csrf';
import {
  activateElectionWizard,
  WizardValidationError
} from '@/lib/wizard/wizardService';
import { ElectionInvariantError } from '@/lib/validation/electionContext';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const auth = await requireAuthenticatedUser();
    if (!auth.authenticated) {
      return NextResponse.json({ error: 'UNAUTHORIZED', message: 'Autenticação necessária.' }, { status: 401 });
    }

    if (auth.user.role !== 'ADMIN') {
      return NextResponse.json({ error: 'FORBIDDEN', message: 'Acesso restrito a administradores.' }, { status: 403 });
    }

    const csrfResult = await validateCsrfProtection(req, {
      userId: auth.user.userId,
      sessionVersion: auth.user.sessionVersion
    });

    if (!csrfResult.valid) {
      return NextResponse.json(
        { error: csrfResult.reason || 'INVALID_CSRF_TOKEN', message: csrfResult.reason || 'Falha na validação CSRF.' },
        { status: 403 }
      );
    }

    let payload;
    try {
      payload = await req.json();
    } catch {
      return NextResponse.json({ error: 'INVALID_JSON', message: 'Corpo da requisição deve ser um JSON válido.' }, { status: 400 });
    }

    const { electionId, confirmationText, allowDeactivateCurrent } = payload || {};
    if (!electionId || !confirmationText) {
      return NextResponse.json(
        { error: 'MISSING_FIELDS', message: 'ID da eleição e texto de confirmação são obrigatórios.' },
        { status: 400 }
      );
    }

    const result = await activateElectionWizard(auth.user.userId, electionId, confirmationText, {
      allowDeactivateCurrent: Boolean(allowDeactivateCurrent)
    });
    return NextResponse.json(result);
  } catch (error: any) {
    if (error instanceof WizardValidationError) {
      return NextResponse.json(
        { error: error.code, message: error.message, details: error.details },
        { status: 400 }
      );
    }

    if (error instanceof ElectionInvariantError) {
      return NextResponse.json(
        { error: error.code, message: error.message, details: error.details },
        { status: 400 }
      );
    }

    console.error('[WIZARD_ACTIVATE_ERROR]', error);
    return NextResponse.json(
      { error: 'INTERNAL_SERVER_ERROR', message: 'Ocorreu um erro interno ao ativar a eleição.' },
      { status: 500 }
    );
  }
}
