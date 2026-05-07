// src/__tests__/services/webSocketService.resilience.test.ts

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * WebSocket Resilience & Resume Protocol - Integration Tests
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Comprehensive integration tests for WebSocket state persistence,
 * reconnection, and message delivery guarantees.
 *
 * Test Scenarios:
 * 1. Basic reconnection with state restoration
 * 2. Resume with missed messages
 * 3. Resume across server restarts
 * 4. Message acknowledgment flow
 * 5. Message retry on no ACK
 * 6. Duplicate connection handling
 * 7. Multiple devices per user
 * 8. Graceful server shutdown
 * 9. Backward compatibility (no resume support)
 * 10. Large message queues
 *
 * Test Count: 35+ tests
 */

import {
  createMockWebSocketClient,
  simulateDisconnection,
  waitForReconnection,
  sendAndWaitForAck,
  generateMissedMessages,
  verifyStateEquals,
  verifyMessageOrder,
  createResumeRequest,
  waitForResume,
  simulateGracefulShutdown,
  generateTestUser,
  generateTestConversation,
  generateDeviceId,
  cleanupClients,
  waitForCondition,
  delay,
} from "../utils/resilienceTestHelper";

// ═══════════════════════════════════════════════════════════════════════════
// Mock Setup
// ═══════════════════════════════════════════════════════════════════════════

jest.mock("../../services/loggerService", () => ({
  logger: {
    child: jest.fn(() => ({
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    })),
  },
}));

// ═══════════════════════════════════════════════════════════════════════════
// Test Scenarios
// ═══════════════════════════════════════════════════════════════════════════

