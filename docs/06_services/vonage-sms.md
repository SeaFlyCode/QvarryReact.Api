# Service Vonage SMS

## Table des matières

- [Vue d'ensemble](#vue-densemble)
- [Configuration](#configuration)
- [Initialisation](#initialisation)
- [Envoi de SMS SOS Stage 2](#envoi-de-sms-sos-stage-2)
- [Webhook delivery receipt](#webhook-delivery-receipt)
- [Gestion des erreurs](#gestion-des-erreurs)

---

## Vue d'ensemble

Le service Vonage SMS est un composant **safety-critical** utilisé **exclusivement** pour les alertes SOS Stage 2. Il envoie des SMS aux contacts d'urgence lorsque l'escalade Stage 2 est déclenchée (30 minutes après l'expiration d'une session SOS sans heartbeat).

> ⚠️ **Safety-critical** : ce service est le dernier recours avant intervention physique. Sa disponibilité est vérifiée au démarrage. Un SMS non envoyé peut avoir des conséquences graves.

```
SOS Stage 2 déclenché (30 min après expiration)
              │
              ▼
    vonageService.sendSMS(contact.phone, message)
              │
              ▼
    Vonage SMS API (HTTPS)
              │
              ▼
    SMS livré au contact d'urgence
              │
              ▼ (optionnel)
    POST /api/webhooks/vonage/delivery-receipt
    (confirmation de livraison)
```

---

## Configuration

### Variables d'environnement

| Variable            | Description           | Requis            |
| ------------------- | --------------------- | ----------------- |
| `VONAGE_API_KEY`    | Clé API Vonage        | Oui en production |
| `VONAGE_API_SECRET` | Secret API Vonage     | Oui en production |
| `VONAGE_SMS_FROM`   | Numéro/nom expéditeur | Oui en production |

```env
VONAGE_API_KEY=a1b2c3d4
VONAGE_API_SECRET=xxxxxxxxxxxxxxxx
VONAGE_SMS_FROM=Qvarry
```

> ⚠️ `VONAGE_SMS_FROM` peut être soit un **numéro de téléphone** (format E.164 : `+33612345678`) soit un **nom alphanumérique** (`Qvarry`, max 11 caractères). Les noms alphanumériques ne sont pas disponibles dans tous les pays.

---

## Initialisation

```typescript
// Au démarrage de l'application (index.ts)
import { vonageService } from "./services/vonageService";

vonageService.initialize();

// Vérification critique
if (!vonageService.isReady()) {
  logger.critical(
    "[VONAGE] Service SMS non configure. " +
      "Les alertes SOS Stage 2 ne fonctionneront PAS. " +
      "Configurer VONAGE_API_KEY et VONAGE_API_SECRET.",
  );
  // L'application continue mais les SMS Stage 2 seront desactives
}
```

### Niveaux de log au démarrage

| État                              | Niveau de log | Message                                                                |
| --------------------------------- | ------------- | ---------------------------------------------------------------------- |
| Variables présentes, connexion OK | `info`        | `[VONAGE] Service SMS initialisé`                                      |
| Variables absentes                | `critical`    | `[VONAGE] Service SMS non configuré - alertes SOS Stage 2 désactivées` |
| Variables présentes, connexion KO | `error`       | `[VONAGE] Échec connexion API Vonage`                                  |

> ⚠️ Contrairement à la plupart des services optionnels, l'absence de configuration Vonage déclenche un log de niveau **CRITICAL** car il s'agit d'un composant de sécurité.

---

## Envoi de SMS SOS Stage 2

### Signature de la fonction

```typescript
vonageService.sendSMS(
  to: string,           // Numero E.164 : +33612345678
  message: string,      // Corps du SMS (max 160 char pour 1 SMS)
  sessionId?: string    // ID session SOS (pour le webhook de suivi)
): Promise<VonageSmsResult>
```

### Exemple d'appel (depuis sos-service)

```typescript
// Lors du declenchement Stage 2
const smsText =
  "ALERTE URGENCE - " +
  userName +
  " n'a pas donne signe de vie. " +
  "Derniere localisation connue : " +
  lastKnownLocation +
  ". " +
  "Session SOS declenchee il y a " +
  elapsedMinutes +
  " minutes. " +
  "Contactez le 15.";

for (const contact of emergencyContacts) {
  await vonageService.sendSMS(contact.phone, smsText, session.id);
}
```

### Format du SMS d'urgence

```
ALERTE URGENCE - Jean Dupont n'a pas donne signe de vie.
Derniere position : 43.2965N, 5.3698E (45 min ago).
Session SOS declenchee il y a 30 minutes.
Contactez le 15 (SAMU) ou le 196 (CROSS).
```

> ⚠️ Les SMS sont limités à **160 caractères** (1 segment). Au-delà, Vonage envoie plusieurs SMS concaténés (surcoût). Le message est tronqué si nécessaire pour rester en 1 segment sur les numéros critiques.

### Résultat retourné

```typescript
interface VonageSmsResult {
  success: boolean;
  messageId?: string; // ID Vonage pour le suivi
  to: string; // Numéro destinataire
  error?: string; // Message d'erreur si echec
  cost?: string; // Coût en euros (optionnel)
}
```

---

## Webhook delivery receipt

Vonage peut notifier l'API lorsqu'un SMS est livré (ou échoue). Ce webhook est **optionnel** mais recommandé pour les SMS critiques.

### Endpoint

```
POST /api/webhooks/vonage/delivery-receipt
```

> ⚠️ Cet endpoint est **public** (pas d'authentification JWT) mais vérifie la signature Vonage. Configurer l'URL dans le tableau de bord Vonage.

### Configuration dans Vonage Dashboard

```
SMS → Settings → Delivery Receipts → Webhook URL :
https://api.qvarry.com/api/webhooks/vonage/delivery-receipt
```

### Corps de la requête Vonage

```json
{
  "msisdn": "33612345678",
  "to": "Qvarry",
  "network-code": "20801",
  "messageId": "0A000000F5C7B56A",
  "price": "0.0533",
  "status": "delivered",
  "scts": "2603181000",
  "err-code": "0",
  "message-timestamp": "2026-03-18 10:00:00"
}
```

### Statuts possibles

| Statut      | Description                     | Action                        |
| ----------- | ------------------------------- | ----------------------------- |
| `delivered` | SMS livré avec succès           | Log info, mise à jour session |
| `failed`    | Échec de livraison              | Log error, alerte admin       |
| `rejected`  | SMS rejeté par l'opérateur      | Log warning                   |
| `expired`   | SMS expiré (72h sans livraison) | Log warning, alerte admin     |
| `unknown`   | Statut inconnu                  | Log warning                   |

---

## Gestion des erreurs

### Erreurs Vonage courantes

| Code erreur Vonage | Description                          | Action recommandée              |
| ------------------ | ------------------------------------ | ------------------------------- |
| `1`                | Throttled — trop d'envois simultanés | Retry avec backoff              |
| `2`                | Missing params                       | Vérifier les paramètres         |
| `3`                | Invalid params                       | Vérifier le numéro de téléphone |
| `4`                | Invalid credentials                  | Vérifier VONAGE_API_KEY/SECRET  |
| `5`                | Internal error                       | Retry                           |
| `6`                | Invalid message                      | Message trop long ou invalide   |
| `9`                | Partner quota exceeded               | Quota mensuel dépassé           |
| `15`               | Invalid sender                       | VONAGE_SMS_FROM invalide        |

### Comportement en cas d'échec

```
vonageService.sendSMS() échoue
          │
          ▼
  Log level ERROR avec details
  {
    sessionId, contactPhone, error, retryable
  }
          │
          ▼
  si retryable → 1 retry après 5 secondes
          │
     ┌────┴────┐
     │         │
   Succès   Echec final
     │         │
     ▼         ▼
  Log info   Log CRITICAL
             "SMS SOS Stage 2 non envoyé"
             Audit: SOS_SMS_FAILED
```

---

_Voir aussi : [sos-service.md](./sos-service.md) — [cron-jobs.md](./cron-jobs.md) — [sos-mode.md](../05_mobile/sos-mode.md)_
