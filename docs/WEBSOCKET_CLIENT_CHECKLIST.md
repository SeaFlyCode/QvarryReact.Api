# 🔍 WebSocket Client - Checklist de Vérification

> **Date :** 18 mars 2026  
> **Contexte :** Rate limiting (code 4029) causé par cycles de reconnexion après auth timeout (code 4001)

---

## ❌ Problème identifié

```
┌─ Cycle observé (répété en boucle toutes les 5-10 secondes)
│
├─ [CLIENT] GET /api/auth/ws-token → Tokens reçus ✓
├─ [CLIENT] Connexion WebSocket → Upgrade OK ✓
├─ [SERVER] Redirection /ws/notifications ou /ws/messages ✓
├─ [CLIENT] Connexion établie ✓
│
├─ ❌ [SERVER] Fermeture après 5s → Code 4001 "Auth timeout"
│
├─ [CLIENT] Reconnexion automatique (tentative 1, 2, 3...)
└─ ❌ [SERVER] Rate limit → Code 4029 "Bloqué 5 minutes"
```

**Cause racine :** Le client ne semble **pas envoyer le message d'authentification** attendu par le serveur après la connexion WebSocket.

---

## ✅ Ce que le serveur attend du client

### 1️⃣ Flux d'authentification complet

```javascript
// ─────────────────────────────────────────────────────────
// ÉTAPE 1 : Obtenir les tokens WebSocket (HTTP)
// ─────────────────────────────────────────────────────────
const response = await fetch("https://qvarry.fr/api/auth/ws-token", {
  headers: {
    Authorization: `Bearer ${accessToken}`, // Token JWT utilisateur
  },
});

const { notificationsToken, messagesToken, expiresIn } = await response.json();
// expiresIn = 300 (5 minutes)

// ─────────────────────────────────────────────────────────
// ÉTAPE 2 : Connexion WebSocket
// ─────────────────────────────────────────────────────────
const ws = new WebSocket("wss://qvarry.fr/ws/notifications");

// ⏰ TIMER CÔTÉ SERVEUR DÉMARRE → 5 SECONDES MAX

// ─────────────────────────────────────────────────────────
// ÉTAPE 3 : Envoyer le message d'authentification
//           ⚠️ OBLIGATOIRE DANS LES 5 SECONDES
// ─────────────────────────────────────────────────────────
ws.onopen = () => {
  console.log("[WebSocket] Connexion établie, envoi du token...");

  // ✅ FORMAT REQUIS PAR LE SERVEUR
  ws.send(
    JSON.stringify({
      type: "auth",
      token: notificationsToken, // OU messagesToken selon le endpoint
    }),
  );
};

// ─────────────────────────────────────────────────────────
// ÉTAPE 4 : Réception de la confirmation
// ─────────────────────────────────────────────────────────
ws.onmessage = (event) => {
  const data = JSON.parse(event.data);

  if (data.type === "connected") {
    console.log("[WebSocket] ✓ Authentification réussie");
    console.log("[WebSocket] Message serveur:", data.message);
    // "WebSocket notifications connecté avec succès"
  }

  if (data.type === "error") {
    console.error("[WebSocket] ✗ Erreur:", data.code, data.message);
  }
};

// ─────────────────────────────────────────────────────────
// ÉTAPE 5 : Gestion de la fermeture
// ─────────────────────────────────────────────────────────
ws.onclose = (event) => {
  console.log("[WebSocket] Déconnexion:", event.code, event.reason);

  switch (event.code) {
    case 4001: // Auth timeout ou token invalide
      console.error("❌ Pas authentifié à temps ou token refusé");
      break;
    case 4002: // Token invalide (signature, format, etc.)
      console.error("❌ Token JWT invalide");
      break;
    case 4003: // Token déjà utilisé ou non participant
      console.error("❌ Token déjà consommé (usage unique)");
      break;
    case 4029: // Rate limit
      console.error("❌ Trop de reconnexions, bloqué 5 minutes");
      break;
  }
};
```

---

## 🔍 Checklist de vérification

### ☑️ 1. Le client envoie-t-il le message `auth` après connexion ?

**Vérifier dans le code :**

```javascript
// ❌ MAUVAIS : Connexion sans authentification
ws.onopen = () => {
  console.log("Connecté"); // Rien envoyé → timeout 4001 après 5s
};

// ✅ BON : Envoi immédiat du token
ws.onopen = () => {
  ws.send(JSON.stringify({ type: "auth", token: wsToken }));
};
```

