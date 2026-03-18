# Modèles Conversation et Message

Fichiers sources : `src/models/conversations.ts`, `src/models/messages.ts`

Ces deux modèles gèrent la messagerie interne de l'application. Les conversations peuvent être bilatérales ou de groupe. Le contenu des messages est chiffré en AES-256-GCM via `communicationEncryptionUtils`.

---

## Modèle Conversation

### Interface TypeScript

```typescript
export interface IParticipant {
  userId: Types.ObjectId; // ref: "User"
  role: "admin" | "member";
  joinedAt: Date;
  leftAt?: Date | null;
}

export interface IConversation extends Document {
  name?: string | null;
  isGroup: boolean;
  creatorId: Types.ObjectId; // ref: "User"
  participants: IParticipant[];
  lastMessage?: Types.ObjectId | null; // ref: "Message"
  deletedBy: Types.ObjectId[]; // ref: "User"
  createdAt: Date;
  updatedAt: Date;
}
```

### Schéma

| Champ          | Type           | Contraintes                    | Description                                                                 |
| -------------- | -------------- | ------------------------------ | --------------------------------------------------------------------------- |
| `name`         | String         | optional, trim, default `null` | Nom de la conversation (groupes uniquement)                                 |
| `isGroup`      | Boolean        | required                       | `true` = groupe, `false` = conversation bilatérale                          |
| `creatorId`    | ObjectId       | ref User, default `null`       | Créateur de la conversation                                                 |
| `participants` | [IParticipant] | required                       | Liste des participants avec leur rôle                                       |
| `lastMessage`  | ObjectId       | ref Message, default `null`    | Référence au dernier message (dénormalisation)                              |
| `deletedBy`    | [ObjectId]     | ref User, default `[]`         | Utilisateurs ayant "supprimé" la conversation (soft-delete par utilisateur) |
| `createdAt`    | Date           | auto (timestamps)              | Date de création                                                            |
| `updatedAt`    | Date           | auto (timestamps)              | Date de dernière modification                                               |

### Sous-document Participant

| Champ      | Type     | Contraintes                  | Description                            |
| ---------- | -------- | ---------------------------- | -------------------------------------- |
| `userId`   | ObjectId | ref User, required           | Identifiant de l'utilisateur           |
| `role`     | String   | enum admin\|member, required | Rôle dans la conversation              |
| `joinedAt` | Date     | required                     | Date d'entrée dans la conversation     |
| `leftAt`   | Date     | default `null`               | Date de sortie (null = encore présent) |

### Index

| Champs                                  | Usage                                                               |
| --------------------------------------- | ------------------------------------------------------------------- |
| `participants.userId: 1, updatedAt: -1` | Récupération des conversations d'un utilisateur triées par activité |
| `creatorId: 1`                          | Récupération des conversations créées par un utilisateur            |

---

## Modèle Message

### Interface TypeScript

```typescript
export interface IMessageReply {
  userId: Types.ObjectId; // ref: "User"
  content: string; // maxlength 10000
  createdAt: Date;
}

export interface IMessageMetadata {
  mentions?: Types.ObjectId[]; // ref: "User"
  edited?: boolean;
  deleted?: boolean;
}

export interface IMessage extends Document {
  conversationId: Types.ObjectId; // ref: "Conversation"
  senderId: Types.ObjectId; // ref: "User"
  content: string; // chiffré AES-256-GCM, maxlength 10000
  type: "text" | "system";
  readBy: Types.ObjectId[]; // ref: "User"
  replies: IMessageReply[];
  metadata?: IMessageMetadata;
  createdAt: Date;
  updatedAt: Date;
}
```

### Schéma principal

| Champ            | Type             | Contraintes                         | Description                                           |
| ---------------- | ---------------- | ----------------------------------- | ----------------------------------------------------- |
| `conversationId` | ObjectId         | ref Conversation, required          | Conversation parente                                  |
| `senderId`       | ObjectId         | ref User, required                  | Expéditeur du message                                 |
| `content`        | String           | required, maxlength 10000           | Contenu chiffré AES-256-GCM                           |
| `type`           | String           | enum text\|system, default `"text"` | Type de message (`system` = notification automatique) |
| `readBy`         | [ObjectId]       | ref User                            | Utilisateurs ayant lu le message                      |
| `replies`        | [IMessageReply]  | —                                   | Réponses (threads)                                    |
| `metadata`       | IMessageMetadata | optional                            | Mentions, statuts édition/suppression                 |
| `createdAt`      | Date             | default `Date.now`                  | Date d'envoi                                          |
| `updatedAt`      | Date             | default `Date.now`                  | Date de dernière modification                         |

### Sous-document MessageReply

| Champ       | Type     | Contraintes               | Description           |
| ----------- | -------- | ------------------------- | --------------------- |
| `userId`    | ObjectId | ref User, required        | Auteur de la réponse  |
| `content`   | String   | required, maxlength 10000 | Contenu de la réponse |
| `createdAt` | Date     | default `Date.now`        | Date de la réponse    |

> Le schéma `MessageReplySchema` est déclaré avec `{ _id: false }` — pas de champ `_id` sur ce sous-document.

### Sous-document MessageMetadata

| Champ      | Type       | Description                                     |
| ---------- | ---------- | ----------------------------------------------- |
| `mentions` | [ObjectId] | Utilisateurs mentionnés (`@user`)               |
| `edited`   | Boolean    | Message modifié après envoi                     |
| `deleted`  | Boolean    | Message supprimé (soft-delete côté métadonnées) |

### Index

| Champs                             | Usage                                                           |
| ---------------------------------- | --------------------------------------------------------------- |
| `conversationId: 1, createdAt: -1` | Pagination des messages d'une conversation (requête principale) |
| `conversationId: 1, readBy: 1`     | Comptage des messages non lus dans une conversation             |
| `senderId: 1`                      | Récupération des messages d'un utilisateur                      |

---

## Notes de sécurité

> ⚠️ Le champ `content` est chiffré côté serveur avec `communicationEncryptionUtils` (AES-256-GCM, clé `ENCRYPTION_KEY_COMMUNICATION`) avant l'écriture en base. La clé de déchiffrement n'est jamais exposée au client.

> ⚠️ La suppression d'un message côté utilisateur positionne `metadata.deleted = true` mais ne supprime pas le document MongoDB. La purge physique est effectuée par un processus d'archivage qui copie dans `DeletedData` puis supprime.
