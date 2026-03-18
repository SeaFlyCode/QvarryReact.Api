# DataShare & DeletedData

## DataShare

Partage chiffré de fiches, points et listes entre utilisateurs. Chaque destinataire reçoit une copie des données chiffrée avec sa propre clé publique RSA — l'émetteur ne peut pas lire les données telles qu'elles sont stockées pour un autre destinataire.

### Interface principale : `IDataShare`

| Champ                      | Type                            | Requis | Description                                                         |
| -------------------------- | ------------------------------- | ------ | ------------------------------------------------------------------- |
| `senderId`                 | `ObjectId` → `User`             | ✅     | Auteur du partage                                                   |
| `receiverIds`              | `ObjectId[]` → `User`           | ✅     | Liste des destinataires                                             |
| `dataType`                 | `"fiche" \| "point" \| "liste"` | ✅     | Type de l'entité partagée                                           |
| `dataId`                   | `ObjectId`                      | ✅     | ID de l'entité d'origine                                            |
| `encryptedDataPerReceiver` | `IEncryptedDataPerReceiver[]`   | —      | Données chiffrées par destinataire                                  |
| `signature`                | `string`                        | ✅     | Signature RSA du hash des données (par l'émetteur)                  |
| `dataHash`                 | `string`                        | ✅     | Hash SHA-256 des données originales (audit d'intégrité)             |
| `relatedPointsIds`         | `ObjectId[]` → `Point`          | —      | IDs des points liés (pour fiches et listes)                         |
| `messagePerReceiver`       | `IMessagePerReceiver[]`         | —      | Message d'accompagnement chiffré par destinataire                   |
| `sharedAt`                 | `Date`                          | —      | Date du partage (défaut: `Date.now`)                                |
| `expiresAt`                | `Date`                          | ✅     | Date d'expiration (calculée automatiquement: `sharedAt + 20 jours`) |
| `notificationSent`         | `boolean`                       | —      | Si la notification a été envoyée (défaut: `false`)                  |
| `readBy`                   | `IReadReceipt[]`                | —      | Accusés de réception par destinataire                               |
| `isActive`                 | `boolean`                       | —      | `false` si supprimé ou expiré (défaut: `true`)                      |
| `createdAt`                | `Date`                          | —      | Géré par `timestamps: true`                                         |
| `updatedAt`                | `Date`                          | —      | Géré par `timestamps: true`                                         |

### Sous-document : `IEncryptedDataPerReceiver`

| Champ           | Type                | Requis | Description                                                |
| --------------- | ------------------- | ------ | ---------------------------------------------------------- |
| `receiverId`    | `ObjectId` → `User` | ✅     | Identifiant du destinataire                                |
| `encryptedData` | `string`            | ✅     | Données chiffrées avec la clé publique RSA du destinataire |
| `status`        | `ShareStatus`       | —      | Statut de lecture (défaut: `"pending"`)                    |

**`ShareStatus`** : `"pending"` | `"read"` | `"accepted"` | `"declined"`

### Sous-document : `IReadReceipt`

| Champ        | Type                 | Description           |
| ------------ | -------------------- | --------------------- |
| `receiverId` | `ObjectId` → `User`  | Destinataire ayant lu |
| `readAt`     | `Date`               | Horodatage de lecture |
| `ipAddress`  | `string` (optionnel) | IP du lecteur (audit) |

### Sous-document : `messagePerReceiver`

| Champ              | Type                | Description                                              |
| ------------------ | ------------------- | -------------------------------------------------------- |
| `receiverId`       | `ObjectId` → `User` | Destinataire du message                                  |
| `encryptedMessage` | `string`            | Message chiffré avec la clé publique RSA du destinataire |

### Index

| Index             | Champs                                          | Type                          | Usage                                 |
| ----------------- | ----------------------------------------------- | ----------------------------- | ------------------------------------- |
| Expiration TTL    | `expiresAt`                                     | TTL (`expireAfterSeconds: 0`) | Suppression automatique à `expiresAt` |
| Sender + date     | `{ senderId: 1, sharedAt: -1 }`                 | Composé                       | Historique des partages envoyés       |
| Receivers + actif | `{ receiverIds: 1, isActive: 1, expiresAt: 1 }` | Composé                       | Partages reçus actifs                 |
| Nettoyage         | `{ expiresAt: 1, isActive: 1 }`                 | Composé                       | Cron de nettoyage                     |
| Sender            | `senderId`                                      | Simple                        | —                                     |
| DataId            | `dataId`                                        | Simple                        | —                                     |
| isActive          | `isActive`                                      | Simple                        | —                                     |
| sharedAt          | `sharedAt`                                      | Simple                        | —                                     |

### Middleware pre-save

Si `expiresAt` n'est pas défini lors de la sauvegarde, il est calculé automatiquement : `expiresAt = sharedAt + 20 jours`.

### Flux de chiffrement

```
Émetteur
  ├─ Hash SHA-256 des données originales → dataHash
  ├─ Signature RSA du hash (clé privée émetteur) → signature
  └─ Pour chaque destinataire :
       └─ Chiffrement hybride RSA+AES (clé publique destinataire) → encryptedData
```

> ⚠️ La vérification de la signature garantit que les données n'ont pas été altérées par un intermédiaire. Chaque entrée `encryptedDataPerReceiver` n'est déchiffrable que par le destinataire correspondant.

---

## DeletedData

Archive des données supprimées. Les données sont physiquement retirées de leur collection d'origine et conservées ici pour audit et récupération potentielle.

### Type énuméré : `DeletedEntityType`

`"fiche"` | `"point"` | `"list"` | `"user"` | `"message"` | `"conversation"` | `"contact"` | `"notification"` | `"dataShare"` | `"maintenance"` | `"sosContact"`

### Interface : `IDeletedData`

| Champ              | Type                      | Requis | Description                                              |
| ------------------ | ------------------------- | ------ | -------------------------------------------------------- |
| `entityType`       | `DeletedEntityType`       | ✅     | Type de l'entité supprimée                               |
| `entityId`         | `ObjectId`                | ✅     | ID de l'entité dans sa collection d'origine              |
| `data`             | `Record<string, unknown>` | ✅     | Snapshot complet de l'entité au moment de la suppression |
| `deletedBy`        | `ObjectId` → `User`       | ✅     | Utilisateur qui a effectué la suppression                |
| `deletedAt`        | `Date`                    | —      | Horodatage (défaut: `Date.now`)                          |
| `deletionReason`   | `string`                  | —      | Raison optionnelle (max 500 caractères)                  |
| `deletionContext`  | `IDeletionContext`        | —      | Métadonnées contextuelles                                |
| `parentEntityType` | `DeletedEntityType`       | —      | Type de l'entité parente (pour cascades)                 |
| `parentEntityId`   | `ObjectId`                | —      | ID de l'entité parente                                   |
| `isRestored`       | `boolean`                 | —      | Si l'entité a été restaurée (défaut: `false`)            |
| `restoredAt`       | `Date`                    | —      | Date de restauration                                     |
| `restoredBy`       | `ObjectId` → `User`       | —      | Utilisateur ayant effectué la restauration               |

### Sous-document : `IDeletionContext`

| Champ       | Type                 | Description                     |
| ----------- | -------------------- | ------------------------------- |
| `ipAddress` | `string` (optionnel) | IP de la requête de suppression |
| `userAgent` | `string` (optionnel) | User-Agent du client            |
| `requestId` | `string` (optionnel) | Correlation ID de la requête    |

### Index

| Index             | Champs                                       | Type                                  | Usage                                  |
| ----------------- | -------------------------------------------- | ------------------------------------- | -------------------------------------- |
| TTL RGPD          | `deletedAt`                                  | TTL (`expireAfterSeconds: 7 776 000`) | Purge automatique après 90 jours       |
| Par type + date   | `{ entityType: 1, deletedAt: -1 }`           | Composé                               | Listing des suppressions par type      |
| Par auteur + date | `{ deletedBy: 1, deletedAt: -1 }`            | Composé                               | Historique d'un utilisateur            |
| Recherche entité  | `{ entityType: 1, entityId: 1 }`             | Composé                               | Retrouver un enregistrement précis     |
| Cascades          | `{ parentEntityType: 1, parentEntityId: 1 }` | Composé                               | Rechercher les suppressions en cascade |
| entityType        | —                                            | Simple                                | —                                      |
| entityId          | —                                            | Simple                                | —                                      |
| deletedBy         | —                                            | Simple                                | —                                      |
| isRestored        | —                                            | Simple                                | —                                      |

### Sanitisation du champ `data`

Le champ `data` (`Schema.Types.Mixed`) est sanitisé via un setter custom :

- Si la taille JSON dépasse 500 000 caractères → `{ error: "Data too large", truncated: true }`
- Les clés commençant par `$` sont supprimées récursivement (protection injection NoSQL)

### Workflow de suppression

```
1. Utilisateur demande suppression
2. Données copiées dans DeletedData (snapshot)
3. Données supprimées de la collection d'origine
4. Les données archivées ne sont JAMAIS relues par l'application
5. TTL: purge automatique après 90 jours (conformité RGPD)
```

> ⚠️ L'archivage et la suppression ne sont pas atomiques (absence de transactions sans replica set). La stratégie de précaution est d'archiver d'abord, supprimer ensuite. En cas d'erreur entre les deux étapes, les données restent accessibles dans la collection d'origine.
