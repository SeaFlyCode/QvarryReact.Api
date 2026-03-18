/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ARTILLERY PROCESSOR FUNCTIONS
 * ═══════════════════════════════════════════════════════════════════════════
 * Helper functions for Artillery load tests
 * Provides data generation, payload manipulation, and custom logic
 */

const crypto = require("crypto");

// ═══════════════════════════════════════════════════════════════════════════
// MESSAGE GENERATORS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Generate realistic message content with varied lengths
 */
function generateMessage(context, events, done) {
  const messages = [
    "Hello, how are you today?",
    "Can we schedule a meeting for tomorrow?",
    "Thanks for the update, I'll review it shortly.",
    "I agree with your proposal. Let's proceed.",
    "Could you send me the latest report?",
    "The project is on track and progressing well.",
    "Let me know if you need any assistance.",
    "Great work on the presentation!",
    "I have a few questions about the implementation.",
    "Looking forward to our discussion later.",
    "Please review the attached documents when you get a chance.",
    "The deadline has been extended to next week.",
    "Can you provide more details about this?",
    "I'll be out of office tomorrow, but back on Monday.",
    "Let's sync up on this topic next week.",
  ];

  const randomMessage = messages[Math.floor(Math.random() * messages.length)];
  context.vars.messageContent = randomMessage;

  return done();
}

/**
 * Generate varied messages with different types and metadata
 */
function generateVariedMessage(context, events, done) {
  const messageTypes = ["text", "info", "warning", "success"];
  const messageType =
    messageTypes[Math.floor(Math.random() * messageTypes.length)];

  // Generate varied content based on type
  let content;
  let metadata = {};

  switch (messageType) {
    case "text":
      content = generateRandomText(50, 200);
      break;
    case "info":
      content = "Information: " + generateRandomText(30, 100);
      metadata = { priority: "normal", category: "info" };
      break;
    case "warning":
      content = "Warning: " + generateRandomText(20, 80);
      metadata = { priority: "high", category: "warning" };
      break;
    case "success":
      content = "Success: " + generateRandomText(20, 80);
      metadata = { priority: "low", category: "success" };
      break;
  }

  context.vars.messageContent = content;
  context.vars.messageType = messageType;
  context.vars.messageMetadata = JSON.stringify(metadata);

  return done();
}

/**
 * Generate random text of specified length
 */
function generateRandomText(minChars, maxChars) {
  const words = [
    "lorem",
    "ipsum",
    "dolor",
    "sit",
    "amet",
    "consectetur",
    "adipiscing",
    "elit",
    "sed",
    "do",
    "eiusmod",
    "tempor",
    "incididunt",
    "ut",
    "labore",
    "et",
    "dolore",
    "magna",
    "aliqua",
    "enim",
    "ad",
    "minim",
    "veniam",
    "quis",
    "nostrud",
    "exercitation",
    "ullamco",
    "laboris",
    "nisi",
  ];

  const targetLength =
    Math.floor(Math.random() * (maxChars - minChars)) + minChars;
  let text = "";

  while (text.length < targetLength) {
    const word = words[Math.floor(Math.random() * words.length)];
    text += word + " ";
  }

  return text.trim().substring(0, targetLength);
}

// ═══════════════════════════════════════════════════════════════════════════
// LARGE PAYLOAD GENERATORS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Generate small message (< 100 bytes)
 */
function generateSmallMessage(context, events, done) {
  context.vars.messageContent = generateRandomText(10, 50);
  context.vars.messageSize = "small";
  return done();
}

/**
 * Generate medium message (100-1000 bytes)
 */
function generateMediumMessage(context, events, done) {
  context.vars.messageContent = generateRandomText(100, 500);
  context.vars.messageSize = "medium";
  return done();
}

/**
 * Generate large message (1000-5000 bytes)
 */
function generateLargeMessage(context, events, done) {
  context.vars.messageContent = generateRandomText(1000, 3000);
  context.vars.messageSize = "large";
  return done();
}

/**
 * Generate extra-large message (5000-10000 bytes)
 */
function generateExtraLargeMessage(context, events, done) {
  context.vars.messageContent = generateRandomText(5000, 9000);
  context.vars.messageSize = "xlarge";
  return done();
}

// ═══════════════════════════════════════════════════════════════════════════
// WEBSOCKET HELPERS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Prepare WebSocket connection for notifications endpoint
 */
function prepareNotificationsWs(context, events, done) {
  // Add custom headers if needed
  context.vars.wsEndpoint = "notifications";
  return done();
}

