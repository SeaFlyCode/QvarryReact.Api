# Push Tokens FCM — /api/v1/mobile/push-tokens

## Table des matières

- [Vue d'ensemble](#vue-densemble)
- [POST /mobile/push-tokens](#post-mobilepush-tokens)
- [DELETE /mobile/push-tokens/:token](#delete-mobilepush-tokenstoken)
- [GET /mobile/push-tokens](#get-mobilepush-tokens)
- [Cycle de vie d'un token](#cycle-de-vie-dun-token)

---

## Vue d'ensemble

Les push tokens FCM (Firebase Cloud Messaging) permettent à l'API d'envoyer des **notifications push** aux appareils mobiles des utilisateurs. Chaque appareil doit enregistrer son token après connexion.

### Cas d'usage des notifications push

| Événement                                      | Destinataire                              |
| ---------------------------------------------- | ----------------------------------------- |
| Session SOS expirée (Stage 0)                  | Utilisateur lui-même                      |
| Alerte SOS Stage 1                             | Contacts d'urgence                        |
| Demande de contact reçue                       | Utilisateur destinataire                  |
| Message reçu                                   | Utilisateur destinataire                  |
| Redémarrage serveur SOS (`SOS_SERVER_RESTART`) | Tous les utilisateurs avec session active |
| Compte approuvé                                | Utilisateur concerné                      |

> ⚠️ **Toutes les routes push-tokens requièrent un Bearer token valide.** Les tokens sont liés à un utilisateur authentifié.

### Headers obligatoires

```http
Authorization: Bearer eyJhbGci...
X-Platform: ios          (ou android)
X-Device-ID: <UUID v4>
X-App-Version: 2.1.0
Content-Type: application/json
```

---

## POST /mobile/push-tokens

Enregistre ou met à jour un token FCM pour l'appareil courant.

> ℹ️ Si un token existe déjà pour ce `deviceId`, il est **remplacé** (upsert). Cela couvre les cas de rotation automatique de token FCM.

### Requête

```http
POST /api/v1/mobile/push-tokens
Authorization: Bearer eyJhbGci...
X-Platform: ios
X-Device-ID: 550e8400-e29b-41d4-a716-446655440000
X-App-Version: 2.1.0
Content-Type: application/json
```

```json
{
  "token": "fMEjhG8zQ9y3vV7nKpT2dP:APA91bHd...",
  "platform": "ios",
  "deviceId": "550e8400-e29b-41d4-a716-446655440000"
}
```

| Champ      | Type   | Requis | Description                                                    |
| ---------- | ------ | ------ | -------------------------------------------------------------- |
| `token`    | string | ✅     | Token FCM fourni par Firebase SDK                              |
| `platform` | string | ✅     | `ios` ou `android`                                             |
| `deviceId` | string | ✅     | UUID de l'appareil (doit correspondre au header `X-Device-ID`) |

### Réponse succès `201 Created`

```json
{
  "message": "Token enregistré avec succès",
  "tokenId": "64a1b2c3d4e5f6789012999",
  "platform": "ios",
  "registeredAt": "2026-03-18T10:00:00.000Z"
}
```

### Réponse succès `200 OK` (token mis à jour)

```json
{
  "message": "Token mis à jour avec succès",
  "tokenId": "64a1b2c3d4e5f6789012999",
  "platform": "ios",
  "updatedAt": "2026-03-18T10:00:00.000Z"
}
```

### Quand enregistrer le token ?

```
Flux recommandé côté application mobile :

1. Connexion réussie (POST /auth/login) → accessToken obtenu
2. Demande de permission notifications à l'OS
3. Firebase SDK → token FCM obtenu
4. POST /push-tokens avec le token FCM
5. Token enregistré → notifications actives

En cas de rotation de token (Firebase génère un nouveau token) :
1. Callback onTokenRefresh() déclenché
2. POST /push-tokens avec le nouveau token
```

### Réponses d'erreur

| HTTP  | Code erreur          | Description                                          |
| ----- | -------------------- | ---------------------------------------------------- |
| `400` | `VALIDATION_ERROR`   | Token, platform ou deviceId manquant                 |
| `400` | `INVALID_PLATFORM`   | Valeur platform invalide (hors `ios`/`android`)      |
| `400` | `DEVICE_ID_MISMATCH` | `deviceId` ne correspond pas au header `X-Device-ID` |
| `401` | `UNAUTHORIZED`       | Token JWT invalide                                   |

---

## DELETE /mobile/push-tokens/:token

Supprime un token FCM. À appeler lors de la déconnexion pour arrêter les notifications push sur cet appareil.

### Requête

```http
DELETE /api/v1/mobile/push-tokens/fMEjhG8zQ9y3vV7nKpT2dP%3AAPA91bHd...
Authorization: Bearer eyJhbGci...
X-Platform: ios
X-Device-ID: 550e8400-e29b-41d4-a716-446655440000
X-App-Version: 2.1.0
```

> ℹ️ Le token FCM doit être encodé en URL (`encodeURIComponent`) car il contient des caractères spéciaux (`:`, `+`, etc.).

### Réponse succès `200 OK`

```json
{
  "message": "Token supprimé avec succès"
}
```

### Réponses d'erreur

| HTTP  | Code erreur       | Description                                |
| ----- | ----------------- | ------------------------------------------ |
| `401` | `UNAUTHORIZED`    | Token JWT invalide                         |
| `403` | `FORBIDDEN`       | Ce token appartient à un autre utilisateur |
| `404` | `TOKEN_NOT_FOUND` | Token non trouvé                           |

---

## GET /mobile/push-tokens

Retourne la liste de tous les tokens FCM enregistrés pour l'utilisateur authentifié.

### Requête

```http
GET /api/v1/mobile/push-tokens
Authorization: Bearer eyJhbGci...
X-Platform: ios
X-Device-ID: 550e8400-e29b-41d4-a716-446655440000
X-App-Version: 2.1.0
```

### Réponse succès `200 OK`

```json
{
  "tokens": [
    {
      "id": "64a1b2c3d4e5f6789012999",
      "token": "fMEjhG8zQ9y3vV7nKpT2dP:APA91bHd...",
      "platform": "ios",
      "deviceId": "550e8400-e29b-41d4-a716-446655440000",
      "registeredAt": "2026-03-18T10:00:00.000Z",
      "lastUsedAt": "2026-03-18T10:30:00.000Z",
      "active": true
    },
    {
      "id": "64a1b2c3d4e5f678901300a",
      "token": "cXKpT4mQ8z:APA91bGe...",
      "platform": "android",
      "deviceId": "660f9511-f30c-52e5-b827-557766551111",
      "registeredAt": "2026-02-10T14:00:00.000Z",
      "lastUsedAt": "2026-03-15T08:00:00.000Z",
      "active": true
    }
  ],
  "total": 2
}
```

| Champ          | Description                                     |
| -------------- | ----------------------------------------------- |
| `id`           | Identifiant MongoDB du token                    |
| `token`        | Valeur du token FCM                             |
| `platform`     | Plateforme (`ios` ou `android`)                 |
| `deviceId`     | UUID de l'appareil associé                      |
| `registeredAt` | Date d'enregistrement                           |
| `lastUsedAt`   | Dernière utilisation pour envoi de notification |
| `active`       | `false` si le token a été invalidé par FCM      |

---

## Cycle de vie d'un token

```
Installation de l'app
        │
        ▼
Firebase SDK → génère token FCM initial
        │
        ▼
POST /push-tokens         ← Enregistrement
        │
        ▼
Token actif → notifications push reçues
        │
  ┌─────┴──────────────────────────┐
  │                                │
  ▼                                ▼
Firebase rotation du token    Déconnexion utilisateur
(onTokenRefresh callback)         │
        │                         ▼
        ▼                  DELETE /push-tokens/:token
POST /push-tokens (update)        │
  (upsert sur deviceId)            ▼
                           Token supprimé → plus de notifs
        │
        │  (si token devenu invalide → FCM retourne 404)
        ▼
startPushTokenCleanupJob    ← Nettoyage automatique quotidien (3h30)
supprime les tokens obsolètes
```

### Nettoyage automatique

Le job `startPushTokenCleanupJob` s'exécute **tous les jours à 3h30** et supprime :

- Les tokens marqués comme invalides par FCM (erreur `registration-token-not-registered`)
- Les tokens non utilisés depuis plus de 90 jours

---

_Voir aussi : [push-notifications.md](../06_services/push-notifications.md) — [cron-jobs.md](../06_services/cron-jobs.md)_
