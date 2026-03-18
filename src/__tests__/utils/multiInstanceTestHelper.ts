// src/__tests__/utils/multiInstanceTestHelper.ts

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * MULTI-INSTANCE TEST HELPER UTILITIES
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Helper functions for testing WebSocket clustering across multiple instances.
 * Provides utilities for:
 * - Starting/stopping mock API instances
 * - Creating authenticated WebSocket clients
 * - Waiting for message delivery
 * - Verifying message delivery across instances
 * - Detecting duplicate messages
 * - Measuring cross-instance latency
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { Server as HttpServer } from "http";
import { WebSocket, WebSocketServer } from "ws";
import { AddressInfo } from "net";
import jwt from "jsonwebtoken";
import { EventEmitter } from "events";

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

export interface MockInstance {
  id: string;
  httpServer: HttpServer;
  wsServer: WebSocketServer;
  port: number;
  clients: Map<string, Set<WebSocket>>;
  messageCount: number;
  receivedMessages: ReceivedMessage[];
  redisPubSubService?: any;
}

export interface ReceivedMessage {
  type: string;
  payload: any;
  instanceId: string;
  receivedAt: number;
}

export interface TestClient {
  userId: string;
  ws: WebSocket;
  receivedMessages: any[];
  connectedToInstance: string;
  connectionTime: number;
}

export interface LatencyMetrics {
  average: number;
  min: number;
  max: number;
  p50: number;
  p95: number;
  p99: number;
  samples: number[];
}

export interface DeliveryResult {
  success: boolean;
  deliveredCount: number;
  expectedCount: number;
  missingClients: string[];
  duplicates: number;
  latency?: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// INSTANCE MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Start a mock API instance with WebSocket server on random port
 */
export async function startMockInstance(
  instanceId: string,
  jwtSecret: string = "test-jwt-secret",
): Promise<MockInstance> {
  return new Promise((resolve, reject) => {
    const httpServer = new HttpServer();
    const wsServer = new WebSocketServer({ noServer: true });
    const clients = new Map<string, Set<WebSocket>>();
    const receivedMessages: ReceivedMessage[] = [];
    let messageCount = 0;

    // Handle WebSocket connections
    wsServer.on("connection", (ws: WebSocket, userId: string) => {
      // Add client to tracking
      if (!clients.has(userId)) {
        clients.set(userId, new Set());
      }
      clients.get(userId)!.add(ws);

      // Track messages
      ws.on("message", (data) => {
        try {
          const message = JSON.parse(data.toString());
          receivedMessages.push({
            type: message.type || "unknown",
            payload: message,
            instanceId,
            receivedAt: Date.now(),
          });
          messageCount++;
        } catch (error) {
          // Ignore parse errors
        }
      });

      // Handle disconnection
      ws.on("close", () => {
        const userClients = clients.get(userId);
        if (userClients) {
          userClients.delete(ws);
          if (userClients.size === 0) {
            clients.delete(userId);
          }
        }
      });

      // Handle errors
      ws.on("error", (error) => {
        console.error(`[${instanceId}] WebSocket error:`, error);
      });
    });

    // Handle HTTP upgrade to WebSocket
    httpServer.on("upgrade", (request, socket, head) => {
      try {
        const url = new URL(request.url!, `http://${request.headers.host}`);
        const token = url.searchParams.get("token");

        if (!token) {
          socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
          socket.destroy();
          return;
        }

        // Verify JWT token
        const decoded = jwt.verify(token, jwtSecret) as { userId: string };
        const userId = decoded.userId;

        // Handle upgrade
        wsServer.handleUpgrade(request, socket, head, (ws) => {
          wsServer.emit("connection", ws, userId);
        });
      } catch (error) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
      }
    });

    // Start server on random port
    httpServer.listen(0, () => {
      const address = httpServer.address() as AddressInfo;

      const instance: MockInstance = {
        id: instanceId,
        httpServer,
        wsServer,
        port: address.port,
        clients,
        messageCount,
        receivedMessages,
      };

      resolve(instance);
    });

    httpServer.on("error", (error) => {
      reject(
        new Error(`Failed to start instance ${instanceId}: ${error.message}`),
      );
    });

    // Timeout after 5 seconds
    setTimeout(() => {
      reject(new Error(`Timeout starting instance ${instanceId}`));
    }, 5000);
  });
}

/**
 * Stop a mock instance and clean up resources
 */
export async function stopInstance(instance: MockInstance): Promise<void> {
  return new Promise((resolve) => {
    // Close all client connections
    instance.clients.forEach((clientSet) => {
      clientSet.forEach((client) => {
        if (
          client.readyState === WebSocket.OPEN ||
          client.readyState === WebSocket.CONNECTING
        ) {
          client.close();
        }
      });
    });

    // Close WebSocket server
    instance.wsServer.close(() => {
      // Close HTTP server
      instance.httpServer.close(() => {
        resolve();
      });
    });

    // Force close after timeout
    setTimeout(() => {
      resolve();
    }, 2000);
  });
}

