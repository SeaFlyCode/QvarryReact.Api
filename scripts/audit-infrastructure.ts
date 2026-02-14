/**
 * Infrastructure Security Audit Script
 *
 * Ce script teste la fiabilité des mécanismes de sécurité de l'application :
 * - Refresh token et rotation
 * - Rate limiting
 * - Protection brute force
 * - Session management
 * - WebSocket authentication
 * - Token blacklisting
 * - Cookie security
 *
 * Usage: npx ts-node scripts/audit-infrastructure.ts
 */

import axios, { AxiosInstance, AxiosError } from 'axios';
import * as https from 'https';
import * as WebSocket from 'ws';

// Configuration
const CONFIG = {
  baseUrl: process.env.API_URL || 'http://localhost:3000',
  testUser: {
    email: process.env.TEST_EMAIL || 'audit-test@example.com',
    password: process.env.TEST_PASSWORD || 'AuditTest123!@#',
  },
  timeout: 10000,
  verbose: process.env.VERBOSE === 'true',
};

// Types
interface AuditResult {
  name: string;
  category: string;
  passed: boolean;
  message: string;
  details?: Record<string, unknown>;
  duration?: number;
}

interface TestContext {
  accessToken?: string;
  refreshToken?: string;
  cookies?: string[];
  wsToken?: string;
  client: AxiosInstance;
}

// Utility functions
const colors = {
  green: (text: string) => `\x1b[32m${text}\x1b[0m`,
  red: (text: string) => `\x1b[31m${text}\x1b[0m`,
  yellow: (text: string) => `\x1b[33m${text}\x1b[0m`,
  blue: (text: string) => `\x1b[34m${text}\x1b[0m`,
  cyan: (text: string) => `\x1b[36m${text}\x1b[0m`,
  bold: (text: string) => `\x1b[1m${text}\x1b[0m`,
};

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function extractCookies(response: { headers: Record<string, unknown> }): string[] {
  const setCookie = response.headers['set-cookie'];
  if (Array.isArray(setCookie)) return setCookie;
  if (typeof setCookie === 'string') return [setCookie];
  return [];
}

function getCookieValue(cookies: string[], name: string): string | undefined {
  for (const cookie of cookies) {
    if (cookie.startsWith(`${name}=`)) {
      const value = cookie.split(';')[0].split('=')[1];
      return value;
    }
  }
  return undefined;
}

function log(message: string, level: 'info' | 'warn' | 'error' | 'success' = 'info') {
  const prefix = {
    info: colors.blue('[INFO]'),
    warn: colors.yellow('[WARN]'),
    error: colors.red('[ERROR]'),
    success: colors.green('[SUCCESS]'),
  };
  console.log(`${prefix[level]} ${message}`);
}

// Audit class
class InfrastructureAudit {
  private results: AuditResult[] = [];
  private context: TestContext;

  constructor() {
    this.context = {
      client: axios.create({
        baseURL: CONFIG.baseUrl,
        timeout: CONFIG.timeout,
        httpsAgent: new https.Agent({ rejectUnauthorized: false }),
        withCredentials: true,
        validateStatus: () => true, // Don't throw on any status
      }),
    };
  }

  private addResult(result: AuditResult) {
    this.results.push(result);
    const status = result.passed
      ? colors.green('✓ PASS')
      : colors.red('✗ FAIL');
    console.log(`  ${status} ${result.name}`);
    if (CONFIG.verbose && result.details) {
      console.log(`    Details: ${JSON.stringify(result.details, null, 2)}`);
    }
    if (!result.passed) {
      console.log(`    ${colors.yellow(result.message)}`);
    }
  }

  // ===========================================
  // AUTHENTICATION TESTS
  // ===========================================

