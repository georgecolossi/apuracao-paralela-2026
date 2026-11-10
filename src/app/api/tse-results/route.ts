import { NextResponse } from 'next/server';
import { getDynamicTseResults } from '@/lib/tse/tseResultsService';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(req: Request) {
  const result = await getDynamicTseResults(req);
  return NextResponse.json(result.body, {
    status: result.status,
    headers: result.headers
  });
}
