# Artillery WebSocket Load Testing - Documentation

## 📋 Table of Contents

1. [Overview](#overview)
2. [Installation](#installation)
3. [Test Scenarios](#test-scenarios)
4. [Performance Baselines](#performance-baselines)
5. [Running Tests](#running-tests)
6. [Interpreting Results](#interpreting-results)
7. [Troubleshooting](#troubleshooting)
8. [Best Practices](#best-practices)

---

## 🎯 Overview

This load testing suite uses Artillery to test WebSocket performance under various conditions. It covers:

- **Connection scalability**: How many concurrent WebSocket connections can the server handle?
- **Message throughput**: How many messages per second can be processed?
- **Latency distribution**: What's the p50, p95, p99 latency under load?
- **Resource usage**: CPU, memory, network bandwidth
- **Failure modes**: How does the system behave under stress?

### Architecture

```
┌─────────────────┐
│  Artillery      │
│  Load Generator │
└────────┬────────┘
         │ HTTP: POST /api/v1/auth/login
         │ HTTP: GET /api/v1/auth/ws-token
         ▼
┌─────────────────┐
│  QvarryAPI      │
│  (Express + WS) │
└────────┬────────┘
         │
         ▼
┌─────────────────────────────────┐
│  WebSocket Endpoints:           │
│  • /ws/notifications (read)     │
│  • /ws/messages/:id (bidirect)  │
└─────────────────────────────────┘
```

---

## 🛠️ Installation

### Prerequisites

1. **Node.js** 16+ installed
2. **Artillery** installed globally:

   ```bash
   npm install -g artillery@latest
   ```

3. **Artillery Plugins** (optional but recommended):
   ```bash
   npm install -g artillery-plugin-metrics-by-endpoint
   npm install -g artillery-plugin-publish-metrics
   ```

### Verify Installation

```bash
cd tests/load
npx ts-node validate-load-test-setup.ts
```

This will check:

- ✅ Artillery installation
- ✅ Configuration files validity
- ✅ Processor functions
- ✅ Test data fixtures
- ✅ API connectivity
- ✅ WebSocket endpoints availability
- ✅ Test user authentication

---

## 🧪 Test Scenarios

### 1. **Main WebSocket Test** (`artillery-websocket.yml`)

**Purpose**: Realistic mixed load simulating actual user behavior

**Profile**:

- 70% passive notification listeners
- 30% active message senders
- Mixed read/write activity

**Load Profile**:

```
Warm-up:   30s  (5 → 10 users/sec)
Sustained: 120s (10 users/sec)
Spike:     30s  (50 users/sec)
Cool-down: 30s  (10 → 2 users/sec)
```

**Run**:

```bash
artillery run artillery-websocket.yml
```

**Expected Metrics**:

- HTTP p95 latency: < 500ms
- HTTP p99 latency: < 1000ms
- WS connection time p95: < 200ms
- HTTP success rate: > 95%

---

### 2. **Connection Stress Test** (`artillery-connection-stress.yml`)

**Purpose**: Test maximum concurrent connections

**Profile**:

- Ramps from 0 → 500 concurrent connections over 5 minutes
- Holds 500 connections for 1 minute
- Tests connection pooling and memory management

**Load Profile**:

```
Phase 1: 60s  (1 → 10 users/sec)  = ~100 connections
Phase 2: 60s  (10 → 25 users/sec) = ~300 connections
Phase 3: 120s (25 → 50 users/sec) = ~500 connections
Phase 4: 60s  (50 users/sec)      = hold at 500
Phase 5: 60s  (50 → 5 users/sec)  = gradual cooldown
```

**Run**:

```bash
artillery run artillery-connection-stress.yml
```

**Expected Metrics**:

- WS connection time p95: < 500ms
- WS connection time p99: < 1000ms
- HTTP success rate: > 90%
- Memory growth: < 100MB per 100 connections

**What to Monitor**:

- Server memory usage (should stabilize, not continuously grow)
- Connection count in server logs
- Database connection pool usage
- Redis connection pool usage

---

### 3. **Message Throughput Test** (`artillery-throughput.yml`)

**Purpose**: Test message processing capacity

**Profile**:

- 100+ concurrent active users
- Sending messages at rate limit (1 msg/sec per user)
- Measures end-to-end message latency

**Load Profile**:

```
Moderate: 60s  (20 users/sec)
High:     120s (50 users/sec)
Peak:     60s  (100 users/sec)
```

**Run**:

```bash
artillery run artillery-throughput.yml
```

**Expected Metrics**:

- Message throughput: > 100 msg/sec
- Message latency p95: < 100ms
- Message latency p99: < 200ms

**What to Monitor**:

- Message queue depth (Redis)
- Database write throughput
- Network bandwidth usage
- CPU usage (should stay < 80%)

---

## 📊 Performance Baselines

### HTTP Endpoints

| Endpoint                  | p50   | p95   | p99   | Notes            |
| ------------------------- | ----- | ----- | ----- | ---------------- |
| POST /api/v1/auth/login   | 100ms | 300ms | 500ms | Authentication   |
| GET /api/v1/auth/ws-token | 50ms  | 150ms | 300ms | Token generation |
| GET /api/v1/conversations | 80ms  | 250ms | 400ms | Database query   |

### WebSocket Metrics

| Metric          | p50  | p95   | p99   | Target                          |
| --------------- | ---- | ----- | ----- | ------------------------------- |
| Connection time | 50ms | 200ms | 500ms | Time to establish WS connection |
| Auth time       | 30ms | 100ms | 200ms | Time to authenticate WS         |
| Message latency | 20ms | 100ms | 200ms | Send → receive round-trip       |

### Throughput

| Metric                 | Target | Maximum | Notes                              |
| ---------------------- | ------ | ------- | ---------------------------------- |
| Messages/second        | 100    | 500     | System-wide message throughput     |
| Concurrent connections | 200    | 500     | Simultaneous WebSocket connections |
| Requests/second (HTTP) | 50     | 200     | HTTP API endpoints                 |

### Success Rates

| Metric                | Target | Notes                            |
| --------------------- | ------ | -------------------------------- |
| HTTP success rate     | 95%    | Status 200-299                   |
| WS connection success | 98%    | Successful WS handshake          |
| Message delivery      | 99%    | Messages delivered without error |

### Resource Usage

| Resource          | Baseline | Under Load (200 users) | Maximum (500 users) |
| ----------------- | -------- | ---------------------- | ------------------- |
| Memory            | 200MB    | 400MB                  | 600MB               |
| CPU               | 5%       | 40%                    | 80%                 |
| Network           | 1 Mbps   | 10 Mbps                | 25 Mbps             |
| DB connections    | 5        | 20                     | 50                  |
| Redis connections | 2        | 10                     | 20                  |

---

## 🚀 Running Tests

### Quick Start

1. **Ensure API is running**:

   ```bash
   npm run dev  # or npm start
   ```

2. **Set environment variables**:

   ```bash
   export API_URL=http://localhost:3000
   export TEST_EMAIL=loadtest@example.com
   export TEST_PASSWORD=LoadTest123!@#
   ```

3. **Validate setup**:

   ```bash
   npx ts-node tests/load/validate-load-test-setup.ts
   ```

4. **Run a test**:
   ```bash
   artillery run tests/load/artillery-websocket.yml
   ```

### Generate HTML Report

```bash
# Run test and save results
artillery run artillery-websocket.yml --output results.json

# Generate HTML report
artillery report results.json
```

This creates `results.json.html` which you can open in a browser.

### Run Against Different Environments

**Local**:

```bash
artillery run artillery-websocket.yml --target http://localhost:3000
```

**Staging**:

```bash
artillery run artillery-websocket.yml --target https://staging-api.example.com
```

**Production** (⚠️ Use with caution!):

```bash
artillery run artillery-websocket.yml \
  --target https://api.example.com \
  --config '{"phases": [{"duration": 60, "arrivalRate": 2}]}'
```

### Custom Configuration

Override test duration:

```bash
artillery run artillery-websocket.yml \
  --overrides '{"config": {"phases": [{"duration": 300, "arrivalRate": 20}]}}'
```

### Parallel Test Execution

Run multiple scenarios in parallel (requires separate terminals):

```bash
# Terminal 1
artillery run artillery-websocket.yml --output ws-test.json

# Terminal 2
artillery run artillery-connection-stress.yml --output conn-test.json

# Terminal 3
artillery run artillery-throughput.yml --output throughput-test.json
```

---

## 📈 Interpreting Results

### Understanding Artillery Output

**During Test**:

```
Summary report @ 14:23:45
  Scenarios launched:  120
  Scenarios completed: 118
  Requests completed:  356
  Mean response/sec:   11.87
  Response time (msec):
    min: 34.2
    max: 567.8
    median: 98.3
    p95: 245.6
    p99: 412.1
  Scenario counts:
    Mixed WebSocket Activity: 120 (100%)
  Codes:
    200: 356
```

### Key Metrics Explained

#### 1. **Scenarios Launched vs Completed**

- **Launched**: Virtual users started
- **Completed**: Virtual users finished their flows
- **Gap**: If completed < launched, users timed out or errored

**Good**: Completed ≈ Launched (within 5%)
**Bad**: Completed < 90% of Launched

#### 2. **Response Time Distribution**

- **Median (p50)**: Half of requests faster, half slower
- **p95**: 95% of requests faster than this
- **p99**: 99% of requests faster than this

**Example**:

```
p50: 50ms   ← Great! Most requests very fast
p95: 100ms  ← Good, even slow requests reasonable
p99: 500ms  ← Some outliers, but acceptable
```

**Red flags**:

- p95 > 500ms: Performance degradation
- p99 > 2000ms: System struggling
- p99 > 5000ms: System overloaded

#### 3. **HTTP Status Codes**

```
Codes:
  200: 950  ← Success
  201: 50   ← Created
  401: 5    ← Auth failures (may be expected)
  429: 10   ← Rate limited (expected under high load)
  500: 2    ← Server errors (investigate!)
```

**Acceptable**:

- 200/201: > 95%
- 429: < 5% (rate limiting working correctly)
- 500: < 1%

#### 4. **Error Rates**

```
Errors:
  ETIMEDOUT: 5
  ECONNREFUSED: 2
```

**Common Errors**:

- **ETIMEDOUT**: Server slow to respond (increase timeout or investigate)
- **ECONNREFUSED**: Server not accepting connections (overloaded)
- **ECONNRESET**: Server closed connection unexpectedly
- **WebSocket error**: Check WS-specific issues

### WebSocket-Specific Metrics

Look for custom metrics in output:

```
websocket.connection.time.p95: 150ms
websocket.auth.latency.p95: 80ms
websocket.message.size: 250 bytes (avg)
websocket.messages_sent: 5000
```

### Red Flags to Watch For

🚨 **Critical Issues**:

- HTTP success rate < 90%
- p99 latency > 5 seconds
- Continuous increase in response time over test duration
- Errors > 10% of requests
- Memory growth > 200MB during test

⚠️ **Warning Signs**:

- HTTP success rate < 95%
- p95 latency > 500ms
- Occasional timeouts (< 5%)
- Inconsistent performance between test runs

### Comparison: Good vs Bad Results

**Good Test Run**:

```
✅ Scenarios: 1000 launched, 998 completed (99.8%)
✅ Response time p95: 245ms
✅ Response time p99: 456ms
✅ HTTP 200: 2998 (99.9%)
✅ Errors: 2 (0.07%)
✅ Throughput: 50 req/sec (stable)
```

**Bad Test Run**:

```
❌ Scenarios: 1000 launched, 750 completed (75%)
❌ Response time p95: 2500ms
❌ Response time p99: 8000ms
❌ HTTP 200: 2100 (70%), HTTP 500: 300 (10%)
❌ Errors: 600 (20%)
❌ Throughput: 15 req/sec (declining)
```

---

## 🔧 Troubleshooting

### Common Issues

#### 1. **Artillery Not Found**

```
Error: artillery: command not found
```

**Solution**:

```bash
npm install -g artillery@latest
# Or use npx
npx artillery run artillery-websocket.yml
```

#### 2. **Test User Authentication Fails**

```
Error: HTTP 401 - Unauthorized
```

**Solutions**:

- Create test user in database:
  ```bash
  # Via API or database directly
  email: loadtest@example.com
  password: LoadTest123!@#
  ```
- Check `TEST_EMAIL` and `TEST_PASSWORD` environment variables
- Verify user account is not locked/disabled

#### 3. **WebSocket Connection Fails**

```
Error: WebSocket connection failed
```

**Solutions**:

- Check API is running: `curl http://localhost:3000/health`
- Verify WebSocket server is initialized
- Check firewall/proxy settings
- Test WS manually:
  ```bash
  npx wscat -c ws://localhost:3000/ws/notifications
  ```

#### 4. **Rate Limit Errors**

```
HTTP 429 - Too Many Requests
```

**Expected**: Some rate limiting under high load is normal

**Solutions**:

- Reduce `arrivalRate` in test config
- Increase rate limits in server config (for testing only!)
- Add delays between requests in test scenarios

#### 5. **High Error Rate**

```
Errors: 30% of requests
```

**Diagnosis**:

1. Check server logs for errors
2. Monitor resource usage (CPU, memory, connections)
3. Check database connection pool
4. Verify Redis connectivity

**Solutions**:

- Scale server resources
- Optimize database queries
- Increase connection pool sizes
- Add caching where appropriate

#### 6. **Inconsistent Results Between Runs**

**Possible causes**:

- Server not in clean state between tests
- External factors (network, other processes)
- Database cache effects

**Solutions**:

- Restart server between test runs
- Clear Redis cache
- Run tests multiple times and average results
- Use dedicated test environment

### Performance Debugging Workflow

1. **Run baseline test**:

   ```bash
   artillery run artillery-websocket.yml --output baseline.json
   ```

2. **Check results**:

   ```bash
   artillery report baseline.json
   ```

3. **If issues found, check server logs**:

   ```bash
   tail -f logs/combined.log
   ```

4. **Monitor server resources**:

   ```bash
   # CPU, Memory
   htop

   # Network
   iftop

   # Connections
   netstat -an | grep ESTABLISHED | wc -l
   ```

5. **Check database**:

   ```bash
   # MongoDB slow queries
   db.setProfilingLevel(2)
   db.system.profile.find().sort({ts:-1}).limit(5)
   ```

6. **Check Redis**:
   ```bash
   redis-cli
   > INFO stats
   > SLOWLOG GET 10
   ```

---

## 🎯 Best Practices

### Before Running Load Tests

1. **Use dedicated test environment**: Don't test on production!
2. **Clean state**: Restart server, clear caches
3. **Baseline metrics**: Record normal performance first
4. **Set alerts**: Monitor CPU, memory, disk, network
5. **Backup data**: Just in case

### During Load Tests

1. **Monitor actively**: Watch server metrics in real-time
2. **Start small**: Begin with low load, gradually increase
3. **Look for patterns**: Does performance degrade over time?
4. **Check logs**: Watch for errors/warnings
5. **Document observations**: Note anything unusual

### After Load Tests

1. **Analyze results**: Don't just look at pass/fail
2. **Compare with baselines**: Has performance changed?
3. **Identify bottlenecks**: CPU? Memory? Database? Network?
4. **Document findings**: Create actionable reports
5. **Plan improvements**: Prioritize optimizations

### Test Design Best Practices

1. **Realistic scenarios**: Mimic actual user behavior
2. **Varied load**: Include warm-up, sustained, spike, cooldown
3. **Multiple runs**: One test is not enough
4. **Measure trends**: Test regularly, track changes over time
5. **Test limits**: Find breaking point (carefully!)

### Interpreting Results Best Practices

1. **Don't rely on single metric**: Look at full picture
2. **Context matters**: Compare apples to apples
3. **Percentiles > averages**: p95/p99 more important than mean
4. **Errors are data**: Understand failure modes
5. **Correlation ≠ causation**: Dig deeper to understand root causes

---

## 📚 Additional Resources

### Artillery Documentation

- Official docs: https://www.artillery.io/docs
- WebSocket testing: https://www.artillery.io/docs/guides/guides/websocket-testing
- Plugins: https://www.artillery.io/docs/guides/plugins

### Performance Testing Best Practices

- [Google SRE Book - Load Testing](https://sre.google/sre-book/load-balancing-datacenter/)
- [AWS - Performance Testing Best Practices](https://aws.amazon.com/architecture/well-architected/)

### Internal Documentation

- API Documentation: `/docs/api/`
- WebSocket Protocol: `/docs/websocket-protocol.md`
- System Architecture: `/docs/architecture.md`

---

## 🆘 Support

**Issues with tests?**

1. Run validation script: `npx ts-node validate-load-test-setup.ts`
2. Check troubleshooting section above
3. Review server logs in `logs/`
4. Contact DevOps team

**Questions about results?**

1. Review "Interpreting Results" section
2. Compare with performance baselines
3. Check for known issues in JIRA/GitHub
4. Consult with performance engineering team

---

**Version**: 1.0.0  
**Last Updated**: 2024-03-18  
**Maintained By**: QA/DevOps Team