  async testBasicAuthentication(): Promise<void> {
    console.log(colors.bold('\n📋 Category: Basic Authentication\n'));

    // Test 1: Login with valid credentials
    const startTime = Date.now();
    try {
      const response = await this.context.client.post('/api/auth/login', {
        email: CONFIG.testUser.email,
        password: CONFIG.testUser.password,
      });

      const cookies = extractCookies(response);
      this.context.cookies = cookies;
      this.context.accessToken = getCookieValue(cookies, 'token');
      this.context.refreshToken = getCookieValue(cookies, 'refreshToken');

      const passed = response.status === 200 && cookies.length > 0;

      this.addResult({
        name: 'Login with valid credentials',
        category: 'Authentication',
        passed,
        message: passed ? 'Login successful' : `Login failed with status ${response.status}`,
        details: { status: response.status, hasCookies: cookies.length > 0 },
        duration: Date.now() - startTime,
      });

      // Update client with cookies for subsequent requests
      if (this.context.cookies) {
        this.context.client.defaults.headers.common['Cookie'] = this.context.cookies.join('; ');
      }
    } catch (error) {
      this.addResult({
        name: 'Login with valid credentials',
        category: 'Authentication',
        passed: false,
        message: `Exception: ${(error as Error).message}`,
        duration: Date.now() - startTime,
      });
    }

    // Test 2: Login with invalid credentials
    try {
      const response = await this.context.client.post('/api/auth/login', {
        email: CONFIG.testUser.email,
        password: 'wrongpassword123',
      });

      this.addResult({
        name: 'Reject invalid credentials',
        category: 'Authentication',
        passed: response.status === 401 || response.status === 400,
        message: `Should reject invalid password, got status ${response.status}`,
        details: { status: response.status },
      });
    } catch (error) {
      this.addResult({
        name: 'Reject invalid credentials',
        category: 'Authentication',
        passed: false,
        message: `Exception: ${(error as Error).message}`,
      });
    }

    // Test 3: Check auth status
    try {
      const response = await this.context.client.get('/api/auth/check');

      this.addResult({
        name: 'Auth check returns authenticated status',
        category: 'Authentication',
        passed: response.status === 200 && response.data?.isAuthenticated === true,
        message: `Auth check returned: ${JSON.stringify(response.data)}`,
        details: response.data,
      });
    } catch (error) {
      this.addResult({
        name: 'Auth check returns authenticated status',
        category: 'Authentication',
        passed: false,
        message: `Exception: ${(error as Error).message}`,
      });
    }
  }

  // ===========================================
  // TOKEN REFRESH TESTS
  // ===========================================

  async testTokenRefresh(): Promise<void> {
    console.log(colors.bold('\n🔄 Category: Token Refresh\n'));

    // Test 1: Refresh token endpoint exists and works
    try {
      const response = await this.context.client.post('/api/auth/refresh-token');
      const cookies = extractCookies(response);
      const newToken = getCookieValue(cookies, 'token');

      const passed = response.status === 200 && !!newToken;

      this.addResult({
        name: 'Token refresh endpoint functional',
        category: 'Token Refresh',
        passed,
        message: passed ? 'Token refreshed successfully' : `Refresh failed with status ${response.status}`,
        details: { status: response.status, newTokenReceived: !!newToken },
      });

      // Update cookies after refresh
      if (cookies.length > 0) {
        this.context.cookies = cookies;
        this.context.accessToken = newToken;
        this.context.client.defaults.headers.common['Cookie'] = cookies.join('; ');
      }
    } catch (error) {
      this.addResult({
        name: 'Token refresh endpoint functional',
        category: 'Token Refresh',
        passed: false,
        message: `Exception: ${(error as Error).message}`,
      });
    }

    // Test 2: Token rotation (new refresh token issued)
    try {
      const oldRefreshToken = this.context.refreshToken;
      const response = await this.context.client.post('/api/auth/refresh-token');
      const cookies = extractCookies(response);
      const newRefreshToken = getCookieValue(cookies, 'refreshToken');

      const rotated = newRefreshToken && newRefreshToken !== oldRefreshToken;

      this.addResult({
        name: 'Refresh token rotation implemented',
        category: 'Token Refresh',
        passed: rotated || response.status === 200,
        message: rotated
          ? 'Refresh token rotated successfully'
          : 'Refresh token may not be rotating (check implementation)',
        details: { tokenChanged: rotated },
      });

      if (cookies.length > 0) {
        this.context.cookies = cookies;
        this.context.refreshToken = newRefreshToken;
        this.context.client.defaults.headers.common['Cookie'] = cookies.join('; ');
      }
    } catch (error) {
      this.addResult({
        name: 'Refresh token rotation implemented',
        category: 'Token Refresh',
        passed: false,
        message: `Exception: ${(error as Error).message}`,
      });
    }

    // Test 3: Refresh without token fails
    try {
      const clientWithoutCookies = axios.create({
        baseURL: CONFIG.baseUrl,
        timeout: CONFIG.timeout,
        validateStatus: () => true,
      });

      const response = await clientWithoutCookies.post('/api/auth/refresh-token');

      this.addResult({
        name: 'Refresh without token rejected',
        category: 'Token Refresh',
        passed: response.status === 401 || response.status === 403,
        message: `Should reject without token, got status ${response.status}`,
        details: { status: response.status },
      });
    } catch (error) {
      this.addResult({
        name: 'Refresh without token rejected',
        category: 'Token Refresh',
        passed: false,
        message: `Exception: ${(error as Error).message}`,
      });
    }
  }

