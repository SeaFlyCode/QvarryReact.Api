# Jobs Planifiés (node-cron)

## Table des matières

- [Vue d'ensemble](#vue-densemble)
- [Liste des jobs](#liste-des-jobs)
- [Protection contre les exécutions simultanées](#protection-contre-les-exécutions-simultanées)
- [Détail de chaque job](#détail-de-chaque-job)
- [Monitoring et logs](#monitoring-et-logs)

---

## Vue d'ensemble

Les jobs planifiés sont gérés par **`node-cron`** et s'exécutent dans le processus Node.js principal. Ils assurent la maintenance automatique de la base de données et le déclenchement de l'escalade SOS.

```
┌─────────────────────────────────────────────────────────┐
│                   node-cron Scheduler                   │
│                                                         │
│  Tous les jours 03:00  → startDataShareCleanupJob       │
│  Tous les jours 03:30  → startPushTokenCleanupJob       │
│  Planifié              → startNotificationCleanupJob    │
│  Planifié              → startRefreshTokenCleanupJob    │
│  Toutes les 1 min      → startSosEscalationJob          │
│  Planifié              → startSosCleanupJob             │
└─────────────────────────────────────────────────────────┘
```

> ⚠️ Les jobs s'exécutent dans le **fuseau horaire du serveur**. Vérifier la variable `TZ` en production si les horaires de nettoyage sont critiques.

---

## Liste des jobs

| Job                           | Fréquence          | Heure       | Description                              |
| ----------------------------- | ------------------ | ----------- | ---------------------------------------- |
| `startDataShareCleanupJob`    | Quotidien          | 03:00       | Supprime les partages de données expirés |
| `startPushTokenCleanupJob`    | Quotidien          | 03:30       | Supprime les push tokens obsolètes       |
| `startNotificationCleanupJob` | Planifié           | —           | Nettoie les anciennes notifications      |
| `startRefreshTokenCleanupJob` | Planifié           | —           | Purge les refresh tokens expirés         |
| `startSosEscalationJob`       | Toutes les minutes | `* * * * *` | Vérifie et déclenche l'escalade SOS      |
| `startSosCleanupJob`          | Planifié           | —           | Nettoie les vieilles sessions SOS        |

### Expressions cron

```
# Syntaxe : seconde(opt) minute heure jour-mois mois jour-semaine

0 3 * * *     → Tous les jours à 03:00
30 3 * * *    → Tous les jours à 03:30
* * * * *     → Toutes les minutes
0 4 * * *     → Tous les jours à 04:00
0 2 * * 0     → Tous les dimanches à 02:00
```

---

## Protection contre les exécutions simultanées

Chaque job est protégé par un **mutex simple** (flag booléen) pour éviter les exécutions parallèles si un job précédent est encore en cours.

```typescript
// Pattern utilisé pour chaque job
let isDataShareCleanupRunning = false;

cron.schedule("0 3 * * *", async () => {
  if (isDataShareCleanupRunning) {
    logger.warn("[CRON] dataShareCleanup déjà en cours - skip");
    return;
  }

  isDataShareCleanupRunning = true;
  try {
    await runDataShareCleanup();
  } catch (error) {
    logger.error("[CRON] Erreur dataShareCleanup", { error });
  } finally {
    isDataShareCleanupRunning = false;
  }
});
```

| Flag                           | Job protégé                   |
| ------------------------------ | ----------------------------- |
| `isDataShareCleanupRunning`    | `startDataShareCleanupJob`    |
| `isPushTokenCleanupRunning`    | `startPushTokenCleanupJob`    |
| `isNotificationCleanupRunning` | `startNotificationCleanupJob` |
| `isRefreshTokenCleanupRunning` | `startRefreshTokenCleanupJob` |
| `isSosEscalationRunning`       | `startSosEscalationJob`       |
| `isSosCleanupRunning`          | `startSosCleanupJob`          |

---

## Détail de chaque job

### startDataShareCleanupJob

**Fréquence** : Tous les jours à 03:00

**Objectif** : Supprimer les partages de données dont la date d'expiration est passée.

```
Sélectionne DataShare où :
  expiresAt < now()
  status = 'active'

Pour chaque partage expiré :
  1. Passer status → 'expired'
  2. Archiver dans DeletedData (RGPD)
  3. Notifier les utilisateurs concernés (optionnel)

Log résultat :
  [CRON] dataShareCleanup : 12 partages expirés traités
```

**Modèle MongoDB** : `DataShare`

---

### startPushTokenCleanupJob

**Fréquence** : Tous les jours à 03:30

**Objectif** : Supprimer les push tokens FCM devenus invalides ou obsolètes.

```
Sélectionne PushToken où :
  active = false                    ← Invalidés par FCM
  OU lastUsedAt < now() - 90 jours  ← Non utilisés depuis 90 jours

Supprime ces tokens de la collection

Log résultat :
  [CRON] pushTokenCleanup : 8 tokens supprimés (3 invalides, 5 obsolètes)
```

**Modèle MongoDB** : `PushToken`

---

### startNotificationCleanupJob

**Fréquence** : Planifiée (configuration à définir, recommandé quotidien ~04:00)

**Objectif** : Supprimer les anciennes notifications lues pour réduire la taille de la collection.

```
Sélectionne Notification où :
  read = true
  createdAt < now() - 30 jours

Supprime ces notifications

Log résultat :
  [CRON] notificationCleanup : 156 notifications supprimées
```

**Modèle MongoDB** : `Notification`

---

### startRefreshTokenCleanupJob

**Fréquence** : Planifiée (recommandé toutes les heures ou quotidien)

**Objectif** : Purger les refresh tokens expirés de MongoDB.

```
Sélectionne RefreshToken où :
  expiresAt < now()

Supprime ces tokens

Log résultat :
  [CRON] refreshTokenCleanup : 42 tokens expirés supprimés
```

**Modèle MongoDB** : `RefreshToken`

---

### startSosEscalationJob

**Fréquence** : Toutes les minutes (`* * * * *`)

> ⚠️ **Job le plus critique** : c'est lui qui déclenche les alertes SOS. Une interruption de ce job peut retarder les alertes d'urgence.

**Objectif** : Vérifier toutes les sessions SOS et déclencher les escalades nécessaires.

```
Toutes les minutes :

1. Chercher sessions SOS avec status IN ['ACTIVE', 'EXPIRED', 'ESCALATING']

2. Pour chaque session :

   a. Si status = 'ACTIVE' et expiresAt < now()
      → Passer status → 'EXPIRED'
      → Déclencher Stage 0 (notification push locale)

   b. Si status = 'EXPIRED' et (now() - expiresAt) >= STAGE_1_DELAY_MINUTES
      → Déclencher Stage 1 si pas encore déclenché
      → Push + WebSocket aux contacts
      → Passer status → 'ESCALATING', escalationStage = 1

   c. Si status = 'ESCALATING' et (now() - expiresAt) >= STAGE_2_DELAY_MINUTES
      → Déclencher Stage 2 si pas encore déclenché
      → SMS Vonage aux contacts
      → escalationStage = 2

3. Pour les sessions de groupe : traiter chaque participant séparément
```

**Diagramme d'escalade dans le job :**

```
Exécution du job (t = now)
         │
         ▼
SOS.find({ status: ['ACTIVE', 'EXPIRED', 'ESCALATING'] })
         │
         ▼
Pour session S :

  expiresAt = T0

  t < T0              → Rien (session active normale)
  T0 <= t < T0+15min  → Stage 0 (alarme locale push)
  T0+15min <= t       → Stage 1 (alertes contacts)  si !stage1Done
  T0+30min <= t       → Stage 2 (SMS Vonage)         si !stage2Done
```

**Modèle MongoDB** : `SosSession`

---

### startSosCleanupJob

**Fréquence** : Planifiée (recommandé hebdomadaire)

**Objectif** : Archiver ou supprimer les vieilles sessions SOS résolues.

```
Sélectionne SosSession où :
  status IN ['RESOLVED', 'CANCELLED']
  resolvedAt < now() - 365 jours

Archive dans DeletedData (RGPD conservation)
Supprime de la collection principale

Log résultat :
  [CRON] sosCleanup : 3 sessions archivées
```

**Modèle MongoDB** : `SosSession`

---

## Monitoring et logs

### Format des logs de jobs

```
[CRON] <jobName> - Démarrage
[CRON] <jobName> - Terminé en <duration>ms (N éléments traités)
[CRON] <jobName> - Erreur : <message>
[CRON] <jobName> - Skip (déjà en cours)
```

### Exemple de log d'exécution

```
2026-03-18 03:00:00 [info]  [CRON] dataShareCleanup - Démarrage
2026-03-18 03:00:00 [info]  [CRON] dataShareCleanup - Terminé en 245ms (12 partages traités)
2026-03-18 03:30:00 [info]  [CRON] pushTokenCleanup - Démarrage
2026-03-18 03:30:00 [info]  [CRON] pushTokenCleanup - Terminé en 89ms (8 tokens supprimés)
2026-03-18 10:01:00 [info]  [CRON] sosEscalation - Démarrage
2026-03-18 10:01:00 [warn]  [CRON] sosEscalation - Session 64a1b2c3... expirée → Stage 0
2026-03-18 10:01:00 [info]  [CRON] sosEscalation - Terminé en 312ms (1 session traitée)
```

### Alertes de monitoring recommandées

| Condition                                               | Alerte   |
| ------------------------------------------------------- | -------- |
| `startSosEscalationJob` ne s'exécute pas depuis > 2 min | CRITICAL |
| Job en erreur 3 fois consécutives                       | WARNING  |
| Durée d'exécution > 30s pour `sosEscalationJob`         | WARNING  |

---

_Voir aussi : [sos-service.md](./sos-service.md) — [push-notifications.md](./push-notifications.md) — [vonage-sms.md](./vonage-sms.md)_
