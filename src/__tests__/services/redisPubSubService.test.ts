// src/__tests__/services/redisPubSubService.test.ts

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * UNIT TESTS - REDIS PUB/SUB SERVICE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Tests for Redis Pub/Sub service used in WebSocket clustering.
 * These are isolated unit tests using mocked Redis clients.
 *
 * Test Coverage:
 * - Service initialization
 * - Channel subscription/unsubscription
 * - Message publishing
 * - Message handler invocation
 * - Echo prevention (instance isolation)
 * - Reconnection logic
 * - Error handling
 * - Message deduplication
 * - Metrics tracking
 * ═══════════════════════════════════════════════════════════════════════════
 */

/// <reference types="jest" />

import { EventEmitter } from "events";

// ═══════════════════════════════════════════════════════════════════════════
// MOCKS
// ═══════════════════════════════════════════════════════════════════════════

class MockRedis extends EventEmitter {
  connected: boolean = false;
  subscriptions: Set<string> = new Set();
  publishedMessages: Array<{ channel: string; message: string }> = [];

  async connect() {
    this.connected = true;
    setTimeout(() => {
      this.emit("connect");
      this.emit("ready");
    }, 10);
    return this;
  }

  async subscribe(channel: string) {
    if (!this.connected) {
      throw new Error("Redis client not connected");
    }
    this.subscriptions.add(channel);
    return 1;
  }

  async unsubscribe(channel: string) {
    this.subscriptions.delete(channel);
    return 1;
  }

  async publish(channel: string, message: string) {
    if (!this.connected) {
      throw new Error("Redis client not connected");
    }
    this.publishedMessages.push({ channel, message });
    return 1;
  }

  async quit() {
    this.connected = false;
    this.emit("close");
    return "OK";
  }

  // Simulate receiving a message
  simulateMessage(channel: string, message: string) {
    this.emit("message", channel, message);
  }

  // Simulate error
  simulateError(error: Error) {
    this.emit("error", error);
  }

  // Simulate reconnection
  simulateReconnect() {
    this.emit("reconnecting");
  }
}

// Mock ioredis
jest.mock("ioredis", () => {
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => new MockRedis()),
    Cluster: jest.fn().mockImplementation(() => new MockRedis()),
  };
});

// Mock logger
jest.mock("../../services/loggerService", () => ({
  logger: {
    child: () => ({
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    }),
  },
}));

// ═══════════════════════════════════════════════════════════════════════════
// TESTS
// ═══════════════════════════════════════════════════════════════════════════