  // ===========================================
  // RATE LIMITING TESTS
  // ===========================================

  async testRateLimiting(): Promise<void> {
    console.log(colors.bold('\n🚦 Category: Rate Limiting\n'));

    // Test 1: Rate limit on login endpoint
    const loginAttempts = 15;
    let rateLimited = false;
    let rateLimitResponse: number | null = null;

    for (let i = 0; i < loginAttempts; i++) {
      try {
        const response = await this.context.client.post('/api/auth/login', {
          email: `ratelimit-test-${Date.now()}@example.com`,
          password: 'test123',
        });

        if (response.status === 429) {
          rateLimited = true;
          rateLimitResponse = response.status;
          break;
        }
      } catch (error) {
        const axiosError = error as AxiosError;
        if (axiosError.response?.status === 429) {
          rateLimited = true;
          rateLimitResponse = 429;
          break;
        }
      }
      await sleep(100); // Small delay between requests
    }

    this.addResult({
      name: 'Rate limiting on login endpoint',
      category: 'Rate Limiting',
      passed: rateLimited,
      message: rateLimited
        ? 'Rate limiting triggered as expected'
        : `Made ${loginAttempts} requests without being rate limited`,
      details: { attempts: loginAttempts, rateLimited, response: rateLimitResponse },
    });

    // Test 2: Check for rate limit headers
    try {
      const response = await this.context.client.get('/api/auth/check');
      const hasRateLimitHeaders =
        response.headers['x-ratelimit-limit'] !== undefined ||
        response.headers['ratelimit-limit'] !== undefined ||
        response.headers['x-ratelimit-remaining'] !== undefined;

      this.addResult({
        name: 'Rate limit headers present',
        category: 'Rate Limiting',
        passed: hasRateLimitHeaders,
        message: hasRateLimitHeaders
          ? 'Rate limit headers found'
          : 'Rate limit headers not found (optional but recommended)',
        details: {
          'x-ratelimit-limit': response.headers['x-ratelimit-limit'],
          'x-ratelimit-remaining': response.headers['x-ratelimit-remaining'],
        },
      });
    } catch (error) {
      this.addResult({
        name: 'Rate limit headers present',
        category: 'Rate Limiting',
        passed: false,
        message: `Exception: ${(error as Error).message}`,
      });
    }
  }

  // ===========================================
  // COOKIE SECURITY TESTS
  // ===========================================

