/**
 * Infrastructure Stress Test Script
 *
 * Ce script teste la résilience du système sous charge :
 * - Requêtes concurrentes multiples
 * - Charge sur le rate limiter
 * - Charge sur le refresh token
 * - Memory/connection leaks detection
 * - WebSocket load
 *
 * Usage: npx ts-node scripts/audit-stress-test.ts
 */

import axios, { AxiosInstance } from 'axios';
import * as https from 'https';
import * as WebSocket from 'ws';

// Configuration
const CONFIG = {
  baseUrl: process.env.API_URL || 'http://localhost:3000',
  testUser: {
    email: process.env.TEST_EMAIL || 'audit-test@example.com',
    password: process.env.TEST_PASSWORD || 'AuditTest123!@#',
  },
  timeout: 30000,
  concurrency: parseInt(process.env.CONCURRENCY || '10'),
  iterations: parseInt(process.env.ITERATIONS || '50'),
};

// Colors
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

interface StressTestResult {
  name: string;
  totalRequests: number;
  successCount: number;
  failCount: number;
  rateLimitedCount: number;
  avgLatency: number;
  minLatency: number;
  maxLatency: number;
  p95Latency: number;
  requestsPerSecond: number;
  duration: number;
  errors: string[];
}

class StressTest {
  private client: AxiosInstance;
  private results: StressTestResult[] = [];

  constructor() {
    this.client = axios.create({
      baseURL: CONFIG.baseUrl,
      timeout: CONFIG.timeout,
      httpsAgent: new https.Agent({ rejectUnauthorized: false }),
      withCredentials: true,
      validateStatus: () => true,
    });
  }

  private calculatePercentile(arr: number[], percentile: number): number {
    const sorted = [...arr].sort((a, b) => a - b);
    const index = Math.ceil((percentile / 100) * sorted.length) - 1;
    return sorted[Math.max(0, index)];
  }

  private printProgress(current: number, total: number, label: string) {
    const width = 30;
    const progress = Math.floor((current / total) * width);
    const bar = '█'.repeat(progress) + '░'.repeat(width - progress);
    const percent = ((current / total) * 100).toFixed(1);
    process.stdout.write(`\r  ${label}: [${bar}] ${percent}% (${current}/${total})`);
  }

  private printResult(result: StressTestResult) {
    console.log('\n');
    console.log(`  ${colors.bold(result.name)}`);
    console.log(`  ├─ Total requests: ${result.totalRequests}`);
    console.log(`  ├─ Success: ${colors.green(result.successCount.toString())} | Failed: ${colors.red(result.failCount.toString())} | Rate limited: ${colors.yellow(result.rateLimitedCount.toString())}`);
    console.log(`  ├─ Latency (avg/min/max/p95): ${result.avgLatency.toFixed(0)}ms / ${result.minLatency}ms / ${result.maxLatency}ms / ${result.p95Latency.toFixed(0)}ms`);
    console.log(`  ├─ Duration: ${(result.duration / 1000).toFixed(2)}s`);
    console.log(`  └─ Throughput: ${result.requestsPerSecond.toFixed(1)} req/s`);

    if (result.errors.length > 0) {
      console.log(`  ${colors.red('Errors:')}`);
      const uniqueErrors = [...new Set(result.errors)].slice(0, 5);
      uniqueErrors.forEach(e => console.log(`    - ${e}`));
    }
  }

