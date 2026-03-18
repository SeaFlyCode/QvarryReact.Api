/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ARTILLERY CUSTOM FUNCTIONS - WebSocket Load Testing
 * ═══════════════════════════════════════════════════════════════════════════
 * Fonctions personnalisées pour enrichir les scénarios Artillery
 */

/**
 * Génère un timestamp ISO 8601 actuel
 * @param {Object} context - Contexte Artillery
 * @param {Object} events - Événements Artillery
 * @param {Function} done - Callback de fin
 */
function generateTimestamp(context, events, done) {
  context.vars.timestamp = new Date().toISOString();
  return done();
}

/**
 * Génère une chaîne aléatoire
 * @param {Object} context - Contexte Artillery
 * @param {Object} events - Événements Artillery
 * @param {Function} done - Callback de fin
 */
function generateRandomString(context, events, done) {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < 16; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  context.vars.randomString = result;
  return done();
}

/**
 * Génère un nombre aléatoire entre 1 et 10000
 * @param {Object} context - Contexte Artillery
 * @param {Object} events - Événements Artillery
 * @param {Function} done - Callback de fin
 */
function generateRandomNumber(context, events, done) {
  context.vars.randomNumber = Math.floor(Math.random() * 10000) + 1;
  return done();
}

/**
 * Génère un payload de message réaliste avec métadonnées
 * @param {Object} context - Contexte Artillery
 * @param {Object} events - Événements Artillery
 * @param {Function} done - Callback de fin
 */
function generateRealisticMessage(context, events, done) {
  const messageTemplates = [
    "Bonjour, comment vas-tu ?",
    "J'ai bien reçu ton message, merci !",
    "Est-ce qu'on peut se voir demain ?",
    "Super, je suis d'accord avec ton plan.",
    "As-tu des nouvelles du projet ?",
    "Merci pour ton aide, c'est très apprécié.",
    "Je pense qu'on devrait se coordonner pour la suite.",
    "Parfait, on fait comme ça alors !",
    "Je te rappelle dès que j'ai des informations.",
    "C'est noté, je m'en occupe tout de suite.",
  ];

  const randomMessage =
    messageTemplates[Math.floor(Math.random() * messageTemplates.length)];

  const payload = {
    type: "message",
    content: randomMessage,
    messageType: "text",
    metadata: {
      timestamp: new Date().toISOString(),
      clientVersion: "1.0.0",
      platform: "load-test",
    },
  };

  context.vars.realisticMessagePayload = JSON.stringify(payload);
  return done();
}

/**
 * Log les métriques personnalisées dans le terminal
 * @param {Object} requestParams - Paramètres de la requête
 * @param {Object} response - Réponse reçue
 * @param {Object} context - Contexte Artillery
 * @param {Object} ee - Event Emitter
 * @param {Function} next - Callback
 */
function logCustomMetrics(requestParams, response, context, ee, next) {
  if (response && response.statusCode) {
    // Émettre des métriques personnalisées
    ee.emit("counter", "websocket.auth.success", 1);

    // Log pour debug
    if (process.env.ARTILLERY_DEBUG) {
      console.log(`[Metric] WebSocket auth successful: ${response.statusCode}`);
    }
  }
  return next();
}

/**
 * Valide la réponse d'authentification WebSocket
 * @param {Object} requestParams - Paramètres de la requête
 * @param {Object} response - Réponse reçue
 * @param {Object} context - Contexte Artillery
 * @param {Object} ee - Event Emitter
 * @param {Function} next - Callback
 */
function validateAuthResponse(requestParams, response, context, ee, next) {
  try {
    if (response && response.body) {
      const data = JSON.parse(response.body);

      if (data.type === "connected") {
        ee.emit("counter", "websocket.connection.success", 1);
      } else if (data.type === "error") {
        ee.emit("counter", "websocket.connection.error", 1);
        console.error(`[Error] WebSocket auth failed: ${data.message}`);
      }
    }
  } catch (error) {
    console.error(
      `[Error] Failed to parse WebSocket response: ${error.message}`,
    );
  }
  return next();
}

/**
 * Mesure la latence de connexion WebSocket
 * @param {Object} context - Contexte Artillery
 * @param {Object} events - Événements Artillery
 * @param {Function} done - Callback de fin
 */
function startConnectionTimer(context, events, done) {
  context.vars.connectionStartTime = Date.now();
  return done();
}

/**
 * Calcule et émet la latence de connexion
 * @param {Object} requestParams - Paramètres de la requête
 * @param {Object} response - Réponse reçue
 * @param {Object} context - Contexte Artillery
 * @param {Object} ee - Event Emitter
 * @param {Function} next - Callback
 */
function measureConnectionLatency(requestParams, response, context, ee, next) {
  if (context.vars.connectionStartTime) {
    const latency = Date.now() - context.vars.connectionStartTime;
    ee.emit("histogram", "websocket.connection.latency", latency);

    if (process.env.ARTILLERY_DEBUG) {
      console.log(`[Metric] WebSocket connection latency: ${latency}ms`);
    }
  }
  return next();
}

// Exporter les fonctions pour Artillery
module.exports = {
  generateTimestamp,
  generateRandomString,
  generateRandomNumber,
  generateRealisticMessage,
  logCustomMetrics,
  validateAuthResponse,
  startConnectionTimer,
  measureConnectionLatency,
};
