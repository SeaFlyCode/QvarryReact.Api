# Guide d'intégration : Options de conversation

Ce guide est destiné aux développeurs **mobile** et **frontend** pour intégrer les nouvelles fonctionnalités de gestion des conversations : mute, archive, pin, mark as unread, et block.

---

## 🎯 Vue d'ensemble

Les nouvelles fonctionnalités permettent aux utilisateurs de :

- **Mute** : Couper les notifications d'une conversation (permanent ou temporaire)
- **Archive** : Ranger une conversation sans la supprimer
- **Pin** : Épingler jusqu'à 5 conversations en haut de liste
- **Mark as Unread** : Marquer manuellement comme non lu pour y revenir plus tard
- **Block** : Bloquer une conversation spécifique (différent du blocage de contact)

---

## 📦 Objet `userPreferences`

Chaque conversation retournée par l'API contient maintenant un objet `userPreferences` :

```typescript
interface UserPreferences {
  isMuted: boolean; // Conversation en sourdine
  mutedUntil: Date | null; // Date de fin du mute (null = permanent)
  notifyOnMention: boolean; // Notifier si mentionné même si muted
  isArchived: boolean; // Conversation archivée
  isPinned: boolean; // Conversation épinglée
  pinOrder: number | null; // Ordre d'épinglage (1-5, null si non épinglée)
  isMarkedUnread: boolean; // Marquée manuellement comme non lue
  isBlocked: boolean; // Conversation bloquée
}
```

### Exemple de réponse API complète

```json
{
  "conversations": [
    {
      "id": "65f8a3b2c1d4e5f6a7b8c9d0",
      "name": "Groupe Marketing",
      "isGroup": true,
      "participants": [...],
      "lastMessage": {
        "content": "Rendez-vous à 14h demain",
        "sentAt": "2026-03-20T10:30:00.000Z",
        "senderId": "65f8a3b2c1d4e5f6a7b8c9d1"
      },
      "unreadCount": 3,
      "updatedAt": "2026-03-20T10:30:00.000Z",

      "userPreferences": {
        "isMuted": true,
        "mutedUntil": "2026-03-21T18:00:00.000Z",
        "notifyOnMention": true,
        "isArchived": false,
        "isPinned": true,
        "pinOrder": 1,
        "isMarkedUnread": false,
        "isBlocked": false
      }
    }
  ],
  "total": 1
}
```

---

## 🔧 Intégration par fonctionnalité

### 1️⃣ MUTE/UNMUTE

#### Cas d'usage

- Groupe de travail bruyant → mute pendant la nuit
- Conversation avec quelqu'un de bavard → mute temporairement
- Groupe familial très actif → mute permanent mais recevoir les mentions

#### Endpoint : Muter une conversation

```http
PATCH /api/v1/conversations/:conversationId/mute
Authorization: Bearer <token>
Content-Type: application/json

{
  "mutedUntil": "2026-03-21T18:00:00Z",  // ou null pour permanent
  "notifyOnMention": true                 // optionnel, défaut: true
}
```

**Réponse (200) :**

```json
{
  "message": "Conversation mise en sourdine jusqu'au 21/03/2026 18:00",
  "conversation": {
    "id": "65f8a3b2c1d4e5f6a7b8c9d0",
    "userPreferences": {
      "isMuted": true,
      "mutedUntil": "2026-03-21T18:00:00.000Z",
      "notifyOnMention": true
    }
  }
}
```

#### Endpoint : Réactiver les notifications

```http
PATCH /api/v1/conversations/:conversationId/unmute
Authorization: Bearer <token>
```

**Réponse (200) :**

```json
{
  "message": "Notifications réactivées pour cette conversation",
  "conversation": {
    "id": "65f8a3b2c1d4e5f6a7b8c9d0",
    "userPreferences": {
      "isMuted": false,
      "mutedUntil": null,
      "notifyOnMention": false
    }
  }
}
```

#### Logique côté client