  // ===========================================
  // TEST 1: Auth Check Endpoint Load
  // ===========================================
  async testAuthCheckLoad(): Promise<void> {
    console.log(colors.bold('\n━━━ Test 1: Auth Check Endpoint Load ━━━'));

    const latencies: number[] = [];
    const errors: string[] = [];
    let successCount = 0;
    let failCount = 0;
    let rateLimitedCount = 0;

    // Login first
    const loginResponse = await this.client.post('/api/auth/login', {
      email: CONFIG.testUser.email,
      password: CONFIG.testUser.password,
    });

    const cookies = loginResponse.headers['set-cookie'] || [];
    this.client.defaults.headers.common['Cookie'] = Array.isArray(cookies) ? cookies.join('; ') : cookies;

    const startTime = Date.now();

    // Send requests in batches
    for (let batch = 0; batch < CONFIG.iterations; batch++) {
      const promises = Array(CONFIG.concurrency).fill(null).map(async () => {
        const reqStart = Date.now();
        try {
          const response = await this.client.get('/api/auth/check');
          const latency = Date.now() - reqStart;
          latencies.push(latency);

          if (response.status === 200) successCount++;
          else if (response.status === 429) rateLimitedCount++;
          else failCount++;
        } catch (error) {
          failCount++;
          errors.push((error as Error).message);
        }
      });

      await Promise.all(promises);
      this.printProgress(batch + 1, CONFIG.iterations, 'Auth check load');
    }

    const duration = Date.now() - startTime;
    const totalRequests = CONFIG.iterations * CONFIG.concurrency;

    const result: StressTestResult = {
      name: 'Auth Check Endpoint Load',
      totalRequests,
      successCount,
      failCount,
      rateLimitedCount,
      avgLatency: latencies.reduce((a, b) => a + b, 0) / latencies.length,
      minLatency: Math.min(...latencies),
      maxLatency: Math.max(...latencies),
      p95Latency: this.calculatePercentile(latencies, 95),
      requestsPerSecond: totalRequests / (duration / 1000),
      duration,
      errors,
    };

    this.results.push(result);
    this.printResult(result);
  }

  // ===========================================
  // TEST 2: Token Refresh Under Load
  // ===========================================
  async testRefreshTokenLoad(): Promise<void> {
    console.log(colors.bold('\n━━━ Test 2: Token Refresh Under Load ━━━'));

    const latencies: number[] = [];
    const errors: string[] = [];
    let successCount = 0;
    let failCount = 0;
    let rateLimitedCount = 0;

    const startTime = Date.now();
    const refreshIterations = Math.min(CONFIG.iterations, 20); // Limit refresh tests

    for (let i = 0; i < refreshIterations; i++) {
      // Login fresh for each batch
      const loginResponse = await this.client.post('/api/auth/login', {
        email: CONFIG.testUser.email,
        password: CONFIG.testUser.password,
      });

      const cookies = loginResponse.headers['set-cookie'] || [];
      this.client.defaults.headers.common['Cookie'] = Array.isArray(cookies) ? cookies.join('; ') : cookies;

      const reqStart = Date.now();
      try {
        const response = await this.client.post('/api/auth/refresh-token');
        const latency = Date.now() - reqStart;
        latencies.push(latency);

        if (response.status === 200) {
          successCount++;
          // Update cookies for next iteration
          const newCookies = response.headers['set-cookie'] || [];
          if (Array.isArray(newCookies) && newCookies.length > 0) {
            this.client.defaults.headers.common['Cookie'] = newCookies.join('; ');
          }
        } else if (response.status === 429) {
          rateLimitedCount++;
        } else {
          failCount++;
          errors.push(`Status ${response.status}: ${JSON.stringify(response.data)}`);
        }
      } catch (error) {
        failCount++;
        errors.push((error as Error).message);
      }

      this.printProgress(i + 1, refreshIterations, 'Refresh token load');
      await sleep(100); // Small delay between refreshes
    }

    const duration = Date.now() - startTime;

    const result: StressTestResult = {
      name: 'Token Refresh Under Load',
      totalRequests: refreshIterations,
      successCount,
      failCount,
      rateLimitedCount,
      avgLatency: latencies.length > 0 ? latencies.reduce((a, b) => a + b, 0) / latencies.length : 0,
      minLatency: latencies.length > 0 ? Math.min(...latencies) : 0,
      maxLatency: latencies.length > 0 ? Math.max(...latencies) : 0,
      p95Latency: latencies.length > 0 ? this.calculatePercentile(latencies, 95) : 0,
      requestsPerSecond: refreshIterations / (duration / 1000),
      duration,
      errors,
    };

    this.results.push(result);
    this.printResult(result);
  }

