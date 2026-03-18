# Artillery WebSocket Load Testing - Quick Reference

## 🚀 Quick Start (30 seconds)

```bash
# 1. Install Artillery
npm install -g artillery@latest

# 2. Validate setup
cd tests/load && npx ts-node validate-load-test-setup.ts

# 3. Run basic test
artillery run artillery-websocket.yml
```

---

## 📋 Test Commands

### Basic Tests

```bash
# Main WebSocket test (mixed load)
artillery run artillery-websocket.yml

# Connection stress test (scalability)
artillery run artillery-connection-stress.yml

# Message throughput test (performance)
artillery run artillery-throughput.yml
```

### With HTML Report

```bash
artillery run artillery-websocket.yml -o results.json
artillery report results.json
open results.json.html
```

### Custom Target

```bash
artillery run artillery-websocket.yml --target http://localhost:3000
artillery run artillery-websocket.yml --target https://staging.example.com
```

### Quick Test (reduced duration)

```bash
artillery quick --duration 60 --rate 10 http://localhost:3000
```

---

## 📊 Key Metrics Cheat Sheet

| Metric           | Good   | Warning    | Critical |
| ---------------- | ------ | ---------- | -------- |
| **Success Rate** | >95%   | 90-95%     | <90%     |
| **p95 Latency**  | <200ms | 200-500ms  | >500ms   |
| **p99 Latency**  | <500ms | 500-1000ms | >1000ms  |
| **Errors**       | <1%    | 1-5%       | >5%      |
| **Completion**   | >98%   | 95-98%     | <95%     |

---

## 🎯 Test Scenarios Summary

### 1. Main WebSocket Test

- **Duration**: 210 seconds (~3.5 min)
- **Max Users**: ~50/sec during spike
- **Purpose**: Realistic mixed behavior
- **Use case**: Regression testing, CI/CD

### 2. Connection Stress

- **Duration**: 360 seconds (~6 min)
- **Max Connections**: 500 concurrent
- **Purpose**: Scalability testing
- **Use case**: Capacity planning

### 3. Message Throughput

- **Duration**: 240 seconds (~4 min)
- **Max Rate**: 100 users/sec
- **Purpose**: Message processing performance
- **Use case**: Feature benchmarking

---

## 🔍 Interpreting Results (5-second rule)

### ✅ PASS Indicators

```
✓ Scenarios completed > 98%
✓ Response time p95 < 500ms
✓ HTTP 200 > 95%
✓ Errors < 1%
```

### ⚠️ WARNING Indicators

```
! Scenarios completed 95-98%
! Response time p95 500-1000ms
! HTTP 200 90-95%
! Errors 1-5%
```

### ❌ FAIL Indicators

```
✗ Scenarios completed < 95%
✗ Response time p95 > 1000ms
✗ HTTP 200 < 90%
✗ Errors > 5%
```

---

## 🐛 Troubleshooting (Common Fixes)

### Problem: "Artillery not found"

```bash
npm install -g artillery@latest
# or use npx
npx artillery run artillery-websocket.yml
```

### Problem: "Test user authentication failed"

```bash
# Set environment variables
export TEST_EMAIL=loadtest@example.com
export TEST_PASSWORD=LoadTest123!@#

# Or create user via API
curl -X POST http://localhost:3000/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"loadtest@example.com","password":"LoadTest123!@#"}'
```

### Problem: "Connection refused"

```bash
# Check if server is running
curl http://localhost:3000/health

# Start server
npm run dev
```

### Problem: "High error rate"

```bash
# Check server logs
tail -f logs/combined.log

# Monitor resources
htop

# Check connections
netstat -an | grep 3000 | wc -l
```

---

## 🎨 Environment Variables

```bash
# API Configuration
export API_URL=http://localhost:3000

# Test User Credentials
export TEST_EMAIL=loadtest@example.com
export TEST_PASSWORD=LoadTest123!@#

# Artillery Configuration
export ARTILLERY_WORKERS=4  # Parallel workers
```

---

## 📈 Performance Baselines (TL;DR)

| What                   | Expected |
| ---------------------- | -------- |
| Login time (p95)       | < 300ms  |
| WS connection (p95)    | < 200ms  |
| Message latency (p95)  | < 100ms  |
| Concurrent connections | 200+     |
| Messages/sec           | 100+     |
| Success rate           | > 95%    |

---

## 🔗 Important Files

```
tests/load/
├── artillery-websocket.yml           # Main test
├── artillery-connection-stress.yml   # Scalability test
├── artillery-throughput.yml          # Performance test
├── artillery-functions.js            # Helper functions
├── test-data.json                    # Test fixtures
├── validate-load-test-setup.ts       # Setup validator
├── README.md                         # Full documentation
└── QUICK_REFERENCE.md                # This file
```

---

## 📞 Need Help?

1. **Validate setup**: `npx ts-node validate-load-test-setup.ts`
2. **Check full docs**: `tests/load/README.md`
3. **Server logs**: `tail -f logs/combined.log`
4. **Artillery docs**: https://www.artillery.io/docs

---

## 🎯 Common Use Cases

### Before Deployment

```bash
# Quick sanity check
artillery run artillery-websocket.yml

# Check if passing
echo $?  # 0 = pass, non-zero = fail
```

### Performance Regression Testing

```bash
# Run test, save baseline
artillery run artillery-websocket.yml -o baseline.json

# After code changes
artillery run artillery-websocket.yml -o current.json

# Compare (manually review reports)
artillery report baseline.json
artillery report current.json
```

### Capacity Planning

```bash
# Find breaking point
artillery run artillery-connection-stress.yml

# Check at what point errors spike
# Review HTML report for patterns
```

### CI/CD Integration

```bash
# Exit code integration
artillery run artillery-websocket.yml --output report.json
if [ $? -eq 0 ]; then
  echo "✅ Load tests passed"
else
  echo "❌ Load tests failed"
  exit 1
fi
```

---

**Quick Reference v1.0** | Last updated: 2024-03-18