**Vérifier si une conversation est mutée :**

```javascript
function isConversationMuted(conversation) {
  if (!conversation.userPreferences.isMuted) return false;

  // Si mutedUntil est null → mute permanent
  if (!conversation.userPreferences.mutedUntil) return true;

  // Sinon, vérifier si la date n'est pas expirée
  return new Date(conversation.userPreferences.mutedUntil) > new Date();
}
```

**Afficher l'icône de mute :**

```jsx
{
  isConversationMuted(conversation) && <Icon name="bell-off" color="gray" />;
}
```

**Menu de sélection de durée de mute :**

```javascript
const muteDurations = [
  { label: "1 heure", hours: 1 },
  { label: "8 heures", hours: 8 },
  { label: "1 semaine", hours: 168 },
  { label: "Toujours", hours: null },
  { label: "Personnalisé...", custom: true },
];

function calculateMutedUntil(hours) {
  if (hours === null) return null; // Permanent
  const date = new Date();
  date.setHours(date.getHours() + hours);
  return date.toISOString();
}

// Exemple d'utilisation
async function muteConversation(conversationId, hours) {
  const mutedUntil = calculateMutedUntil(hours);

  const response = await fetch(`/api/v1/conversations/${conversationId}/mute`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      mutedUntil,
      notifyOnMention: true,
    }),
  });

  return response.json();
}
```

---

### 2️⃣ ARCHIVE/UNARCHIVE

#### Cas d'usage

- Conversations terminées mais à garder (ex: ancien collègue)
- Projets terminés
- Ranger sans perdre l'historique

#### Endpoint : Archiver une conversation

```http
PATCH /api/v1/conversations/:conversationId/archive
Authorization: Bearer <token>
```

**Réponse (200) :**

```json
{
  "message": "Conversation archivée",
  "conversation": {
    "id": "65f8a3b2c1d4e5f6a7b8c9d0",
    "userPreferences": {
      "isArchived": true
    }
  }
}
```

#### Endpoint : Désarchiver une conversation

```http
PATCH /api/v1/conversations/:conversationId/unarchive
Authorization: Bearer <token>
```

#### Endpoint : Lister les conversations archivées

```http
GET /api/v1/conversations/archived?limit=20&skip=0
Authorization: Bearer <token>
```

**Réponse (200) :**

```json
{
  "conversations": [...],
  "total": 5,
  "limit": 20,
  "skip": 0
}
```

#### Logique côté client

**Note importante** : Par défaut, `GET /api/v1/conversations` exclut les conversations archivées. Elles n'apparaissent que dans `GET /api/v1/conversations/archived`.

**Afficher une section "Archivées" :**

```jsx
function ConversationList() {
  const [conversations, setConversations] = useState([]);
  const [archivedConversations, setArchivedConversations] = useState([]);
  const [showArchived, setShowArchived] = useState(false);

  useEffect(() => {
    // Charger conversations actives
    fetchConversations().then(setConversations);
  }, []);

  const loadArchived = async () => {
    const data = await fetchArchivedConversations();
    setArchivedConversations(data.conversations);
    setShowArchived(true);
  };

  return (
    <div>
      <ConversationsList items={conversations} />

      <button onClick={loadArchived}>
        Voir les archivées ({archivedCount})
      </button>

      {showArchived && (
        <ArchivedConversationsList items={archivedConversations} />
      )}
    </div>
  );
}
```

**Badge de non-lus sur les archivées :**

```jsx
// Afficher un badge sur le bouton "Archivées" s'il y a des non-lus
function ArchivedButton() {
  const unreadArchivedCount = archivedConversations.reduce(
    (sum, conv) => sum + conv.unreadCount,
    0,
  );

  return (
    <button>
      Archivées
      {unreadArchivedCount > 0 && <Badge count={unreadArchivedCount} />}
    </button>
  );
}
```

---

### 3️⃣ PIN/UNPIN

#### Cas d'usage

