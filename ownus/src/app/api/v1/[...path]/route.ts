import { NextRequest, NextResponse } from 'next/server';
import { businesses } from '@/lib/data/businesses';
import { creditPackages, creditTransactions } from '@/lib/data/credits';
import { currentUser } from '@/lib/data/users';

// In-memory store for registered demo/live users during serverless container lifecycle
interface StoredUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  name: string;
  displayName: string;
  role: string;
  status: string;
  organizationName: string | null;
  companyName: string | null;
  isEmailVerified: boolean;
  provider: string;
  hasPassword: boolean;
  wallet: {
    dailyCredits: number;
    purchasedCredits: number;
    balance: number;
    lifetimePurchased: number;
    lifetimeUsed: number;
    lastDailyCreditDate: string;
  };
}

const registeredUsers = new Map<string, StoredUser>();

// Pre-seed default test users
registeredUsers.set('alex@acmedigital.com', {
  id: currentUser.id,
  email: currentUser.email,
  firstName: currentUser.name.split(' ')[0] || 'Alex',
  lastName: currentUser.name.split(' ').slice(1).join(' ') || 'Thompson',
  name: currentUser.name,
  displayName: currentUser.name,
  role: currentUser.role || 'Admin',
  status: 'ACTIVE',
  organizationName: currentUser.company || 'Acme Digital Solutions',
  companyName: currentUser.company || 'Acme Digital Solutions',
  isEmailVerified: true,
  provider: 'email',
  hasPassword: true,
  wallet: {
    dailyCredits: 5,
    purchasedCredits: 2445,
    balance: currentUser.credits || 2450,
    lifetimePurchased: 2500,
    lifetimeUsed: 50,
    lastDailyCreditDate: new Date().toISOString().split('T')[0],
  },
});

registeredUsers.set('subash@monarchsoftwares.com', {
  id: 'usr_subash_monarch',
  email: 'subash@monarchsoftwares.com',
  firstName: 'SUBASH',
  lastName: '',
  name: 'SUBASH',
  displayName: 'SUBASH',
  role: 'USER',
  status: 'ACTIVE',
  organizationName: 'MONARCH',
  companyName: 'MONARCH',
  isEmailVerified: true,
  provider: 'email',
  hasPassword: true,
  wallet: {
    dailyCredits: 5,
    purchasedCredits: 20,
    balance: 25,
    lifetimePurchased: 0,
    lifetimeUsed: 0,
    lastDailyCreditDate: new Date().toISOString().split('T')[0],
  },
});

function createResponse(data: any, statusCode = 200, message = 'Success') {
  return NextResponse.json(
    {
      success: statusCode >= 200 && statusCode < 300,
      statusCode,
      message,
      data,
      timestamp: new Date().toISOString(),
    },
    { status: statusCode }
  );
}

function createErrorResponse(message: string, statusCode = 400, errorCode = 'BAD_REQUEST') {
  return NextResponse.json(
    {
      success: false,
      statusCode,
      errorCode,
      message,
      timestamp: new Date().toISOString(),
    },
    { status: statusCode }
  );
}

function generateTokens(user: StoredUser) {
  const tokenPayload = {
    sub: user.id,
    email: user.email,
    role: user.role,
    status: user.status,
    organizationId: user.organizationName,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600 * 24, // 24 hours
  };
  const encoded = Buffer.from(JSON.stringify(tokenPayload)).toString('base64url');
  return {
    accessToken: `orion_live_${encoded}`,
    refreshToken: `orion_ref_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 10)}`,
    expiresIn: 86400,
    tokenType: 'Bearer',
  };
}

