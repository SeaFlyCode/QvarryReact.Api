# Navigation — Application Mobile Qvarry

## Vue d'ensemble

La navigation est gérée par **React Navigation v7**. Elle est structurée en deux branches principales selon l'état d'authentification :

```
NavigationContainer (deep linking activé)
│
├── AuthStackNavigator      ← Utilisateur non connecté
│   ├── LoginScreen
│   └── ForgotPasswordScreen
│
└── BottomTabNavigator      ← Utilisateur connecté
    ├── ExplorerStackNavigator   (onglet "Explorer")
    │   ├── LeafletMapScreen
    │   ├── PointDetailScreen
    │   ├── PointFormScreen
    │   ├── SearchScreen
    │   └── UndergroundNavScreen
    │
    ├── FichesScreen             (onglet "Fiches")
    │
    ├── MessagesStackNavigator   (onglet "Messages")
    │   ├── MessagesScreen
    │   ├── ConversationsScreen
    │   ├── ChatScreen
    │   ├── ContactsScreen
    │   ├── ContactRequestsScreen
    │   ├── ConfirmContactScreen
    │   └── NewConversationScreen
    │
    ├── ProfileScreen            (onglet "Profil")
    │
    └── AdminSosNavigator        (onglet "Admin SOS" — admin uniquement)
        └── ...SOS admin screens
```

---

## Fichiers de navigation

### `AuthStackNavigator.tsx`

Stack de navigation pour les utilisateurs non authentifiés.

**Écrans** :
- `Login` → `LoginScreen`
- `ForgotPassword` → `ForgotPasswordScreen`

### `BottomTabNavigator.tsx`

Barre de navigation en bas avec 4 onglets principaux (+ 1 admin conditionnel).

**Onglets** :

| Nom       | Icône (Material)         | Composant                  | Condition        |
| --------- | ------------------------ | -------------------------- | ---------------- |
| Explorer  | `explore`                | ExplorerStackNavigator     | Toujours         |
| Fiches    | `description`            | FichesScreen               | Toujours         |
| Messages  | `chat`                   | MessagesStackNavigator     | Toujours         |
| Profil    | `person`                 | ProfileScreen              | Toujours         |
| Admin SOS | `admin-panel-settings`   | AdminSosNavigator          | `role === 'admin'` |

**Caractéristiques** :
- Icônes animées avec un spring **Apple-like** (scale + opacité + dot animés via Reanimated)
- Retour haptique à chaque changement d'onglet (`haptics.selection()`)
- Adaptation automatique au Safe Area (notch, Dynamic Island, barre de geste Android)
- Support thème clair/sombre

**Banners overlay** (présents dans le wrapper `BottomTabNavigator`) :
- `SosActiveBanner` : affiché si un SOS est actif (priorité maximale)
- `DegradedModeBanner` : affiché en mode `limited` après la vérification initiale
- `InAppMessageToast` : toast pour les messages entrants en temps réel

### `ExplorerStackNavigator.tsx`

Stack pour le module carte.

**Écrans** :
- `LeafletMap`, `PointDetail`, `PointForm`, `Search`, `UndergroundNav`

### `MessagesStackNavigator.tsx`

Stack pour le module messagerie.

**Écrans** :
- `Messages`, `Conversations`, `Chat`, `Contacts`, `ContactRequests`, `ConfirmContact`, `NewConversation`, `MyCode`

### `AdminSosNavigator.tsx`

Navigateur réservé aux administrateurs pour superviser les alertes SOS en cours.

---

## Deep Linking

Le deep linking est configuré dans `App.tsx` avec les préfixes `qvarry://` et `https://qvarry.com`.

### Routes configurées

| URL                                       | Destination                    |
| ----------------------------------------- | ------------------------------ |
| `qvarry://MapTab`                         | Explorer (carte)               |
| `qvarry://MessagesTab/Messages`           | Liste des messages             |
| `qvarry://MessagesTab/Conversations`      | Liste des conversations        |
| `qvarry://MessagesTab/Chat`               | Écran de chat                  |
| `qvarry://contact/add/:userCode`          | ConfirmContactScreen           |
| `qvarry://Profil`                         | Écran de profil                |

### Exemple d'utilisation (notification push)

Quand l'utilisateur reçoit une notification de message, l'action tape sur la notification ouvre directement la conversation concernée grâce au deep linking.

---

## Logique d'affichage dans `AppNavigator`

```typescript
if (isLoading) {
  return <SplashLoader message="Connexion" />;
}

if (isAuthenticated && permissions.isLoading) {
  return <SplashLoader message="Autorisations" />;
}

return isAuthenticated 
  ? <BottomTabNavigator /> 
  : <AuthStackNavigator />;
```

La transition entre les deux navigateurs est automatique dès que l'état `isAuthenticated` change dans `AuthContext`.