- Garder conversations importantes toujours visibles en haut
- Maximum 5 conversations épinglées par utilisateur

#### Endpoint : Épingler une conversation

```http
PATCH /api/v1/conversations/:conversationId/pin
Authorization: Bearer <token>
Content-Type: application/json

{
  "order": 1  // Optionnel, auto-calculé si omis
}
```

**Réponse (200) :**

```json
{
  "message": "Conversation épinglée en position 2",
  "conversation": {
    "id": "65f8a3b2c1d4e5f6a7b8c9d0",
    "userPreferences": {
      "isPinned": true,
      "pinOrder": 2
    }
  }
}
```

**Erreur si limite atteinte (400) :**

```json
{
  "error": "Vous ne pouvez épingler que 5 conversations maximum"
}
```

#### Endpoint : Désépingler une conversation

```http
PATCH /api/v1/conversations/:conversationId/unpin
Authorization: Bearer <token>
```

#### Logique côté client

**Vérifier la limite avant d'épingler :**

```javascript
function canPinConversation(conversations) {
  const pinnedCount = conversations.filter(
    (conv) => conv.userPreferences.isPinned,
  ).length;

  return pinnedCount < 5;
}

async function pinConversation(conversationId) {
  if (!canPinConversation(conversations)) {
    alert("Vous ne pouvez épingler que 5 conversations maximum");
    return;
  }

  const response = await fetch(`/api/v1/conversations/${conversationId}/pin`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  return response.json();
}
```

**Affichage des conversations épinglées :**

```jsx
function ConversationsList({ conversations }) {
  // Les conversations sont déjà triées par le serveur :
  // 1. Épinglées d'abord (par pinOrder croissant)
  // 2. Non épinglées ensuite (par updatedAt décroissant)

  return (
    <div>
      {conversations.map((conv) => (
        <ConversationItem
          key={conv.id}
          conversation={conv}
          showPinIcon={conv.userPreferences.isPinned}
        />
      ))}
    </div>
  );
}

function ConversationItem({ conversation, showPinIcon }) {
  return (
    <div className="conversation-item">
      {showPinIcon && <Icon name="pin" />}
      <span>{conversation.name}</span>
    </div>
  );
}
```

**Drag & drop pour réorganiser l'ordre :**

```javascript
// Si vous voulez permettre de réorganiser les épinglées par drag & drop
async function reorderPinnedConversation(conversationId, newOrder) {
  const response = await fetch(`/api/v1/conversations/${conversationId}/pin`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ order: newOrder }),
  });

  return response.json();
}
```

---

### 4️⃣ MARK AS UNREAD/READ

#### Cas d'usage

- Se rappeler de répondre à une conversation plus tard
- Forcer le badge "non lu" même si tous les messages sont lus

#### Endpoint : Marquer comme non lu

```http
PATCH /api/v1/conversations/:conversationId/mark-unread
Authorization: Bearer <token>
```

**Réponse (200) :**

```json
{
  "message": "Conversation marquée comme non lue",
  "conversation": {
    "id": "65f8a3b2c1d4e5f6a7b8c9d0",
    "userPreferences": {
      "isMarkedUnread": true
    }
  }
}
```

#### Endpoint : Retirer le marquage

```http
PATCH /api/v1/conversations/:conversationId/mark-read-flag
Authorization: Bearer <token>
```

#### Logique côté client

**Afficher le badge "non lu" :**

```javascript
function shouldShowUnreadBadge(conversation) {
  // Afficher si : vraiment des non-lus OU marqué manuellement
  return (
    conversation.unreadCount > 0 || conversation.userPreferences.isMarkedUnread
  );
}

function getUnreadCount(conversation) {
  // Si marqué manuellement ET pas de vrais non-lus → afficher "●" au lieu d'un chiffre
  if (
    conversation.userPreferences.isMarkedUnread &&
    conversation.unreadCount === 0
  ) {
    return "●"; // Ou un badge sans chiffre
  }

  return conversation.unreadCount;
}
```