describe("RedisPubSubService - Unit Tests", () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeAll(() => {
    originalEnv = { ...process.env };
  });

  beforeEach(() => {
    // Reset environment for each test
    process.env = { ...originalEnv };
    process.env.REDIS_ENABLED = "true";
    process.env.REDIS_PUBSUB_ENABLED = "true";
    process.env.REDIS_HOST = "localhost";
    process.env.REDIS_PORT = "6379";

    // Clear module cache to get fresh instance
    jest.resetModules();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("Service Initialization", () => {
    it("should initialize with pub/sub enabled", async () => {
      const {
        redisPubSubService,
      } = require("../../services/redisPubSubService");

      // Wait for async initialization
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(redisPubSubService).toBeDefined();
      expect(redisPubSubService.getInstanceId()).toBeTruthy();
      expect(typeof redisPubSubService.getInstanceId()).toBe("string");
    });

    it("should initialize in disabled mode when REDIS_ENABLED is false", async () => {
      process.env.REDIS_ENABLED = "false";

      const {
        redisPubSubService,
      } = require("../../services/redisPubSubService");

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(redisPubSubService.isEnabled()).toBe(false);
    });

    it("should initialize in disabled mode when REDIS_PUBSUB_ENABLED is false", async () => {
      process.env.REDIS_PUBSUB_ENABLED = "false";

      const {
        redisPubSubService,
      } = require("../../services/redisPubSubService");

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(redisPubSubService.isEnabled()).toBe(false);
    });

    it("should generate unique instance IDs", () => {
      const {
        redisPubSubService: service1,
      } = require("../../services/redisPubSubService");

      jest.resetModules();

      const {
        redisPubSubService: service2,
      } = require("../../services/redisPubSubService");

      expect(service1.getInstanceId()).not.toBe(service2.getInstanceId());
    });

    it("should include hostname in instance ID", () => {
      const {
        redisPubSubService,
      } = require("../../services/redisPubSubService");

      const instanceId = redisPubSubService.getInstanceId();
      expect(instanceId).toContain("-"); // Format: hostname-randomhex
      expect(instanceId.length).toBeGreaterThan(10);
    });
  });

  describe("Channel Subscription", () => {
    it("should subscribe to a channel successfully", async () => {
      const {
        redisPubSubService,
      } = require("../../services/redisPubSubService");

      await new Promise((resolve) => setTimeout(resolve, 50));

      const handler = jest.fn();
      await redisPubSubService.subscribe("test:channel", handler);

      const metrics = redisPubSubService.getMetrics();
      expect(metrics.subscribedChannels).toBeGreaterThanOrEqual(1);
    });

    it("should handle multiple handlers for same channel", async () => {
      const {
        redisPubSubService,
      } = require("../../services/redisPubSubService");

      await new Promise((resolve) => setTimeout(resolve, 50));

      const handler1 = jest.fn();
      const handler2 = jest.fn();
      const handler3 = jest.fn();

      await redisPubSubService.subscribe("test:channel", handler1);
      await redisPubSubService.subscribe("test:channel", handler2);
      await redisPubSubService.subscribe("test:channel", handler3);

      const metrics = redisPubSubService.getMetrics();
      expect(metrics.subscribedChannels).toBeGreaterThanOrEqual(1);
    });

    it("should handle subscription when service is disabled", async () => {
      process.env.REDIS_ENABLED = "false";

      const {
        redisPubSubService,
      } = require("../../services/redisPubSubService");

      const handler = jest.fn();
      await expect(
        redisPubSubService.subscribe("test:channel", handler),
      ).resolves.not.toThrow();
    });

    it("should subscribe to multiple different channels", async () => {
      const {
        redisPubSubService,
      } = require("../../services/redisPubSubService");

      await new Promise((resolve) => setTimeout(resolve, 50));

      const handler1 = jest.fn();
      const handler2 = jest.fn();
      const handler3 = jest.fn();

      await redisPubSubService.subscribe("channel:1", handler1);
      await redisPubSubService.subscribe("channel:2", handler2);
      await redisPubSubService.subscribe("channel:3", handler3);

      const metrics = redisPubSubService.getMetrics();
      expect(metrics.subscribedChannels).toBeGreaterThanOrEqual(3);
    });
  });

  describe("Channel Unsubscription", () => {
    it("should unsubscribe specific handler from channel", async () => {
      const {
        redisPubSubService,
      } = require("../../services/redisPubSubService");

      await new Promise((resolve) => setTimeout(resolve, 50));

      const handler1 = jest.fn();
      const handler2 = jest.fn();

      await redisPubSubService.subscribe("test:channel", handler1);
      await redisPubSubService.subscribe("test:channel", handler2);

      await redisPubSubService.unsubscribe("test:channel", handler1);

      // Should still have handler2
      const metrics = redisPubSubService.getMetrics();
      expect(metrics.subscribedChannels).toBeGreaterThanOrEqual(1);
    });

    it("should unsubscribe all handlers from channel", async () => {
      const {
        redisPubSubService,
      } = require("../../services/redisPubSubService");

      await new Promise((resolve) => setTimeout(resolve, 50));

      const handler1 = jest.fn();
      const handler2 = jest.fn();

      await redisPubSubService.subscribe("test:channel", handler1);
      await redisPubSubService.subscribe("test:channel", handler2);

      // Unsubscribe without specific handler removes all
      await redisPubSubService.unsubscribe("test:channel");

      const metrics = redisPubSubService.getMetrics();
      // Channel should be removed when all handlers are gone
      expect(metrics.subscribedChannels).toBe(0);
    });

    it("should handle unsubscribe from non-existent channel", async () => {
      const {
        redisPubSubService,
      } = require("../../services/redisPubSubService");

      await new Promise((resolve) => setTimeout(resolve, 50));

      await expect(
        redisPubSubService.unsubscribe("non:existent:channel"),
      ).resolves.not.toThrow();
    });

    it("should handle unsubscribe when service is disabled", async () => {
      process.env.REDIS_ENABLED = "false";

      const {
        redisPubSubService,
      } = require("../../services/redisPubSubService");

      await expect(
        redisPubSubService.unsubscribe("test:channel"),
      ).resolves.not.toThrow();
    });
  });

  describe("Message Publishing", () => {
    it("should publish notification message successfully", async () => {
      const {
        redisPubSubService,
      } = require("../../services/redisPubSubService");

      await new Promise((resolve) => setTimeout(resolve, 50));

      const result = await redisPubSubService.publishNotification("user123", {
        title: "Test",
        message: "Test notification",
      });

      expect(result).toBe(true);

      const metrics = redisPubSubService.getMetrics();
      expect(metrics.published).toBeGreaterThanOrEqual(1);
    });

    it("should publish chat message successfully", async () => {
      const {
        redisPubSubService,
      } = require("../../services/redisPubSubService");

      await new Promise((resolve) => setTimeout(resolve, 50));

      const result = await redisPubSubService.publishMessage(
        "conv123",
        { content: "Hello" },
        "sender123",
        ["user1", "user2"],
      );

      expect(result).toBe(true);

      const metrics = redisPubSubService.getMetrics();
      expect(metrics.published).toBeGreaterThanOrEqual(1);
    });

    it("should publish broadcast message successfully", async () => {
      const {
        redisPubSubService,
      } = require("../../services/redisPubSubService");

      await new Promise((resolve) => setTimeout(resolve, 50));

      const result = await redisPubSubService.publishBroadcast(
        "system:update",
        {
          version: "1.0.0",
        },
      );

      expect(result).toBe(true);

      const metrics = redisPubSubService.getMetrics();
      expect(metrics.published).toBeGreaterThanOrEqual(1);
    });

    it("should return false when publishing with service disabled", async () => {
      process.env.REDIS_ENABLED = "false";

      const {
        redisPubSubService,
      } = require("../../services/redisPubSubService");

      const result = await redisPubSubService.publishNotification("user123", {
        title: "Test",
      });

      expect(result).toBe(false);
    });

    it("should include instance ID in published messages", async () => {
      const Redis = require("ioredis").default;
      const mockRedis = new MockRedis();
      Redis.mockImplementation(() => mockRedis);

      jest.resetModules();
      const {
        redisPubSubService,
      } = require("../../services/redisPubSubService");

      await new Promise((resolve) => setTimeout(resolve, 50));
      await redisPubSubService.publishNotification("user123", { test: true });

      expect(mockRedis.publishedMessages.length).toBeGreaterThan(0);

      const published = mockRedis.publishedMessages[0];
      const message = JSON.parse(published.message);

      expect(message).toHaveProperty("instanceId");
      expect(message).toHaveProperty("messageId");
      expect(message).toHaveProperty("timestamp");
      expect(message).toHaveProperty("payload");
    });
  });

  describe("Message Handling and Echo Prevention", () => {
    it("should invoke handler when receiving message from different instance", async () => {
      const Redis = require("ioredis").default;
      const mockSubscriber = new MockRedis();
      Redis.mockImplementation(() => mockSubscriber);

      jest.resetModules();
      const {
        redisPubSubService,
      } = require("../../services/redisPubSubService");

      await new Promise((resolve) => setTimeout(resolve, 50));

      const handler = jest.fn();

      await redisPubSubService.subscribe("websocket:notifications", handler);

      // Simulate message from different instance
      const message = {
        instanceId: "different-instance-id",
        messageId: "msg-123",
        timestamp: Date.now(),
        payload: {
          userId: "user123",
          notification: { title: "Test" },
        },
      };

      mockSubscriber.simulateMessage(
        "websocket:notifications",
        JSON.stringify(message),
      );

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith({
        userId: "user123",
        notification: { title: "Test" },
      });
    });

    it("should NOT invoke handler for own instance messages (echo prevention)", async () => {
      const Redis = require("ioredis").default;
      const mockSubscriber = new MockRedis();
      Redis.mockImplementation(() => mockSubscriber);

      jest.resetModules();
      const {
        redisPubSubService,
      } = require("../../services/redisPubSubService");

      await new Promise((resolve) => setTimeout(resolve, 50));

      const handler = jest.fn();
      await redisPubSubService.subscribe("websocket:notifications", handler);

      // Simulate message from own instance
      const message = {
        instanceId: redisPubSubService.getInstanceId(),
        messageId: "msg-123",
        timestamp: Date.now(),
        payload: {
          userId: "user123",
          notification: { title: "Test" },
        },
      };

      mockSubscriber.simulateMessage(
        "websocket:notifications",
        JSON.stringify(message),
      );

      // Wait a bit for any potential handler invocation
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(handler).not.toHaveBeenCalled();
    });

    it("should invoke all registered handlers for a channel", async () => {
      const Redis = require("ioredis").default;
      const mockSubscriber = new MockRedis();
      Redis.mockImplementation(() => mockSubscriber);

      jest.resetModules();
      const {
        redisPubSubService,
      } = require("../../services/redisPubSubService");

      await new Promise((resolve) => setTimeout(resolve, 50));

      const handler1 = jest.fn();
      const handler2 = jest.fn();
      const handler3 = jest.fn();

      await redisPubSubService.subscribe("test:channel", handler1);
      await redisPubSubService.subscribe("test:channel", handler2);
      await redisPubSubService.subscribe("test:channel", handler3);

      const message = {
        instanceId: "different-instance",
        messageId: "msg-123",
        timestamp: Date.now(),
        payload: { test: true },
      };

      mockSubscriber.simulateMessage("test:channel", JSON.stringify(message));

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(handler1).toHaveBeenCalledWith({ test: true });
      expect(handler2).toHaveBeenCalledWith({ test: true });
      expect(handler3).toHaveBeenCalledWith({ test: true });
    });

    it("should deduplicate messages with same messageId", async () => {
      const Redis = require("ioredis").default;
      const mockSubscriber = new MockRedis();
      Redis.mockImplementation(() => mockSubscriber);

      jest.resetModules();
      const {
        redisPubSubService,
      } = require("../../services/redisPubSubService");

      await new Promise((resolve) => setTimeout(resolve, 50));

      const handler = jest.fn();
      await redisPubSubService.subscribe("test:channel", handler);

      const message = {
        instanceId: "different-instance",
        messageId: "duplicate-msg-id",
        timestamp: Date.now(),
        payload: { test: true },
      };

      // Send same message multiple times
      mockSubscriber.simulateMessage("test:channel", JSON.stringify(message));
      mockSubscriber.simulateMessage("test:channel", JSON.stringify(message));
      mockSubscriber.simulateMessage("test:channel", JSON.stringify(message));

      await new Promise((resolve) => setTimeout(resolve, 50));

      // Should only be called once due to deduplication
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it("should handle malformed messages gracefully", async () => {
      const Redis = require("ioredis").default;
      const mockSubscriber = new MockRedis();
      Redis.mockImplementation(() => mockSubscriber);

      jest.resetModules();
      const {
        redisPubSubService,
      } = require("../../services/redisPubSubService");

      await new Promise((resolve) => setTimeout(resolve, 50));

      const handler = jest.fn();
      await redisPubSubService.subscribe("test:channel", handler);

      // Send malformed JSON
      mockSubscriber.simulateMessage("test:channel", "invalid json {{{");

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(handler).not.toHaveBeenCalled();

      const metrics = redisPubSubService.getMetrics();
      expect(metrics.errors).toBeGreaterThan(0);
    });
  });

  describe("Error Handling", () => {
    it("should handle Redis connection errors", async () => {
      const Redis = require("ioredis").default;
      const mockRedis = new MockRedis();
      Redis.mockImplementation(() => mockRedis);

      jest.resetModules();
      const {
        redisPubSubService,
      } = require("../../services/redisPubSubService");

      await new Promise((resolve) => setTimeout(resolve, 50));

      mockRedis.simulateError(new Error("Connection lost"));

      await new Promise((resolve) => setTimeout(resolve, 50));

      const metrics = redisPubSubService.getMetrics();
      expect(metrics.errors).toBeGreaterThan(0);
    });

    it("should handle handler exceptions without crashing", async () => {
      const Redis = require("ioredis").default;
      const mockSubscriber = new MockRedis();
      Redis.mockImplementation(() => mockSubscriber);

      jest.resetModules();
      const {
        redisPubSubService,
      } = require("../../services/redisPubSubService");

      await new Promise((resolve) => setTimeout(resolve, 50));

      const faultyHandler = jest.fn(() => {
        throw new Error("Handler error");
      });
      const goodHandler = jest.fn();

      await redisPubSubService.subscribe("test:channel", faultyHandler);
      await redisPubSubService.subscribe("test:channel", goodHandler);

      const message = {
        instanceId: "different-instance",
        messageId: "msg-123",
        timestamp: Date.now(),
        payload: { test: true },
      };

      mockSubscriber.simulateMessage("test:channel", JSON.stringify(message));

      await new Promise((resolve) => setTimeout(resolve, 50));

      // Both handlers should be called despite first one throwing
      expect(faultyHandler).toHaveBeenCalled();
      expect(goodHandler).toHaveBeenCalled();
    });
  });

  describe("Metrics and Status", () => {
    it("should track published message count", async () => {
      const {
        redisPubSubService,
      } = require("../../services/redisPubSubService");

      await new Promise((resolve) => setTimeout(resolve, 50));

      const initialMetrics = redisPubSubService.getMetrics();
      const initialCount = initialMetrics.published;

      await redisPubSubService.publishNotification("user1", { test: 1 });
      await redisPubSubService.publishNotification("user2", { test: 2 });
      await redisPubSubService.publishMessage("conv1", { msg: 1 });

      const finalMetrics = redisPubSubService.getMetrics();
      expect(finalMetrics.published).toBe(initialCount + 3);
    });

    it("should track received message count", async () => {
      const Redis = require("ioredis").default;
      const mockSubscriber = new MockRedis();
      Redis.mockImplementation(() => mockSubscriber);

      jest.resetModules();
      const {
        redisPubSubService,
      } = require("../../services/redisPubSubService");

      await new Promise((resolve) => setTimeout(resolve, 50));

      const handler = jest.fn();
      await redisPubSubService.subscribe("test:channel", handler);

      const initialMetrics = redisPubSubService.getMetrics();
      const initialCount = initialMetrics.received;

      // Simulate multiple messages
      for (let i = 0; i < 5; i++) {
        const message = {
          instanceId: "different-instance",
          messageId: `msg-${i}`,
          timestamp: Date.now(),
          payload: { index: i },
        };
        mockSubscriber.simulateMessage("test:channel", JSON.stringify(message));
      }

      await new Promise((resolve) => setTimeout(resolve, 50));

      const finalMetrics = redisPubSubService.getMetrics();
      expect(finalMetrics.received).toBe(initialCount + 5);
    });

    it("should track error count", async () => {
      const Redis = require("ioredis").default;
      const mockRedis = new MockRedis();
      Redis.mockImplementation(() => mockRedis);

      jest.resetModules();
      const {
        redisPubSubService,
      } = require("../../services/redisPubSubService");

      await new Promise((resolve) => setTimeout(resolve, 50));

      const initialMetrics = redisPubSubService.getMetrics();
      const initialErrors = initialMetrics.errors;

      mockRedis.simulateError(new Error("Error 1"));
      mockRedis.simulateError(new Error("Error 2"));

      await new Promise((resolve) => setTimeout(resolve, 50));

      const finalMetrics = redisPubSubService.getMetrics();
      expect(finalMetrics.errors).toBeGreaterThan(initialErrors);
    });

    it("should return complete metrics object", async () => {
      const {
        redisPubSubService,
      } = require("../../services/redisPubSubService");

      await new Promise((resolve) => setTimeout(resolve, 50));

      const metrics = redisPubSubService.getMetrics();

      expect(metrics).toHaveProperty("instanceId");
      expect(metrics).toHaveProperty("enabled");
      expect(metrics).toHaveProperty("connected");
      expect(metrics).toHaveProperty("published");
      expect(metrics).toHaveProperty("received");
      expect(metrics).toHaveProperty("errors");
      expect(metrics).toHaveProperty("subscribedChannels");
      expect(metrics).toHaveProperty("reconnectAttempts");
    });
  });

  describe("Shutdown and Cleanup", () => {
    it("should shutdown cleanly", async () => {
      const {
        redisPubSubService,
      } = require("../../services/redisPubSubService");

      await new Promise((resolve) => setTimeout(resolve, 50));

      await expect(redisPubSubService.shutdown()).resolves.not.toThrow();

      const metrics = redisPubSubService.getMetrics();
      expect(metrics.connected).toBe(false);
    });

    it("should clear all subscriptions on shutdown", async () => {
      const {
        redisPubSubService,
      } = require("../../services/redisPubSubService");

      await new Promise((resolve) => setTimeout(resolve, 50));

      await redisPubSubService.subscribe("channel:1", jest.fn());
      await redisPubSubService.subscribe("channel:2", jest.fn());
      await redisPubSubService.subscribe("channel:3", jest.fn());

      await redisPubSubService.shutdown();

      const metrics = redisPubSubService.getMetrics();
      expect(metrics.subscribedChannels).toBe(0);
    });
  });

  describe("Reconnection Logic", () => {
    it("should track reconnection attempts", async () => {
      const Redis = require("ioredis").default;
      const mockRedis = new MockRedis();
      Redis.mockImplementation(() => mockRedis);

      jest.resetModules();
      const {
        redisPubSubService,
      } = require("../../services/redisPubSubService");

      await new Promise((resolve) => setTimeout(resolve, 50));

      const initialMetrics = redisPubSubService.getMetrics();
      const initialAttempts = initialMetrics.reconnectAttempts;

      mockRedis.simulateReconnect();

      await new Promise((resolve) => setTimeout(resolve, 50));

      const finalMetrics = redisPubSubService.getMetrics();
      expect(finalMetrics.reconnectAttempts).toBeGreaterThan(initialAttempts);
    });
  });
});