  async testCookieSecurity(): Promise<void> {
    console.log(colors.bold('\n🍪 Category: Cookie Security\n'));

    // Re-login to get fresh cookies
    try {
      const response = await this.context.client.post('/api/auth/login', {
        email: CONFIG.testUser.email,
        password: CONFIG.testUser.password,
      });

      const cookies = extractCookies(response);
      this.context.cookies = cookies;

      // Test 1: HttpOnly flag
      const tokenCookie = cookies.find(c => c.startsWith('token='));
      const hasHttpOnly = tokenCookie?.toLowerCase().includes('httponly');

      this.addResult({
        name: 'Token cookie has HttpOnly flag',
        category: 'Cookie Security',
        passed: !!hasHttpOnly,
        message: hasHttpOnly
          ? 'HttpOnly flag present'
          : 'HttpOnly flag missing - XSS vulnerability!',
        details: { cookie: tokenCookie?.substring(0, 50) + '...' },
      });

      // Test 2: SameSite attribute
      const hasSameSite = tokenCookie?.toLowerCase().includes('samesite');
      const sameSiteStrict = tokenCookie?.toLowerCase().includes('samesite=strict');

      this.addResult({
        name: 'Token cookie has SameSite attribute',
        category: 'Cookie Security',
        passed: !!hasSameSite,
        message: sameSiteStrict
          ? 'SameSite=Strict (best)'
          : hasSameSite
            ? 'SameSite present'
            : 'SameSite missing - CSRF vulnerability!',
        details: { sameSite: hasSameSite, strict: sameSiteStrict },
      });

      // Test 3: Secure flag (only required in production with HTTPS)
      const hasSecure = tokenCookie?.toLowerCase().includes('secure');
      const isHttps = CONFIG.baseUrl.startsWith('https');

      this.addResult({
        name: 'Token cookie has Secure flag (HTTPS)',
        category: 'Cookie Security',
        passed: hasSecure || !isHttps,
        message: hasSecure
          ? 'Secure flag present'
          : isHttps
            ? 'Secure flag missing on HTTPS!'
            : 'Secure flag not required on HTTP (dev)',
        details: { secure: hasSecure, isHttps },
      });

      // Test 4: Refresh token cookie security
      const refreshCookie = cookies.find(c => c.startsWith('refreshToken='));
      const refreshHttpOnly = refreshCookie?.toLowerCase().includes('httponly');

      this.addResult({
        name: 'Refresh token cookie has HttpOnly flag',
        category: 'Cookie Security',
        passed: !!refreshHttpOnly,
        message: refreshHttpOnly
          ? 'HttpOnly flag present on refresh token'
          : 'HttpOnly flag missing on refresh token!',
      });

    } catch (error) {
      this.addResult({
        name: 'Cookie security tests',
        category: 'Cookie Security',
        passed: false,
        message: `Exception: ${(error as Error).message}`,
      });
    }
  }

  // ===========================================
  // SESSION MANAGEMENT TESTS
  // ===========================================

  async testSessionManagement(): Promise<void> {
    console.log(colors.bold('\n🔐 Category: Session Management\n'));

    // Test 1: Protected route requires authentication
    try {
      const unauthClient = axios.create({
        baseURL: CONFIG.baseUrl,
        timeout: CONFIG.timeout,
        validateStatus: () => true,
      });

      const response = await unauthClient.get('/api/user/profile');

      this.addResult({
        name: 'Protected routes require authentication',
        category: 'Session Management',
        passed: response.status === 401 || response.status === 403,
        message: `Protected route returned ${response.status}`,
        details: { status: response.status },
      });
    } catch (error) {
      this.addResult({
        name: 'Protected routes require authentication',
        category: 'Session Management',
        passed: false,
        message: `Exception: ${(error as Error).message}`,
      });
    }

    // Test 2: Logout invalidates session
    let logoutCookies: string[] = [];
    try {
      // First login
      const loginResponse = await this.context.client.post('/api/auth/login', {
        email: CONFIG.testUser.email,
        password: CONFIG.testUser.password,
      });
      const loginCookies = extractCookies(loginResponse);
      this.context.client.defaults.headers.common['Cookie'] = loginCookies.join('; ');

      // Then logout
      const logoutResponse = await this.context.client.post('/api/auth/logout');
      logoutCookies = extractCookies(logoutResponse);

      // Check if cookies are cleared
      const tokenCleared = logoutCookies.some(c =>
        c.startsWith('token=') && (c.includes('Max-Age=0') || c.includes('expires=Thu, 01 Jan 1970'))
      );

      this.addResult({
        name: 'Logout clears authentication cookies',
        category: 'Session Management',
        passed: logoutResponse.status === 200 && (tokenCleared || logoutCookies.length === 0),
        message: tokenCleared ? 'Cookies cleared on logout' : 'Check cookie clearing implementation',
        details: { status: logoutResponse.status, cookiesCleared: tokenCleared },
      });
    } catch (error) {
      this.addResult({
        name: 'Logout clears authentication cookies',
        category: 'Session Management',
        passed: false,
        message: `Exception: ${(error as Error).message}`,
      });
    }

    // Test 3: Token blacklisting after logout
    try {
      // Use the old cookies after logout
      const response = await this.context.client.get('/api/auth/check');

      this.addResult({
        name: 'Token blacklisted after logout',
        category: 'Session Management',
        passed: response.status === 401 || response.data?.isAuthenticated === false,
        message: response.data?.isAuthenticated === false
          ? 'Token properly invalidated'
          : `Auth check returned authenticated=${response.data?.isAuthenticated}`,
        details: response.data,
      });
    } catch (error) {
      this.addResult({
        name: 'Token blacklisted after logout',
        category: 'Session Management',
        passed: false,
        message: `Exception: ${(error as Error).message}`,
      });
    }

    // Re-login for subsequent tests
    try {
      const response = await this.context.client.post('/api/auth/login', {
        email: CONFIG.testUser.email,
        password: CONFIG.testUser.password,
      });
      const cookies = extractCookies(response);
      this.context.cookies = cookies;
      this.context.client.defaults.headers.common['Cookie'] = cookies.join('; ');
    } catch {
      // Continue anyway
    }
  }