**Tester dans la console navigateur :**

```javascript
// Après connexion, vérifier les messages envoyés
console.log("[WS Sent]", message);
// Attendu : {"type":"auth","token":"eyJhbGci..."}
```

---

### ☑️ 2. Le token est-il envoyé **dans les 5 secondes** ?

**Causes possibles de délai :**

- Appel asynchrone lent (fetch, async/await) bloquant l'envoi
- Logique métier complexe avant `ws.send()`
- Race condition entre `onopen` et obtention du token

**Solution :**

```javascript
// ✅ Obtenir le token AVANT de créer la connexion WS
const token = await getWebSocketToken(); // HTTP request first
const ws = new WebSocket(url);

ws.onopen = () => {
  // Token déjà disponible, envoi immédiat
  ws.send(JSON.stringify({ type: "auth", token }));
};
```

---

### ☑️ 3. Le token utilisé correspond-il au bon endpoint ?

**Le serveur valide le champ `wsType` du JWT :**

```javascript
// Token notifications : { wsType: "notifications" }
// Token messages :      { wsType: "messages" }

// ❌ MAUVAIS : Token notifications sur /ws/messages
ws = new WebSocket("wss://host/ws/messages");
ws.send(JSON.stringify({ type: "auth", token: notificationsToken }));
// → Code 4002 "Invalid token"

// ✅ BON : Tokens correspondants
wsNotif = new WebSocket("wss://host/ws/notifications");
wsNotif.send(JSON.stringify({ type: "auth", token: notificationsToken }));

wsMsg = new WebSocket("wss://host/ws/messages?conv=123");
wsMsg.send(JSON.stringify({ type: "auth", token: messagesToken }));
```

---

### ☑️ 4. Le token est-il réutilisé (usage unique) ?

**Comportement serveur :**

- Chaque token WebSocket est **à usage unique** (JTI consommé en Redis)
- Deuxième utilisation → Code 4003 "Token already used"

**Causes fréquentes :**

```javascript
// ❌ MAUVAIS : Reconnexion avec le même token
const token = await getWebSocketToken();

const ws1 = new WebSocket(url);
ws1.send(JSON.stringify({ type: "auth", token })); // ✓ OK

// Reconnexion plus tard...
const ws2 = new WebSocket(url);
ws2.send(JSON.stringify({ type: "auth", token })); // ✗ Code 4003

// ✅ BON : Nouveau token à chaque connexion
async function connectWebSocket() {
  const { token } = await getWebSocketToken(); // Fresh token
  const ws = new WebSocket(url);
  ws.send(JSON.stringify({ type: "auth", token }));
}
```

---

### ☑️ 5. Le client gère-t-il le heartbeat (ping/pong) ?

**Comportement serveur :**

- Serveur envoie un `ping` toutes les **30 secondes**
- Client doit répondre automatiquement avec `pong` (natif navigateur)
- Si pas de `pong` reçu → fermeture via `terminate()`

**Vérification :**

```javascript
// ✅ Navigateurs modernes gèrent ping/pong automatiquement
// (pas de code requis)

// ✅ React Native / Node.js : Gestion manuelle
ws.on("ping", () => {
  ws.pong(); // Réponse obligatoire
});
```

**Logs attendus (toutes les 30s) :**

```
[WebSocket] ← Ping reçu du serveur
[WebSocket] → Pong envoyé automatiquement
```

---

### ☑️ 6. La stratégie de reconnexion est-elle appropriée ?

**Configuration serveur actuelle :**

- **Max 10 connexions/minute** par IP
- **Blocage 5 minutes** si dépassé → Code 4029

**Causes de rate limiting :**

```javascript
// ❌ MAUVAIS : Reconnexion immédiate en boucle
ws.onclose = () => {
  console.log("Déconnecté, reconnexion immédiate...");
  connectWebSocket(); // Spam le serveur → rate limit
};

// ✅ BON : Backoff exponentiel
let reconnectDelay = 2000; // 2s initial
const maxDelay = 60000; // 60s max

ws.onclose = (event) => {
  if (event.code === 4029) {
    // Rate limité → attendre 5 minutes
    console.warn("Rate limité, attente 5 minutes...");
    reconnectDelay = 5 * 60 * 1000;
  }

  setTimeout(() => {
    connectWebSocket();
    reconnectDelay = Math.min(reconnectDelay * 2, maxDelay);
  }, reconnectDelay);
};
```

