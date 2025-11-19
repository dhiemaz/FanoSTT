import { NextResponse } from 'next/server';

export async function GET() {
  try {
    return NextResponse.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      service: 'fano-stt-web',
      version: '1.0.0'
    }, { status: 200 });
  } catch (error) {
    return NextResponse.json({
      status: 'error',
      message: 'Health check failed',
      timestamp: new Date().toISOString()
    }, { status: 500 });
  }
}
