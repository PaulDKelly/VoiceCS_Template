import { NextResponse } from 'next/server';

export async function GET() {
    console.log('[DEBUG API] GET /api/debug-ping hit');
    return NextResponse.json({ status: 'ok', time: new Date().toISOString() });
}