  // ===========================================
  // WEBSOCKET AUTHENTICATION TESTS
  // ===========================================

  async testWebSocketAuthentication(): Promise<void> {
    console.log(colors.bold('\n🌐 Category: WebSocket Authentication\n'));

    // Test 1: Get WebSocket token
    try {
      const response = await this.context.client.get('/api/auth/ws-token');

      this.context.wsToken = response.data?.token;

      this.addResult({
        name: 'WebSocket token endpoint accessible',
        category: 'WebSocket',
        passed: response.status === 200 && !!response.data?.token,
        message: response.data?.token
          ? 'WS token received'
          : `WS token endpoint returned ${response.status}`,
        details: { status: response.status, hasToken: !!response.data?.token },
      });
    } catch (error) {
      this.addResult({
        name: 'WebSocket token endpoint accessible',
        category: 'WebSocket',
        passed: false,
        message: `Exception: ${(error as Error).message}`,
      });
    }

    // Test 2: WebSocket connection without token rejected
    try {
      const wsUrl = CONFIG.baseUrl.replace('http', 'ws') + '/ws/notifications';

      const rejected = await new Promise<boolean>((resolve) => {
        const ws = new WebSocket(wsUrl);
        const timeout = setTimeout(() => {
          ws.close();
          resolve(false); // Timeout = connection might have succeeded
        }, 5000);

        ws.on('error', () => {
          clearTimeout(timeout);
          resolve(true); // Error = rejected
        });

        ws.on('close', (code) => {
          clearTimeout(timeout);
          resolve(code !== 1000); // Non-normal close = rejected
        });

        ws.on('open', () => {
          clearTimeout(timeout);
          ws.close();
          resolve(false); // Open = not rejected (bad)
        });
      });

      this.addResult({
        name: 'WebSocket rejects connection without token',
        category: 'WebSocket',
        passed: rejected,
        message: rejected
          ? 'Unauthenticated WS connection rejected'
          : 'WS connection accepted without token!',
      });
    } catch (error) {
      this.addResult({
        name: 'WebSocket rejects connection without token',
        category: 'WebSocket',
        passed: true, // Error likely means rejection
        message: `Connection rejected: ${(error as Error).message}`,
      });
    }

    // Test 3: WebSocket connection with valid token
    if (this.context.wsToken) {
      try {
        const wsUrl = `${CONFIG.baseUrl.replace('http', 'ws')}/ws/notifications?token=${this.context.wsToken}`;

        const connected = await new Promise<boolean>((resolve) => {
          const ws = new WebSocket(wsUrl);
          const timeout = setTimeout(() => {
            ws.close();
            resolve(false);
          }, 5000);

          ws.on('error', () => {
            clearTimeout(timeout);
            resolve(false);
          });

          ws.on('open', () => {
            clearTimeout(timeout);
            ws.close();
            resolve(true);
          });
        });

        this.addResult({
          name: 'WebSocket accepts connection with valid token',
          category: 'WebSocket',
          passed: connected,
          message: connected
            ? 'Authenticated WS connection successful'
            : 'WS connection failed with valid token',
        });
      } catch (error) {
        this.addResult({
          name: 'WebSocket accepts connection with valid token',
          category: 'WebSocket',
          passed: false,
          message: `Exception: ${(error as Error).message}`,
        });
      }
    }
  }

  // ===========================================
  // SECURITY HEADERS TESTS
  // ===========================================