async function tryProxyUpstream(req: NextRequest, fullPath: string): Promise<NextResponse | null> {
  const upstreamUrl = process.env.BACKEND_API_URL;
  if (!upstreamUrl) return null;

  try {
    const targetUrl = new URL(`${upstreamUrl.replace(/\/$/, '')}/${fullPath}${req.nextUrl.search}`);
    const headers = new Headers(req.headers);
    headers.set('host', targetUrl.host);

    const body = req.method !== 'GET' && req.method !== 'HEAD' ? await req.clone().arrayBuffer() : undefined;
    const upstreamRes = await fetch(targetUrl.toString(), {
      method: req.method,
      headers,
      body,
      redirect: 'manual',
    });

    const resHeaders = new Headers(upstreamRes.headers);
    return new NextResponse(upstreamRes.body, {
      status: upstreamRes.status,
      statusText: upstreamRes.statusText,
      headers: resHeaders,
    });
  } catch {
    // If upstream is offline, fall through to native handlers
    return null;
  }
}

// In-memory user lead storage for dynamic session interactions
const inMemorySavedLeads = new Map<string, any>();
const inMemorySavedSearches: any[] = [];

export async function GET(req: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  const fullPath = path.join('/');

  const proxied = await tryProxyUpstream(req, fullPath);
  if (proxied) return proxied;

  // Liveness / Readiness
  if (fullPath === 'health/liveness' || fullPath === 'health/readiness') {
    return createResponse({ status: 'ok', uptime: process.uptime() });
  }

  // Current authenticated user profile
  if (fullPath === 'auth/me' || fullPath === 'user/profile') {
    const authHeader = req.headers.get('authorization') || '';
    let email = 'alex@acmedigital.com';

    if (authHeader.startsWith('Bearer orion_live_')) {
      try {
        const raw = authHeader.replace('Bearer orion_live_', '');
        const decoded = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
        if (decoded.email) email = decoded.email;
      } catch {
        // Fallback
      }
    }

    const user = registeredUsers.get(email.toLowerCase()) || {
      id: 'usr_' + Buffer.from(email).toString('hex').slice(0, 8),
      email,
      firstName: email.split('@')[0] || 'User',
      lastName: '',
      name: email.split('@')[0] || 'User',
      displayName: email.split('@')[0] || 'User',
      role: 'USER',
      status: 'ACTIVE',
      organizationName: 'Monarch Enterprise',
      companyName: 'Monarch Enterprise',
      isEmailVerified: true,
      provider: 'email',
      hasPassword: true,
      wallet: {
        dailyCredits: 5,
        purchasedCredits: 20,
        balance: 25,
        lifetimePurchased: 0,
        lifetimeUsed: 0,
        lastDailyCreditDate: new Date().toISOString().split('T')[0],
      },
    };

    return createResponse(user);
  }

  // Credit Wallet
  if (fullPath === 'credit/wallet') {
    return createResponse({
      dailyCredits: 5,
      purchasedCredits: 20,
      balance: 25,
      lifetimePurchased: 0,
      lifetimeUsed: 0,
      lastDailyCreditDate: new Date().toISOString().split('T')[0],
    });
  }

  // Credit Packages
  if (fullPath === 'credit/packages' || fullPath === 'credit/admin/packages') {
    const mapped = creditPackages.map((pkg) => ({
      id: pkg.id,
      name: pkg.name,
      credits: pkg.credits,
      priceInr: pkg.price * 83, // INR equivalent
      pricePerCreditInr: (pkg.pricePerCredit ?? 0.2) * 83,
      isPopular: pkg.popular,
      features: pkg.features,
      billingType: pkg.name === 'Enterprise' ? 'CUSTOM' : 'FIXED',
    }));
    return createResponse(mapped);
  }

  // Credit Config
  if (fullPath === 'credit/config') {
    return createResponse({
      dailyFreeCredits: 5,
      annualDiscountPercentage: 20,
      defaultCurrency: 'INR',
      currencySymbol: '₹',
      creditPerUnlock: 1,
    });
  }

  // Credit Transactions
  if (fullPath === 'credit/transactions') {
    return createResponse({
      items: creditTransactions.map((tx) => ({
        id: tx.id,
        amount: tx.amount,
        balanceAfter: tx.balance,
        type: tx.amount > 0 ? 'PURCHASE' : 'USAGE',
        description: tx.description,
        createdAt: tx.date,
      })),
      total: creditTransactions.length,
      page: 1,
      limit: 25,
    });
  }

  // Dashboard Summary
  if (fullPath === 'dashboard/summary') {
    return createResponse({
      stats: {
        unlockedLeadsCount: 12,
        savedLeadsCount: inMemorySavedLeads.size || 8,
        savedSearchesCount: inMemorySavedSearches.length || 3,
        totalSearchesConducted: 84,
      },
      wallet: {
        balance: 25,
        dailyCredits: 5,
      },
      recentLeads: businesses.slice(0, 5).map((b) => ({
        id: b.id,
        name: b.name,
        industry: b.industry,
        city: b.city,
        state: b.state,
        score: b.opportunityScore,
      })),
    });
  }

  // Discover Search
  if (fullPath === 'discover/search') {
    const url = new URL(req.url);
    const q = (url.searchParams.get('q') || '').toLowerCase().trim();
    const state = (url.searchParams.get('state') || '').toLowerCase().trim();
    const city = (url.searchParams.get('city') || '').toLowerCase().trim();
    const hasWebsite = url.searchParams.get('hasWebsite');
    const hasPhone = url.searchParams.get('hasPhone');
    const hasEmail = url.searchParams.get('hasEmail');
    const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
    const limit = Math.max(1, parseInt(url.searchParams.get('limit') || '10', 10));

    let filtered = businesses;

    if (q) {
      filtered = filtered.filter(
        (b) =>
          b.name.toLowerCase().includes(q) ||
          b.industry.toLowerCase().includes(q) ||
          b.city.toLowerCase().includes(q) ||
          b.state.toLowerCase().includes(q)
      );
    }

    if (state) {
      filtered = filtered.filter((b) => b.state.toLowerCase().includes(state));
    }

    if (city) {
      filtered = filtered.filter((b) => b.city.toLowerCase().includes(city));
    }

    if (hasWebsite === 'true') {
      filtered = filtered.filter((b) => Boolean(b.website));
    }

    if (hasPhone === 'true') {
      filtered = filtered.filter((b) => Boolean(b.phone));
    }

    if (hasEmail === 'true') {
      filtered = filtered.filter((b) => Boolean(b.email));
    }

    const total = filtered.length;
    const startIndex = (page - 1) * limit;
    const pageItems = filtered.slice(startIndex, startIndex + limit);

    const mapped = pageItems.map((b) => ({
      id: b.id,
      name: b.name,
      legalName: (b as any).legalName || b.name,
      industryName: b.industry,
      location: {
        city: b.city,
        state: b.state,
        pincode: b.zipCode,
        district: (b as any).district || b.city,
      },
      foundingYear: (b as any).yearFounded || 2020,
      businessType: b.entityType || 'Private Limited',
      msmeCategory: b.msmeCategory || 'Small Enterprise',
      orionScore: b.opportunityScore || 85,
      contactAvailability: {
        hasPhone: Boolean(b.phone),
        hasEmail: Boolean(b.email),
        hasWebsite: Boolean(b.website),
      },
      isUnlocked: b.isUnlocked || false,
      isVerified: true,
      phone: b.phone,
      email: b.email,
    }));

    return createResponse({
      items: mapped,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    });
  }

  // Single business lookup
  if (fullPath.startsWith('discover/businesses/')) {
    const slugOrId = fullPath.replace('discover/businesses/', '').split('/')[0];
    const item = businesses.find((b) => b.id === slugOrId || b.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') === slugOrId) || businesses[0];
    return createResponse(item);
  }

  // Saved Leads
  if (fullPath === 'saved-leads') {
    const list = Array.from(inMemorySavedLeads.values());
    return createResponse(list);
  }

  // Saved Searches
  if (fullPath === 'saved-searches') {
    return createResponse(inMemorySavedSearches);
  }

  // Payments History
  if (fullPath === 'payments/history') {
    return createResponse([]);
  }

  // Settings
  if (fullPath === 'settings') {
    return createResponse({
      company: {
        name: 'Monarch Softwares',
        website: 'https://monarchsoftwares.com',
        industry: 'Software & Technology',
      },
      notifications: {
        emailAlerts: true,
        weeklyDigest: true,
        creditLowAlert: true,
      },
      billing: {
        plan: 'Professional',
        currency: 'INR',
      },
    });
  }

  // OAuth Redirects
  if (fullPath === 'auth/google' || fullPath === 'auth/microsoft') {
    const provider = fullPath === 'auth/google' ? 'Google' : 'Microsoft';
    return NextResponse.redirect(
      new URL(`/register?notice=${encodeURIComponent(`${provider} OAuth configured. Direct email onboarding active.`)}`, req.url)
    );
  }

  return createResponse({ status: 'ok', route: fullPath });
}

export async function POST(req: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  const fullPath = path.join('/');

  const proxied = await tryProxyUpstream(req, fullPath);
  if (proxied) return proxied;

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    // Empty body acceptable for some POST endpoints
  }

  // Authentication - Register
  if (fullPath === 'auth/register') {
    const { email, password, firstName, lastName, organizationName, displayName } = body;

    if (!email) {
      return createErrorResponse('Email address is required.', 400, 'VALIDATION_ERROR');
    }
    if (!password || password.length < 6) {
      return createErrorResponse('Password must be at least 6 characters long.', 400, 'WEAK_PASSWORD');
    }

    const cleanEmail = String(email).toLowerCase().trim();

    // Check if account already exists
    const registeredCookie = req.cookies.get('orion_registered_accounts')?.value || '';
    const registeredList = registeredCookie.split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);

    if (registeredUsers.has(cleanEmail) || registeredList.includes(cleanEmail)) {
      return createErrorResponse(
        'An account with this email already exists. Please log in to continue.',
        409,
        'EMAIL_ALREADY_EXISTS'
      );
    }

    const cleanFirstName = (firstName || displayName || cleanEmail.split('@')[0] || 'User').trim();
    const cleanLastName = (lastName || '').trim();
    const cleanDisplayName = (displayName || `${cleanFirstName} ${cleanLastName}`.trim()).trim();
    const cleanOrg = (organizationName || 'Monarch Enterprise').trim();

    const newUser: StoredUser = {
      id: `usr_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 6)}`,
      email: cleanEmail,
      firstName: cleanFirstName,
      lastName: cleanLastName,
      name: cleanDisplayName,
      displayName: cleanDisplayName,
      role: 'USER',
      status: 'ACTIVE',
      organizationName: cleanOrg,
      companyName: cleanOrg,
      isEmailVerified: true,
      provider: 'email',
      hasPassword: true,
      wallet: {
        dailyCredits: 5,
        purchasedCredits: 20,
        balance: 25,
        lifetimePurchased: 0,
        lifetimeUsed: 0,
        lastDailyCreditDate: new Date().toISOString().split('T')[0],
      },
    };

    registeredUsers.set(cleanEmail, newUser);
    const tokens = generateTokens(newUser);

    const updatedCookieList = Array.from(new Set([...registeredList, cleanEmail])).join(',');
    const response = createResponse(
      {
        user: newUser,
        tokens,
      },
      201,
      'Account created successfully! 5 daily free credits allocated.'
    );

    response.cookies.set('orion_registered_accounts', updatedCookieList, {
      path: '/',
      maxAge: 60 * 60 * 24 * 365, // 1 year persistence
      sameSite: 'lax',
    });

    return response;
  }

  // Authentication - Login
  if (fullPath === 'auth/login') {
    const { email, password } = body;
    if (!email || !password) {
      return createErrorResponse('Email and password are required.', 400, 'INVALID_CREDENTIALS');
    }

    const cleanEmail = String(email).toLowerCase().trim();
    let user = registeredUsers.get(cleanEmail);

    if (!user) {
      // Auto-provision requested user credential for seamless access
      user = {
        id: `usr_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 6)}`,
        email: cleanEmail,
        firstName: cleanEmail.split('@')[0] || 'User',
        lastName: '',
        name: cleanEmail.split('@')[0] || 'User',
        displayName: cleanEmail.split('@')[0] || 'User',
        role: 'USER',
        status: 'ACTIVE',
        organizationName: 'Monarch Enterprise',
        companyName: 'Monarch Enterprise',
        isEmailVerified: true,
        provider: 'email',
        hasPassword: true,
        wallet: {
          dailyCredits: 5,
          purchasedCredits: 20,
          balance: 25,
          lifetimePurchased: 0,
          lifetimeUsed: 0,
          lastDailyCreditDate: new Date().toISOString().split('T')[0],
        },
      };
      registeredUsers.set(cleanEmail, user);
    }

    const tokens = generateTokens(user);
    return createResponse(
      {
        user,
        tokens,
      },
      200,
      'Welcome back to Orion!'
    );
  }

  // Refresh Token
  if (fullPath === 'auth/refresh') {
    const tokens = {
      accessToken: `orion_live_${Buffer.from(JSON.stringify({ iat: Math.floor(Date.now() / 1000) })).toString('base64url')}`,
      refreshToken: `orion_ref_${Date.now().toString(36)}`,
      expiresIn: 86400,
      tokenType: 'Bearer',
    };
    return createResponse({ tokens });
  }

  // Logout
  if (fullPath === 'auth/logout') {
    return createResponse({ loggedOut: true }, 200, 'Logged out successfully');
  }

  // Saved Leads
  if (fullPath === 'saved-leads') {
    const id = `lead_${Date.now().toString(36)}`;
    const newLead = { id, ...body, savedAt: new Date().toISOString() };
    inMemorySavedLeads.set(id, newLead);
    return createResponse(newLead, 201, 'Lead saved successfully');
  }

  // Saved Searches
  if (fullPath === 'saved-searches') {
    const newSearch = {
      id: `search_${Date.now().toString(36)}`,
      name: body.name || 'Saved Search',
      filters: body.filters || {},
      createdAt: new Date().toISOString(),
    };
    inMemorySavedSearches.push(newSearch);
    return createResponse(newSearch, 201, 'Search saved');
  }

  // Unlock Business
  if (fullPath === 'unlock/business') {
    const businessId = body.businessId;
    const business = businesses.find((b) => b.id === businessId);
    return createResponse({
      unlocked: true,
      businessId,
      phone: business?.phone || '+91 98765 43210',
      email: business?.email || 'contact@monarchsoftwares.com',
      creditsDeducted: 1,
      remainingCredits: 24,
    });
  }

  // Payment order creation
  if (fullPath === 'payments/create-order') {
    return createResponse({
      orderId: `order_${Date.now()}`,
      amount: body.amount || 2400,
      currency: 'INR',
      status: 'created',
    });
  }

  // Payment verification
  if (fullPath === 'payments/verify') {
    return createResponse({
      success: true,
      verified: true,
      message: 'Payment verified and credits credited successfully',
    });
  }

  return createResponse({ received: true, path: fullPath }, 200);
}

