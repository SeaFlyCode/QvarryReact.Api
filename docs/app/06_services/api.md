# Services API — Application Mobile Qvarry

## Vue d'ensemble

Tous les services API sont dans `src/services/api/`. Ils encapsulent les appels HTTP vers l'API Qvarry et gèrent automatiquement les tokens, le refresh et les erreurs.

---

## `config.ts` — Configuration centrale

**Exports principaux** :

### URLs

```typescript
export const API_BASE_URL: string;  // ENV.API_BASE_URL
export const WS_BASE_URL: string;   // ENV.WS_BASE_URL
```

### Device ID

```typescript
// Génère ou récupère l'UUID persistant de l'appareil
export const getDeviceId(): Promise<string>;

// Version synchrone (utilise le cache)
export const getDeviceId_sync(): string | null;

// À appeler au démarrage de l'app
export const initializeDeviceId(): Promise<string>;
```

### Headers mobile

```typescript
// Headers complets avec X-Platform, X-Device-ID, Authorization
export const getDefaultHeaders(token?: string): Promise<HeadersInit>;

// Version synchrone (fallback si cache disponible)
export const getDefaultHeadersSync(token?: string): HeadersInit;
```

### Gestion des erreurs

```typescript
class ApiError extends Error {
  statusCode: number;
  message: string;
  errors?: Record<string, string[]>;
}

class MaintenanceError extends ApiError {
  // statusCode = 503
}

class RateLimitError extends ApiError {
  // statusCode = 429
  retryAfter: number; // secondes avant réessai
}
```

### Fetch authentifié

```typescript
// Effectue une requête avec refresh automatique si 401
export const fetchWithAuth(url, options, token?): Promise<Response>;

// Parse la réponse JSON ou lance une ApiError
export const handleResponse<T>(response): Promise<T>;
```

---

## `secureFetch.ts` — Fetch sécurisé

Wrapper de `fetch` qui enforce la sécurité en production :

```typescript
export const secureFetch(url, options?): Promise<Response>;
```

**Vérifications** :
- Protocole HTTPS/WSS obligatoire en production
- Domaines autorisés uniquement : `qvarry.fr`, `challenges.cloudflare.com`
- Ajoute le header `X-Requested-With: QvarryMobile`

En développement (`__DEV__`), ces vérifications sont désactivées pour permettre les appels vers `localhost`.

---

## `auth.ts` — Authentification

```typescript
// Connexion
login(email, password, turnstileToken?): Promise<LoginResponse>
// → { user, accessToken, refreshToken, requiresTwoFactor?, tempToken? }

// Finaliser la connexion 2FA
complete2FALogin(tempToken, totpCode): Promise<LoginResponse>

// Déconnexion
logout(): Promise<void>

// Inscription
register({ name, surname, email, password }): Promise<void>

// Vérifier si la session est encore valide
checkAuthStatus(): Promise<{ isAuthenticated: boolean, user?: User }>

// Rafraîchir le token d'accès
refreshAccessToken(): Promise<string | null>

// Profil de l'utilisateur connecté
getProfile(): Promise<User>
```

---

## `tokenStore.ts` — Token en mémoire

Stockage en mémoire du token d'accès courant (pour éviter des accès Keychain répétés).

```typescript
export const getGlobalToken(): string | null;
export const setGlobalToken(token: string | null): void;
```

---

## `secureTokenStore.ts` — Stockage sécurisé des tokens

Abstraction sur `react-native-keychain` pour stocker les tokens de manière persistante et sécurisée.

```typescript
export const secureTokenStore = {
  setAccessToken(token: string): Promise<void>,
  getAccessToken(): Promise<string | null>,
  setRefreshToken(token: string): Promise<void>,
  getRefreshToken(): Promise<string | null>,
  clearAll(): Promise<void>,
};
```

---

## `refreshManager.ts` — Gestion du refresh automatique

Évite les appels concurrents de refresh (un seul refresh à la fois même si plusieurs requêtes échouent avec 401 simultanément).

```typescript
export const refreshAccessToken(): Promise<string | null>;
```

Implémente un mécanisme de **mutex** : si un refresh est déjà en cours, les autres appelants attendent sa résolution au lieu de lancer un nouveau refresh.

---

## Autres services API

| Fichier             | Endpoints couverts                                      |
| ------------------- | ------------------------------------------------------- |
| `fiches.ts`         | CRUD fiches (`/api/v1/fiches`)                          |
| `lists.ts`          | CRUD listes (`/api/v1/lists`)                           |
| `points.ts`         | Points de fidélité (`/api/v1/points`)                   |
| `contacts.ts`       | Contacts, demandes (`/api/v1/contacts`)                 |
| `conversations.ts`  | Conversations, messages (`/api/v1/conversations`)       |
| `notifications.ts`  | Notifications (`/api/v1/notifications`)                 |
| `sos.ts`            | SOS activation/désactivation (`/api/v1/mobile/sos`)     |
| `adminSos.ts`       | Administration SOS (`/api/v1/admin/sos`)                |
| `users.ts`          | Profil, paramètres (`/api/v1/users`)                    |
| `pushToken.ts`      | Enregistrement FCM (`/api/v1/mobile/push-tokens`)       |
| `share.ts`          | Partage de données (`/api/v1/data-share`)               |
| `sync.ts`           | Synchronisation delta (`/api/v1/mobile/sync`)           |
| `websocket.ts`      | Client WebSocket (`wss://...`)                          |

---

## Pattern d'utilisation

Tous les services suivent le même pattern :

```typescript
import { API_BASE_URL, fetchWithAuth, handleResponse, ApiError } from './config';
import { getDefaultHeadersSync } from './config';

export const getFiches = async (): Promise<Fiche[]> => {
  const token = getGlobalToken();
  const response = await fetchWithAuth(
    `${API_BASE_URL}/fiches`,
    {
      method: 'GET',
      headers: getDefaultHeadersSync(token),
    },
    token
  );
  return handleResponse<Fiche[]>(response);
};
```

Les erreurs sont propagées sous forme d'`ApiError` et gérées par les hooks ou les composants appelants.