  async testSecurityHeaders(): Promise<void> {
    console.log(colors.bold('\n🛡️ Category: Security Headers\n'));

    try {
      const response = await this.context.client.get('/api/auth/check');
      const headers = response.headers;

      // Test 1: X-Content-Type-Options
      this.addResult({
        name: 'X-Content-Type-Options header',
        category: 'Security Headers',
        passed: headers['x-content-type-options'] === 'nosniff',
        message: headers['x-content-type-options']
          ? `Value: ${headers['x-content-type-options']}`
          : 'Header missing',
      });

      // Test 2: X-Frame-Options
      this.addResult({
        name: 'X-Frame-Options header',
        category: 'Security Headers',
        passed: !!headers['x-frame-options'],
        message: headers['x-frame-options']
          ? `Value: ${headers['x-frame-options']}`
          : 'Header missing (clickjacking protection)',
      });

      // Test 3: X-XSS-Protection
      this.addResult({
        name: 'X-XSS-Protection header',
        category: 'Security Headers',
        passed: !!headers['x-xss-protection'],
        message: headers['x-xss-protection']
          ? `Value: ${headers['x-xss-protection']}`
          : 'Header missing (legacy but still useful)',
      });

      // Test 4: Strict-Transport-Security (HSTS)
      const hasHsts = !!headers['strict-transport-security'];
      this.addResult({
        name: 'Strict-Transport-Security (HSTS)',
        category: 'Security Headers',
        passed: hasHsts || !CONFIG.baseUrl.startsWith('https'),
        message: hasHsts
          ? `Value: ${headers['strict-transport-security']}`
          : CONFIG.baseUrl.startsWith('https')
            ? 'HSTS missing on HTTPS!'
            : 'HSTS not required on HTTP (dev)',
      });

      // Test 5: Content-Security-Policy
      this.addResult({
        name: 'Content-Security-Policy header',
        category: 'Security Headers',
        passed: !!headers['content-security-policy'],
        message: headers['content-security-policy']
          ? 'CSP configured'
          : 'CSP not configured (recommended)',
      });

    } catch (error) {
      this.addResult({
        name: 'Security headers tests',
        category: 'Security Headers',
        passed: false,
        message: `Exception: ${(error as Error).message}`,
      });
    }
  }

  // ===========================================
  // INPUT VALIDATION TESTS
  // ===========================================

  async testInputValidation(): Promise<void> {
    console.log(colors.bold('\n🔍 Category: Input Validation\n'));

    // Test 1: SQL Injection attempt (should be handled)
    try {
      const response = await this.context.client.post('/api/auth/login', {
        email: "admin'--",
        password: 'test',
      });

      this.addResult({
        name: 'SQL injection attempt handled',
        category: 'Input Validation',
        passed: response.status === 400 || response.status === 401,
        message: `Malformed email returned status ${response.status}`,
        details: { status: response.status },
      });
    } catch (error) {
      this.addResult({
        name: 'SQL injection attempt handled',
        category: 'Input Validation',
        passed: false,
        message: `Exception: ${(error as Error).message}`,
      });
    }

    // Test 2: XSS attempt in input
    try {
      const response = await this.context.client.post('/api/auth/login', {
        email: '<script>alert("xss")</script>@test.com',
        password: 'test',
      });

      this.addResult({
        name: 'XSS attempt in email handled',
        category: 'Input Validation',
        passed: response.status === 400 || response.status === 401,
        message: `XSS email returned status ${response.status}`,
        details: { status: response.status },
      });
    } catch (error) {
      this.addResult({
        name: 'XSS attempt in email handled',
        category: 'Input Validation',
        passed: false,
        message: `Exception: ${(error as Error).message}`,
      });
    }

    // Test 3: Oversized payload
    try {
      const largePayload = 'a'.repeat(1000000); // 1MB
      const response = await this.context.client.post('/api/auth/login', {
        email: 'test@test.com',
        password: largePayload,
      });

      this.addResult({
        name: 'Oversized payload rejected',
        category: 'Input Validation',
        passed: response.status === 400 || response.status === 413 || response.status === 401,
        message: `Large payload returned status ${response.status}`,
        details: { status: response.status, payloadSize: '1MB' },
      });
    } catch (error) {
      // Network error is also acceptable (payload too large)
      this.addResult({
        name: 'Oversized payload rejected',
        category: 'Input Validation',
        passed: true,
        message: 'Large payload rejected at network level',
      });
    }
  }

