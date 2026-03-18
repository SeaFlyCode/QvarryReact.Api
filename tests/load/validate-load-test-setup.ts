/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ARTILLERY LOAD TEST VALIDATION SCRIPT
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Validates that Artillery load testing setup is working correctly
 * Tests:
 *  - Artillery installation
 *  - Configuration file validity
 *  - Processor functions
 *  - Test data fixtures
 *  - Basic connectivity to API
 *  - WebSocket endpoint availability
 *
 * Usage:
 *   npm run test:load:validate
 *   OR
 *   npx ts-node tests/load/validate-load-test-setup.ts
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import axios from "axios";
import * as WebSocket from "ws";

// Configuration
const CONFIG = {
  apiUrl: process.env.API_URL || "http://localhost:3000",
  testEmail: process.env.TEST_EMAIL || "loadtest@example.com",
  testPassword: process.env.TEST_PASSWORD || "LoadTest123!@#",
};

// Colors for console output
const colors = {
  green: (text: string) => `\x1b[32m${text}\x1b[0m`,
  red: (text: string) => `\x1b[31m${text}\x1b[0m`,
  yellow: (text: string) => `\x1b[33m${text}\x1b[0m`,
  blue: (text: string) => `\x1b[34m${text}\x1b[0m`,
  bold: (text: string) => `\x1b[1m${text}\x1b[0m`,
};

interface ValidationResult {
  name: string;
  passed: boolean;
  message: string;
  details?: string;
}

class LoadTestValidator {
  private results: ValidationResult[] = [];
  private testDir = path.join(__dirname);

  /**
   * Run all validation checks
   */
  async validate(): Promise<boolean> {
    console.log(colors.bold("\n🔍 Artillery Load Test Setup Validation\n"));
    console.log("━".repeat(80) + "\n");

    // Run checks
    await this.checkArtilleryInstallation();
    await this.checkConfigFiles();
    await this.checkProcessorFunctions();
    await this.checkTestData();
    await this.checkApiConnectivity();
    await this.checkWebSocketEndpoints();
    await this.checkTestUserExists();

    // Print results
    this.printResults();

    return this.results.every((r) => r.passed);
  }

  /**
   * Check if Artillery is installed
   */
  private async checkArtilleryInstallation(): Promise<void> {
    try {
      const version = execSync("artillery version", {
        encoding: "utf-8",
      }).trim();
      this.addResult({
        name: "Artillery Installation",
        passed: true,
        message: `Artillery is installed (${version})`,
      });
    } catch (error) {
      this.addResult({
        name: "Artillery Installation",
        passed: false,
        message: "Artillery is not installed",
        details: "Install with: npm install -g artillery@latest",
      });
    }
  }

  /**
   * Check if configuration files exist and are valid
   */
  private async checkConfigFiles(): Promise<void> {
    const configFiles = [
      "artillery-websocket.yml",
      "artillery-connection-stress.yml",
      "artillery-throughput.yml",
    ];

    let allValid = true;
    const details: string[] = [];

    for (const file of configFiles) {
      const filePath = path.join(this.testDir, file);

      if (!fs.existsSync(filePath)) {
        allValid = false;
        details.push(`❌ Missing: ${file}`);
        continue;
      }

      try {
        const content = fs.readFileSync(filePath, "utf-8");

        // Basic validation: check for required sections
        const requiredSections = ["config:", "scenarios:"];
        const missingSection = requiredSections.find(
          (section) => !content.includes(section),
        );

        if (missingSection) {
          allValid = false;
          details.push(`❌ ${file}: Missing ${missingSection}`);
        } else {
          details.push(`✅ ${file}`);
        }
      } catch (error) {
        allValid = false;
        details.push(`❌ ${file}: Invalid YAML`);
      }
    }

    this.addResult({
      name: "Configuration Files",
      passed: allValid,
      message: allValid
        ? "All config files valid"
        : "Some config files invalid",
      details: details.join("\n"),
    });
  }