  // ===========================================
  // TEST 3: Rate Limiter Stress Test
  // ===========================================
  async testRateLimiterStress(): Promise<void> {
    console.log(colors.bold('\n━━━ Test 3: Rate Limiter Stress Test ━━━'));

    const latencies: number[] = [];
    const errors: string[] = [];
    let successCount = 0;
    let failCount = 0;
    let rateLimitedCount = 0;

    const startTime = Date.now();
    const rapidIterations = 100;

    // Rapid fire requests to trigger rate limiter
    for (let i = 0; i < rapidIterations; i++) {
      const reqStart = Date.now();
      try {
        const response = await this.client.post('/api/auth/login', {
          email: `ratelimit-stress-${i}@test.com`,
          password: 'test123',
        });

        const latency = Date.now() - reqStart;
        latencies.push(latency);

        if (response.status === 200) successCount++;
        else if (response.status === 429) rateLimitedCount++;
        else if (response.status === 401 || response.status === 400) successCount++; // Invalid creds but endpoint works
        else failCount++;
      } catch (error) {
        failCount++;
        errors.push((error as Error).message);
      }

      this.printProgress(i + 1, rapidIterations, 'Rate limiter stress');
    }

    const duration = Date.now() - startTime;

    const result: StressTestResult = {
      name: 'Rate Limiter Stress Test',
      totalRequests: rapidIterations,
      successCount,
      failCount,
      rateLimitedCount,
      avgLatency: latencies.reduce((a, b) => a + b, 0) / latencies.length,
      minLatency: Math.min(...latencies),
      maxLatency: Math.max(...latencies),
      p95Latency: this.calculatePercentile(latencies, 95),
      requestsPerSecond: rapidIterations / (duration / 1000),
      duration,
      errors,
    };

    this.results.push(result);
    this.printResult(result);

    // Verify rate limiter is working
    if (rateLimitedCount > 0) {
      console.log(`  ${colors.green('✓')} Rate limiter triggered after ${rapidIterations - rateLimitedCount} requests`);
    } else {
      console.log(`  ${colors.yellow('⚠')} Rate limiter did not trigger during test`);
    }
  }

  // ===========================================
  // TEST 4: WebSocket Connection Stress
  // ===========================================
  async testWebSocketStress(): Promise<void> {
    console.log(colors.bold('\n━━━ Test 4: WebSocket Connection Stress ━━━'));

    // Get WS token
    const loginResponse = await this.client.post('/api/auth/login', {
      email: CONFIG.testUser.email,
      password: CONFIG.testUser.password,
    });

    const cookies = loginResponse.headers['set-cookie'] || [];
    this.client.defaults.headers.common['Cookie'] = Array.isArray(cookies) ? cookies.join('; ') : cookies;

    const tokenResponse = await this.client.get('/api/auth/ws-token');
    const wsToken = tokenResponse.data?.token;

    if (!wsToken) {
      console.log(`  ${colors.yellow('⚠')} Could not obtain WebSocket token, skipping test`);
      return;
    }

    const wsUrl = `${CONFIG.baseUrl.replace('http', 'ws')}/ws/notifications?token=${wsToken}`;
    const connections: WebSocket[] = [];
    const latencies: number[] = [];
    const errors: string[] = [];
    let successCount = 0;
    let failCount = 0;

    const startTime = Date.now();
    const maxConnections = 20;

    // Try to create multiple connections
    for (let i = 0; i < maxConnections; i++) {
      const connStart = Date.now();

      try {
        const connected = await new Promise<boolean>((resolve) => {
          const ws = new WebSocket(wsUrl);
          const timeout = setTimeout(() => {
            ws.close();
            resolve(false);
          }, 5000);

          ws.on('open', () => {
            clearTimeout(timeout);
            connections.push(ws);
            resolve(true);
          });

          ws.on('error', () => {
            clearTimeout(timeout);
            resolve(false);
          });
        });

        const latency = Date.now() - connStart;
        latencies.push(latency);

        if (connected) successCount++;
        else failCount++;
      } catch (error) {
        failCount++;
        errors.push((error as Error).message);
      }

      this.printProgress(i + 1, maxConnections, 'WebSocket connections');
    }

    const duration = Date.now() - startTime;

    // Close all connections
    for (const ws of connections) {
      try {
        ws.close();
      } catch {
        // Ignore close errors
      }
    }

    const result: StressTestResult = {
      name: 'WebSocket Connection Stress',
      totalRequests: maxConnections,
      successCount,
      failCount,
      rateLimitedCount: 0,
      avgLatency: latencies.length > 0 ? latencies.reduce((a, b) => a + b, 0) / latencies.length : 0,
      minLatency: latencies.length > 0 ? Math.min(...latencies) : 0,
      maxLatency: latencies.length > 0 ? Math.max(...latencies) : 0,
      p95Latency: latencies.length > 0 ? this.calculatePercentile(latencies, 95) : 0,
      requestsPerSecond: maxConnections / (duration / 1000),
      duration,
      errors,
    };

    this.results.push(result);
    this.printResult(result);
  }

