# Écrans — SOS

## Vue d'ensemble

Le module SOS est le système d'alerte d'urgence de Qvarry. Il permet d'envoyer une alerte immédiate à des contacts d'urgence prédéfinis. C'est le module le plus critique de l'application.

---

## Architecture du module SOS

```
SosProvider (contexte global)
    │
    ├── SosDashboardScreen      ← Hub principal du module SOS
    │   ├── SosActivationScreen     ← Configuration et activation
    │   ├── SosQuickActivationScreen ← Activation rapide (1 tap)
    │   ├── SosContactsScreen       ← Gestion des contacts d'urgence
    │   ├── SosHistoryScreen        ← Historique des alertes
    │   │   └── SosHistoryDetailScreen ← Détail d'une alerte
    │   ├── SosStatsScreen          ← Statistiques (admin)
    │   └── SosWidgetConfigScreen   ← Configuration du widget
    │
    └── SosActiveScreen         ← Affiché quand un SOS est actif
        └── SosAlarmScreen      ← Alarme sonore + visuelle
```

---

## `SosDashboardScreen`

**Chemin** : `src/screens/sos/SosDashboardScreen.tsx`

Hub principal du module SOS. Point d'entrée depuis le BottomTabNavigator ou la `SosActiveBanner`.

### Fonctionnalités

- Affichage de l'état actuel (SOS actif / inactif)
- Accès rapide à l'activation d'un SOS
- Navigation vers les sous-sections (contacts, historique, stats)
- Indicateur du nombre de contacts SOS configurés

---

## `SosActivationScreen`

**Chemin** : `src/screens/sos/SosActivationScreen.tsx`

Écran de configuration et d'activation d'une alerte SOS.

### Fonctionnalités

- Sélection des contacts à alerter parmi les contacts SOS configurés
- Saisie d'un message personnalisé (optionnel)
- Confirmation avant envoi
- Bouton d'activation avec feedback haptique fort

### Flux d'activation

```
SosActivationScreen
    │
    ▼
sosApi.activateSos({ contactIds, message })
    │
    ├── API → envoie SMS via Vonage aux contacts d'urgence
    ├── API → envoie notifications push aux contacts Qvarry
    └── SosContext.isSosActive = true
            │
            ▼
    SosActiveBanner affichée
    SosActiveScreen navigué automatiquement
```

---

## `SosQuickActivationScreen`

**Chemin** : `src/screens/sos/SosQuickActivationScreen.tsx`

Activation express en un seul geste, sans confirmation (pour les situations d'extrême urgence).

### Fonctionnalités

- Activation immédiate avec tous les contacts SOS configurés
- Message d'urgence prédéfini
- Décompte de 3 secondes avec possibilité d'annuler
- Feedback haptique intense

---

## `SosActiveScreen`

**Chemin** : `src/screens/sos/SosActiveScreen.tsx`

Écran affiché pendant toute la durée d'une alerte SOS active.

### Fonctionnalités

- Indicateur visuel rouge clignotant
- Chronomètre de durée de l'alerte
- Liste des contacts alertés avec statut de lecture
- Bouton de désactivation avec double confirmation
- Position GPS partagée en temps réel avec les contacts
- Accès à `SosAlarmScreen`

---

## `SosAlarmScreen`

**Chemin** : `src/screens/sos/SosAlarmScreen.tsx`

Alarme sonore et visuelle maximale.

### Fonctionnalités

- Son d'alarme fort via `react-native-sound`
- Écran rouge clignotant
- Vibrations répétées (`react-native-haptic-feedback`)
- Peut fonctionner en arrière-plan via `react-native-background-actions`

---

## `SosContactsScreen`

**Chemin** : `src/screens/sos/SosContactsScreen.tsx`

Gestion des contacts d'urgence.

### Fonctionnalités

- Liste des contacts SOS configurés (nom, téléphone ou compte Qvarry)
- Ajout d'un contact (depuis les contacts Qvarry ou par numéro de téléphone)
- Suppression d'un contact
- Ordre de priorité des contacts

> Les contacts SOS sont synchronisés offline-first. En mode hors ligne, la liste locale est utilisée pour l'activation.

---

## `SosHistoryScreen`

**Chemin** : `src/screens/sos/SosHistoryScreen.tsx`

Historique de toutes les alertes SOS passées.

### Fonctionnalités

- Liste chronologique des alertes avec date, durée et statut
- Navigation vers le détail d'une alerte

---

## `SosHistoryDetailScreen`

**Chemin** : `src/screens/sos/SosHistoryDetailScreen.tsx`

Détail d'une alerte SOS passée.

### Fonctionnalités

- Contacts alertés et statut de notification (SMS envoyé, push reçu)
- Localisation au moment de l'alerte
- Durée totale de l'alerte
- Message envoyé

---

## `SosStatsScreen`

**Chemin** : `src/screens/sos/SosStatsScreen.tsx`

Statistiques du module SOS (principalement pour les administrateurs).

### Fonctionnalités

- Nombre d'alertes déclenchées (total, ce mois)
- Temps de réponse moyen des contacts
- Graphiques de tendance

---

## `SosWidgetConfigScreen`

**Chemin** : `src/screens/sos/SosWidgetConfigScreen.tsx`

Configuration du widget SOS de l'écran d'accueil (iOS Widget / Android Widget).

### Fonctionnalités

- Activation / désactivation du widget
- Personnalisation du bouton (couleur, label)
- Instructions d'ajout du widget à l'écran d'accueil

---

## `SosActiveBanner`

Composant global (présent dans `BottomTabNavigator`) affiché en haut de l'écran quand un SOS est actif.

```typescript
// Visible si SosContext.isSosActive === true
<SosActiveBanner />
```

Il donne accès immédiat à `SosActiveScreen` depuis n'importe quel écran.

---

## Canaux de notification Android

Configurés au démarrage via `SosNotificationService` :

| Canal          | Importance | Description                           |
| -------------- | ---------- | ------------------------------------- |
| `sos_alerts`   | MAX        | Alertes SOS entrantes                 |
| `messages`     | HIGH       | Nouveaux messages                     |
| `contacts`     | DEFAULT    | Demandes de contact                   |
| `share`        | DEFAULT    | Partages reçus                        |
| `system`       | LOW        | Notifications système                 |
