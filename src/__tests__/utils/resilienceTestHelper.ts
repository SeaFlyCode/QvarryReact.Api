// src/__tests__/utils/resilienceTestHelper.ts

/**
 * Test Utilities for WebSocket Resilience & State Persistence Testing
 *
 * Provides helper functions for:
 * - Simulating network failures
 * - Testing reconnection flows
 * - Verifying state consistency
 * - Chaos testing scenarios
 */

import WebSocket from "ws";
import { EventEmitter } from "events";

// ═══════════════════════════════════════════════════════════════════════════
// Types & Interfaces
// ═══════════════════════════════════════════════════════════════════════════

export interface MockWebSocketClient extends EventEmitter {
  ws: WebSocket | null;
  url: string;
  connected: boolean;
  deviceId?: string;
  userId?: string;
  lastMessageId?: string;
  receivedMessages: any[];
  connect(): Promise<void>;
  disconnect(): void;
  send(data: any): void;
  waitForMessage(type: string, timeout?: number): Promise<any>;
}

export interface ResumeData {
  type: "resume_success";
  userId: string;
  deviceId: string;
  lastSeenMessageIds: Record<string, string>;
  subscriptions: string[];
  pendingMessages: any[];
  timestamp: string;
}

export interface TestMessage {
  id: string;
  conversationId: string;
  content: string;
  senderId: string;
  timestamp: string;
  type: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// Mock WebSocket Client
// ═══════════════════════════════════════════════════════════════════════════

export function createMockWebSocketClient(
  url: string,
  deviceId?: string,
): MockWebSocketClient {
  const client = new EventEmitter() as MockWebSocketClient;

  client.url = url;
  client.ws = null;
  client.connected = false;
  client.deviceId = deviceId;
  client.receivedMessages = [];

  client.connect = async function () {
    return new Promise((resolve, reject) => {
      const wsUrl = deviceId ? `${url}?deviceId=${deviceId}` : url;
      this.ws = new WebSocket(wsUrl);

      this.ws.on("open", () => {
        this.connected = true;
        this.emit("connected");
        resolve();
      });

      this.ws.on("message", (data: Buffer) => {
        try {
          const message = JSON.parse(data.toString());
          this.receivedMessages.push(message);
          this.emit("message", message);

          // Track last message ID
          if (message.messageId) {
            this.lastMessageId = message.messageId;
          }
        } catch (err) {
          this.emit("error", err);
        }
      });

      this.ws.on("close", () => {
        this.connected = false;
        this.emit("disconnected");
      });

      this.ws.on("error", (err) => {
        this.emit("error", err);
        reject(err);
      });

      // Timeout
      setTimeout(() => reject(new Error("Connection timeout")), 5000);
    });
  };

  client.disconnect = function () {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
      this.connected = false;
    }
  };

  client.send = function (data: any) {
    if (!this.ws || !this.connected) {
      throw new Error("WebSocket not connected");
    }
    const payload = typeof data === "string" ? data : JSON.stringify(data);
    this.ws.send(payload);
  };