  /**
   * Check if processor functions file exists and is valid
   */
  private async checkProcessorFunctions(): Promise<void> {
    const functionsFile = path.join(this.testDir, "artillery-functions.js");

    if (!fs.existsSync(functionsFile)) {
      this.addResult({
        name: "Processor Functions",
        passed: false,
        message: "artillery-functions.js not found",
      });
      return;
    }

    try {
      const functions = require(functionsFile);
      const requiredFunctions = [
        "generateMessage",
        "generateVariedMessage",
        "prepareNotificationsWs",
        "prepareMessagesWs",
      ];

      const missingFunctions = requiredFunctions.filter(
        (fn) => typeof functions[fn] !== "function",
      );

      if (missingFunctions.length > 0) {
        this.addResult({
          name: "Processor Functions",
          passed: false,
          message: "Some required functions missing",
          details: `Missing: ${missingFunctions.join(", ")}`,
        });
      } else {
        this.addResult({
          name: "Processor Functions",
          passed: true,
          message: "All processor functions available",
        });
      }
    } catch (error) {
      this.addResult({
        name: "Processor Functions",
        passed: false,
        message: "Error loading processor functions",
        details: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Check if test data fixtures exist and are valid
   */
  private async checkTestData(): Promise<void> {
    const dataFile = path.join(this.testDir, "test-data.json");

    if (!fs.existsSync(dataFile)) {
      this.addResult({
        name: "Test Data Fixtures",
        passed: false,
        message: "test-data.json not found",
      });
      return;
    }

    try {
      const data = JSON.parse(fs.readFileSync(dataFile, "utf-8"));
      const requiredSections = ["users", "messages", "performanceBaselines"];
      const missingSections = requiredSections.filter(
        (section) => !data[section],
      );

      if (missingSections.length > 0) {
        this.addResult({
          name: "Test Data Fixtures",
          passed: false,
          message: "Test data incomplete",
          details: `Missing sections: ${missingSections.join(", ")}`,
        });
      } else {
        this.addResult({
          name: "Test Data Fixtures",
          passed: true,
          message: "Test data fixtures valid",
        });
      }
    } catch (error) {
      this.addResult({
        name: "Test Data Fixtures",
        passed: false,
        message: "Invalid JSON in test-data.json",
        details: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Check API connectivity
   */
  private async checkApiConnectivity(): Promise<void> {
    try {
      const response = await axios.get(`${CONFIG.apiUrl}/health`, {
        timeout: 5000,
        validateStatus: () => true,
      });

      if (response.status === 200) {
        this.addResult({
          name: "API Connectivity",
          passed: true,
          message: `API is reachable at ${CONFIG.apiUrl}`,
        });
      } else {
        this.addResult({
          name: "API Connectivity",
          passed: false,
          message: `API returned status ${response.status}`,
          details: `URL: ${CONFIG.apiUrl}/health`,
        });
      }
    } catch (error) {
      this.addResult({
        name: "API Connectivity",
        passed: false,
        message: "Cannot reach API",
        details: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Check WebSocket endpoints
   */
  private async checkWebSocketEndpoints(): Promise<void> {
    const wsUrl = CONFIG.apiUrl.replace("http", "ws");
    const endpoints = ["/ws/notifications", "/ws/messages/test"];

    let allReachable = true;
    const details: string[] = [];

    for (const endpoint of endpoints) {
      try {
        const ws = new WebSocket.WebSocket(`${wsUrl}${endpoint}`);

        const result = await new Promise<boolean>((resolve) => {
          const timeout = setTimeout(() => {
            ws.close();
            resolve(false);
          }, 3000);

          ws.on("open", () => {
            clearTimeout(timeout);
            ws.close();
            resolve(true);
          });

          ws.on("error", () => {
            clearTimeout(timeout);
            resolve(false);
          });
        });

        if (result) {
          details.push(`✅ ${endpoint}`);
        } else {
          allReachable = false;
          details.push(`❌ ${endpoint} - Connection failed`);
        }
      } catch (error) {
        allReachable = false;
        details.push(`❌ ${endpoint} - Error`);
      }
    }

    this.addResult({
      name: "WebSocket Endpoints",
      passed: allReachable,
      message: allReachable
        ? "All WS endpoints reachable"
        : "Some WS endpoints unreachable",
      details: details.join("\n"),
    });
  }

  /**
   * Check if test user exists and can authenticate
   */
  private async checkTestUserExists(): Promise<void> {
    try {
      const response = await axios.post(
        `${CONFIG.apiUrl}/api/v1/auth/login`,
        {
          email: CONFIG.testEmail,
          password: CONFIG.testPassword,
        },
        {
          timeout: 5000,
          validateStatus: () => true,
        },
      );

      if (response.status === 200 && response.data.accessToken) {
        this.addResult({
          name: "Test User Authentication",
          passed: true,
          message: "Test user exists and can authenticate",
        });
      } else {
        this.addResult({
          name: "Test User Authentication",
          passed: false,
          message: "Test user authentication failed",
          details: `Status: ${response.status}. Create user with email: ${CONFIG.testEmail}`,
        });
      }
    } catch (error) {
      this.addResult({
        name: "Test User Authentication",
        passed: false,
        message: "Cannot authenticate test user",
        details: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Add validation result
   */
  private addResult(result: ValidationResult): void {
    this.results.push(result);
  }

  /**
   * Print validation results
   */
  private printResults(): void {
    console.log(colors.bold("\n📊 Validation Results\n"));

    const passed = this.results.filter((r) => r.passed).length;
    const total = this.results.length;

    for (const result of this.results) {
      const icon = result.passed ? "✅" : "❌";
      const color = result.passed ? colors.green : colors.red;

      console.log(
        `${icon} ${colors.bold(result.name)}: ${color(result.message)}`,
      );

      if (result.details) {
        console.log(`   ${colors.yellow(result.details)}`);
      }
      console.log();
    }

    console.log("━".repeat(80));
    console.log(
      `\n${colors.bold("Summary:")} ${colors.green(passed.toString())}/${total} checks passed\n`,
    );

    if (passed === total) {
      console.log(
        colors.green(
          colors.bold(
            "✅ All validation checks passed! Ready to run load tests.\n",
          ),
        ),
      );
      console.log(colors.blue("Run load tests with:"));
      console.log(
        colors.yellow("  artillery run tests/load/artillery-websocket.yml"),
      );
      console.log(
        colors.yellow(
          "  artillery run tests/load/artillery-connection-stress.yml",
        ),
      );
      console.log(
        colors.yellow("  artillery run tests/load/artillery-throughput.yml\n"),
      );
    } else {
      console.log(
        colors.red(
          colors.bold(
            "❌ Some validation checks failed. Fix issues before running load tests.\n",
          ),
        ),
      );
    }
  }
}

// Main execution
async function main() {
  const validator = new LoadTestValidator();
  const success = await validator.validate();

  process.exit(success ? 0 : 1);
}

// Run if executed directly
if (require.main === module) {
  main().catch((error) => {
    console.error(colors.red("Validation error:"), error);
    process.exit(1);
  });
}

export { LoadTestValidator };
