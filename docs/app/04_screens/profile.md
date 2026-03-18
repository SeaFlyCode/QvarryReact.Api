# Écrans — Profil et Paramètres

## Vue d'ensemble

Le module Profil regroupe la gestion du compte utilisateur, les paramètres de l'application, la sécurité et les informations diverses.

---

## `ProfileScreen`

**Chemin** : `src/screens/profile/ProfileScreen.tsx`

Écran principal du profil. Hub de navigation vers tous les sous-écrans de paramétrage.

### Fonctionnalités

- Affichage du nom, prénom, pseudo et email
- Accès rapide aux sous-sections
- Affichage du score de points de fidélité
- Bouton de déconnexion

---

## `EditProfileScreen`

**Chemin** : `src/screens/profile/EditProfileScreen.tsx`

Modification des informations du profil.

### Fonctionnalités

- Modifier nom, prénom, pseudo
- Activer / désactiver l'affichage du pseudo
- Sauvegarde avec appel à `PATCH /api/v1/users/me`

---

## `SettingsScreen`

**Chemin** : `src/screens/profile/SettingsScreen.tsx`

Paramètres généraux de l'application.

### Fonctionnalités

- Thème clair / sombre (via `ThemeContext`)
- Paramètres de synchronisation (fréquence, sync auto)
- Retour haptique (activer / désactiver via `HapticsContext`)
- Langue de l'application

---

## `SecurityScreen`

**Chemin** : `src/screens/profile/SecurityScreen.tsx`

Paramètres de sécurité du compte.

### Fonctionnalités

- Activer / désactiver le verrouillage biométrique (Face ID / Touch ID / empreinte)
  - Stocké dans Keychain sous la clé `qvarry_biometric_enabled`
  - Déclenche le `BiometricLockScreen` au prochain démarrage
- Activer / désactiver la 2FA TOTP
  - Affichage du QR code de configuration via `react-native-qrcode-svg`
  - Vérification du code TOTP avant activation
- Consulter les sessions actives
- Changer le mot de passe

---

## `NotificationsScreen`

**Chemin** : `src/screens/profile/NotificationsScreen.tsx`

Paramètres des notifications.

### Fonctionnalités

- Activer / désactiver les notifications push pour chaque catégorie (messages, contacts, SOS, système)
- Activer / désactiver les notifications de connexion
- Appel à `PATCH /api/v1/users/me` pour sauvegarder les préférences

---

## `UserPointsScreen`

**Chemin** : `src/screens/profile/UserPointsScreen.tsx`

Affichage des points de fidélité de l'utilisateur.

### Fonctionnalités

- Score total de points
- Historique des transactions de points
- Explication des règles de gain

### Hook utilisé

```typescript
const { points, transactions, isLoading } = usePoints();
```

---

## `CacheManagementScreen`

**Chemin** : `src/screens/profile/CacheManagementScreen.tsx`

Gestion du cache local de l'application.

### Fonctionnalités

- Affichage de la taille du cache (points, fiches, listes, cartes offline)
- Nombre de changements en attente de synchronisation
- Bouton "Vider le cache" (avec confirmation)
- Bouton "Forcer la synchronisation complète" (`sync({ forceFull: true })`)
- Date de la dernière synchronisation

---

## `OfflineMapScreen`

**Chemin** : `src/screens/profile/OfflineMapScreen.tsx`

Gestion des tuiles de carte disponibles hors ligne.

### Fonctionnalités

- Liste des zones de carte téléchargées
- Taille totale des tuiles stockées
- Télécharger une nouvelle zone
- Supprimer des zones pour libérer de l'espace

---

## `HelpScreen`

**Chemin** : `src/screens/profile/HelpScreen.tsx`

Centre d'aide de l'application.

### Fonctionnalités

- FAQ
- Lien vers le support
- Guide d'utilisation des fonctionnalités principales

---

## `AboutScreen`

**Chemin** : `src/screens/profile/AboutScreen.tsx`

Informations sur l'application.

### Fonctionnalités

- Version de l'application
- Mentions légales
- Politique de confidentialité
- Licences open source