**Délais recommandés :**

```
Tentative 1 : 2 secondes
Tentative 2 : 4 secondes
Tentative 3 : 8 secondes
Tentative 4 : 16 secondes
Tentative 5+ : 60 secondes (max)
```

---

### ☑️ 7. Les logs client sont-ils cohérents avec le serveur ?

**Logs attendus :**

```javascript
// ✅ Connexion réussie
"[API] GET /auth/ws-token → 200 OK";
"[WebSocket] Connexion à ws://...";
"[WebSocket] → Envoi message auth";
'[WebSocket] ← Message: {"type":"connected"}';
"[WebSocket] ✓ Authentifié avec succès";

// ❌ Timeout auth (5s)
"[API] GET /auth/ws-token → 200 OK";
"[WebSocket] Connexion à ws://...";
// Aucun message envoyé...
"[WebSocket] Déconnexion (code: 4001)"; // 5 secondes plus tard

// ❌ Rate limit
"[WebSocket] Connexion à ws://...";
"[WebSocket] Déconnexion (code: 4029)";
"[WebSocket] ⚠️ Rate limité, bloqué 5 minutes";
```

---

## 🎯 Checklist complète (à cocher)

### Phase 1 : Authentification

- [ ] Le client obtient un nouveau token via `GET /auth/ws-token` **avant** chaque connexion WS
- [ ] Le message `{ type: 'auth', token: '...' }` est envoyé **immédiatement** dans `ws.onopen`
- [ ] L'envoi se fait dans **les 5 secondes** après connexion
- [ ] Le token `notificationsToken` est utilisé pour `/ws/notifications`
- [ ] Le token `messagesToken` est utilisé pour `/ws/messages?conv=...`
- [ ] Le token n'est **jamais réutilisé** (nouveau token à chaque reconnexion)

### Phase 2 : Gestion des messages