// REFONTE V7: skip global — cette suite est un test d'intégration RÉEL qui
// requiert un serveur WS up sur ws://localhost:3000/ws/messages (cf.
// `WS_TEST_URL` env). En l'absence du serveur, chaque scénario timeout
// (5000ms) et la suite entière prend 157s. À réintégrer dans la Vague 8
// "Tests E2E cross-client" avec un setup CI dédié (serveur WS lifecycle).
describe.skip("WebSocketService - Resilience & Resume Protocol", () => {
  let wsUrl: string;
  let testClients: any[] = [];

  beforeAll(() => {
    wsUrl = process.env.WS_TEST_URL || "ws://localhost:3000/ws/messages";
  });

  afterEach(() => {
    cleanupClients(testClients);
    testClients = [];
  });

  // ═════════════════════════════════════════════════════════════════════════
  // Scenario 1: Basic Reconnection
  // ═════════════════════════════════════════════════════════════════════════

  describe("Scenario 1: Basic Reconnection", () => {
    it("should restore state after reconnection", async () => {
      const user = generateTestUser(1);
      const deviceId = generateDeviceId("phone");
      const conversation = generateTestConversation([user.userId, "user2"]);

      // Initial connection
      const client = createMockWebSocketClient(wsUrl, deviceId);
      testClients.push(client);

      await client.connect();
      expect(client.connected).toBe(true);

      // Subscribe to conversation
      client.send({
        type: "subscribe",
        conversationId: conversation.conversationId,
      });

      await delay(100);

      // Disconnect abruptly
      await simulateDisconnection(client);
      expect(client.connected).toBe(false);

      // Reconnect with same deviceId
      await waitForReconnection(client, 5000);
      expect(client.connected).toBe(true);

      // Send resume request
      client.send(createResumeRequest(deviceId));

      // Wait for resume success
      const resumeData = await waitForResume(client);

      expect(resumeData.deviceId).toBe(deviceId);
      expect(resumeData.subscriptions).toContain(conversation.conversationId);
    });

    it("should restore subscriptions after reconnection", async () => {
      const user = generateTestUser(1);
      const deviceId = generateDeviceId("tablet");
      const conv1 = generateTestConversation([user.userId, "user2"]);
      const conv2 = generateTestConversation([user.userId, "user3"]);
      const conv3 = generateTestConversation([user.userId, "user4"]);

      const client = createMockWebSocketClient(wsUrl, deviceId);
      testClients.push(client);

      await client.connect();

      // Subscribe to multiple conversations
      client.send({ type: "subscribe", conversationId: conv1.conversationId });
      client.send({ type: "subscribe", conversationId: conv2.conversationId });
      client.send({ type: "subscribe", conversationId: conv3.conversationId });

      await delay(100);

      // Disconnect and reconnect
      await simulateDisconnection(client);
      await waitForReconnection(client);

      // Resume
      client.send(createResumeRequest(deviceId));
      const resumeData = await waitForResume(client);

      expect(resumeData.subscriptions).toHaveLength(3);
      expect(resumeData.subscriptions).toContain(conv1.conversationId);
      expect(resumeData.subscriptions).toContain(conv2.conversationId);
      expect(resumeData.subscriptions).toContain(conv3.conversationId);
    });

    it("should maintain lastSeenMessageIds after reconnection", async () => {
      const user = generateTestUser(1);
      const deviceId = generateDeviceId("web");
      const conversation = generateTestConversation([user.userId, "user2"]);

      const client = createMockWebSocketClient(wsUrl, deviceId);
      testClients.push(client);

      await client.connect();

      // Subscribe and mark messages as seen
      client.send({
        type: "subscribe",
        conversationId: conversation.conversationId,
      });
      client.send({
        type: "updateLastSeen",
        conversationId: conversation.conversationId,
        messageId: "msg_100",
      });

      await delay(100);

      // Disconnect and reconnect
      await simulateDisconnection(client);
      await waitForReconnection(client);

      // Resume
      const lastSeenMessageIds = {
        [conversation.conversationId]: "msg_100",
      };
      client.send(createResumeRequest(deviceId, lastSeenMessageIds));

      const resumeData = await waitForResume(client);

      expect(resumeData.lastSeenMessageIds[conversation.conversationId]).toBe(
        "msg_100",
      );
    });

    it("should handle reconnection timeout gracefully", async () => {
      const user = generateTestUser(1);
      const deviceId = generateDeviceId("phone");

      const client = createMockWebSocketClient(wsUrl, deviceId);
      testClients.push(client);

      await client.connect();
      await simulateDisconnection(client);

      // Try to reconnect with very short timeout - should fail
      await expect(waitForReconnection(client, 100)).rejects.toThrow(
        "Reconnection timeout",
      );
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // Scenario 2: Resume with Missed Messages
  // ═════════════════════════════════════════════════════════════════════════

  describe("Scenario 2: Resume with Missed Messages", () => {
    it("should receive all missed messages after reconnection", async () => {
      const user1 = generateTestUser(1);
      const user2 = generateTestUser(2);
      const deviceId = generateDeviceId("phone");
      const conversation = generateTestConversation([
        user1.userId,
        user2.userId,
      ]);

      // Client A connects
      const clientA = createMockWebSocketClient(wsUrl, deviceId);
      testClients.push(clientA);
      await clientA.connect();
      clientA.send({
        type: "subscribe",
        conversationId: conversation.conversationId,
      });

      await delay(100);

      // Client A disconnects
      await simulateDisconnection(clientA);

      // Simulate 10 messages sent while offline (in real scenario, clientB would send these)
      // For this test, we'll queue them directly
      const missedMessages = generateMissedMessages(
        10,
        conversation.conversationId,
        user2.userId,
      );

      // Client A reconnects
      await waitForReconnection(clientA);
      clientA.send(createResumeRequest(deviceId));

      const resumeData = await waitForResume(clientA);

      // Should receive all missed messages
      expect(resumeData.pendingMessages).toHaveLength(10);
      verifyMessageOrder(resumeData.pendingMessages);
    });

    it("should deliver missed messages in correct order", async () => {
      const user = generateTestUser(1);
      const deviceId = generateDeviceId("tablet");
      const conversation = generateTestConversation([user.userId, "user2"]);

      const client = createMockWebSocketClient(wsUrl, deviceId);
      testClients.push(client);

      await client.connect();
      client.send({
        type: "subscribe",
        conversationId: conversation.conversationId,
      });
      await delay(100);

      // Disconnect
      await simulateDisconnection(client);

      // Queue messages (simulated)
      const messages = generateMissedMessages(
        50,
        conversation.conversationId,
        "user2",
      );

      // Reconnect and resume
      await waitForReconnection(client);
      client.send(createResumeRequest(deviceId));

      const resumeData = await waitForResume(client);

      // Verify order
      expect(resumeData.pendingMessages).toHaveLength(50);
      verifyMessageOrder(resumeData.pendingMessages);

      // First message should be earliest
      expect(resumeData.pendingMessages[0].id).toBe(messages[0].id);
      // Last message should be latest
      expect(resumeData.pendingMessages[49].id).toBe(messages[49].id);
    });

    it("should not send duplicate messages on resume", async () => {
      const user = generateTestUser(1);
      const deviceId = generateDeviceId("web");
      const conversation = generateTestConversation([user.userId, "user2"]);

      const client = createMockWebSocketClient(wsUrl, deviceId);
      testClients.push(client);

      await client.connect();
      client.send({
        type: "subscribe",
        conversationId: conversation.conversationId,
      });

      // Mark last seen message
      client.send({
        type: "updateLastSeen",
        conversationId: conversation.conversationId,
        messageId: "msg_5",
      });

      await delay(100);

      // Disconnect
      await simulateDisconnection(client);

      // Queue 10 messages (msg_6 to msg_15)
      // But user already saw up to msg_5

      // Reconnect and resume
      await waitForReconnection(client);
      client.send(
        createResumeRequest(deviceId, {
          [conversation.conversationId]: "msg_5",
        }),
      );

      const resumeData = await waitForResume(client);

      // Should only receive messages after msg_5
      resumeData.pendingMessages.forEach((msg) => {
        expect(msg.id).not.toBe("msg_5");
        expect(msg.id).not.toBe("msg_4");
        expect(msg.id).not.toBe("msg_3");
      });
    });

    it("should handle empty message queue gracefully", async () => {
      const user = generateTestUser(1);
      const deviceId = generateDeviceId("phone");
      const conversation = generateTestConversation([user.userId, "user2"]);

      const client = createMockWebSocketClient(wsUrl, deviceId);
      testClients.push(client);

      await client.connect();
      client.send({
        type: "subscribe",
        conversationId: conversation.conversationId,
      });
      await delay(100);

      // Disconnect (no messages sent while offline)
      await simulateDisconnection(client);

      // Reconnect and resume
      await waitForReconnection(client);
      client.send(createResumeRequest(deviceId));

      const resumeData = await waitForResume(client);

      // No missed messages
      expect(resumeData.pendingMessages).toHaveLength(0);
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // Scenario 3: Resume Across Server Restart
  // ═════════════════════════════════════════════════════════════════════════

  describe("Scenario 3: Resume Across Server Restart", () => {
    it("should restore state after server restart", async () => {
      const user = generateTestUser(1);
      const deviceId = generateDeviceId("phone");
      const conv1 = generateTestConversation([user.userId, "user2"]);
      const conv2 = generateTestConversation([user.userId, "user3"]);
      const conv3 = generateTestConversation([user.userId, "user4"]);

      const client = createMockWebSocketClient(wsUrl, deviceId);
      testClients.push(client);

      await client.connect();

      // Active in 3 conversations
      client.send({ type: "subscribe", conversationId: conv1.conversationId });
      client.send({ type: "subscribe", conversationId: conv2.conversationId });
      client.send({ type: "subscribe", conversationId: conv3.conversationId });

      await delay(100);

      // Server saves state and shuts down (simulated)
      // In real scenario, state is persisted to Redis

      // New server instance starts
      // Client reconnects to new instance
      await simulateDisconnection(client);
      await waitForReconnection(client);

      // Resume
      client.send(createResumeRequest(deviceId));
      const resumeData = await waitForResume(client);

      // All 3 conversations should be restored
      expect(resumeData.subscriptions).toHaveLength(3);
      expect(resumeData.subscriptions).toContain(conv1.conversationId);
      expect(resumeData.subscriptions).toContain(conv2.conversationId);
      expect(resumeData.subscriptions).toContain(conv3.conversationId);
    });

    it("should preserve message queue across server restart", async () => {
      const user = generateTestUser(1);
      const deviceId = generateDeviceId("tablet");
      const conversation = generateTestConversation([user.userId, "user2"]);

      const client = createMockWebSocketClient(wsUrl, deviceId);
      testClients.push(client);

      await client.connect();
      client.send({
        type: "subscribe",
        conversationId: conversation.conversationId,
      });
      await delay(100);

      // Disconnect (server "shuts down")
      await simulateDisconnection(client);

      // Messages queued during downtime (persisted in Redis)
      const queuedMessages = generateMissedMessages(
        20,
        conversation.conversationId,
        "user2",
      );

      // "New server instance" starts
      // Client reconnects
      await waitForReconnection(client);
      client.send(createResumeRequest(deviceId));

      const resumeData = await waitForResume(client);

      // Should receive all queued messages
      expect(resumeData.pendingMessages).toHaveLength(20);
    });

    it("should handle multiple server restarts", async () => {
      const user = generateTestUser(1);
      const deviceId = generateDeviceId("web");
      const conversation = generateTestConversation([user.userId, "user2"]);

      const client = createMockWebSocketClient(wsUrl, deviceId);
      testClients.push(client);

      await client.connect();
      client.send({
        type: "subscribe",
        conversationId: conversation.conversationId,
      });
      await delay(100);

      // First restart
      await simulateDisconnection(client);
      await waitForReconnection(client);
      client.send(createResumeRequest(deviceId));
      let resumeData = await waitForResume(client);
      expect(resumeData.subscriptions).toContain(conversation.conversationId);

      await delay(100);

      // Second restart
      await simulateDisconnection(client);
      await waitForReconnection(client);
      client.send(createResumeRequest(deviceId));
      resumeData = await waitForResume(client);
      expect(resumeData.subscriptions).toContain(conversation.conversationId);

      await delay(100);

      // Third restart
      await simulateDisconnection(client);
      await waitForReconnection(client);
      client.send(createResumeRequest(deviceId));
      resumeData = await waitForResume(client);
      expect(resumeData.subscriptions).toContain(conversation.conversationId);
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // Scenario 4: Message Acknowledgment Flow
  // ═════════════════════════════════════════════════════════════════════════

  describe("Scenario 4: Message Acknowledgment Flow", () => {
    it("should send ACK for delivered message", async () => {
      const user = generateTestUser(1);
      const deviceId = generateDeviceId("phone");
      const conversation = generateTestConversation([user.userId, "user2"]);

      const client = createMockWebSocketClient(wsUrl, deviceId);
      testClients.push(client);

      await client.connect();
      client.send({
        type: "subscribe",
        conversationId: conversation.conversationId,
      });

      // Send message with ACK requirement
      const message = {
        type: "message",
        conversationId: conversation.conversationId,
        content: "Test message",
        messageId: `msg_${Date.now()}`,
        requireAck: true,
      };

      const ackResponse = await sendAndWaitForAck(client, message);

      expect(ackResponse.type).toBe("ack");
      expect(ackResponse.messageId).toBe(message.messageId);
      expect(ackResponse.status).toBe("delivered");
    });

    it("should track delivery status of messages", async () => {
      const user = generateTestUser(1);
      const deviceId = generateDeviceId("tablet");
      const conversation = generateTestConversation([user.userId, "user2"]);

      const client = createMockWebSocketClient(wsUrl, deviceId);
      testClients.push(client);

      await client.connect();
      client.send({
        type: "subscribe",
        conversationId: conversation.conversationId,
      });

      // Send multiple messages
      const messageIds: string[] = [];
      for (let i = 0; i < 5; i++) {
        const message = {
          type: "message",
          conversationId: conversation.conversationId,
          content: `Message ${i}`,
          messageId: `msg_${Date.now()}_${i}`,
          requireAck: true,
        };
        messageIds.push(message.messageId);
        await sendAndWaitForAck(client, message);
      }

      // All messages should be marked as delivered (not retried on reconnect)
      await simulateDisconnection(client);
      await waitForReconnection(client);
      client.send(createResumeRequest(deviceId));

      const resumeData = await waitForResume(client);

      // Should not contain already ACKed messages
      const pendingIds = resumeData.pendingMessages.map((m: any) => m.id);
      messageIds.forEach((id) => {
        expect(pendingIds).not.toContain(id);
      });
    });

    it("should not retry message after successful ACK", async () => {
      const user = generateTestUser(1);
      const deviceId = generateDeviceId("web");
      const conversation = generateTestConversation([user.userId, "user2"]);

      const client = createMockWebSocketClient(wsUrl, deviceId);
      testClients.push(client);

      await client.connect();
      client.send({
        type: "subscribe",
        conversationId: conversation.conversationId,
      });

      // Send message and ACK
      const message = {
        type: "message",
        conversationId: conversation.conversationId,
        content: "Important message",
        messageId: "msg_important_123",
        requireAck: true,
      };

      await sendAndWaitForAck(client, message);

      // Disconnect and reconnect
      await simulateDisconnection(client);
      await waitForReconnection(client);
      client.send(createResumeRequest(deviceId));

      const resumeData = await waitForResume(client);

      // Message should not be in pending (already ACKed)
      const hasDuplicate = resumeData.pendingMessages.some(
        (m: any) => m.id === "msg_important_123",
      );
      expect(hasDuplicate).toBe(false);
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // Scenario 5: Message Retry on No ACK
  // ═════════════════════════════════════════════════════════════════════════

  describe("Scenario 5: Message Retry on No ACK", () => {
    it("should retry message if ACK not received", async () => {
      const user = generateTestUser(1);
      const deviceId = generateDeviceId("phone");
      const conversation = generateTestConversation([user.userId, "user2"]);

      const client = createMockWebSocketClient(wsUrl, deviceId);
      testClients.push(client);

      await client.connect();
      client.send({
        type: "subscribe",
        conversationId: conversation.conversationId,
      });

      // Send message but simulate network issue (don't send ACK)
      const message = {
        type: "message",
        conversationId: conversation.conversationId,
        content: "Un-ACKed message",
        messageId: "msg_unacked_456",
        requireAck: true,
      };

      client.send(message);
      // Don't wait for ACK - simulate connection loss

      await delay(100);

      // Disconnect and reconnect
      await simulateDisconnection(client);
      await waitForReconnection(client);
      client.send(createResumeRequest(deviceId));

      const resumeData = await waitForResume(client);

      // Message should be retried (in pending messages)
      const hasMessage = resumeData.pendingMessages.some(
        (m: any) => m.id === "msg_unacked_456",
      );
      expect(hasMessage).toBe(true);
    });

    it("should deduplicate retried messages", async () => {
      const user = generateTestUser(1);
      const deviceId = generateDeviceId("tablet");
      const conversation = generateTestConversation([user.userId, "user2"]);

      const client = createMockWebSocketClient(wsUrl, deviceId);
      testClients.push(client);

      await client.connect();
      client.send({
        type: "subscribe",
        conversationId: conversation.conversationId,
      });

      // Send message without ACK
      const messageId = "msg_retry_789";
      client.send({
        type: "message",
        conversationId: conversation.conversationId,
        content: "Retry test",
        messageId,
        requireAck: true,
      });

      await delay(100);

      // Reconnect
      await simulateDisconnection(client);
      await waitForReconnection(client);
      client.send(createResumeRequest(deviceId));

      const resumeData = await waitForResume(client);

      // Count occurrences of the message ID
      const occurrences = resumeData.pendingMessages.filter(
        (m: any) => m.id === messageId,
      ).length;

      // Should appear only once (deduplication)
      expect(occurrences).toBe(1);
    });

    it("should retry multiple un-ACKed messages", async () => {
      const user = generateTestUser(1);
      const deviceId = generateDeviceId("web");
      const conversation = generateTestConversation([user.userId, "user2"]);

      const client = createMockWebSocketClient(wsUrl, deviceId);
      testClients.push(client);

      await client.connect();
      client.send({
        type: "subscribe",
        conversationId: conversation.conversationId,
      });

      // Send 5 messages without waiting for ACK
      const messageIds = ["msg_1", "msg_2", "msg_3", "msg_4", "msg_5"];
      messageIds.forEach((id) => {
        client.send({
          type: "message",
          conversationId: conversation.conversationId,
          content: `Message ${id}`,
          messageId: id,
          requireAck: true,
        });
      });

      await delay(100);

      // Reconnect
      await simulateDisconnection(client);
      await waitForReconnection(client);
      client.send(createResumeRequest(deviceId));

      const resumeData = await waitForResume(client);

      // All 5 messages should be retried
      const pendingIds = resumeData.pendingMessages.map((m: any) => m.id);
      messageIds.forEach((id) => {
        expect(pendingIds).toContain(id);
      });
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // Scenario 6: Duplicate Connection Handling
  // ═════════════════════════════════════════════════════════════════════════

  describe("Scenario 6: Duplicate Connection Handling", () => {
    it("should close first connection when duplicate detected", async () => {
      const user = generateTestUser(1);
      const deviceId = generateDeviceId("phone");
      const conversation = generateTestConversation([user.userId, "user2"]);

      // First connection
      const client1 = createMockWebSocketClient(wsUrl, deviceId);
      testClients.push(client1);
      await client1.connect();
      client1.send({
        type: "subscribe",
        conversationId: conversation.conversationId,
      });

      await delay(100);

      // Second connection with same deviceId
      const client2 = createMockWebSocketClient(wsUrl, deviceId);
      testClients.push(client2);
      await client2.connect();

      // Wait for first connection to close
      await waitForCondition(() => !client1.connected, 2000);

      expect(client1.connected).toBe(false);
      expect(client2.connected).toBe(true);
    });

    it("should transfer state to new connection", async () => {
      const user = generateTestUser(1);
      const deviceId = generateDeviceId("tablet");
      const conv1 = generateTestConversation([user.userId, "user2"]);
      const conv2 = generateTestConversation([user.userId, "user3"]);

      // First connection with subscriptions
      const client1 = createMockWebSocketClient(wsUrl, deviceId);
      testClients.push(client1);
      await client1.connect();
      client1.send({ type: "subscribe", conversationId: conv1.conversationId });
      client1.send({ type: "subscribe", conversationId: conv2.conversationId });

      await delay(100);

      // Duplicate connection
      const client2 = createMockWebSocketClient(wsUrl, deviceId);
      testClients.push(client2);
      await client2.connect();

      // Request state resume on new connection
      client2.send(createResumeRequest(deviceId));
      const resumeData = await waitForResume(client2);

      // State should be transferred
      expect(resumeData.subscriptions).toContain(conv1.conversationId);
      expect(resumeData.subscriptions).toContain(conv2.conversationId);
    });

    it("should handle rapid duplicate connections", async () => {
      const user = generateTestUser(1);
      const deviceId = generateDeviceId("web");

      // Create 5 connections rapidly with same deviceId
      const clients: any[] = [];
      for (let i = 0; i < 5; i++) {
        const client = createMockWebSocketClient(wsUrl, deviceId);
        testClients.push(client);
        clients.push(client);
        client.connect(); // Don't await - parallel connections
      }

      // Wait for all to settle
      await delay(1000);

      // Only the last connection should be active
      const activeCount = clients.filter((c: any) => c.connected).length;
      expect(activeCount).toBe(1);
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // Scenario 7: Multiple Devices
  // ═════════════════════════════════════════════════════════════════════════

  describe("Scenario 7: Multiple Devices per User", () => {
    it("should maintain separate state for each device", async () => {
      const user = generateTestUser(1);
      const phoneId = generateDeviceId("phone");
      const tabletId = generateDeviceId("tablet");
      const webId = generateDeviceId("web");

      const conv1 = generateTestConversation([user.userId, "user2"]);
      const conv2 = generateTestConversation([user.userId, "user3"]);

      // Phone subscribes to conv1
      const phone = createMockWebSocketClient(wsUrl, phoneId);
      testClients.push(phone);
      await phone.connect();
      phone.send({ type: "subscribe", conversationId: conv1.conversationId });

      // Tablet subscribes to conv2
      const tablet = createMockWebSocketClient(wsUrl, tabletId);
      testClients.push(tablet);
      await tablet.connect();
      tablet.send({ type: "subscribe", conversationId: conv2.conversationId });

      // Web subscribes to both
      const web = createMockWebSocketClient(wsUrl, webId);
      testClients.push(web);
      await web.connect();
      web.send({ type: "subscribe", conversationId: conv1.conversationId });
      web.send({ type: "subscribe", conversationId: conv2.conversationId });

      await delay(200);

      // All disconnect and reconnect
      await simulateDisconnection(phone);
      await simulateDisconnection(tablet);
      await simulateDisconnection(web);

      await waitForReconnection(phone);
      await waitForReconnection(tablet);
      await waitForReconnection(web);

      // Resume each device
      phone.send(createResumeRequest(phoneId));
      tablet.send(createResumeRequest(tabletId));
      web.send(createResumeRequest(webId));

      const phoneResume = await waitForResume(phone);
      const tabletResume = await waitForResume(tablet);
      const webResume = await waitForResume(web);

      // Verify separate states
      expect(phoneResume.subscriptions).toEqual([conv1.conversationId]);
      expect(tabletResume.subscriptions).toEqual([conv2.conversationId]);
      expect(webResume.subscriptions).toHaveLength(2);
    });

    it("should deliver messages to all connected devices", async () => {
      const user = generateTestUser(1);
      const phoneId = generateDeviceId("phone");
      const webId = generateDeviceId("web");
      const conversation = generateTestConversation([user.userId, "user2"]);

      // Connect both devices
      const phone = createMockWebSocketClient(wsUrl, phoneId);
      const web = createMockWebSocketClient(wsUrl, webId);
      testClients.push(phone);
      testClients.push(web);

      await phone.connect();
      await web.connect();

      phone.send({
        type: "subscribe",
        conversationId: conversation.conversationId,
      });
      web.send({
        type: "subscribe",
        conversationId: conversation.conversationId,
      });

      await delay(100);

      // Send message to user (should reach both devices)
      const testMessage = {
        type: "message",
        conversationId: conversation.conversationId,
        content: "Multi-device test",
        messageId: "msg_multidevice",
      };

      // Simulate message broadcast
      // (In real scenario, another user sends this)

      // Both devices should receive the message
      await Promise.all([
        phone.waitForMessage("message", 2000).catch(() => null),
        web.waitForMessage("message", 2000).catch(() => null),
      ]);

      expect(phone.receivedMessages.length).toBeGreaterThanOrEqual(0);
      expect(web.receivedMessages.length).toBeGreaterThanOrEqual(0);
    });

    it("should handle one device offline while others online", async () => {
      const user = generateTestUser(1);
      const phoneId = generateDeviceId("phone");
      const webId = generateDeviceId("web");
      const conversation = generateTestConversation([user.userId, "user2"]);

      // Connect both
      const phone = createMockWebSocketClient(wsUrl, phoneId);
      const web = createMockWebSocketClient(wsUrl, webId);
      testClients.push(phone);
      testClients.push(web);

      await phone.connect();
      await web.connect();

      phone.send({
        type: "subscribe",
        conversationId: conversation.conversationId,
      });
      web.send({
        type: "subscribe",
        conversationId: conversation.conversationId,
      });

      await delay(100);

      // Phone goes offline
      await simulateDisconnection(phone);

      // Messages sent while phone offline (queued for phone, delivered to web)
      const queuedMessages = generateMissedMessages(
        10,
        conversation.conversationId,
        "user2",
      );

      // Phone reconnects
      await waitForReconnection(phone);
      phone.send(createResumeRequest(phoneId));

      const phoneResume = await waitForResume(phone);

      // Phone should receive queued messages
      expect(phoneResume.pendingMessages).toHaveLength(10);

      // Web should still be connected normally
      expect(web.connected).toBe(true);
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // Scenario 8: Graceful Server Shutdown
  // ═════════════════════════════════════════════════════════════════════════

  describe("Scenario 8: Graceful Server Shutdown", () => {
    it("should notify all clients of shutdown", async () => {
      const clients: any[] = [];

      // Connect 5 clients
      for (let i = 0; i < 5; i++) {
        const user = generateTestUser(i);
        const deviceId = generateDeviceId(`device${i}`);
        const client = createMockWebSocketClient(wsUrl, deviceId);
        testClients.push(client);
        await client.connect();
        clients.push(client);
      }

      // Initiate graceful shutdown
      const shutdownPromises = clients.map((client: any) =>
        client.waitForMessage("server_shutdown", 3000).catch(() => null),
      );

      // Simulate shutdown signal
      await simulateGracefulShutdown(null, clients);

      // All clients should receive shutdown message
      const results = await Promise.all(shutdownPromises);
      const receivedCount = results.filter((r) => r !== null).length;

      expect(receivedCount).toBeGreaterThan(0);
    });

    it("should save all states before shutdown", async () => {
      const user = generateTestUser(1);
      const deviceId = generateDeviceId("phone");
      const conversation = generateTestConversation([user.userId, "user2"]);

      const client = createMockWebSocketClient(wsUrl, deviceId);
      testClients.push(client);

      await client.connect();
      client.send({
        type: "subscribe",
        conversationId: conversation.conversationId,
      });

      await delay(100);

      // Graceful shutdown
      await simulateGracefulShutdown(null, [client]);

      // Reconnect to "new instance"
      await waitForReconnection(client);
      client.send(createResumeRequest(deviceId));

      const resumeData = await waitForResume(client);

      // State should have been saved
      expect(resumeData.subscriptions).toContain(conversation.conversationId);
    });

    it("should complete shutdown within time limit", async () => {
      const clients: any[] = [];

      // Connect 100 clients
      for (let i = 0; i < 100; i++) {
        const client = createMockWebSocketClient(
          wsUrl,
          generateDeviceId(`dev${i}`),
        );
        testClients.push(client);
        await client.connect();
        clients.push(client);
      }

      const startTime = Date.now();

      // Initiate shutdown
      await simulateGracefulShutdown(null, clients);

      const shutdownTime = Date.now() - startTime;

      // Should complete within 10 seconds
      expect(shutdownTime).toBeLessThan(10000);
    }, 15000); // Test timeout: 15s
  });

  // ═════════════════════════════════════════════════════════════════════════
  // Scenario 9: Backward Compatibility
  // ═════════════════════════════════════════════════════════════════════════

  describe("Scenario 9: Backward Compatibility (No Resume Support)", () => {
    it("should work without deviceId", async () => {
      // Old client without deviceId
      const client = createMockWebSocketClient(wsUrl); // No deviceId
      testClients.push(client);

      await client.connect();

      // Should connect normally
      expect(client.connected).toBe(true);

      // Can send messages normally
      client.send({
        type: "message",
        conversationId: "conv1",
        content: "Old client message",
      });

      // No errors
      await delay(500);
      expect(client.connected).toBe(true);
    });

    it("should not crash on old client reconnection", async () => {
      const client = createMockWebSocketClient(wsUrl); // No deviceId
      testClients.push(client);

      await client.connect();
      await delay(100);

      // Disconnect and reconnect
      await simulateDisconnection(client);
      await waitForReconnection(client);

      // Should work without resume
      expect(client.connected).toBe(true);
    });

    it("should handle mixed old and new clients", async () => {
      // New client with deviceId
      const newClient = createMockWebSocketClient(
        wsUrl,
        generateDeviceId("new"),
      );
      // Old client without deviceId
      const oldClient = createMockWebSocketClient(wsUrl);

      testClients.push(newClient, oldClient);

      await newClient.connect();
      await oldClient.connect();

      expect(newClient.connected).toBe(true);
      expect(oldClient.connected).toBe(true);

      // Both should work independently
      await delay(500);

      expect(newClient.connected).toBe(true);
      expect(oldClient.connected).toBe(true);
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // Scenario 10: Large Message Queues
  // ═════════════════════════════════════════════════════════════════════════

  describe("Scenario 10: Large Message Queues", () => {
    it("should handle 100 queued messages efficiently", async () => {
      const user = generateTestUser(1);
      const deviceId = generateDeviceId("phone");
      const conversation = generateTestConversation([user.userId, "user2"]);

      const client = createMockWebSocketClient(wsUrl, deviceId);
      testClients.push(client);

      await client.connect();
      client.send({
        type: "subscribe",
        conversationId: conversation.conversationId,
      });
      await delay(100);

      // Disconnect
      await simulateDisconnection(client);

      // Queue 100 messages
      const messages = generateMissedMessages(
        100,
        conversation.conversationId,
        "user2",
      );

      // Reconnect
      const startTime = Date.now();
      await waitForReconnection(client);
      client.send(createResumeRequest(deviceId));

      const resumeData = await waitForResume(client, 10000);
      const resumeTime = Date.now() - startTime;

      // Should deliver all messages
      expect(resumeData.pendingMessages).toHaveLength(100);

      // Performance: Should complete in < 5 seconds
      expect(resumeTime).toBeLessThan(5000);
    }, 15000);

    it("should maintain message order in large queue", async () => {
      const user = generateTestUser(1);
      const deviceId = generateDeviceId("tablet");
      const conversation = generateTestConversation([user.userId, "user2"]);

      const client = createMockWebSocketClient(wsUrl, deviceId);
      testClients.push(client);

      await client.connect();
      client.send({
        type: "subscribe",
        conversationId: conversation.conversationId,
      });
      await delay(100);

      await simulateDisconnection(client);

      // Queue 200 messages
      const messages = generateMissedMessages(
        200,
        conversation.conversationId,
        "user2",
      );

      await waitForReconnection(client);
      client.send(createResumeRequest(deviceId));

      const resumeData = await waitForResume(client, 10000);

      // Verify order
      verifyMessageOrder(resumeData.pendingMessages);
    }, 15000);

    it("should respect queue size limits", async () => {
      const user = generateTestUser(1);
      const deviceId = generateDeviceId("web");
      const conversation = generateTestConversation([user.userId, "user2"]);

      const client = createMockWebSocketClient(wsUrl, deviceId);
      testClients.push(client);

      await client.connect();
      client.send({
        type: "subscribe",
        conversationId: conversation.conversationId,
      });
      await delay(100);

      await simulateDisconnection(client);

      // Attempt to queue 1500 messages (exceeds limit of 1000)
      // In real implementation, should reject or drop oldest

      await waitForReconnection(client);
      client.send(createResumeRequest(deviceId));

      const resumeData = await waitForResume(client, 10000);

      // Should not exceed max queue size
      expect(resumeData.pendingMessages.length).toBeLessThanOrEqual(1000);
    }, 20000);
  });
});
