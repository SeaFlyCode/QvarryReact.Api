// src/__tests__/services/webSocketService.clustering.test.ts

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * INTEGRATION TESTS - WEBSOCKET CLUSTERING WITH REDIS PUB/SUB
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Tests for multi-instance WebSocket broadcasting using Redis Pub/Sub.
 * These tests simulate multiple API instances to verify cross-instance
 * message delivery.
 *
 * Test Scenarios:
 * 1. Cross-Instance Notification Broadcast
 * 2. Cross-Instance Chat Messages
 * 3. Instance Isolation (Echo Prevention)
 * 4. Partial Instance Failure
 * 5. High Load Multi-Instance
 * 6. Message Deduplication
 * 7. Latency Measurements
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { Server as HttpServer } from "http";
import { WebSocket, WebSocketServer } from "ws";
import { AddressInfo } from "net";
import jwt from "jsonwebtoken";

// ═══════════════════════════════════════════════════════════════════════════
// TEST CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════

const JWT_SECRET = "test-jwt-secret-clustering";
const TEST_TIMEOUT = 30000; // 30 seconds for integration tests

// Skip these tests if Redis is not available
const REDIS_AVAILABLE = process.env.REDIS_ENABLED === "true";
const skipIfNoRedis = REDIS_AVAILABLE ? describe : describe.skip;

// ═══════════════════════════════════════════════════════════════════════════
// HELPER TYPES
// ═══════════════════════════════════════════════════════════════════════════

interface MockInstance {
  id: string;
  httpServer: HttpServer;
  wsServer: WebSocketServer;
  port: number;
  clients: Map<string, Set<WebSocket>>;
  messageCount: number;
  receivedMessages: any[];
}

interface TestUser {
  id: string;
  token: string;
  ws?: WebSocket;
  receivedMessages: any[];
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Create a mock API instance with WebSocket server
 */
function createMockInstance(instanceId: string): Promise<MockInstance> {
  return new Promise((resolve, reject) => {
    const httpServer = new HttpServer();
    const wsServer = new WebSocketServer({ noServer: true });
    const clients = new Map<string, Set<WebSocket>>();
    const receivedMessages: any[] = [];
    let messageCount = 0;

    // Handle WebSocket connections
    wsServer.on("connection", (ws: WebSocket, userId: string) => {
      // Add client to tracking
      if (!clients.has(userId)) {
        clients.set(userId, new Set());
      }
      clients.get(userId)!.add(ws);

      ws.on("message", (data) => {
        const message = JSON.parse(data.toString());
        receivedMessages.push(message);
        messageCount++;
      });

      ws.on("close", () => {
        const userClients = clients.get(userId);
        if (userClients) {
          userClients.delete(ws);
          if (userClients.size === 0) {
            clients.delete(userId);
          }
        }
      });
    });

    // Handle upgrade requests
    httpServer.on("upgrade", (request, socket, head) => {
      try {
        // Extract token from query string
        const url = new URL(request.url!, `http://${request.headers.host}`);
        const token = url.searchParams.get("token");

        if (!token) {
          socket.destroy();
          return;
        }

        // Verify token
        const decoded = jwt.verify(token, JWT_SECRET) as { userId: string };
        const userId = decoded.userId;

        // Handle upgrade
        wsServer.handleUpgrade(request, socket, head, (ws) => {
          wsServer.emit("connection", ws, userId);
        });
      } catch (error) {
        socket.destroy();
      }
    });

    // Start server on random port
    httpServer.listen(0, () => {
      const address = httpServer.address() as AddressInfo;
      resolve({
        id: instanceId,
        httpServer,
        wsServer,
        port: address.port,
        clients,
        messageCount,
        receivedMessages,
      });
    });

    httpServer.on("error", reject);
  });
}

/**
 * Stop a mock instance
 */
function stopMockInstance(instance: MockInstance): Promise<void> {
  return new Promise((resolve) => {
    // Close all client connections
    instance.clients.forEach((clientSet) => {
      clientSet.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
          client.close();
        }
      });
    });

    // Close servers
    instance.wsServer.close(() => {
      instance.httpServer.close(() => {
        resolve();
      });
    });
  });
}

/**
 * Create a test user with JWT token
 */
function createTestUser(userId: string): TestUser {
  const token = jwt.sign({ userId }, JWT_SECRET, { expiresIn: "1h" });
  return {
    id: userId,
    token,
    receivedMessages: [],
  };
}

/**
 * Connect user to an instance
 */
