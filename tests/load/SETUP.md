# Artillery WebSocket Load Testing - Installation & Setup Guide

## 🎯 Purpose

This guide walks you through setting up Artillery load testing for WebSocket endpoints from scratch.

**Time Required**: ~10 minutes

---

## ✅ Prerequisites

Before you begin, ensure you have:

- [ ] Node.js 16+ installed (`node --version`)
- [ ] npm installed (`npm --version`)
- [ ] QvarryAPI running locally or accessible
- [ ] Terminal/command line access
- [ ] Basic understanding of WebSocket and REST APIs

---

## 📦 Step 1: Install Artillery

### Global Installation (Recommended)

```bash
npm install -g artillery@latest
```

### Verify Installation

```bash
artillery version
```

Expected output: `Artillery 2.x.x` or higher

### Alternative: Using npx (No Installation)

If you don't want to install globally, use `npx`:

```bash
npx artillery version
```

---

## 🔧 Step 2: Verify Setup

Navigate to the load test directory and run validation:

```bash
cd tests/load
npx ts-node validate-load-test-setup.ts
```

This will check:

- ✅ Artillery installation
- ✅ Configuration files
- ✅ Test dependencies
- ✅ API connectivity
- ✅ WebSocket endpoints

### Expected Output

```
🔍 Artillery Load Test Setup Validation
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✅ Artillery Installation: Artillery is installed (2.0.x)
✅ Configuration Files: All config files valid
✅ Processor Functions: All processor functions available
✅ Test Data Fixtures: Test data fixtures valid
✅ API Connectivity: API is reachable at http://localhost:3000
✅ WebSocket Endpoints: All WS endpoints reachable
⚠️  Test User Authentication: Test user authentication failed

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Summary: 6/7 checks passed
```

---

## 👤 Step 3: Create Test User

If the validation shows test user authentication failed, create the test user:

### Option A: Via API (Recommended)

```bash
curl -X POST http://localhost:3000/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "loadtest@example.com",
    "password": "LoadTest123!@#",
    "name": "Load Test User"
  }'
```

### Option B: Via Database

If you have direct database access:

```javascript
// MongoDB shell or Compass
db.users.insertOne({
  email: "loadtest@example.com",
  password: "<hashed_password>", // Use bcrypt
  name: "Load Test User",
  isVerified: true,
  createdAt: new Date(),
  updatedAt: new Date(),
});
```

### Option C: Use Existing User

Set environment variables to use an existing user:

```bash
export TEST_EMAIL=your-existing-user@example.com
export TEST_PASSWORD=YourPassword123
```

### Verify Test User

```bash
curl -X POST http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "loadtest@example.com",
    "password": "LoadTest123!@#"
  }'
```

Expected: HTTP 200 with `accessToken` in response

---

## 🎯 Step 4: Run Your First Test

### Quick Test (30 seconds)

```bash
artillery quick --duration 30 --rate 5 http://localhost:3000
```

This runs a quick HTTP test to verify Artillery works.

### WebSocket Test

```bash
cd tests/load
artillery run artillery-websocket.yml
```

Expected output:

```
Summary report @ 14:23:45(+00:00)
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
  Codes:
    200: 356
```

### Using npm Scripts

```bash
# From project root
npm run test:load              # Main WebSocket test
npm run test:load:validate     # Validation
npm run test:load:connections  # Connection stress test
npm run test:load:throughput   # Throughput test
```

---

## 📊 Step 5: Generate HTML Report

Run test and generate visual report:

```bash
cd tests/load
artillery run artillery-websocket.yml --output results.json
artillery report results.json
```

This creates `results.json.html`. Open it in your browser:

```bash
# macOS
open results.json.html

# Linux
xdg-open results.json.html

# Windows
start results.json.html
```

---

## 🔍 Step 6: Understand the Results

### Key Metrics to Check

1. **Scenarios Completed**: Should be > 98% of launched
2. **HTTP Status Codes**: 200/201 should be > 95%
3. **Response Time p95**: Should be < 500ms
4. **Response Time p99**: Should be < 1000ms
5. **Errors**: Should be < 1%

### Example Good Results

```
✅ Scenarios: 1000 launched, 998 completed (99.8%)
✅ Response time p95: 245ms
✅ Response time p99: 456ms
✅ HTTP 200: 2998 (99.9%)
✅ Errors: 2 (0.07%)
```