**Exemple d'affichage :**

```jsx
function ConversationItem({ conversation }) {
  const showBadge = shouldShowUnreadBadge(conversation);
  const badgeContent = getUnreadCount(conversation);

  return (
    <div className="conversation-item">
      <span>{conversation.name}</span>
      {showBadge && <Badge>{badgeContent}</Badge>}
    </div>
  );
}
```

**Auto-retirer le marquage lors de l'ouverture :**

```javascript
async function openConversation(conversationId) {
  // Ouvrir la conversation
  navigateToConversation(conversationId);

  // Si marquée comme non lue, retirer le marquage automatiquement
  const conversation = conversations.find((c) => c.id === conversationId);
  if (conversation.userPreferences.isMarkedUnread) {
    await fetch(`/api/v1/conversations/${conversationId}/mark-read-flag`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}` },
    });
  }
}
```

---

### 5️⃣ BLOCK/UNBLOCK

#### Cas d'usage

- Bloquer une conversation spécifique sans bloquer le contact complètement
- Utile pour groupes où on veut ignorer quelqu'un
- Empêche envoi/réception de messages dans cette conversation uniquement

#### Endpoint : Bloquer une conversation

```http
PATCH /api/v1/conversations/:conversationId/block
Authorization: Bearer <token>
Content-Type: application/json

