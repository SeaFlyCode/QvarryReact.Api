# Écrans — Messagerie

## Vue d'ensemble

Le module Messages permet une messagerie chiffrée en temps réel entre utilisateurs Qvarry. Les contacts sont ajoutés via un système de QR code / code unique.

---

## `MessagesScreen`

**Chemin** : `src/screens/messages/MessagesScreen.tsx`

Écran d'accueil du module messages. Point d'entrée avec accès rapide aux conversations et contacts.

---

## `ConversationsScreen`

**Chemin** : `src/screens/messages/ConversationsScreen.tsx`

Liste de toutes les conversations de l'utilisateur.

### Fonctionnalités

- Liste des conversations triées par date du dernier message
- Aperçu du dernier message et horodatage
- Badge de compteur de messages non lus
- Swipe-to-delete pour supprimer une conversation
- Navigation vers `ChatScreen`
- Création d'une nouvelle conversation → `NewConversationScreen`

---

## `ChatScreen`

**Chemin** : `src/screens/messages/ChatScreen.tsx`

Écran de conversation en temps réel.

### Fonctionnalités

- Affichage des messages avec bulles (envoyé / reçu)
- Envoi de messages texte
- Réception de messages en temps réel via WebSocket
- Indicateurs de lecture et d'envoi
- Historique de la conversation
- Toast in-app si un message arrive d'une autre conversation (`InAppMessageToast`)

### WebSocket

Les messages sont reçus via `WebSocketContext`. À chaque nouveau message entrant, le store local est mis à jour et le composant est re-rendu.

---

## `ContactsScreen`

**Chemin** : `src/screens/messages/ContactsScreen.tsx`

Liste des contacts de l'utilisateur.

### Fonctionnalités

- Liste des contacts validés
- Recherche par nom ou pseudo
- Navigation vers une conversation avec un contact
- Accès aux demandes de contact en attente (`ContactRequestsScreen`)

---

## `ContactRequestsScreen`

**Chemin** : `src/screens/messages/ContactRequestsScreen.tsx`

Gestion des demandes de contact reçues.

### Fonctionnalités

- Liste des demandes en attente
- Accepter ou refuser une demande
- Notification push à la réception d'une nouvelle demande

---

## `ConfirmContactScreen`

**Chemin** : `src/screens/messages/ConfirmContactScreen.tsx`

Écran de confirmation pour ajouter un contact via un code unique.

### Fonctionnalités

- Affiché quand l'utilisateur ouvre le deep link `qvarry://contact/add/:userCode`
- Affiche le profil de l'utilisateur cible (nom, pseudo)
- Envoi d'une demande de contact avec un message optionnel

---

## `NewConversationScreen`

**Chemin** : `src/screens/messages/NewConversationScreen.tsx`

Création d'une nouvelle conversation avec un contact existant.

---

## `MyCodeScreen`

**Chemin** : `src/screens/messages/MyCodeScreen.tsx`

Affichage du code unique et QR code de l'utilisateur connecté pour être ajouté en contact.

### Fonctionnalités

- Affichage du `contact_code` sous forme de QR code (`react-native-qrcode-svg`)
- Affichage du code numérique
- Bouton de copie dans le presse-papier
- Partage natif du lien d'ajout (`qvarry://contact/add/:userCode`)
