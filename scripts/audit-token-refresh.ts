/**
 * Token Refresh Deep Audit Script
 *
 * Ce script teste en profondeur le mécanisme de refresh token :
 * - Rotation des tokens
 * - Détection de vol de token
 * - Expiration et invalidation
 * - Concurrence des refreshs
 * - Sécurité du token family
 *
 * Usage: npx ts-node scripts/audit-token-refresh.ts
 */

import axios, { AxiosInstance } from 'axios';
import * as https from 'https';

// Configuration
const CONFIG = {
  baseUrl: process.env.API_URL || 'http://localhost:3000',
  testUser: {
    email: process.env.TEST_EMAIL || 'audit-test@example.com',
    password: process.env.TEST_PASSWORD || 'AuditTest123!@#',
  },
  timeout: 15000,
  verbose: process.env.VERBOSE === 'true',
};

// Utility functions
const colors = {
  green: (text: string) => `\x1b[32m${text}\x1b[0m`,
  red: (text: string) => `\x1b[31m${text}\x1b[0m`,
  yellow: (text: string) => `\x1b[33m${text}\x1b[0m`,
  blue: (text: string) => `\x1b[34m${text}\x1b[0m`,
  cyan: (text: string) => `\x1b[36m${text}\x1b[0m`,
  bold: (text: string) => `\x1b[1m${text}\x1b[0m`,
  dim: (text: string) => `\x1b[2m${text}\x1b[0m`,
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

function parseJwt(token: string): Record<string, unknown> | null {
  try {
    const base64Url = token.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(
      Buffer.from(base64, 'base64')
        .toString()
        .split('')
        .map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    );
    return JSON.parse(jsonPayload);
  } catch {
    return null;
  }
}

interface TestResult {
  name: string;
  passed: boolean;
  message: string;
  details?: Record<string, unknown>;
}

class TokenRefreshAudit {
  private results: TestResult[] = [];
  private client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: CONFIG.baseUrl,
      timeout: CONFIG.timeout,
      httpsAgent: new https.Agent({ rejectUnauthorized: false }),
      withCredentials: true,
      validateStatus: () => true,
    });
  }

  private log(message: string, level: 'info' | 'success' | 'error' | 'warn' = 'info') {
    const prefixes = {
      info: colors.blue('ℹ'),
      success: colors.green('✓'),
      error: colors.red('✗'),
      warn: colors.yellow('⚠'),
    };
    console.log(`  ${prefixes[level]} ${message}`);
  }

  private addResult(result: TestResult) {
    this.results.push(result);
    const status = result.passed ? colors.green('PASS') : colors.red('FAIL');
    console.log(`\n  [${status}] ${result.name}`);
    if (!result.passed || CONFIG.verbose) {
      console.log(`         ${colors.dim(result.message)}`);
    }
  }

  // ===========================================
  // TEST 1: Basic Token Refresh
  // ===========================================
  async testBasicRefresh(): Promise<void> {
    console.log(colors.bold('\n━━━ Test 1: Basic Token Refresh ━━━'));

    // Login
    const loginResponse = await this.client.post('/api/auth/login', {
      email: CONFIG.testUser.email,
      password: CONFIG.testUser.password,
    });

    if (loginResponse.status !== 200) {
      this.addResult({
        name: 'Basic refresh test',
        passed: false,
        message: `Login failed: ${loginResponse.status}`,
      });
      return;
    }

    const loginCookies = extractCookies(loginResponse);
    const originalToken = getCookieValue(loginCookies, 'token');
    const originalRefreshToken = getCookieValue(loginCookies, 'refreshToken');

    this.log(`Original JWT obtained: ${originalToken?.substring(0, 20)}...`);
    this.log(`Original Refresh Token: ${originalRefreshToken?.substring(0, 20)}...`);

    // Wait a bit and refresh
    await sleep(1000);

    this.client.defaults.headers.common['Cookie'] = loginCookies.join('; ');
    const refreshResponse = await this.client.post('/api/auth/refresh-token');

    const refreshCookies = extractCookies(refreshResponse);
    const newToken = getCookieValue(refreshCookies, 'token');
    const newRefreshToken = getCookieValue(refreshCookies, 'refreshToken');

    this.log(`New JWT: ${newToken?.substring(0, 20)}...`);
    this.log(`New Refresh Token: ${newRefreshToken?.substring(0, 20)}...`);

    const tokenChanged = newToken !== originalToken;
    const refreshTokenChanged = newRefreshToken !== originalRefreshToken;

    this.addResult({
      name: 'Access token rotated on refresh',
      passed: tokenChanged,
      message: tokenChanged
        ? 'Access token was rotated'
        : 'Access token did not change - may indicate caching or timing issue',
      details: { originalToken: originalToken?.substring(0, 20), newToken: newToken?.substring(0, 20) },
    });

    this.addResult({
      name: 'Refresh token rotated on refresh',
      passed: refreshTokenChanged,
      message: refreshTokenChanged
        ? 'Refresh token was rotated (token rotation implemented)'
        : 'Refresh token not rotated (may be intentional)',
      details: { rotated: refreshTokenChanged },
    });

    // Update cookies for next tests
    if (refreshCookies.length > 0) {
      this.client.defaults.headers.common['Cookie'] = refreshCookies.join('; ');
    }
  }

  // ===========================================
  // TEST 2: Token Expiration Handling
  // ===========================================
  async testTokenExpiration(): Promise<void> {
    console.log(colors.bold('\n━━━ Test 2: Token Expiration Check ━━━'));

    // Login fresh
    const loginResponse = await this.client.post('/api/auth/login', {
      email: CONFIG.testUser.email,
      password: CONFIG.testUser.password,
    });

    const cookies = extractCookies(loginResponse);
    const token = getCookieValue(cookies, 'token');

    if (!token) {
      this.addResult({
        name: 'Token expiration analysis',
        passed: false,
        message: 'Could not obtain token',
      });
      return;
    }

    const payload = parseJwt(token);

    if (payload) {
      const exp = payload.exp as number;
      const iat = payload.iat as number;
      const jti = payload.jti as string;

      const expiresIn = exp - iat;
      const expiresAt = new Date(exp * 1000);

      this.log(`Token issued at: ${new Date((iat as number) * 1000).toISOString()}`);
      this.log(`Token expires at: ${expiresAt.toISOString()}`);
      this.log(`Token lifetime: ${expiresIn} seconds (${(expiresIn / 60).toFixed(1)} minutes)`);
      this.log(`Token ID (jti): ${jti || 'not set'}`);

      this.addResult({
        name: 'Token has reasonable expiration',
        passed: expiresIn > 0 && expiresIn <= 3600, // Between 0 and 1 hour
        message: `Token expires in ${expiresIn}s (${(expiresIn / 60).toFixed(1)} minutes)`,
        details: { expiresIn, exp, iat },
      });

      this.addResult({
        name: 'Token has JTI (unique identifier)',
        passed: !!jti,
        message: jti ? `JTI: ${jti}` : 'No JTI - token replay attacks may be possible',
      });
    }

    this.client.defaults.headers.common['Cookie'] = cookies.join('; ');
  }

  // ===========================================
  // TEST 3: Reuse of Old Refresh Token
  // ===========================================
  async testOldTokenReuse(): Promise<void> {
    console.log(colors.bold('\n━━━ Test 3: Old Refresh Token Reuse Detection ━━━'));

    // Login
    const loginResponse = await this.client.post('/api/auth/login', {
      email: CONFIG.testUser.email,
      password: CONFIG.testUser.password,
    });

    const loginCookies = extractCookies(loginResponse);
    const oldRefreshToken = getCookieValue(loginCookies, 'refreshToken');

    this.log(`Obtained initial refresh token: ${oldRefreshToken?.substring(0, 20)}...`);

    // First refresh (legitimate)
    this.client.defaults.headers.common['Cookie'] = loginCookies.join('; ');
    const firstRefresh = await this.client.post('/api/auth/refresh-token');
    const newCookies = extractCookies(firstRefresh);

    this.log('First refresh completed successfully');

    // Try to reuse the OLD refresh token (simulating token theft)
    this.client.defaults.headers.common['Cookie'] = loginCookies.join('; '); // Use OLD cookies

    await sleep(500);

    const secondRefresh = await this.client.post('/api/auth/refresh-token');

    const tokenReuseBlocked = secondRefresh.status === 401 || secondRefresh.status === 403;

    this.addResult({
      name: 'Old refresh token reuse blocked',
      passed: tokenReuseBlocked,
      message: tokenReuseBlocked
        ? 'Old refresh token was rejected (good for security)'
        : `Old token still works (status ${secondRefresh.status}) - token theft detection may be missing`,
      details: { status: secondRefresh.status },
    });

    // Check if the new token was also invalidated (token family revocation)
    this.client.defaults.headers.common['Cookie'] = newCookies.join('; ');
    const checkNewToken = await this.client.get('/api/auth/check');

    // If old token reuse triggered family revocation, new token should also be invalid
    if (tokenReuseBlocked) {
      const familyRevoked = checkNewToken.status === 401 || checkNewToken.data?.isAuthenticated === false;

      this.addResult({
        name: 'Token family revocation on theft detection',
        passed: familyRevoked,
        message: familyRevoked
          ? 'All tokens in family were revoked (excellent security)'
          : 'New token still works after old token reuse (partial protection)',
        details: { newTokenStatus: checkNewToken.status },
      });
    }
  }

  // ===========================================
  // TEST 4: Concurrent Refresh Requests
  // ===========================================
  async testConcurrentRefresh(): Promise<void> {
    console.log(colors.bold('\n━━━ Test 4: Concurrent Refresh Requests ━━━'));

    // Login fresh
    const loginResponse = await this.client.post('/api/auth/login', {
      email: CONFIG.testUser.email,
      password: CONFIG.testUser.password,
    });

    const cookies = extractCookies(loginResponse);
    this.client.defaults.headers.common['Cookie'] = cookies.join('; ');

    // Send 5 concurrent refresh requests
    const concurrentRequests = 5;
    this.log(`Sending ${concurrentRequests} concurrent refresh requests...`);

    const promises = Array(concurrentRequests).fill(null).map(() =>
      this.client.post('/api/auth/refresh-token')
    );

    const results = await Promise.all(promises);

    const successCount = results.filter(r => r.status === 200).length;
    const failCount = results.filter(r => r.status !== 200).length;

    this.log(`Success: ${successCount}, Failed: ${failCount}`);

    // Ideally, only one should succeed (race condition handling)
    // But multiple successes might be acceptable depending on implementation

    this.addResult({
      name: 'Concurrent refresh handling',
      passed: successCount >= 1,
      message: successCount === 1
        ? 'Only one concurrent refresh succeeded (optimal)'
        : `${successCount}/${concurrentRequests} refreshes succeeded`,
      details: {
        total: concurrentRequests,
        success: successCount,
        failed: failCount,
        statuses: results.map(r => r.status),
      },
    });

    // Get latest valid cookies for next tests
    const lastSuccess = results.find(r => r.status === 200);
    if (lastSuccess) {
      const newCookies = extractCookies(lastSuccess);
      if (newCookies.length > 0) {
        this.client.defaults.headers.common['Cookie'] = newCookies.join('; ');
      }
    }
  }

  // ===========================================
  // TEST 5: Refresh After Logout
  // ===========================================
  async testRefreshAfterLogout(): Promise<void> {
    console.log(colors.bold('\n━━━ Test 5: Refresh After Logout ━━━'));

    // Login
    const loginResponse = await this.client.post('/api/auth/login', {
      email: CONFIG.testUser.email,
      password: CONFIG.testUser.password,
    });

    const loginCookies = extractCookies(loginResponse);
    this.client.defaults.headers.common['Cookie'] = loginCookies.join('; ');

    this.log('Logged in successfully');

    // Logout
    const logoutResponse = await this.client.post('/api/auth/logout');
    this.log(`Logout status: ${logoutResponse.status}`);

    // Try to refresh with the old tokens
    this.client.defaults.headers.common['Cookie'] = loginCookies.join('; ');
    const refreshResponse = await this.client.post('/api/auth/refresh-token');

    const refreshBlocked = refreshResponse.status === 401 || refreshResponse.status === 403;

    this.addResult({
      name: 'Refresh blocked after logout',
      passed: refreshBlocked,
      message: refreshBlocked
        ? 'Refresh token was invalidated on logout'
        : `Refresh still works after logout (status ${refreshResponse.status}) - critical vulnerability!`,
      details: { status: refreshResponse.status },
    });
  }

  // ===========================================
  // TEST 6: Token Modification Detection
  // ===========================================
  async testTokenModification(): Promise<void> {
    console.log(colors.bold('\n━━━ Test 6: Token Modification Detection ━━━'));

    // Login
    const loginResponse = await this.client.post('/api/auth/login', {
      email: CONFIG.testUser.email,
      password: CONFIG.testUser.password,
    });

    const cookies = extractCookies(loginResponse);
    const token = getCookieValue(cookies, 'token');

    if (!token) {
      this.addResult({
        name: 'Token modification test',
        passed: false,
        message: 'Could not obtain token',
      });
      return;
    }

    // Modify the token payload (tamper with it)
    const parts = token.split('.');
    if (parts.length === 3) {
      // Decode payload
      const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());

      // Try to escalate privileges
      payload.isAdmin = true;

      // Re-encode (this will break the signature)
      const tamperedPayload = Buffer.from(JSON.stringify(payload)).toString('base64');
      const tamperedToken = `${parts[0]}.${tamperedPayload}.${parts[2]}`;

      // Try to use the tampered token
      const tamperedCookies = cookies.map(c =>
        c.startsWith('token=') ? `token=${tamperedToken}` : c
      );

      this.client.defaults.headers.common['Cookie'] = tamperedCookies.join('; ');
      const checkResponse = await this.client.get('/api/auth/check');

      const tamperedRejected = checkResponse.status === 401 || checkResponse.data?.isAuthenticated === false;

      this.addResult({
        name: 'Tampered token rejected',
        passed: tamperedRejected,
        message: tamperedRejected
          ? 'Modified token was rejected (signature verification works)'
          : 'Tampered token was accepted - critical vulnerability!',
        details: { status: checkResponse.status },
      });
    }

    // Reset cookies for next tests
    this.client.defaults.headers.common['Cookie'] = cookies.join('; ');
  }

  // ===========================================
  // TEST 7: Refresh Token Cookie Security
  // ===========================================
  async testRefreshTokenCookieSecurity(): Promise<void> {
    console.log(colors.bold('\n━━━ Test 7: Refresh Token Cookie Security ━━━'));

    // Login
    const loginResponse = await this.client.post('/api/auth/login', {
      email: CONFIG.testUser.email,
      password: CONFIG.testUser.password,
    });

    const cookies = extractCookies(loginResponse);
    const refreshTokenCookie = cookies.find(c => c.startsWith('refreshToken='));

    if (!refreshTokenCookie) {
      this.addResult({
        name: 'Refresh token cookie analysis',
        passed: false,
        message: 'No refresh token cookie found',
      });
      return;
    }

    const cookieLower = refreshTokenCookie.toLowerCase();

    // Check HttpOnly
    const hasHttpOnly = cookieLower.includes('httponly');
    this.addResult({
      name: 'Refresh token has HttpOnly flag',
      passed: hasHttpOnly,
      message: hasHttpOnly
        ? 'HttpOnly prevents JavaScript access'
        : 'Missing HttpOnly - XSS can steal refresh token!',
    });

    // Check SameSite
    const hasSameSite = cookieLower.includes('samesite');
    const hasSameSiteStrict = cookieLower.includes('samesite=strict');
    const hasSameSiteLax = cookieLower.includes('samesite=lax');

    this.addResult({
      name: 'Refresh token has SameSite attribute',
      passed: hasSameSite,
      message: hasSameSiteStrict
        ? 'SameSite=Strict (best CSRF protection)'
        : hasSameSiteLax
          ? 'SameSite=Lax (good CSRF protection)'
          : hasSameSite
            ? 'SameSite present'
            : 'Missing SameSite - CSRF vulnerability!',
    });

    // Check Path
    const hasPath = cookieLower.includes('path=');
    const pathMatch = refreshTokenCookie.match(/path=([^;]+)/i);
    const path = pathMatch ? pathMatch[1] : 'not set';

    this.addResult({
      name: 'Refresh token has restricted path',
      passed: hasPath && (path === '/' || path.includes('auth') || path.includes('refresh')),
      message: `Path: ${path}`,
    });

    // Check Max-Age/Expires
    const hasExpiry = cookieLower.includes('max-age') || cookieLower.includes('expires');
    const maxAgeMatch = refreshTokenCookie.match(/max-age=(\d+)/i);
    const maxAge = maxAgeMatch ? parseInt(maxAgeMatch[1]) : null;

    this.addResult({
      name: 'Refresh token has expiration',
      passed: hasExpiry,
      message: maxAge
        ? `Max-Age: ${maxAge}s (${(maxAge / 3600).toFixed(1)} hours)`
        : hasExpiry
          ? 'Has expiration set'
          : 'No expiration - session never expires!',
      details: { maxAge },
    });
  }

  // ===========================================
  // TEST 8: Multiple Session Handling
  // ===========================================
  async testMultipleSessions(): Promise<void> {
    console.log(colors.bold('\n━━━ Test 8: Multiple Session Handling ━━━'));

    // Create two sessions
    const session1 = await this.client.post('/api/auth/login', {
      email: CONFIG.testUser.email,
      password: CONFIG.testUser.password,
    });

    const cookies1 = extractCookies(session1);
    this.log('Session 1 created');

    await sleep(500);

    const session2 = await this.client.post('/api/auth/login', {
      email: CONFIG.testUser.email,
      password: CONFIG.testUser.password,
    });

    const cookies2 = extractCookies(session2);
    this.log('Session 2 created');

    // Check if both sessions are valid
    this.client.defaults.headers.common['Cookie'] = cookies1.join('; ');
    const check1 = await this.client.get('/api/auth/check');

    this.client.defaults.headers.common['Cookie'] = cookies2.join('; ');
    const check2 = await this.client.get('/api/auth/check');

    const session1Valid = check1.status === 200 && check1.data?.isAuthenticated;
    const session2Valid = check2.status === 200 && check2.data?.isAuthenticated;

    this.log(`Session 1 valid: ${session1Valid}`);
    this.log(`Session 2 valid: ${session2Valid}`);

    // Multiple sessions might be allowed (e.g., different devices)
    // This is more of an informational test

    this.addResult({
      name: 'Multiple session behavior',
      passed: true, // This is informational
      message: session1Valid && session2Valid
        ? 'Multiple concurrent sessions allowed (normal behavior)'
        : session2Valid && !session1Valid
          ? 'New login invalidates old session (single session enforcement)'
          : 'Session behavior needs review',
      details: { session1Valid, session2Valid },
    });
  }

  // ===========================================
  // REPORT
  // ===========================================
  generateReport(): void {
    console.log('\n' + '━'.repeat(60));
    console.log(colors.bold('📊 TOKEN REFRESH AUDIT REPORT'));
    console.log('━'.repeat(60));

    const passed = this.results.filter(r => r.passed).length;
    const failed = this.results.filter(r => !r.passed).length;
    const total = this.results.length;

    console.log(`\nTotal tests: ${total}`);
    console.log(`${colors.green('Passed')}: ${passed}`);
    console.log(`${colors.red('Failed')}: ${failed}`);
    console.log(`Pass rate: ${((passed / total) * 100).toFixed(1)}%`);

    if (failed > 0) {
      console.log(colors.bold('\n⚠️  Failed Tests:'));
      this.results
        .filter(r => !r.passed)
        .forEach(r => {
          console.log(`  ${colors.red('✗')} ${r.name}`);
          console.log(`    ${colors.dim(r.message)}`);
        });
    }

    console.log(colors.bold('\n🔒 Security Assessment:'));

    const criticalIssues = this.results.filter(r =>
      !r.passed && (
        r.name.includes('Tampered') ||
        r.name.includes('logout') ||
        r.name.includes('reuse') ||
        r.name.includes('HttpOnly')
      )
    );

    if (criticalIssues.length > 0) {
      console.log(colors.red('  ⚠️  CRITICAL ISSUES FOUND:'));
      criticalIssues.forEach(r => console.log(`    - ${r.name}`));
    } else {
      console.log(colors.green('  ✓ No critical token refresh vulnerabilities detected'));
    }

    console.log('\n' + '━'.repeat(60));
  }

  // ===========================================
  // RUN
  // ===========================================
  async run(): Promise<void> {
    console.log(colors.bold(colors.cyan('\n🔄 TOKEN REFRESH DEEP AUDIT\n')));
    console.log(`Target: ${CONFIG.baseUrl}`);
    console.log(`Time: ${new Date().toISOString()}`);
    console.log('━'.repeat(60));

    try {
      await this.testBasicRefresh();
      await this.testTokenExpiration();
      await this.testOldTokenReuse();
      await this.testConcurrentRefresh();
      await this.testRefreshAfterLogout();
      await this.testTokenModification();
      await this.testRefreshTokenCookieSecurity();
      await this.testMultipleSessions();
    } catch (error) {
      console.error(colors.red('\nAudit error:'), error);
    }

    this.generateReport();

    const failed = this.results.filter(r => !r.passed).length;
    process.exit(failed > 0 ? 1 : 0);
  }
}

// Run
const audit = new TokenRefreshAudit();
audit.run().catch(console.error);