  client.waitForMessage = function (
    type: string,
    timeout = 5000,
  ): Promise<any> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Timeout waiting for message type: ${type}`));
      }, timeout);

      const handler = (message: any) => {
        if (message.type === type) {
          clearTimeout(timer);
          this.removeListener("message", handler);
          resolve(message);
        }
      };

      this.on("message", handler);
    });
  };

  return client;
}

// ═══════════════════════════════════════════════════════════════════════════
// Network Simulation Utilities
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Simulates an abrupt network disconnection
 */
export async function simulateDisconnection(
  client: MockWebSocketClient,
): Promise<void> {
  if (!client.ws) {
    throw new Error("Client not connected");
  }

  // Abruptly close the connection (simulate network failure)
  client.ws.terminate();

  // Wait for disconnection event
  return new Promise((resolve) => {
    client.once("disconnected", resolve);
    // Timeout fallback
    setTimeout(resolve, 1000);
  });
}

/**
 * Waits for client to reconnect successfully
 */
export async function waitForReconnection(
  client: MockWebSocketClient,
  timeout = 10000,
): Promise<void> {
  if (client.connected) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("Reconnection timeout"));
    }, timeout);

    client.once("connected", () => {
      clearTimeout(timer);
      resolve();
    });

    // Attempt to reconnect
    client.connect().catch(reject);
  });
}

/**
 * Simulates intermittent network connectivity (packet loss)
 */
export function simulatePacketLoss(
  client: MockWebSocketClient,
  lossPercentage: number,
): () => void {
  const originalSend = client.send.bind(client);

  client.send = function (data: any) {
    // Randomly drop packets
    if (Math.random() * 100 < lossPercentage) {
      // Drop packet silently
      return;
    }
    originalSend(data);
  };

  // Return cleanup function
  return () => {
    client.send = originalSend;
  };
}

/**
 * Simulates network latency
 */
export function simulateNetworkLatency(
  client: MockWebSocketClient,
  latencyMs: number,
): () => void {
  const originalSend = client.send.bind(client);

  client.send = function (data: any) {
    setTimeout(() => {
      originalSend(data);
    }, latencyMs);
  };

  // Return cleanup function
  return () => {
    client.send = originalSend;
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Message & ACK Utilities
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Sends a message and waits for acknowledgment
 */
export async function sendAndWaitForAck(
  client: MockWebSocketClient,
  message: any,
  timeout = 5000,
): Promise<any> {
  const messageId = message.messageId || `msg_${Date.now()}`;

  client.send({
    ...message,
    messageId,
    requireAck: true,
  });

  return client.waitForMessage("ack", timeout).then((ackMessage) => {
    if (ackMessage.messageId === messageId) {
      return ackMessage;
    }
    throw new Error("ACK message ID mismatch");
  });
}

/**
 * Generates test messages for queue testing
 */
export function generateMissedMessages(
  count: number,
  conversationId: string,
  senderId: string,
): TestMessage[] {
  const messages: TestMessage[] = [];

  for (let i = 0; i < count; i++) {
    messages.push({
      id: `msg_${Date.now()}_${i}`,
      conversationId,
      content: `Test message ${i + 1}`,
      senderId,
      timestamp: new Date().toISOString(),
      type: "message",
    });
  }

  return messages;
}

// ═══════════════════════════════════════════════════════════════════════════
// State Verification Utilities
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Verifies that two state objects are equal
 */
export function verifyStateEquals(actual: any, expected: any): void {
  const actualKeys = Object.keys(actual).sort();
  const expectedKeys = Object.keys(expected).sort();

  if (JSON.stringify(actualKeys) !== JSON.stringify(expectedKeys)) {
    throw new Error(
      `State keys mismatch.\nExpected: ${expectedKeys}\nActual: ${actualKeys}`,
    );
  }

  for (const key of expectedKeys) {
    if (JSON.stringify(actual[key]) !== JSON.stringify(expected[key])) {
      throw new Error(
        `State mismatch for key "${key}".\nExpected: ${JSON.stringify(expected[key])}\nActual: ${JSON.stringify(actual[key])}`,
      );
    }
  }
}

/**
 * Verifies messages are in correct order
 */
export function verifyMessageOrder(messages: TestMessage[]): void {
  for (let i = 1; i < messages.length; i++) {
    const prevTime = new Date(messages[i - 1].timestamp).getTime();
    const currTime = new Date(messages[i].timestamp).getTime();

    if (currTime < prevTime) {
      throw new Error(
        `Messages out of order at index ${i}. ` +
          `Previous: ${messages[i - 1].timestamp}, Current: ${messages[i].timestamp}`,
      );
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Resume Protocol Utilities
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Creates a resume request message
 */
export function createResumeRequest(
  deviceId: string,
  lastSeenMessageIds?: Record<string, string>,
): any {
  return {
    type: "resume",
    deviceId,
    lastSeenMessageIds: lastSeenMessageIds || {},
    timestamp: new Date().toISOString(),
  };
}

/**
 * Waits for resume success message
 */
export async function waitForResume(
  client: MockWebSocketClient,
  timeout = 5000,
): Promise<ResumeData> {
  const message = await client.waitForMessage("resume_success", timeout);
  return message as ResumeData;
}

// ═══════════════════════════════════════════════════════════════════════════
// Redis Simulation Utilities
// ═══════════════════════════════════════════════════════════════════════════

let redisFailureSimulated = false;

/**
 * Simulates Redis connection failure
 */
export function simulateRedisFailure(): void {
  redisFailureSimulated = true;
  // This would be used in conjunction with mocked Redis client
}

/**
 * Restores Redis connection
 */
export function restoreRedis(): void {
  redisFailureSimulated = false;
}

/**
 * Checks if Redis failure is currently simulated
 */
export function isRedisFailureSimulated(): boolean {
  return redisFailureSimulated;
}

// ═══════════════════════════════════════════════════════════════════════════
// Server Shutdown Utilities
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Simulates graceful server shutdown
 */
export async function simulateGracefulShutdown(
  server: any,
  clients: MockWebSocketClient[],
): Promise<void> {
  // Broadcast shutdown message to all clients
  const shutdownPromises = clients.map((client) => {
    return client.waitForMessage("server_shutdown", 3000).catch(() => {
      // Some clients might not be connected
    });
  });

  // Trigger shutdown
  if (server && typeof server.close === "function") {
    server.close();
  }

  // Wait for all clients to receive shutdown message
  await Promise.allSettled(shutdownPromises);
}

// ═══════════════════════════════════════════════════════════════════════════
// Test Data Generators
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Generates test user data
 */
export function generateTestUser(index: number) {
  return {
    userId: `user_${index}`,
    username: `testuser${index}`,
    email: `testuser${index}@example.com`,
  };
}

/**
 * Generates test conversation data
 */
export function generateTestConversation(participantIds: string[]) {
  return {
    conversationId: `conv_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    participants: participantIds.map((id) => ({ userId: id })),
    createdAt: new Date().toISOString(),
  };
}