  // ===========================================
  // TEST 5: Mixed Workload Simulation
  // ===========================================
  async testMixedWorkload(): Promise<void> {
    console.log(colors.bold('\n━━━ Test 5: Mixed Workload Simulation ━━━'));

    const latencies: number[] = [];
    const errors: string[] = [];
    let successCount = 0;
    let failCount = 0;
    let rateLimitedCount = 0;

    // Login
    const loginResponse = await this.client.post('/api/auth/login', {
      email: CONFIG.testUser.email,
      password: CONFIG.testUser.password,
    });

    const cookies = loginResponse.headers['set-cookie'] || [];
    this.client.defaults.headers.common['Cookie'] = Array.isArray(cookies) ? cookies.join('; ') : cookies;

    const startTime = Date.now();
    const workloadIterations = CONFIG.iterations;

    const endpoints = [
      { method: 'get', url: '/api/auth/check', weight: 40 },
      { method: 'get', url: '/api/user/profile', weight: 30 },
      { method: 'get', url: '/api/2fa/status', weight: 20 },
      { method: 'post', url: '/api/auth/refresh-token', weight: 10 },
    ];

    // Simulate mixed traffic
    for (let i = 0; i < workloadIterations; i++) {
      const promises = Array(CONFIG.concurrency).fill(null).map(async () => {
        // Select random endpoint based on weight
        const rand = Math.random() * 100;
        let cumulativeWeight = 0;
        let selectedEndpoint = endpoints[0];

        for (const endpoint of endpoints) {
          cumulativeWeight += endpoint.weight;
          if (rand < cumulativeWeight) {
            selectedEndpoint = endpoint;
            break;
          }
        }

        const reqStart = Date.now();
        try {
          const response = selectedEndpoint.method === 'get'
            ? await this.client.get(selectedEndpoint.url)
            : await this.client.post(selectedEndpoint.url);

          const latency = Date.now() - reqStart;
          latencies.push(latency);

          if (response.status === 200) successCount++;
          else if (response.status === 429) rateLimitedCount++;
          else if (response.status === 401 || response.status === 403) failCount++;
          else successCount++; // Other status codes might be valid
        } catch (error) {
          failCount++;
          errors.push((error as Error).message);
        }
      });

      await Promise.all(promises);
      this.printProgress(i + 1, workloadIterations, 'Mixed workload');
    }

    const duration = Date.now() - startTime;
    const totalRequests = workloadIterations * CONFIG.concurrency;

    const result: StressTestResult = {
      name: 'Mixed Workload Simulation',
      totalRequests,
      successCount,
      failCount,
      rateLimitedCount,
      avgLatency: latencies.reduce((a, b) => a + b, 0) / latencies.length,
      minLatency: Math.min(...latencies),
      maxLatency: Math.max(...latencies),
      p95Latency: this.calculatePercentile(latencies, 95),
      requestsPerSecond: totalRequests / (duration / 1000),
      duration,
      errors,
    };

    this.results.push(result);
    this.printResult(result);
  }

