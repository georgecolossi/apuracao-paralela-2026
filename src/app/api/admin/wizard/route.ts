import { NextResponse } from 'next/server';
import { requireAuthenticatedUser } from '@/lib/auth';
import { validateCsrfProtection } from '@/lib/security/csrf';
import {
  getWizardMetadata,
  saveElectionWizard,
  WizardValidationError
} from '@/lib/wizard/wizardService';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const auth = await requireAuthenticatedUser();
    if (!auth.authenticated) {
      return NextResponse.json({ error: 'UNAUTHORIZED', message: 'Autenticação necessária.' }, { status: 401 });
    }

    if (auth.user.role !== 'ADMIN') {
      return NextResponse.json({ error: 'FORBIDDEN', message: 'Acesso restrito a administradores.' }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const electionId = searchParams.get('electionId') || undefined;

    const data = await getWizardMetadata(electionId);
    return NextResponse.json(data);
  } catch (error: any) {
    return NextResponse.json(
      { error: 'INTERNAL_ERROR', message: error.message || 'Erro ao carregar dados do assistente.' },
      { status: 500 }
    );
  }
}

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

    const result = await saveElectionWizard(auth.user.userId, payload);
    return NextResponse.json(result);
  } catch (error: any) {
    if (error instanceof WizardValidationError) {
      return NextResponse.json(
        { error: error.code, message: error.message, details: error.details },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: 'INTERNAL_ERROR', message: error.message || 'Erro ao processar dados do assistente.' },
      { status: 500 }
    );
  }
}