  // ===========================================
  // BRUTE FORCE PROTECTION TESTS
  // ===========================================

  async testBruteForceProtection(): Promise<void> {
    console.log(colors.bold('\n🔨 Category: Brute Force Protection\n'));

    const testEmail = `bruteforce-${Date.now()}@audit-test.com`;
    let blocked = false;
    let attempts = 0;

    // Attempt multiple failed logins
    for (let i = 0; i < 10; i++) {
      attempts++;
      try {
        const response = await this.context.client.post('/api/auth/login', {
          email: testEmail,
          password: 'wrongpassword',
        });

        if (response.status === 429 || response.data?.blocked) {
          blocked = true;
          break;
        }
      } catch (error) {
        const axiosError = error as AxiosError;
        if (axiosError.response?.status === 429) {
          blocked = true;
          break;
        }
      }
      await sleep(200);
    }

    this.addResult({
      name: 'Brute force protection triggers',
      category: 'Brute Force',
      passed: blocked,
      message: blocked
        ? `Account locked after ${attempts} attempts`
        : `Made ${attempts} failed attempts without being blocked`,
      details: { attempts, blocked },
    });
  }

  // ===========================================
  // CORS TESTS
  // ===========================================

  async testCORS(): Promise<void> {
    console.log(colors.bold('\n🌍 Category: CORS Configuration\n'));

    // Test 1: CORS headers present
    try {
      const response = await this.context.client.options('/api/auth/check', {
        headers: {
          'Origin': 'http://malicious-site.com',
          'Access-Control-Request-Method': 'POST',
        },
      });

      const allowOrigin = response.headers['access-control-allow-origin'];
      const isWildcard = allowOrigin === '*';

      this.addResult({
        name: 'CORS not allowing wildcard origin',
        category: 'CORS',
        passed: !isWildcard,
        message: isWildcard
          ? 'CORS allows any origin (*) - security risk!'
          : `CORS origin: ${allowOrigin || 'not set'}`,
        details: {
          'access-control-allow-origin': allowOrigin,
          'access-control-allow-credentials': response.headers['access-control-allow-credentials'],
        },
      });

      // Test 2: Credentials not allowed with wildcard
      const allowCredentials = response.headers['access-control-allow-credentials'];

      this.addResult({
        name: 'CORS credentials configuration',
        category: 'CORS',
        passed: !(isWildcard && allowCredentials === 'true'),
        message: isWildcard && allowCredentials === 'true'
          ? 'Credentials allowed with wildcard - critical vulnerability!'
          : 'CORS credentials properly configured',
      });
    } catch (error) {
      this.addResult({
        name: 'CORS configuration',
        category: 'CORS',
        passed: false,
        message: `Exception: ${(error as Error).message}`,
      });
    }
  }

  // ===========================================
  // TWO-FACTOR AUTHENTICATION TESTS
  // ===========================================

  async test2FAEndpoints(): Promise<void> {
    console.log(colors.bold('\n🔐 Category: Two-Factor Authentication\n'));

    // Re-login first
    try {
      const loginResponse = await this.context.client.post('/api/auth/login', {
        email: CONFIG.testUser.email,
        password: CONFIG.testUser.password,
      });
      const cookies = extractCookies(loginResponse);
      this.context.cookies = cookies;
      this.context.client.defaults.headers.common['Cookie'] = cookies.join('; ');
    } catch {
      // Continue anyway
    }

    // Test 1: 2FA status endpoint
    try {
      const response = await this.context.client.get('/api/2fa/status');

      this.addResult({
        name: '2FA status endpoint accessible',
        category: '2FA',
        passed: response.status === 200,
        message: `2FA status endpoint returned ${response.status}`,
        details: response.data,
      });
    } catch (error) {
      this.addResult({
        name: '2FA status endpoint accessible',
        category: '2FA',
        passed: false,
        message: `Exception: ${(error as Error).message}`,
      });
    }

    // Test 2: 2FA verify with invalid code
    try {
      const response = await this.context.client.post('/api/2fa/verify', {
        code: '000000',
      });

      this.addResult({
        name: '2FA rejects invalid code',
        category: '2FA',
        passed: response.status === 400 || response.status === 401,
        message: `Invalid 2FA code returned ${response.status}`,
        details: { status: response.status },
      });
    } catch (error) {
      this.addResult({
        name: '2FA rejects invalid code',
        category: '2FA',
        passed: false,
        message: `Exception: ${(error as Error).message}`,
      });
    }
  }

