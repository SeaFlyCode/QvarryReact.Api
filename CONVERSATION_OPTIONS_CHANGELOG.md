# 🚀 Changelog : Nouvelles options de conversation

**Date** : 20 Mars 2026  
**Version** : API v1  
**Auteur** : Équipe Backend QvarryReact

---

## 📋 Résumé des changements

Ajout de 5 nouvelles fonctionnalités majeures pour la gestion des conversations :

1. **Mute/Unmute** - Couper les notifications (permanent ou temporaire)
2. **Archive/Unarchive** - Ranger les conversations sans les supprimer
3. **Pin/Unpin** - Épingler jusqu'à 5 conversations en haut de liste
4. **Mark as Unread** - Marquer manuellement comme non lu
5. **Block/Unblock** - Bloquer une conversation spécifique

---

## ✨ Nouvelles fonctionnalités

### 1. MUTE/UNMUTE 🔕

**Description** : Permet de couper les notifications d'une conversation, avec support du mute temporaire ou permanent.

**Endpoints ajoutés :**

- `PATCH /api/v1/conversations/:id/mute`
- `PATCH /api/v1/conversations/:id/unmute`

**Options :**

- Mute permanent (pas de date de fin)
- Mute temporaire (avec date d'expiration)
- Notification sur mention même si muted (paramètre `notifyOnMention`)
- Limite : Maximum 1 an de mute

**Impact :**

- Les notifications push/email/WebSocket sont bloquées pour les conversations mutées
- Exception : Les mentions (@username) peuvent continuer à notifier si `notifyOnMention: true`
- Nettoyage automatique des mutes expirés toutes les heures (cron job)

---

### 2. ARCHIVE/UNARCHIVE 📁

**Description** : Permet d'archiver des conversations pour les ranger sans les supprimer.

**Endpoints ajoutés :**

- `PATCH /api/v1/conversations/:id/archive`
- `PATCH /api/v1/conversations/:id/unarchive`
- `GET /api/v1/conversations/archived`

**Options :**

- Pagination (limit, skip)
- Les conversations archivées restent archivées même si nouveaux messages
- Exclues par défaut de `GET /conversations` (sauf si `?includeArchived=true`)

**Impact :**

- Les conversations archivées disparaissent de la liste principale
- Accessible via section dédiée "Conversations archivées"
- Les nouveaux messages n'affectent pas le statut archivé (différent du soft delete)

---

### 3. PIN/UNPIN 📌

**Description** : Permet d'épingler des conversations importantes en haut de liste.

**Endpoints ajoutés :**

- `PATCH /api/v1/conversations/:id/pin`
- `PATCH /api/v1/conversations/:id/unpin`

**Options :**

- Maximum 5 conversations épinglées par utilisateur
- Ordre personnalisable (paramètre `order` de 1 à 5)
- Auto-calcul de l'ordre si non spécifié

**Impact :**

- Les conversations épinglées apparaissent en haut de `GET /conversations`
- Tri : Épinglées par `pinOrder` croissant, puis non-épinglées par `updatedAt` décroissant

---

### 4. MARK AS UNREAD ●

**Description** : Permet de marquer manuellement une conversation comme non lue.

**Endpoints ajoutés :**

- `PATCH /api/v1/conversations/:id/mark-unread`
- `PATCH /api/v1/conversations/:id/mark-read-flag`

**Impact :**

- Affiche un badge "non lu" même si tous les messages sont lus
- Utile pour se rappeler de répondre plus tard

---

### 5. BLOCK/UNBLOCK 🚫

**Description** : Permet de bloquer une conversation spécifique (différent du blocage de contact).

**Endpoints ajoutés :**

- `PATCH /api/v1/conversations/:id/block`
- `PATCH /api/v1/conversations/:id/unblock`

**Options :**

- Raison optionnelle (max 500 caractères)

**Impact :**

- Empêche l'envoi et la réception de messages dans cette conversation
- Plus granulaire que le blocage de contact (n'affecte que cette conversation)
- Vérification côté WebSocket pour bloquer en temps réel

---

## 🗂️ Modifications du modèle de données

### Nouveaux champs dans `Conversation`

```typescript
interface IConversation {
  // ... champs existants ...

  mutedBy: {
    userId: Types.ObjectId;
    mutedAt: Date;
    mutedUntil?: Date | null; // null = permanent
    notifyOnMention?: boolean; // défaut: true
  }[];

  archivedBy: {
    userId: Types.ObjectId;
    archivedAt: Date;
  }[];

  pinnedBy: {
    userId: Types.ObjectId;
    pinnedAt: Date;
    order: number; // 1 à 5
  }[];

  markedUnreadBy: {
    userId: Types.ObjectId;
    markedAt: Date;
  }[];

  blockedBy: {
    userId: Types.ObjectId;
    blockedAt: Date;
    reason?: string;
  }[];
}
```

### Nouveaux index pour performances

```typescript
conversationSchema.index({ "mutedBy.userId": 1 });
conversationSchema.index({ "archivedBy.userId": 1 });
conversationSchema.index({ "pinnedBy.userId": 1, "pinnedBy.order": 1 });
conversationSchema.index({ markedUnreadBy: 1 });
conversationSchema.index({ "blockedBy.userId": 1 });
```

---

## 📡 Modifications des réponses API

### Nouveau champ `userPreferences` dans GET /conversations

Chaque conversation contient maintenant un objet `userPreferences` :

```json
{
  "conversations": [
    {
      "id": "...",
      "name": "...",
      "isGroup": true,
      "lastMessage": {...},
      "unreadCount": 3,

      "userPreferences": {
        "isMuted": true,
        "mutedUntil": "2026-03-21T18:00:00Z",
        "notifyOnMention": true,
        "isArchived": false,
        "isPinned": true,
        "pinOrder": 2,
        "isMarkedUnread": false,
        "isBlocked": false
      }
    }
  ]
}
```

---

## 🔧 Fichiers modifiés/créés

### Modèles

- ✅ `/src/models/conversations.ts` - Ajout des nouveaux champs + index

### Controllers

- ✅ `/src/controllers/conversationsControllers.ts` - Ajout de 14 nouvelles fonctions :
  - `muteConversation()`
  - `unmuteConversation()`
  - `archiveConversation()`
  - `unarchiveConversation()`
  - `getArchivedConversations()`
  - `pinConversation()`
  - `unpinConversation()`
  - `markConversationAsUnread()`
  - `markConversationAsReadFlag()`
  - `blockConversation()`
  - `unblockConversation()`
  - Modification de `getConversations()` pour intégrer `userPreferences`

### Routes

- ✅ `/src/routes/conversationsRoutes.ts` - Ajout de 10 nouvelles routes

### Services

- ✅ `/src/services/notificationService.ts` - Modification pour respecter le mute
- ✅ `/src/services/webSocketService.ts` - Vérification du blocage avant envoi messages

### Helpers

- ✅ `/src/utils/conversationHelpers.ts` - Nouvelles fonctions utilitaires :
  - `buildUserPreferences()` - Construit l'objet userPreferences
  - `isConversationMuted()` - Vérifie si muted et non expiré
  - `isConversationArchived()` - Vérifie si archivé
  - `isConversationPinned()` - Vérifie si épinglé
  - `isConversationBlocked()` - Vérifie si bloqué

### Jobs (Cron)

- ✅ `/src/jobs/cleanExpiredMutes.ts` - Nettoyage automatique des mutes expirés (toutes les heures)

### Documentation

- ✅ `/docs/api/04_api-routes/conversations.md` - Documentation API mise à jour
- ✅ `/docs/api/CONVERSATION_OPTIONS_GUIDE.md` - Guide complet pour développeurs front/mobile
- ✅ `/MANUAL_TESTS.md` - Exemples de tests manuels avec curl/Postman

### Migration

- ✅ `/src/migrations/conversationFeatures.ts` - Script de migration pour ajouter les nouveaux champs

---

## 🔒 Sécurité

### Middlewares appliqués sur toutes les routes

1. **Authentification** : `authenticateUser` sur toutes les routes
2. **Validation** : Middlewares de validation pour tous les paramètres et body
3. **Vérification participant** : L'utilisateur doit être participant actif de la conversation
4. **Rate limiting** : Hérité des paramètres existants

### Validations spécifiques

| Endpoint | Validation                                        |
| -------- | ------------------------------------------------- |
| `/mute`  | `mutedUntil` doit être dans le futur, max 1 an    |
| `/pin`   | Maximum 5 conversations épinglées par utilisateur |
| `/pin`   | `order` doit être entre 1 et 5                    |
| `/block` | `reason` max 500 caractères                       |
| Tous     | `:conversationId` doit être ObjectId valide       |

### Gestion des erreurs

- **400** : Validation échouée, limite dépassée
- **401** : Non authentifié
- **403** : Pas participant de la conversation
- **404** : Conversation introuvable
- **500** : Erreur serveur

---

## 🚀 Migration

### Étape 1 : Exécuter la migration

```bash
npx ts-node src/migrations/conversationFeatures.ts
```

Cette migration :

- Ajoute les nouveaux champs vides sur toutes les conversations existantes
- Crée les index de performance
- Sauvegarde avant modification

### Étape 2 : Redémarrer le serveur

```bash
npm run dev  # ou npm start en production
```

Le cron job se lancera automatiquement au démarrage.

---

## 📊 Métriques et monitoring

### Nouveaux logs ajoutés

- Info : Mute/Unmute d'une conversation
- Info : Archive/Unarchive d'une conversation
- Info : Pin/Unpin d'une conversation
- Info : Block/Unblock d'une conversation
- Info : Nettoyage automatique des mutes expirés (cron)

### Métriques à surveiller

- Nombre de conversations mutées (par utilisateur)
- Nombre de conversations archivées (total)
- Nombre de conversations épinglées (max 5 par user)
- Durée moyenne de mute
- Taux de blocage de conversations

---

## 🧪 Tests

### Tests manuels disponibles

Consultez `/MANUAL_TESTS.md` pour des exemples de requêtes curl/Postman couvrant :

- Mute temporaire et permanent
- Archive/Unarchive
- Pin avec limite de 5
- Mark as unread
- Block/Unblock

### Scénarios de test recommandés

1. **Mute** :
   - ✅ Mute permanent
   - ✅ Mute temporaire (1h, 8h, 1 semaine)
   - ✅ Mute avec mention activée
   - ✅ Auto-unmute après expiration (vérifier cron)
   - ✅ Notification bloquée si muted (sauf mention)

2. **Archive** :
   - ✅ Archive une conversation
   - ✅ Vérifier exclusion de GET /conversations
   - ✅ Lister les archivées via GET /archived
   - ✅ Désarchiver
   - ✅ Nouveau message ne désarchive pas automatiquement

3. **Pin** :
   - ✅ Épingler une conversation
   - ✅ Épingler 5 conversations (max)
   - ✅ Erreur sur la 6ème
   - ✅ Vérifier tri (épinglées en haut)
   - ✅ Désépingler

4. **Mark as Unread** :
   - ✅ Marquer comme non lu
   - ✅ Badge affiché même si messages lus
   - ✅ Retirer le marquage

5. **Block** :
   - ✅ Bloquer une conversation
   - ✅ Tentative d'envoi de message → bloquée
   - ✅ WebSocket bloque les messages
   - ✅ Débloquer

---

## 📚 Documentation pour équipes Front/Mobile

### Fichiers à consulter

1. **Documentation API complète** :  
   `/docs/api/04_api-routes/conversations.md`  
   → Spécifications techniques de tous les endpoints

2. **Guide d'intégration développeur** :  
   `/docs/api/CONVERSATION_OPTIONS_GUIDE.md`  
   → Exemples de code, bonnes pratiques, gestion d'erreurs

3. **Tests manuels** :  
   `/MANUAL_TESTS.md`  
   → Exemples de requêtes pour tester les endpoints

### Points clés pour l'intégration

**Objet `userPreferences`** : Toutes les conversations retournées contiennent maintenant ce champ avec les préférences utilisateur.

**Tri automatique** : Les conversations sont triées par le serveur (épinglées en premier, puis par date).

**Vérification côté client** : Checker si `mutedUntil` est expiré pour afficher correctement l'icône de mute.

**Limite de 5 pins** : Vérifier le nombre de conversations épinglées avant d'appeler `/pin`.

**Badge "non lu"** : Afficher si `unreadCount > 0` OU `isMarkedUnread === true`.

---

## 🐛 Problèmes connus

Aucun problème connu pour le moment.

---

## 🔜 Améliorations futures possibles

- [ ] Mute sélectif (mute sauf mentions @username)
- [ ] Épinglage par drag & drop avec ordre dynamique
- [ ] Catégories/Dossiers de conversations
- [ ] Notifications granulaires par conversation (son personnalisé, vibration, etc.)
- [ ] Statistiques d'utilisation des options (analytics)
- [ ] Synchronisation temps réel des préférences via WebSocket entre sessions
- [ ] Backup/restore des préférences utilisateur

---

## 📞 Support

Pour toute question ou problème :

- Consulter la documentation API : `/docs/api/04_api-routes/conversations.md`
- Consulter le guide développeur : `/docs/api/CONVERSATION_OPTIONS_GUIDE.md`
- Contacter l'équipe backend

---

## ✅ Checklist de déploiement

Avant de déployer en production :

- [x] Code développé et testé localement
- [x] Documentation API mise à jour
- [x] Guide développeur créé
- [x] Tests manuels documentés
- [ ] Migration testée sur base de données de staging
- [ ] Tests de charge effectués (pin limit, mute expiration)
- [ ] Logs et monitoring configurés
- [ ] Équipes front/mobile informées
- [ ] Migration exécutée en production
- [ ] Déploiement effectué
- [ ] Tests post-déploiement réussis

---

**Fin du changelog** ✨
