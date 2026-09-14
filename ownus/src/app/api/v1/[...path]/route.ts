import { NextRequest, NextResponse } from 'next/server';

/**
 * Orion Production Gateway Proxy
 *
 * Ensures NestJS API remains the single source of truth for:
 * - Authentication & JWT token verification
 * - Credit wallets and atomic deduction ledger
 * - Real business discovery and PostgreSQL search
 * - Saved leads, saved searches, and lead unlock management
 * - Audit logging and administrative imports
 *
 * No in-memory production maps. No mock users or fake fallback data.
 */

function getBackendUrl(): string {
  const envUrl = process.env.BACKEND_API_URL || process.env.NEST_API_URL;
  if (envUrl) {
    return envUrl.replace(/\/$/, '');
  }
  return 'http://127.0.0.1:4000/api/v1';
}

async function proxyRequest(
  req: NextRequest,
  context: { params: Promise<{ path: string[] }> },
): Promise<NextResponse> {
  const { path } = await context.params;
  const fullPath = path.join('/');

  // Gateway Liveness / Readiness health probe
  if (fullPath === 'health/liveness' || fullPath === 'health/readiness') {
    return NextResponse.json({
      success: true,
      statusCode: 200,
      message: 'Orion Gateway Online',
      data: { status: 'ok', uptime: process.uptime() },
      timestamp: new Date().toISOString(),
    });
  }

  const backendBase = getBackendUrl();
  const targetUrl = new URL(`${backendBase}/${fullPath}${req.nextUrl.search}`);

  // Prevent self-proxy recursion loops
  if (targetUrl.host === req.nextUrl.host) {
    return NextResponse.json(
      {
        success: false,
        statusCode: 500,
        message: 'Invalid routing configuration: Gateway cannot proxy to its own host.',
      },
      { status: 500 },
    );
  }

  const headers = new Headers(req.headers);
  headers.set('host', targetUrl.host);

  const clientIp = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip');
  if (clientIp) {
    headers.set('x-forwarded-for', clientIp);
  }

  let body: ArrayBuffer | undefined = undefined;
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    try {
      body = await req.arrayBuffer();
    } catch {
      // Body may be empty for certain calls
    }
  }

  try {
    let upstreamRes: Response;
    try {
      upstreamRes = await fetch(targetUrl.toString(), {
        method: req.method,
        headers,
        body,
        redirect: 'manual',
      });
    } catch (firstErr: any) {
      if (targetUrl.hostname === '127.0.0.1' || targetUrl.hostname === 'localhost') {
        const altHost = targetUrl.hostname === '127.0.0.1' ? 'localhost' : '127.0.0.1';
        const altUrl = new URL(targetUrl.toString());
        altUrl.hostname = altHost;
        headers.set('host', altUrl.host);
        upstreamRes = await fetch(altUrl.toString(), {
          method: req.method,
          headers,
          body,
          redirect: 'manual',
        });
      } else {
        throw firstErr;
      }
    }

    // Handle OAuth redirects (Google/Microsoft 302 redirect)
    if (upstreamRes.status >= 300 && upstreamRes.status < 400) {
      const location = upstreamRes.headers.get('location');
      if (location) {
        const redirectHeaders = new Headers();
        redirectHeaders.set('location', location);
        return new NextResponse(null, {
          status: upstreamRes.status,
          statusText: upstreamRes.statusText,
          headers: redirectHeaders,
        });
      }
    }

    const resHeaders = new Headers();
    upstreamRes.headers.forEach((val, key) => {
      const lowerKey = key.toLowerCase();
      if (!['transfer-encoding', 'connection', 'keep-alive', 'content-encoding', 'content-length'].includes(lowerKey)) {
        resHeaders.set(key, val);
      }
    });

    const bodyBuffer = await upstreamRes.arrayBuffer();

    return new NextResponse(bodyBuffer, {
      status: upstreamRes.status,
      statusText: upstreamRes.statusText,
      headers: resHeaders,
    });
  } catch (err: any) {
    console.error(
      `[Gateway Error] Failed to proxy ${req.method} ${fullPath} to upstream API: ${err?.message}`,
    );

    return NextResponse.json(
      {
        success: false,
        statusCode: 503,
        errorCode: 'BACKEND_UNAVAILABLE',
        message:
          'The Orion backend API is currently unreachable. Please ensure the NestJS service is running.',
        timestamp: new Date().toISOString(),
      },
      { status: 503 },
    );
  }
}

export async function GET(req: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  return proxyRequest(req, context);
}

export async function POST(req: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  return proxyRequest(req, context);
}

export async function PUT(req: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  return proxyRequest(req, context);
}

export async function PATCH(req: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  return proxyRequest(req, context);
}

export async function DELETE(req: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  return proxyRequest(req, context);
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
    },
  });
}