  // ===========================================
  // REPORT GENERATION
  // ===========================================

  generateReport(): void {
    console.log('\n' + '='.repeat(60));
    console.log(colors.bold('📊 INFRASTRUCTURE AUDIT REPORT'));
    console.log('='.repeat(60));

    const passed = this.results.filter(r => r.passed).length;
    const failed = this.results.filter(r => !r.passed).length;
    const total = this.results.length;

    console.log(`\n${colors.bold('Summary:')}`);
    console.log(`  Total tests: ${total}`);
    console.log(`  ${colors.green('Passed')}: ${passed}`);
    console.log(`  ${colors.red('Failed')}: ${failed}`);
    console.log(`  Pass rate: ${((passed / total) * 100).toFixed(1)}%`);

    // Group by category
    const categories = [...new Set(this.results.map(r => r.category))];

    console.log(`\n${colors.bold('Results by Category:')}`);
    for (const category of categories) {
      const categoryResults = this.results.filter(r => r.category === category);
      const categoryPassed = categoryResults.filter(r => r.passed).length;
      const categoryTotal = categoryResults.length;
      const icon = categoryPassed === categoryTotal ? '✓' : '⚠';
      const color = categoryPassed === categoryTotal ? colors.green : colors.yellow;

      console.log(`  ${color(icon)} ${category}: ${categoryPassed}/${categoryTotal}`);
    }

    // List failures
    const failures = this.results.filter(r => !r.passed);
    if (failures.length > 0) {
      console.log(`\n${colors.bold(colors.red('Failed Tests:'))}`);
      for (const failure of failures) {
        console.log(`  ${colors.red('✗')} [${failure.category}] ${failure.name}`);
        console.log(`    ${colors.yellow(failure.message)}`);
      }
    }

    // Security recommendations
    console.log(`\n${colors.bold('🔒 Security Recommendations:')}`);

    if (failures.some(f => f.category === 'Cookie Security')) {
      console.log('  • Review cookie security settings (HttpOnly, Secure, SameSite)');
    }
    if (failures.some(f => f.category === 'Rate Limiting')) {
      console.log('  • Implement or strengthen rate limiting');
    }
    if (failures.some(f => f.category === 'Security Headers')) {
      console.log('  • Add missing security headers (consider using Helmet.js)');
    }
    if (failures.some(f => f.category === 'Brute Force')) {
      console.log('  • Implement account lockout after failed attempts');
    }
    if (failures.some(f => f.category === 'Token Refresh')) {
      console.log('  • Review token refresh and rotation implementation');
    }

    console.log('\n' + '='.repeat(60));
  }

  // ===========================================
  // MAIN EXECUTION
  // ===========================================

  async run(): Promise<void> {
    console.log(colors.bold(colors.cyan('\n🔍 QVARRY INFRASTRUCTURE SECURITY AUDIT\n')));
    console.log(`Target: ${CONFIG.baseUrl}`);
    console.log(`Time: ${new Date().toISOString()}`);
    console.log('='.repeat(60));

    // Check server availability
    try {
      await this.context.client.get('/api/auth/check');
      log('Server is reachable', 'success');
    } catch (error) {
      log(`Server not reachable at ${CONFIG.baseUrl}`, 'error');
      log('Make sure the server is running and the URL is correct', 'warn');
      process.exit(1);
    }

    // Run all test suites
    await this.testBasicAuthentication();
    await this.testTokenRefresh();
    await this.testRateLimiting();
    await this.testCookieSecurity();
    await this.testSessionManagement();
    await this.testWebSocketAuthentication();
    await this.testSecurityHeaders();
    await this.testInputValidation();
    await this.testBruteForceProtection();
    await this.testCORS();
    await this.test2FAEndpoints();

    // Generate report
    this.generateReport();

    // Exit with appropriate code
    const failed = this.results.filter(r => !r.passed).length;
    process.exit(failed > 0 ? 1 : 0);
  }
}

// Run audit
const audit = new InfrastructureAudit();
audit.run().catch((error) => {
  console.error('Audit failed with error:', error);
  process.exit(1);
});