/**
 * Stop all instances
 */
export async function stopAllInstances(
  instances: MockInstance[],
): Promise<void> {
  await Promise.all(instances.map((instance) => stopInstance(instance)));
}

// ═══════════════════════════════════════════════════════════════════════════
// CLIENT MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Connect a client to an instance with authentication
 */
export async function connectClient(
  instanceUrl: string,
  userId: string,
  jwtSecret: string = "test-jwt-secret",
): Promise<TestClient> {
  return new Promise((resolve, reject) => {
    const token = jwt.sign({ userId }, jwtSecret, { expiresIn: "1h" });
    const ws = new WebSocket(`${instanceUrl}?token=${token}`);
    const receivedMessages: any[] = [];
    const connectionTime = Date.now();

    ws.on("open", () => {
      const client: TestClient = {
        userId,
        ws,
        receivedMessages,
        connectedToInstance: instanceUrl,
        connectionTime,
      };
      resolve(client);
    });

    ws.on("message", (data) => {
      try {
        const message = JSON.parse(data.toString());
        receivedMessages.push(message);
      } catch (error) {
        // Ignore parse errors
      }
    });

    ws.on("error", (error) => {
      reject(
        new Error(`Connection failed for user ${userId}: ${error.message}`),
      );
    });

    // Timeout after 5 seconds
    setTimeout(() => {
      if (ws.readyState !== WebSocket.OPEN) {
        reject(new Error(`Connection timeout for user ${userId}`));
      }
    }, 5000);
  });
}

/**
 * Disconnect a client
 */