/**
 * Generates test device ID
 */
export function generateDeviceId(prefix = "device"): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// ═══════════════════════════════════════════════════════════════════════════
// Performance Utilities
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Measures operation latency
 */
export async function measureLatency<T>(
  operation: () => Promise<T>,
): Promise<{ result: T; latencyMs: number }> {
  const start = Date.now();
  const result = await operation();
  const latencyMs = Date.now() - start;

  return { result, latencyMs };
}

/**
 * Calculates percentile from array of numbers
 */
export function calculatePercentile(
  values: number[],
  percentile: number,
): number {
  if (values.length === 0) return 0;

  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil((percentile / 100) * sorted.length) - 1;

  return sorted[Math.max(0, index)];
}

/**
 * Collects latency statistics
 */
export function calculateLatencyStats(latencies: number[]) {
  if (latencies.length === 0) {
    return {
      min: 0,
      max: 0,
      avg: 0,
      p50: 0,
      p95: 0,
      p99: 0,
    };
  }

  const sum = latencies.reduce((a, b) => a + b, 0);

  return {
    min: Math.min(...latencies),
    max: Math.max(...latencies),
    avg: sum / latencies.length,
    p50: calculatePercentile(latencies, 50),
    p95: calculatePercentile(latencies, 95),
    p99: calculatePercentile(latencies, 99),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Cleanup Utilities
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Cleans up all test clients
 */
export function cleanupClients(clients: MockWebSocketClient[]): void {
  clients.forEach((client) => {
    try {
      client.disconnect();
      client.removeAllListeners();
    } catch (err) {
      // Ignore cleanup errors
    }
  });
}

/**
 * Waits for a condition to be true
 */
export async function waitForCondition(
  condition: () => boolean | Promise<boolean>,
  timeout = 5000,
  pollInterval = 100,
): Promise<void> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    const result = await Promise.resolve(condition());
    if (result) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, pollInterval));
  }

  throw new Error("Condition not met within timeout");
}

/**
 * Delays execution
 */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