### What to Do If Tests Fail

1. **Check server logs**: `tail -f logs/combined.log`
2. **Verify server is running**: `curl http://localhost:3000/health`
3. **Check resource usage**: `htop` or Activity Monitor
4. **Review troubleshooting guide**: `tests/load/README.md` (Section: Troubleshooting)

---

## 🎓 Step 7: Learn the Test Scenarios

### Main WebSocket Test (`artillery-websocket.yml`)

- **Purpose**: Realistic mixed load
- **Duration**: ~3.5 minutes
- **Users**: 70% passive listeners, 30% active senders
- **Use**: Regular regression testing

### Connection Stress Test (`artillery-connection-stress.yml`)

- **Purpose**: Test max concurrent connections
- **Duration**: ~6 minutes
- **Max Connections**: 500 concurrent
- **Use**: Capacity planning

### Throughput Test (`artillery-throughput.yml`)

- **Purpose**: Test message processing speed
- **Duration**: ~4 minutes
- **Max Rate**: 100 users/sec
- **Use**: Performance benchmarking

---

## 🚀 Step 8: Integrate into Workflow

### Before Deployment

```bash
# Quick sanity check
npm run test:load:validate && npm run test:load
```

### CI/CD Pipeline

Add to your `.github/workflows/` or `.gitlab-ci.yml`:

```yaml
load-test:
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v3
    - uses: actions/setup-node@v3
      with:
        node-version: "18"
    - run: npm install -g artillery@latest
    - run: npm run test:load:validate
    - run: npm run test:load
```

### Regular Performance Audits

Schedule weekly or monthly load tests to track performance trends.

---

## 🎛️ Step 9: Customize Tests (Optional)

### Change Test Duration

Edit `artillery-websocket.yml`:

```yaml
phases:
  - name: "Sustained load"
    duration: 300 # Change from 120 to 300 seconds
    arrivalRate: 10
```

### Change Load Level

```yaml
phases:
  - name: "Sustained load"
    duration: 120
    arrivalRate: 20 # Change from 10 to 20 users/sec
```

### Target Different Environment

```bash
artillery run artillery-websocket.yml --target https://staging.example.com
```

Or set environment variable:

```bash
export API_URL=https://staging.example.com
npm run test:load
```

---

## 📚 Step 10: Read the Documentation

Now that you have tests running, dive deeper:

1. **Quick Reference**: `tests/load/QUICK_REFERENCE.md` (5-minute read)
2. **Full Documentation**: `tests/load/README.md` (30-minute read)
3. **Summary Report**: `tests/load/SUMMARY.md` (10-minute read)

### Key Sections to Read

- **Interpreting Results**: Learn what metrics mean
- **Troubleshooting**: Fix common issues
- **Best Practices**: Design better tests
- **Performance Baselines**: Understand expected performance

---

## ✅ Installation Complete!

You now have a fully functional Artillery load testing setup for WebSocket endpoints.

### Quick Command Reference

```bash
# Validate setup
npm run test:load:validate

# Run tests
npm run test:load              # Main test
npm run test:load:connections  # Scalability
npm run test:load:throughput   # Performance
npm run test:load:all          # All tests

# Generate HTML report
npm run test:load:report
```

### Next Steps

1. ✅ Run tests regularly (before deployments)
2. ✅ Establish performance baselines
3. ✅ Track trends over time
4. ✅ Integrate into CI/CD (optional)
5. ✅ Share results with team

---

## 🆘 Need Help?

### Common Issues

**Artillery not found**

```bash
npm install -g artillery@latest
# or use: npx artillery run ...
```

**Test user authentication fails**

```bash
# Create test user via API or set existing user credentials
export TEST_EMAIL=existing@example.com
export TEST_PASSWORD=ExistingPassword123
```

**Connection refused**

```bash
# Ensure API is running
npm run dev
# Check health endpoint
curl http://localhost:3000/health
```

### Resources

- **Troubleshooting Guide**: `tests/load/README.md#troubleshooting`
- **Artillery Docs**: https://www.artillery.io/docs
- **GitHub Issues**: Create an issue if problems persist

---

## 🎉 Congratulations!

You're ready to start load testing your WebSocket API!

Run your first test:

```bash
npm run test:load
```

**Happy Testing!** 🚀

---

**Guide Version**: 1.0.0  
**Last Updated**: 2024-03-18  
**Estimated Setup Time**: 10 minutes