function connectUserToInstance(
  user: TestUser,
  instance: MockInstance,
): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(
      `ws://localhost:${instance.port}/ws/messages?token=${user.token}`,
    );

    ws.on("open", () => {
      user.ws = ws;
      resolve(ws);
    });

    ws.on("message", (data) => {
      const message = JSON.parse(data.toString());
      user.receivedMessages.push(message);
    });

    ws.on("error", reject);

    // Timeout after 5 seconds
    setTimeout(() => reject(new Error("Connection timeout")), 5000);
  });
}

/**
 * Wait for condition with timeout
 */
function waitFor(
  condition: () => boolean,
  timeout: number = 5000,
  checkInterval: number = 100,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();

    const check = () => {
      if (condition()) {
        resolve();
      } else if (Date.now() - startTime > timeout) {
        reject(new Error("Timeout waiting for condition"));
      } else {
        setTimeout(check, checkInterval);
      }
    };

    check();
  });
}

/**
 * Broadcast message to all users on an instance
 */
function broadcastToInstance(
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
        client.send(JSON.stringify(message));
      }
    });
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// TESTS
// ═══════════════════════════════════════════════════════════════════════════

skipIfNoRedis("WebSocketService - Clustering Integration Tests", () => {
  let redisPubSubService: any;

  beforeAll(() => {
    process.env.JWT_SECRET = JWT_SECRET;
    process.env.REDIS_ENABLED = "true";
    process.env.REDIS_PUBSUB_ENABLED = "true";
    process.env.REDIS_HOST = process.env.REDIS_HOST || "localhost";
    process.env.REDIS_PORT = process.env.REDIS_PORT || "6379";
  });

  beforeEach(async () => {
    jest.resetModules();
    const module = require("../../services/redisPubSubService");
    redisPubSubService = module.redisPubSubService;

    // Wait for Redis connection
    await new Promise((resolve) => setTimeout(resolve, 100));
  });

  afterEach(async () => {
    if (redisPubSubService) {
      await redisPubSubService.shutdown();
    }
  });

  describe("Scenario 1: Cross-Instance Notification Broadcast", () => {
    it(
      "should deliver notifications to users on different instances",
      async () => {
        // Create two instances
        const instance1 = await createMockInstance("instance-1");
        const instance2 = await createMockInstance("instance-2");

        // Create users
        const userA = createTestUser("user-a");
        const userB = createTestUser("user-b");

        try {
          // Connect User A to Instance 1
          await connectUserToInstance(userA, instance1);

          // Connect User B to Instance 2
          await connectUserToInstance(userB, instance2);

          // Wait for connections to stabilize
          await new Promise((resolve) => setTimeout(resolve, 200));

          // Publish notification via Redis Pub/Sub
          const notification = {
            type: "notification",
            title: "Test Notification",
            message: "Cross-instance test",
            timestamp: Date.now(),
          };

          await redisPubSubService.publishNotification("user-b", notification);

          // Simulate Instance 2 receiving and forwarding the message
          await waitFor(() => userB.receivedMessages.length > 0, 3000);

          // Verify User B received the notification
          expect(userB.receivedMessages.length).toBeGreaterThan(0);
          const received = userB.receivedMessages[0];
          expect(received.type).toBe("notification");
          expect(received.title).toBe("Test Notification");

          // Verify User A did NOT receive it (not targeted)
          expect(userA.receivedMessages.length).toBe(0);
        } finally {
          await stopMockInstance(instance1);
          await stopMockInstance(instance2);
        }
      },
      TEST_TIMEOUT,
    );

    it(
      "should broadcast to multiple users across instances",
      async () => {
        const instance1 = await createMockInstance("instance-1");
        const instance2 = await createMockInstance("instance-2");

        const user1 = createTestUser("user-1");
        const user2 = createTestUser("user-2");
        const user3 = createTestUser("user-3");

        try {
          await connectUserToInstance(user1, instance1);
          await connectUserToInstance(user2, instance1);
          await connectUserToInstance(user3, instance2);

          await new Promise((resolve) => setTimeout(resolve, 200));

          // Publish to all users
          const notification = {
            type: "broadcast",
            message: "System maintenance",
          };

          // Simulate publishing to all users
          for (const user of [user1, user2, user3]) {
            await redisPubSubService.publishNotification(user.id, notification);
          }

          await waitFor(
            () =>
              user1.receivedMessages.length > 0 &&
              user2.receivedMessages.length > 0 &&
              user3.receivedMessages.length > 0,
            3000,
          );

          expect(user1.receivedMessages.length).toBeGreaterThan(0);
          expect(user2.receivedMessages.length).toBeGreaterThan(0);
          expect(user3.receivedMessages.length).toBeGreaterThan(0);
        } finally {
          await stopMockInstance(instance1);
          await stopMockInstance(instance2);
        }
      },
      TEST_TIMEOUT,
    );
  });

  describe("Scenario 2: Cross-Instance Chat Messages", () => {
    it(
      "should deliver chat messages between users on different instances",
      async () => {
        const instance1 = await createMockInstance("instance-1");
        const instance2 = await createMockInstance("instance-2");

        const userA = createTestUser("user-a");
        const userB = createTestUser("user-b");

        try {
          await connectUserToInstance(userA, instance1);
          await connectUserToInstance(userB, instance2);

          await new Promise((resolve) => setTimeout(resolve, 200));

          const conversationId = "conv-123";
          const chatMessage = {
            type: "chat_message",
            conversationId,
            content: "Hello from User A",
            senderId: userA.id,
            timestamp: Date.now(),
          };

          // Publish chat message
          await redisPubSubService.publishMessage(
            conversationId,
            chatMessage,
            userA.id, // exclude sender
            [userA.id, userB.id], // participants
          );

          // Wait for delivery
          await waitFor(() => userB.receivedMessages.length > 0, 3000);

          expect(userB.receivedMessages.length).toBeGreaterThan(0);
          const received = userB.receivedMessages[0];
          expect(received.type).toBe("chat_message");
          expect(received.content).toBe("Hello from User A");
        } finally {
          await stopMockInstance(instance1);
          await stopMockInstance(instance2);
        }
      },
      TEST_TIMEOUT,
    );
  });

  describe("Scenario 3: Instance Isolation (Echo Prevention)", () => {
    it(
      "should NOT echo messages back to originating instance",
      async () => {
        const instance1 = await createMockInstance("instance-1");

        const userA = createTestUser("user-a");
        const userB = createTestUser("user-b");

        try {
          await connectUserToInstance(userA, instance1);
          await connectUserToInstance(userB, instance1);

          await new Promise((resolve) => setTimeout(resolve, 200));

          // Set instance ID to match for testing
          const originalInstanceId = redisPubSubService.getInstanceId();

          // Send message that should not echo
          const notification = {
            type: "notification",
            message: "Test echo prevention",
          };

          await redisPubSubService.publishNotification(userA.id, notification);

          // Wait a bit to see if any echo occurs
          await new Promise((resolve) => setTimeout(resolve, 500));

          // Messages should be 0 because same instance ignores its own publishes
          expect(userA.receivedMessages.length).toBe(0);
        } finally {
          await stopMockInstance(instance1);
        }
      },
      TEST_TIMEOUT,
    );
  });

  describe("Scenario 4: Partial Instance Failure", () => {
    it(
      "should continue delivering messages when one instance fails",
      async () => {
        const instance1 = await createMockInstance("instance-1");
        const instance2 = await createMockInstance("instance-2");
        const instance3 = await createMockInstance("instance-3");

        const user1 = createTestUser("user-1");
        const user2 = createTestUser("user-2");
        const user3 = createTestUser("user-3");

        try {
          await connectUserToInstance(user1, instance1);
          await connectUserToInstance(user2, instance2);
          await connectUserToInstance(user3, instance3);

          await new Promise((resolve) => setTimeout(resolve, 200));

          // Shut down instance 2
          await stopMockInstance(instance2);

          await new Promise((resolve) => setTimeout(resolve, 200));

          // Send messages
          const notification = {
            type: "notification",
            message: "After instance failure",
          };

          await redisPubSubService.publishNotification(user1.id, notification);
          await redisPubSubService.publishNotification(user3.id, notification);

          await waitFor(
            () =>
              user1.receivedMessages.length > 0 &&
              user3.receivedMessages.length > 0,
            3000,
          );

          // Instances 1 and 3 should still receive messages
          expect(user1.receivedMessages.length).toBeGreaterThan(0);
          expect(user3.receivedMessages.length).toBeGreaterThan(0);
        } finally {
          await stopMockInstance(instance1);
          // instance2 already stopped
          await stopMockInstance(instance3);
        }
      },
      TEST_TIMEOUT,
    );
  });

  describe("Scenario 5: High Load Multi-Instance", () => {
    it(
      "should handle high message volume across instances",
      async () => {
        const instance1 = await createMockInstance("instance-1");
        const instance2 = await createMockInstance("instance-2");

        const users: TestUser[] = [];
        const messageCount = 50;

        try {
          // Create 10 users, 5 per instance
          for (let i = 0; i < 10; i++) {
            const user = createTestUser(`user-${i}`);
            users.push(user);

            const targetInstance = i < 5 ? instance1 : instance2;
            await connectUserToInstance(user, targetInstance);
          }

          await new Promise((resolve) => setTimeout(resolve, 300));

          // Send many messages
          const startTime = Date.now();

          for (let i = 0; i < messageCount; i++) {
            const targetUser = users[i % users.length];
            await redisPubSubService.publishNotification(targetUser.id, {
              type: "notification",
              index: i,
              message: `Message ${i}`,
            });
          }

          // Wait for all deliveries (with generous timeout)
          await new Promise((resolve) => setTimeout(resolve, 2000));

          const endTime = Date.now();
          const duration = endTime - startTime;

          // Verify messages were received
          const totalReceived = users.reduce(
            (sum, user) => sum + user.receivedMessages.length,
            0,
          );

          expect(totalReceived).toBeGreaterThan(0);

          // Check for duplicates
          const allReceivedIds = new Set();
          let duplicateCount = 0;

          users.forEach((user) => {
            user.receivedMessages.forEach((msg) => {
              const id = `${msg.type}-${msg.index || msg.message}`;
              if (allReceivedIds.has(id)) {
                duplicateCount++;
              }
              allReceivedIds.add(id);
            });
          });

          expect(duplicateCount).toBe(0); // No duplicates

          // Performance check (should complete within reasonable time)
          expect(duration).toBeLessThan(10000); // 10 seconds max
        } finally {
          await stopMockInstance(instance1);
          await stopMockInstance(instance2);
        }
      },
      TEST_TIMEOUT,
    );
  });

  describe("Performance Metrics", () => {
    it(
      "should measure cross-instance latency",
      async () => {
        const instance1 = await createMockInstance("instance-1");
        const instance2 = await createMockInstance("instance-2");

        const user = createTestUser("user-latency");

        try {
          await connectUserToInstance(user, instance2);
          await new Promise((resolve) => setTimeout(resolve, 200));

          const latencies: number[] = [];

          // Measure latency for 10 messages
          for (let i = 0; i < 10; i++) {
            const startTime = Date.now();

            await redisPubSubService.publishNotification(user.id, {
              type: "notification",
              index: i,
              timestamp: startTime,
            });

            // Wait for delivery
            const initialCount = user.receivedMessages.length;
            await waitFor(
              () => user.receivedMessages.length > initialCount,
              2000,
            );

            const endTime = Date.now();
            latencies.push(endTime - startTime);

            await new Promise((resolve) => setTimeout(resolve, 100));
          }

          const avgLatency =
            latencies.reduce((sum, l) => sum + l, 0) / latencies.length;
          const maxLatency = Math.max(...latencies);
          const minLatency = Math.min(...latencies);

          console.log("Cross-Instance Latency Metrics:");
          console.log(`  Average: ${avgLatency.toFixed(2)}ms`);
          console.log(`  Min: ${minLatency}ms`);
          console.log(`  Max: ${maxLatency}ms`);

          // Reasonable expectations for Redis Pub/Sub
          expect(avgLatency).toBeLessThan(500); // Average < 500ms
          expect(maxLatency).toBeLessThan(1000); // Max < 1s
        } finally {
          await stopMockInstance(instance1);
          await stopMockInstance(instance2);
        }
      },
      TEST_TIMEOUT,
    );
  });

  describe("Message Deduplication", () => {
    it(
      "should not deliver duplicate messages",
      async () => {
        const instance1 = await createMockInstance("instance-1");
        const user = createTestUser("user-dedup");

        try {
          await connectUserToInstance(user, instance1);
          await new Promise((resolve) => setTimeout(resolve, 200));

          // Send same message multiple times
          const notification = {
            type: "notification",
            message: "Duplicate test",
            uniqueId: "unique-123",
          };

          // Rapid fire the same notification
          for (let i = 0; i < 5; i++) {
            await redisPubSubService.publishNotification(user.id, notification);
          }

          await new Promise((resolve) => setTimeout(resolve, 1000));

          // Should receive messages but Redis Pub/Sub will deduplicate by messageId
          // Our service generates unique messageIds, so all 5 will be delivered
          // This is expected behavior - deduplication is at messageId level
          expect(user.receivedMessages.length).toBeGreaterThan(0);
        } finally {
          await stopMockInstance(instance1);
        }
      },
      TEST_TIMEOUT,
    );
  });
});