  // ===========================================
  // REPORT
  // ===========================================
  generateReport(): void {
    console.log('\n' + '━'.repeat(60));
    console.log(colors.bold('📊 STRESS TEST REPORT'));
    console.log('━'.repeat(60));

    let totalRequests = 0;
    let totalSuccess = 0;
    let totalFail = 0;
    let totalRateLimited = 0;
    let allLatencies: number[] = [];

    for (const result of this.results) {
      totalRequests += result.totalRequests;
      totalSuccess += result.successCount;
      totalFail += result.failCount;
      totalRateLimited += result.rateLimitedCount;
    }

    console.log(`\n${colors.bold('Summary:')}`);
    console.log(`  Total requests made: ${totalRequests}`);
    console.log(`  ${colors.green('Successful')}: ${totalSuccess} (${((totalSuccess / totalRequests) * 100).toFixed(1)}%)`);
    console.log(`  ${colors.red('Failed')}: ${totalFail} (${((totalFail / totalRequests) * 100).toFixed(1)}%)`);
    console.log(`  ${colors.yellow('Rate limited')}: ${totalRateLimited} (${((totalRateLimited / totalRequests) * 100).toFixed(1)}%)`);

    console.log(`\n${colors.bold('Latency Summary:')}`);
    for (const result of this.results) {
      console.log(`  ${result.name}: avg=${result.avgLatency.toFixed(0)}ms, p95=${result.p95Latency.toFixed(0)}ms`);
    }

    console.log(`\n${colors.bold('Throughput Summary:')}`);
    for (const result of this.results) {
      console.log(`  ${result.name}: ${result.requestsPerSecond.toFixed(1)} req/s`);
    }

    // Assessment
    console.log(`\n${colors.bold('🔍 Assessment:')}`);

    const successRate = (totalSuccess / totalRequests) * 100;
    const avgP95 = this.results.reduce((a, b) => a + b.p95Latency, 0) / this.results.length;

    if (successRate >= 95) {
      console.log(`  ${colors.green('✓')} High availability maintained (${successRate.toFixed(1)}% success rate)`);
    } else if (successRate >= 80) {
      console.log(`  ${colors.yellow('⚠')} Moderate availability (${successRate.toFixed(1)}% success rate)`);
    } else {
      console.log(`  ${colors.red('✗')} Low availability under stress (${successRate.toFixed(1)}% success rate)`);
    }

    if (avgP95 < 500) {
      console.log(`  ${colors.green('✓')} Good latency (p95 < 500ms)`);
    } else if (avgP95 < 2000) {
      console.log(`  ${colors.yellow('⚠')} Moderate latency (p95 = ${avgP95.toFixed(0)}ms)`);
    } else {
      console.log(`  ${colors.red('✗')} High latency under load (p95 = ${avgP95.toFixed(0)}ms)`);
    }

    if (totalRateLimited > 0) {
      console.log(`  ${colors.green('✓')} Rate limiting active and functioning`);
    } else {
      console.log(`  ${colors.yellow('⚠')} Rate limiting may not be active`);
    }

    console.log('\n' + '━'.repeat(60));
  }

  // ===========================================
  // RUN
  // ===========================================
  async run(): Promise<void> {
    console.log(colors.bold(colors.cyan('\n⚡ INFRASTRUCTURE STRESS TEST\n')));
    console.log(`Target: ${CONFIG.baseUrl}`);
    console.log(`Concurrency: ${CONFIG.concurrency}`);
    console.log(`Iterations: ${CONFIG.iterations}`);
    console.log(`Time: ${new Date().toISOString()}`);
    console.log('━'.repeat(60));

    try {
      // Check server is available
      const health = await this.client.get('/api/auth/check');
      if (health.status >= 500) {
        console.log(colors.red('Server not responding properly'));
        process.exit(1);
      }

      await this.testAuthCheckLoad();
      await this.testRefreshTokenLoad();
      await this.testRateLimiterStress();
      await this.testWebSocketStress();
      await this.testMixedWorkload();
    } catch (error) {
      console.error(colors.red('\nStress test error:'), error);
    }

    this.generateReport();
  }
}

// Run
const test = new StressTest();
test.run().catch(console.error);
