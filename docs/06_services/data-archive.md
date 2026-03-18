# Service Data Archive (RGPD)

## Table des matières

- [Vue d'ensemble](#vue-densemble)
- [Modèle DeletedData](#modèle-deleteddata)
- [Cycle de vie des données supprimées](#cycle-de-vie-des-données-supprimées)
- [Archivage des données](#archivage-des-données)
- [Restauration des données](#restauration-des-données)
- [Purge définitive](#purge-définitive)
- [Conformité RGPD](#conformité-rgpd)

---

## Vue d'ensemble

Le service Data Archive implémente un mécanisme de **suppression en deux phases** conforme au RGPD :

1. **Archivage** : les données supprimées sont déplacées dans la collection `DeletedData` (elles ne sont plus visibles par l'utilisateur mais restent récupérables)
2. **Purge** : après un délai de grâce, les données archivées sont définitivement supprimées

```
┌─────────────────────────────────────────────────────────────┐
│                    Cycle de vie des données                 │
│                                                             │
│  Données actives → [Suppression utilisateur] → Archivage   │
│  (Collection normale)                         (DeletedData) │
│                                                    │        │
│                              ┌─────────────────── │ ──────▶│
│                              │  Délai de grâce    │        │
│                              │  (X jours)         │        │
│                              └─────────────────── │ ──────▶│
│                                                    ▼        │
│                                          Purge définitive   │
│                                          (cron job)         │
└─────────────────────────────────────────────────────────────┘
```

> ℹ️ Ce système permet de répondre au **droit à l'oubli** (Article 17 RGPD) tout en offrant une période de grâce durant laquelle une restauration reste possible en cas d'erreur.

---

## Modèle DeletedData

```typescript
interface DeletedData {
  _id: ObjectId;

  // Identification
  originalId: ObjectId; // ID original du document supprimé
  entityType: string; // 'fiche' | 'liste' | 'point' | 'message' | 'sosSession' | ...
  userId: ObjectId; // Propriétaire des données

  // Données archivées
  data: object; // Copie complète du document original

  // Métadonnées de suppression
  deletedAt: Date; // Date de suppression initiale
  deletedBy: string; // 'user' | 'admin' | 'system' | 'cron'
  deletionReason?: string; // Raison de la suppression (ex: 'account_deletion')

  // Purge
  purgeAfter: Date; // Date après laquelle la purge définitive est autorisée
  purgedAt?: Date; // Date de purge définitive (null si non encore purgé)

  // Restauration
  restoredAt?: Date; // Date de restauration (si restauré)
  restoredBy?: string; // 'user' | 'admin'
}
```

### Index MongoDB

```javascript
db.deleteddata.createIndex({ userId: 1, entityType: 1 });
db.deleteddata.createIndex({ purgeAfter: 1 }); // Pour le cron de purge
db.deleteddata.createIndex({ originalId: 1 }); // Pour la restauration
db.deleteddata.createIndex({ deletedAt: 1 });
```

---

## Cycle de vie des données supprimées

```
Utilisateur supprime une fiche
          │
          ▼
1. Fiche retirée de la collection Fiche
   (ou soft-delete avec deletedAt = now)
          │
          ▼
2. Copie archivée dans DeletedData :
   {
     originalId: ficheId,
     entityType: 'fiche',
     userId: userId,
     data: { ...ficheComplète },
     deletedAt: now,
     deletedBy: 'user',
     purgeAfter: now + RETENTION_DAYS
   }
          │
          │  [Délai de grâce : RETENTION_DAYS]
          │
          ▼
3. Cron startSosCleanupJob / dataShareCleanupJob
   Cherche DeletedData où purgeAfter < now AND purgedAt = null
          │
          ▼
4. Purge définitive :
   DeletedData.purgedAt = now
   (document conservé comme trace de purge)
   OU
   DeletedData supprimé complètement
```

---

## Archivage des données

### Fonction d'archivage

```typescript
dataArchiveService.archive(
  entityType: string,
  originalId: string,
  data: object,
  options: {
    userId: string;
    deletedBy: 'user' | 'admin' | 'system' | 'cron';
    deletionReason?: string;
    retentionDays?: number;   // Défaut: DATA_RETENTION_DAYS env var
  }
): Promise<DeletedData>
```

### Exemple d'utilisation

```typescript
// Lors de la suppression d'une fiche
const fiche = await Fiche.findByIdAndDelete(ficheId);

if (fiche) {
  await dataArchiveService.archive("fiche", fiche.id, fiche.toObject(), {
    userId: req.user.id,
    deletedBy: "user",
    retentionDays: 30,
  });
}

// Lors de la suppression d'un compte (RGPD)
await dataArchiveService.archiveUserData(userId, {
  deletedBy: "user",
  deletionReason: "account_deletion_request",
  retentionDays: parseInt(process.env.DATA_RETENTION_DAYS || "30"),
});
```

### archiveUserData (suppression de compte)

Lors d'une demande de suppression de compte, toutes les données de l'utilisateur sont archivées en une seule opération :

```typescript
await dataArchiveService.archiveUserData(userId, options);
// Archive : fiches, listes, points, messages, sessions SOS, tokens, etc.
// Anonymise les données dans les collections partagées (conversations, etc.)
```

---

## Restauration des données

Pendant le délai de grâce (`purgeAfter` non dépassé), les données peuvent être restaurées.

### Fonction de restauration

```typescript
dataArchiveService.restore(
  deletedDataId: string,
  options: {
    restoredBy: 'user' | 'admin';
  }
): Promise<object>   // Document restauré
```

### Exemple

```typescript
// Un admin restaure une fiche supprimée par erreur
const restored = await dataArchiveService.restore(deletedDataId, {
  restoredBy: "admin",
});

// Les données sont réinsérées dans la collection d'origine
// DeletedData.restoredAt = now, restoredBy = 'admin'
```

> ⚠️ La restauration n'est possible que si `purgeAfter > now` (délai de grâce non dépassé). Après la purge, aucune restauration n'est possible.

---

## Purge définitive

La purge est déclenchée par les cron jobs de nettoyage. Deux approches sont possibles :

### Approche 1 : Marquage de purge (recommandé pour audit)

```
DeletedData.purgedAt = now
Le document reste en base comme trace de la suppression
```

### Approche 2 : Suppression complète

```
DeletedData supprimé de MongoDB
Aucune trace conservée (conformité droit à l'oubli strict)
```

> ℹ️ Le choix entre les deux approches dépend des exigences légales. L'approche 1 permet de prouver que les données ont bien été supprimées (audit trail). L'approche 2 est plus radicale mais ne laisse aucune trace.

---

## Conformité RGPD

### Articles couverts

| Article RGPD                                  | Implémentation                                        |
| --------------------------------------------- | ----------------------------------------------------- |
| **Art. 17** — Droit à l'effacement            | Archivage + purge définitive après délai de grâce     |
| **Art. 20** — Droit à la portabilité          | Export des données avant suppression (endpoint dédié) |
| **Art. 5(1)(e)** — Limitation de conservation | TTL automatique via `purgeAfter`                      |

### Variables d'environnement

| Variable                     | Description                           | Défaut |
| ---------------------------- | ------------------------------------- | ------ |
| `DATA_RETENTION_DAYS`        | Délai de grâce avant purge définitive | `30`   |
| `SOS_SESSION_RETENTION_DAYS` | Rétention spécifique sessions SOS     | `365`  |

### Délais de rétention recommandés

| Type de données               | Rétention recommandée          | Justification                   |
| ----------------------------- | ------------------------------ | ------------------------------- |
| Données utilisateur générales | 30 jours                       | Standard RGPD                   |
| Sessions SOS                  | 365 jours                      | Valeur médicolégale potentielle |
| Logs d'audit                  | 90 jours                       | Sécurité (via TTL MongoDB)      |
| Push tokens                   | 0 jour (suppression immédiate) | Données techniques              |

---

_Voir aussi : [cron-jobs.md](./cron-jobs.md) — [audit-service.md](./audit-service.md)_