{
  "reason": "Harcèlement"  // Optionnel, max 500 caractères
}
```

**Réponse (200) :**

```json
{
  "message": "Conversation bloquée",
  "conversation": {
    "id": "65f8a3b2c1d4e5f6a7b8c9d0",
    "userPreferences": {
      "isBlocked": true
    }
  }
}
```

#### Endpoint : Débloquer une conversation

```http
PATCH /api/v1/conversations/:conversationId/unblock
Authorization: Bearer <token>
```

#### Logique côté client

**Empêcher l'envoi de messages si bloquée :**

```javascript
async function sendMessage(conversationId, content) {
  const conversation = conversations.find((c) => c.id === conversationId);

  if (conversation.userPreferences.isBlocked) {
    alert(
      "Vous ne pouvez pas envoyer de messages dans une conversation bloquée",
    );
    return;
  }

  // Envoyer le message...
}
```

**Afficher un message d'avertissement :**

```jsx
function ConversationView({ conversation }) {
  if (conversation.userPreferences.isBlocked) {
    return (
      <div className="blocked-warning">
        ⚠️ Cette conversation est bloquée. Vous ne pouvez pas envoyer ou
        recevoir de messages.
        <button onClick={() => unblockConversation(conversation.id)}>
          Débloquer
        </button>
      </div>
    );
  }

  return <MessageList conversation={conversation} />;
}
```

---

## 🎨 Exemple de menu contextuel complet

Voici un exemple de menu contextuel (long press ou clic droit) pour une conversation :

```jsx
function ConversationContextMenu({ conversation, onClose }) {
  const { userPreferences } = conversation;
  const pinnedCount = conversations.filter(
    (c) => c.userPreferences.isPinned,
  ).length;
  const canPin = pinnedCount < 5 || userPreferences.isPinned;

  return (
    <Menu>
      {/* Pin/Unpin */}
      {canPin && (
        <MenuItem icon="📌" onClick={() => togglePin(conversation.id)}>
          {userPreferences.isPinned ? "Désépingler" : "Épingler"}
        </MenuItem>
      )}

      {/* Mute/Unmute */}
      {!userPreferences.isMuted ? (
        <MenuItem icon="🔕" onClick={() => showMuteOptions(conversation.id)}>
          Mettre en sourdine
        </MenuItem>
      ) : (
        <MenuItem icon="🔔" onClick={() => unmuteConversation(conversation.id)}>
          Réactiver les notifications
        </MenuItem>
      )}

      {/* Archive/Unarchive */}
      <MenuItem icon="📁" onClick={() => toggleArchive(conversation.id)}>
        {userPreferences.isArchived ? "Désarchiver" : "Archiver"}
      </MenuItem>

      {/* Mark as unread */}
      <MenuItem icon="●" onClick={() => markAsUnread(conversation.id)}>
        Marquer comme non lu
      </MenuItem>

      <MenuDivider />

      {/* Block/Unblock */}
      <MenuItem icon="🚫" onClick={() => toggleBlock(conversation.id)} danger>
        {userPreferences.isBlocked ? "Débloquer" : "Bloquer conversation"}
      </MenuItem>

      {/* Delete */}
      <MenuItem
        icon="🗑️"
        onClick={() => deleteConversation(conversation.id)}
        danger
      >
        Supprimer
      </MenuItem>
    </Menu>
  );
}
```

### Sous-menu de durée de mute

```jsx
function MuteOptionsMenu({ conversationId, onClose }) {
  const options = [
    { label: "1 heure", hours: 1 },
    { label: "8 heures", hours: 8 },
    { label: "1 semaine", hours: 168 },
    { label: "Toujours", hours: null },
  ];

  const handleMute = async (hours) => {
    const mutedUntil = hours === null ? null : calculateMutedUntil(hours);

    await fetch(`/api/v1/conversations/${conversationId}/mute`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ mutedUntil, notifyOnMention: true }),
    });

    onClose();
  };

  return (
    <Menu>
      <MenuTitle>Mettre en sourdine pour :</MenuTitle>
      {options.map((option) => (
        <MenuItem key={option.label} onClick={() => handleMute(option.hours)}>
          {option.label}
        </MenuItem>
      ))}
      <MenuItem onClick={showCustomMutePicker}>Personnalisé...</MenuItem>
    </Menu>
  );
}
```

---

## 🚨 Gestion des erreurs

### Erreurs communes

| Code | Message                                              | Solution                                                             |
| ---- | ---------------------------------------------------- | -------------------------------------------------------------------- |
| 400  | Vous ne pouvez épingler que 5 conversations maximum  | Vérifier le nombre de conversations épinglées avant d'appeler `/pin` |
| 400  | La date de fin de sourdine doit être dans le futur   | Calculer correctement `mutedUntil` avec une date future              |
| 400  | La date de fin de sourdine ne peut pas dépasser 1 an | Limiter le mute max à 1 an                                           |
| 401  | Non authentifié                                      | Rafraîchir le token JWT                                              |
| 403  | Vous devez être participant de cette conversation    | L'utilisateur n'est pas membre (vérifier `participants`)             |
| 404  | Conversation introuvable                             | L'ID de conversation est invalide                                    |

### Exemple de gestion d'erreur

```javascript
async function muteConversation(conversationId, mutedUntil) {
  try {
    const response = await fetch(
      `/api/v1/conversations/${conversationId}/mute`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ mutedUntil, notifyOnMention: true }),
      },
    );

    if (!response.ok) {
      const error = await response.json();

      if (response.status === 400) {
        alert(error.error); // Afficher le message d'erreur
      } else if (response.status === 403) {
        alert("Vous n'avez pas accès à cette conversation");
      } else if (response.status === 404) {
        alert("Conversation introuvable");
      }

      return null;
    }

    return response.json();
  } catch (err) {
    console.error("Erreur lors du mute:", err);
    alert("Une erreur est survenue");
    return null;
  }
}
```

---

## ⚡ Optimisations et bonnes pratiques

### 1. Mise à jour optimiste de l'UI

Pour une meilleure UX, mettez à jour l'UI immédiatement avant d'attendre la réponse serveur :

```javascript
async function togglePin(conversationId) {
  // 1. Mise à jour optimiste de l'UI
  updateConversationLocally(conversationId, {
    userPreferences: { isPinned: true },
  });

  try {
    // 2. Appel serveur
    const result = await fetch(`/api/v1/conversations/${conversationId}/pin`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!result.ok) {
      // 3. Rollback en cas d'erreur
      updateConversationLocally(conversationId, {
        userPreferences: { isPinned: false },
      });
      throw new Error("Échec de l'épinglage");
    }
  } catch (err) {
    console.error(err);
    alert("Impossible d'épingler cette conversation");
  }
}
```

### 2. Cache et synchronisation

**Invalider le cache après une action :**

```javascript
async function archiveConversation(conversationId) {
  await fetch(`/api/v1/conversations/${conversationId}/archive`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}` },
  });

  // Recharger la liste des conversations
  await refreshConversations();
}
```

### 3. Batch updates

Si plusieurs actions sont effectuées en même temps, groupez les appels :

```javascript
async function bulkArchive(conversationIds) {
  const promises = conversationIds.map((id) =>
    fetch(`/api/v1/conversations/${id}/archive`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}` },
    }),
  );

  await Promise.all(promises);
  await refreshConversations();
}
```

### 4. WebSocket pour la synchronisation temps réel

Si un utilisateur a plusieurs sessions ouvertes (mobile + web), synchronisez les préférences via WebSocket :

```javascript
// Écouter les changements de préférences depuis d'autres sessions
socket.on("conversation:preferences:updated", (data) => {
  updateConversationLocally(data.conversationId, {
    userPreferences: data.userPreferences,
  });
});
```

---

## 📱 Exemples spécifiques par plateforme

### React Native

```jsx
import { useState } from "react";
import { View, Text, TouchableOpacity, ActionSheetIOS } from "react-native";