- [ ] Le client écoute et traite `{ type: 'connected' }` (confirmation d'auth)
- [ ] Le client gère `{ type: 'error' }` (erreurs métier)
- [ ] Le client respecte le rate limit de **60 messages/minute**

### Phase 3 : Heartbeat & Connexion

- [ ] Le client répond aux `ping` (automatique navigateur, manuel Node.js/RN)
- [ ] Les logs montrent les pings toutes les 30 secondes
- [ ] Le client détecte les déconnexions (`onclose`)

### Phase 4 : Reconnexion

- [ ] Le client utilise un **backoff exponentiel** (2s → 4s → 8s → ...)
- [ ] Le délai max est de **60 secondes** entre tentatives
- [ ] Si code **4029** (rate limit) → pause de **5 minutes** avant reconnexion
- [ ] Si code **4001** (auth timeout) → vérifier le flux d'auth, pas juste reconnecter
- [ ] Si code **4002** (token invalide) → obtenir un nouveau token, pas réutiliser l'ancien
- [ ] Si code **4003** (token déjà utilisé) → obtenir un nouveau token

### Phase 5 : Logs & Debug

- [ ] Les logs montrent clairement : obtention token → connexion → envoi auth → confirmation
- [ ] Les codes de fermeture sont loggés avec leur signification
- [ ] Les tentatives de reconnexion sont comptées et loggées

---

## 🔧 Exemple de code complet (référence)

```javascript
class WebSocketManager {
  constructor(url, getTokenFn) {
    this.url = url;
    this.getTokenFn = getTokenFn;
    this.ws = null;
    this.reconnectDelay = 2000;
    this.maxDelay = 60000;
    this.reconnectAttempts = 0;
  }

  async connect() {
    try {
      // 1. Obtenir un nouveau token (HTTP)
      console.log("[WS] Obtention du token...");
      const { token } = await this.getTokenFn();

      // 2. Créer la connexion WebSocket
      console.log("[WS] Connexion à", this.url);
      this.ws = new WebSocket(this.url);

      // 3. Envoyer l'auth dès l'ouverture
      this.ws.onopen = () => {
        console.log("[WS] ✓ Connexion établie, envoi auth...");
        this.ws.send(JSON.stringify({ type: "auth", token }));
        this.reconnectAttempts = 0; // Reset compteur
        this.reconnectDelay = 2000; // Reset délai
      };

      // 4. Gérer les messages
      this.ws.onmessage = (event) => {
        const data = JSON.parse(event.data);

        if (data.type === "connected") {
          console.log("[WS] ✓ Authentifié:", data.message);
        } else if (data.type === "error") {
          console.error("[WS] Erreur:", data.code, data.message);
        } else {
          // Message métier
          this.handleMessage(data);
        }
      };

      // 5. Gérer les fermetures
      this.ws.onclose = (event) => {
        console.log("[WS] Déconnexion:", event.code, event.reason);

        switch (event.code) {
          case 4001:
            console.error("[WS] ✗ Auth timeout ou token refusé");
            break;
          case 4002:
            console.error("[WS] ✗ Token invalide");
            break;
          case 4003:
            console.error("[WS] ✗ Token déjà utilisé");
            break;
          case 4029:
            console.warn("[WS] ⚠️ Rate limité, pause 5 minutes");
            this.reconnectDelay = 5 * 60 * 1000;
            break;
        }

        this.scheduleReconnect();
      };

      // 6. Gérer les erreurs
      this.ws.onerror = (error) => {
        console.error("[WS] Erreur connexion:", error);
      };
    } catch (error) {
      console.error("[WS] Erreur obtention token:", error);
      this.scheduleReconnect();
    }
  }

  scheduleReconnect() {
    this.reconnectAttempts++;

    console.log(
      `[WS] Reconnexion dans ${this.reconnectDelay / 1000}s (tentative ${this.reconnectAttempts})...`,
    );

    setTimeout(() => {
      this.connect();
      // Backoff exponentiel
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxDelay);
    }, this.reconnectDelay);
  }

  send(data) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    } else {
      console.warn("[WS] Connexion non ouverte, message non envoyé");
    }
  }

  disconnect() {
    if (this.ws) {
      this.ws.close(1000, "Client disconnect");
    }
  }

  handleMessage(data) {
    // À implémenter selon les besoins métier
    console.log("[WS] Message reçu:", data);
  }
}

// Usage
async function getWebSocketToken() {
  const response = await fetch("https://qvarry.fr/api/auth/ws-token", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const { notificationsToken } = await response.json();
  return { token: notificationsToken };
}

const wsManager = new WebSocketManager(
  "wss://qvarry.fr/ws/notifications",
  getWebSocketToken,
);

wsManager.connect();
```

---

## 📊 Codes d'erreur WebSocket (référence)

| Code     | Signification                 | Action client                              |
| -------- | ----------------------------- | ------------------------------------------ |
| **1000** | Fermeture normale             | Pas de reconnexion nécessaire              |
| **4001** | Auth timeout / Token invalide | Vérifier le flux d'auth (envoi immédiat ?) |
| **4002** | Token JWT invalide            | Obtenir un nouveau token, vérifier format  |
| **4003** | Token déjà utilisé            | Obtenir un nouveau token (usage unique)    |
| **4029** | Rate limit (10 conn/min)      | Attendre 5 minutes avant reconnexion       |

---

## 🐛 Debugging

### Activer les logs détaillés

```javascript
// Mode debug
const DEBUG = true;

if (DEBUG) {
  // Log tous les messages envoyés
  const originalSend = WebSocket.prototype.send;
  WebSocket.prototype.send = function (data) {
    console.log("[WS →]", data);
    return originalSend.call(this, data);
  };

  // Log tous les messages reçus
  ws.addEventListener("message", (event) => {
    console.log("[WS ←]", event.data);
  });
}
```

### Tester manuellement depuis la console

```javascript
// Dans la console navigateur
const ws = new WebSocket("wss://qvarry.fr/ws/notifications");

ws.onopen = () => {
  console.log("Connecté");

  // Tester l'envoi du token
  const token = "eyJhbGci..."; // Récupérer via localStorage ou autre
  ws.send(JSON.stringify({ type: "auth", token }));
};

ws.onmessage = (e) => console.log("Reçu:", e.data);
ws.onclose = (e) => console.log("Fermé:", e.code, e.reason);
```

---

## 📞 Contact

**Questions ou anomalies détectées ?**  
→ Contacter l'équipe backend avec :

- Les logs client complets (avec timestamps)
- Le code de fermeture WebSocket reçu
- Les tokens utilisés (masquer les valeurs sensibles)

---

**Document généré le 18 mars 2026**  
**Version backend API :** Voir `package.json`
