# 📦 Système d'Archivage des Données Supprimées

## Vue d'ensemble

Ce système archive automatiquement toutes les données supprimées dans une table `DeletedData`.
Les données sont conservées **chiffrées** (exactement comme en base) pour permettre une restauration si nécessaire.

---

## ✅ Ce qui est archivé

| Fichier | Entités archivées | Status |
|---------|-------------------|--------|
| `authControllers.ts` | Points, Fiches, Listes supprimés | ✅ Actif |
| `conversationsControllers.ts` | Conversations, Messages supprimés | ✅ Actif |
| `notificationService.ts` | Notifications supprimées | ✅ Actif |
| `userServices.ts` | Suppression RGPD (toutes données utilisateur) | ✅ Actif |

---

## 📊 Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        TABLES ACTIVES                           │
│  (Fiches, Points, Users, Messages, Conversations, etc.)        │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ Suppression demandée
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    DataArchiveService                           │
│  - archiveAndRecordDeletion()  → Archive avant suppression     │
│  - archiveEntity()             → Archive simple                 │
│  - markAsRestored()            → Marquer comme restauré         │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────┐
│                      DeletedData                                 │
│                                                                  │
│  - entityType      : Type d'entité (fiche, point, message...)  │
│  - entityId        : ID original de l'entité                    │
│  - data            : Données complètes CHIFFRÉES                │
│  - deletedBy       : Qui a supprimé                             │
│  - deletedAt       : Quand                                      │
│  - deletionReason  : Pourquoi                                   │
│  - isRestored      : Si restauré                                │
│  - restoredAt/By   : Info restauration                          │
└──────────────────────────────────────────────────────────────────┘
```

---

## 🔄 Workflow Suppression

```typescript
import dataArchiveService from '../services/dataArchiveService';

// 1. Récupérer l'entité AVANT suppression
const fiche = await Fiche.findById(id).lean();

// 2. Archiver (données chiffrées conservées)
await dataArchiveService.archiveAndRecordDeletion(
    'fiche',
    id,
    fiche as Record<string, unknown>,
    userId,
    { reason: 'Suppression par utilisateur' }
);

// 3. Supprimer physiquement
await Fiche.findByIdAndDelete(id);
```

---

## ♻️ Restauration (Admin)

```typescript
// 1. Récupérer l'archive
const archived = await dataArchiveService.getArchivedEntity('fiche', ficheId);

// 2. Recréer l'entité
const restored = await Fiche.create(archived.data);

// 3. Marquer comme restauré
await dataArchiveService.markAsRestored('fiche', ficheId, adminId);
```

---

## 📈 Statistiques (Admin Dashboard)

```typescript
const stats = await dataArchiveService.getArchiveStats();
// {
//   totalDeleted: 150,
//   deletedByType: { fiche: 50, point: 80, message: 20 },
//   totalRestored: 5,
//   recentDeletions: 12  // 7 derniers jours
// }
```

---

## 📁 Fichiers

| Fichier | Description |
|---------|-------------|
| `models/deletedData.ts` | Modèle MongoDB pour les données supprimées |
| `services/dataArchiveService.ts` | Service centralisé d'archivage |

---

## 🔒 Sécurité

- Les données restent **chiffrées** dans l'archive
- Seuls les **admins** peuvent consulter et restaurer
- Traçabilité complète : qui, quand, pourquoi