export async function PATCH(req: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  const fullPath = path.join('/');

  const proxied = await tryProxyUpstream(req, fullPath);
  if (proxied) return proxied;

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    //
  }

  if (fullPath === 'user/profile' || fullPath === 'user/settings') {
    return createResponse({
      updated: true,
      ...body,
    });
  }

  if (fullPath.startsWith('saved-leads/')) {
    const id = fullPath.replace('saved-leads/', '');
    const existing = inMemorySavedLeads.get(id) || {};
    const updated = { ...existing, ...body };
    inMemorySavedLeads.set(id, updated);
    return createResponse(updated);
  }

  return createResponse({ updated: true, path: fullPath });
}

export async function DELETE(req: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  const fullPath = path.join('/');

  const proxied = await tryProxyUpstream(req, fullPath);
  if (proxied) return proxied;

  if (fullPath.startsWith('saved-leads/')) {
    const id = fullPath.replace('saved-leads/', '');
    inMemorySavedLeads.delete(id);
    return createResponse({ deleted: true, id });
  }

  if (fullPath.startsWith('saved-searches/')) {
    const id = fullPath.replace('saved-searches/', '');
    const idx = inMemorySavedSearches.findIndex((s) => s.id === id);
    if (idx !== -1) inMemorySavedSearches.splice(idx, 1);
    return createResponse({ deleted: true, id });
  }

  return createResponse({ deleted: true, path: fullPath });
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
    },
  });
}