function ConversationItem({ conversation }) {
  const handleLongPress = () => {
    const options = ["Épingler", "Muter", "Archiver", "Annuler"];
    const cancelButtonIndex = 3;

    ActionSheetIOS.showActionSheetWithOptions(
      {
        options,
        cancelButtonIndex,
      },
      (buttonIndex) => {
        if (buttonIndex === 0) pinConversation(conversation.id);
        if (buttonIndex === 1) showMuteOptions(conversation.id);
        if (buttonIndex === 2) archiveConversation(conversation.id);
      },
    );
  };

  return (
    <TouchableOpacity onLongPress={handleLongPress}>
      <View>
        <Text>{conversation.name}</Text>
        {conversation.userPreferences.isPinned && <Text>📌</Text>}
        {isConversationMuted(conversation) && <Text>🔕</Text>}
      </View>
    </TouchableOpacity>
  );
}
```

### React Web

```jsx
import { useState } from "react";
import { Menu, MenuItem } from "@mui/material";

function ConversationItem({ conversation }) {
  const [anchorEl, setAnchorEl] = useState(null);

  const handleRightClick = (event) => {
    event.preventDefault();
    setAnchorEl(event.currentTarget);
  };

  return (
    <>
      <div onContextMenu={handleRightClick}>
        {conversation.name}
        {conversation.userPreferences.isPinned && "📌"}
      </div>

      <Menu
        anchorEl={anchorEl}
        open={Boolean(anchorEl)}
        onClose={() => setAnchorEl(null)}
      >
        <MenuItem onClick={() => togglePin(conversation.id)}>
          {conversation.userPreferences.isPinned ? "Désépingler" : "Épingler"}
        </MenuItem>
        <MenuItem onClick={() => showMuteOptions(conversation.id)}>
          Mettre en sourdine
        </MenuItem>
        <MenuItem onClick={() => archiveConversation(conversation.id)}>
          Archiver
        </MenuItem>
      </Menu>
    </>
  );
}
```

---

## 🔗 Ressources

- [Documentation API complète](/docs/api/04_api-routes/conversations.md)
- [Tests manuels avec exemples](/MANUAL_TESTS.md)
- [Modèle de données Conversation](/docs/api/07_models/conversations-messages.md)

---

## 📞 Support

Pour toute question sur l'intégration, contactez l'équipe backend ou consultez la documentation API complète.