/**
 * Prepare WebSocket connection for messages endpoint
 */
function prepareMessagesWs(context, events, done) {
  context.vars.wsEndpoint = "messages";
  return done();
}

/**
 * Log WebSocket connection event
 */
function logWsConnection(context, events, done) {
  console.log(`[WS] User connected to ${context.vars.wsEndpoint || "unknown"}`);
  return done();
}

/**
 * Log WebSocket message sent
 */
function logWsMessage(context, events, done) {
  console.log(
    `[WS] Message sent (${context.vars.messageSize || "unknown"} size)`,
  );
  return done();
}

// ═══════════════════════════════════════════════════════════════════════════
// COMPRESSION TEST HELPERS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Generate highly compressible content (repetitive patterns)
 */
function generateCompressibleMessage(context, events, done) {
  const pattern = "This is a test message. ";
  const repetitions = Math.floor(Math.random() * 20) + 10;
  context.vars.messageContent = pattern.repeat(repetitions);
  context.vars.compressionType = "high";
  return done();
}

/**
 * Generate poorly compressible content (random data)
 */
function generateIncompressibleMessage(context, events, done) {
  const length = Math.floor(Math.random() * 500) + 200;
  context.vars.messageContent = crypto.randomBytes(length).toString("base64");
  context.vars.compressionType = "low";
  return done();
}

// ═══════════════════════════════════════════════════════════════════════════
// REALISTIC USER BEHAVIOR
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Simulate realistic user think time
 */
function realisticThinkTime(context, events, done) {
  // Human-like delays: mostly 5-15 seconds, occasionally longer
  const thinkTimes = [5, 7, 10, 12, 15, 20, 30, 45, 60];
  const weights = [0.2, 0.2, 0.2, 0.15, 0.1, 0.08, 0.05, 0.01, 0.01];

  const random = Math.random();
  let cumulative = 0;
  let selectedTime = 10; // default

  for (let i = 0; i < thinkTimes.length; i++) {
    cumulative += weights[i];
    if (random <= cumulative) {
      selectedTime = thinkTimes[i];
      break;
    }
  }

  context.vars.thinkTime = selectedTime;
  return done();
}

/**
 * Determine if user should send a message (probability-based)
 */
function shouldSendMessage(context, events, done) {
  // 30% chance to send a message
  context.vars.shouldSend = Math.random() < 0.3;
  return done();
}

// ═══════════════════════════════════════════════════════════════════════════
// CUSTOM METRICS & LOGGING
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Track custom metric for message size
 */
function trackMessageSize(context, events, done) {
  const content = context.vars.messageContent || "";
  const sizeBytes = Buffer.byteLength(content, "utf8");

  // Emit custom metric
  events.emit("counter", "websocket.message.bytes", sizeBytes);
  events.emit("histogram", "websocket.message.size", sizeBytes);

  return done();
}

/**
 * Track authentication latency
 */
function trackAuthLatency(context, events, done) {
  const startTime = context.vars.authStartTime || Date.now();
  const latency = Date.now() - startTime;

  events.emit("histogram", "websocket.auth.latency", latency);

  return done();
}

// ═══════════════════════════════════════════════════════════════════════════
// ERROR HANDLING & VALIDATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Validate WebSocket token was received
 */
function validateWsToken(context, events, done) {
  if (!context.vars.wsToken) {
    console.error("[ERROR] WebSocket token not received");
    events.emit("counter", "websocket.token.missing", 1);
    return done(new Error("WebSocket token missing"));
  }
  return done();
}

/**
 * Handle WebSocket error
 */
function handleWsError(context, events, done) {
  console.error("[ERROR] WebSocket error occurred");
  events.emit("counter", "websocket.errors", 1);
  return done();
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

module.exports = {
  // Message generators
  generateMessage,
  generateVariedMessage,
  generateSmallMessage,
  generateMediumMessage,
  generateLargeMessage,
  generateExtraLargeMessage,

  // WebSocket helpers
  prepareNotificationsWs,
  prepareMessagesWs,
  logWsConnection,
  logWsMessage,

  // Compression tests
  generateCompressibleMessage,
  generateIncompressibleMessage,

  // Realistic behavior
  realisticThinkTime,
  shouldSendMessage,

  // Metrics & tracking
  trackMessageSize,
  trackAuthLatency,

  // Error handling
  validateWsToken,
  handleWsError,
};