export async function disconnectClient(client: TestClient): Promise<void> {
  return new Promise((resolve) => {
    if (client.ws.readyState === WebSocket.OPEN) {
      client.ws.once("close", () => resolve());
      client.ws.close();

      // Force resolve after timeout
      setTimeout(resolve, 1000);
    } else {
      resolve();
    }
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// MESSAGE HANDLING
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Wait for a message to be received by a client
 */
export async function waitForMessage(
  client: TestClient,
  predicate?: (message: any) => boolean,
  timeout: number = 5000,
): Promise<any> {
  const startTime = Date.now();

  return new Promise((resolve, reject) => {
    // Check existing messages first
    const existing = client.receivedMessages.find(predicate || (() => true));
    if (existing) {
      resolve(existing);
      return;
    }

    // Set up message listener
    const checkMessages = () => {
      const message = client.receivedMessages.find(predicate || (() => true));

      if (message) {
        resolve(message);
      } else if (Date.now() - startTime > timeout) {
        reject(new Error(`Timeout waiting for message (${timeout}ms)`));
      } else {
        setTimeout(checkMessages, 50);
      }
    };

    checkMessages();
  });
}

/**
 * Verify message delivery to all clients
 */
export async function verifyMessageDelivery(
  clients: TestClient[],
  expectedMessage: (message: any) => boolean,
  timeout: number = 5000,
): Promise<DeliveryResult> {
  const startTime = Date.now();
  const missingClients: string[] = [];
  let deliveredCount = 0;

  // Wait for all clients to receive the message
  const results = await Promise.allSettled(
    clients.map((client) =>
      waitForMessage(client, expectedMessage, timeout)
        .then(() => {
          deliveredCount++;
          return client.userId;
        })
        .catch(() => {
          missingClients.push(client.userId);
          return null;
        }),
    ),
  );

  const latency = Date.now() - startTime;

  return {
    success: deliveredCount === clients.length,
    deliveredCount,
    expectedCount: clients.length,
    missingClients,
    duplicates: 0, // Will be calculated by checkForDuplicates
    latency,
  };
}

/**
 * Check for duplicate messages in client message lists
 */
export function checkForDuplicates(
  clients: TestClient[],
  messageIdentifier: (message: any) => string,
): { hasDuplicates: boolean; duplicateCount: number; details: any[] } {
  const allMessages: Array<{ userId: string; id: string; message: any }> = [];

  // Collect all messages with IDs
  clients.forEach((client) => {
    client.receivedMessages.forEach((message) => {
      allMessages.push({
        userId: client.userId,
        id: messageIdentifier(message),
        message,
      });
    });
  });

  // Find duplicates
  const seen = new Map<string, number>();
  const duplicates: any[] = [];

  allMessages.forEach((item) => {
    const key = `${item.userId}-${item.id}`;
    const count = (seen.get(key) || 0) + 1;
    seen.set(key, count);

    if (count > 1) {
      duplicates.push({
        userId: item.userId,
        messageId: item.id,
        count,
        message: item.message,
      });
    }
  });

  return {
    hasDuplicates: duplicates.length > 0,
    duplicateCount: duplicates.length,
    details: duplicates,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// PERFORMANCE MEASUREMENT
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Measure cross-instance latency for message delivery
 */
export async function measureCrossInstanceLatency(
  senderInstance: MockInstance,
  receiverClients: TestClient[],
  messageFactory: (index: number) => any,
  iterations: number = 10,
): Promise<LatencyMetrics> {
  const samples: number[] = [];

  for (let i = 0; i < iterations; i++) {
    const startTime = Date.now();
    const message = messageFactory(i);

    // Broadcast message from sender instance
    broadcastFromInstance(senderInstance, message);

    // Wait for all receivers to get the message
    await Promise.all(
      receiverClients.map(
        (client) =>
          waitForMessage(
            client,
            (msg) => JSON.stringify(msg) === JSON.stringify(message),
            2000,
          ).catch(() => null), // Ignore failures for latency measurement
      ),
    );

    const endTime = Date.now();
    samples.push(endTime - startTime);

    // Small delay between iterations
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  // Calculate statistics
  samples.sort((a, b) => a - b);

  const average = samples.reduce((sum, val) => sum + val, 0) / samples.length;
  const min = samples[0];
  const max = samples[samples.length - 1];
  const p50 = samples[Math.floor(samples.length * 0.5)];
  const p95 = samples[Math.floor(samples.length * 0.95)];
  const p99 = samples[Math.floor(samples.length * 0.99)];

  return {
    average,
    min,
    max,
    p50,
    p95,
    p99,
    samples,
  };
}

/**
 * Broadcast a message from an instance to all connected clients
 */
export function broadcastFromInstance(
  instance: MockInstance,
  message: any,
  excludeUserId?: string,
): void {
  instance.clients.forEach((clientSet, userId) => {
    if (excludeUserId && userId === excludeUserId) {
      return;
    }

    clientSet.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        try {
          client.send(JSON.stringify(message));
        } catch (error) {
          console.error(`[${instance.id}] Error broadcasting:`, error);
        }
      }
    });
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// UTILITY FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Wait for a condition to be true
 */
export async function waitForCondition(
  condition: () => boolean | Promise<boolean>,
  timeout: number = 5000,
  checkInterval: number = 100,
): Promise<void> {
  const startTime = Date.now();

  return new Promise((resolve, reject) => {
    const check = async () => {
      try {
        const result = await condition();

        if (result) {
          resolve();
        } else if (Date.now() - startTime > timeout) {
          reject(new Error(`Timeout waiting for condition (${timeout}ms)`));
        } else {
          setTimeout(check, checkInterval);
        }
      } catch (error) {
        reject(error);
      }
    };

    check();
  });
}

/**
 * Generate JWT token for testing
 */
export function generateTestToken(
  userId: string,
  jwtSecret: string = "test-jwt-secret",
): string {
  return jwt.sign({ userId }, jwtSecret, { expiresIn: "1h" });
}

/**
 * Get instance statistics
 */
export function getInstanceStats(instance: MockInstance): {
  instanceId: string;
  port: number;
  connectedClients: number;
  totalConnections: number;
  messagesReceived: number;
  messageTypes: Record<string, number>;
} {
  const messageTypes: Record<string, number> = {};

  instance.receivedMessages.forEach((msg) => {
    messageTypes[msg.type] = (messageTypes[msg.type] || 0) + 1;
  });

  return {
    instanceId: instance.id,
    port: instance.port,
    connectedClients: instance.clients.size,
    totalConnections: Array.from(instance.clients.values()).reduce(
      (sum, set) => sum + set.size,
      0,
    ),
    messagesReceived: instance.messageCount,
    messageTypes,
  };
}

/**
 * Clear received messages from clients
 */
export function clearClientMessages(clients: TestClient[]): void {
  clients.forEach((client) => {
    client.receivedMessages.length = 0;
  });
}

/**
 * Clear received messages from instances
 */
export function clearInstanceMessages(instances: MockInstance[]): void {
  instances.forEach((instance) => {
    instance.receivedMessages.length = 0;
    instance.messageCount = 0;
  });
}

/**
 * Wait for all clients to be connected
 */
export async function waitForAllConnected(
  clients: TestClient[],
  timeout: number = 5000,
): Promise<void> {
  return waitForCondition(
    () => clients.every((client) => client.ws.readyState === WebSocket.OPEN),
    timeout,
  );
}

/**
 * Format latency metrics for console output
 */
export function formatLatencyMetrics(metrics: LatencyMetrics): string {
  return `
Cross-Instance Latency Metrics:
  Samples: ${metrics.samples.length}
  Average: ${metrics.average.toFixed(2)}ms
  Min: ${metrics.min}ms
  Max: ${metrics.max}ms
  P50 (Median): ${metrics.p50}ms
  P95: ${metrics.p95}ms
  P99: ${metrics.p99}ms
`.trim();
}
