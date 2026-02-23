# Mode SOS - Roadmap App Mobile (React Native)

**Statut** : BROUILLON
**Auteur** : Matheo / Chef IA
**Date** : 23/02/2026
**Version** : 0.1
**Document parent** : SOS_MODE_FEATURE.md (design global)

---

## Contexte

L'app mobile Qvarry sera en **React Native (TypeScript)**.
Le backend expose deja les routes `/api/mobile/auth`, `/api/mobile/2fa`, `/api/mobile/sync`.
Le Mode SOS necessite de nouveaux endpoints (`/api/mobile/sos/*`) et de nouvelles dependances (Vonage, Firebase).

Ce document decrit **uniquement le travail cote app mobile** pour le Mode SOS.

---

## Prerequis (avant de commencer le SOS)

Ces elements doivent exister dans l'app avant d'attaquer le Mode SOS :

- [ ] App React Native fonctionnelle (navigation, ecrans de base)
- [ ] Authentification mobile connectee a `/api/mobile/auth`
- [ ] Sync offline-first connectee a `/api/mobile/sync`
- [ ] Stockage local (SQLite / WatermelonDB / MMKV)
- [ ] Gestion de l'etat global (Zustand / Redux / Context)

---

## MVP (v1) - Le SOS qui marche

> Objectif : un user peut activer le SOS, descendre sous terre, et etre secouru si il ne remonte pas.

### 1. Ecran de configuration des contacts d'urgence

**Ou** : Parametres du profil → "Contacts d'urgence"

**Fonctionnalites** :

- [ ] Liste des contacts d'urgence permanents (max 5)
- [ ] Ajout d'un contact : nom, telephone (format international), relation
- [ ] Modification / suppression d'un contact
- [ ] Validation du numero de telephone (format +33...)
- [ ] Indicateur : "Au moins 1 contact requis pour activer le Mode SOS"

**Donnees** :

```typescript
interface SosContact {
  id: string;
  name: string;
  phone: string; // Format international +33...
  relationship: string; // collegue, famille, responsable, autre
  isDefault: boolean;
}
```

**API** :

- `POST /api/mobile/sos/contacts` → Creer un contact
- `GET /api/mobile/sos/contacts` → Liste des contacts
- `PUT /api/mobile/sos/contacts/:id` → Modifier
- `DELETE /api/mobile/sos/contacts/:id` → Supprimer

---

### 2. Bouton SOS sur l'ecran principal

**Ou** : Ecran d'accueil, toujours visible

**Fonctionnalites** :

- [ ] Bouton gros, rouge, bien visible "Mode SOS"
- [ ] Grise / desactive si aucun contact d'urgence configure
- [ ] Badge indiquant le nombre de contacts configures
- [ ] Si SOS deja actif → affiche le timer en cours au lieu du bouton

---

### 3. Ecran d'activation du SOS

**Ou** : Modal / ecran plein apres tap sur le bouton SOS

**Fonctionnalites** :

- [ ] Selection de la duree : boutons rapides [30min] [1H] [2H] [4H] + saisie custom
- [ ] Validation : min 30min, max 12H
- [ ] Affichage des contacts qui seront prevenus (contacts par defaut)
- [ ] Note optionnelle (zone precise, ex: "Galerie nord, niveau -2")
- [ ] Confirmation par **swipe** (pas un simple tap, pour eviter les activations accidentelles)
- [ ] A la confirmation :
  - Enregistrer la derniere position GPS
  - Envoyer `POST /api/mobile/sos/activate` au serveur
  - Demarrer le timer local en parallele
  - Afficher l'ecran SOS actif

**Payload d'activation** :

```typescript
// POST /api/mobile/sos/activate
{
  expectedDuration: number;    // en minutes
  contactIds: string[];        // IDs des contacts selectionnes
  lastKnownLat: number;
  lastKnownLng: number;
  lastKnownAccuracy: number;
  note?: string;               // optionnel, ex: "Zone B, galerie 3"
}
```

---

### 4. Ecran SOS actif (timer en cours)

**Ou** : Ecran dedie, aussi accessible via notification persistante

**Fonctionnalites** :

- [ ] Timer countdown visible (heures:minutes:secondes restantes)
- [ ] Statut reseau en temps reel (connecte / pas de reseau)
- [ ] Statut heartbeat (dernier heartbeat envoye il y a X min)
- [ ] Bouton **"Je suis OK (+15min)"** → prolonge le timer (serveur + local)
- [ ] Bouton **"Je suis sorti"** → desactive le SOS proprement
- [ ] Confirmation avant desactivation (eviter le tap accidentel)
- [ ] Affichage de la note si renseignee
- [ ] Indicateur du stade actuel si timer expire (STADE 0, 1, 2)

**Notification persistante Android/iOS** :

- [ ] Notification sticky qui reste tant que le SOS est actif
- [ ] Affiche le temps restant (mise a jour toutes les minutes)
- [ ] Actions rapides : "Je suis OK" / "Je suis sorti"
- [ ] Ne peut pas etre swipee / dismissee

---

### 5. Double timer (serveur + local)

**Timer serveur** : fait foi pour l'escalade et les notifications externes.
**Timer local** : declenche l'alarme sonore, fonctionne sans reseau.

**Fonctionnalites** :

- [ ] Timer local demarre au meme moment que le timer serveur
- [ ] Timer local tourne en background (meme app fermee / ecran verrouille)
- [ ] Resynchronisation du timer local avec le serveur a chaque heartbeat
- [ ] Resynchronisation via `GET /api/mobile/sos/status` a la reconnexion

**Implementation technique** :

```
React Native Background Timer / react-native-background-actions
─────────────────────────────────────────────────────────────────
iOS  → Background task + local notification schedulee
Android → Foreground service (notification persistante obligatoire)
```

- [ ] Stocker `expiresAt` en local (AsyncStorage / MMKV) au cas ou l'app est killee
- [ ] Au relancement de l'app → verifier si un SOS est actif et reprendre le countdown

---

### 6. Heartbeat automatique

**Fonctionnalites** :

- [ ] Envoi silencieux d'un ping `POST /api/mobile/sos/heartbeat` toutes les 60 secondes
- [ ] Envoi uniquement si reseau disponible (check connectivity avant)
- [ ] Si heartbeat reussi → serveur renvoie le nouveau `expiresAt` → recaler le timer local
- [ ] Si pas de reseau → le heartbeat echoue silencieusement, on reessaie dans 60s
- [ ] Compteur de heartbeats envoyes (affiche sur l'ecran SOS actif)

**Payload heartbeat** :

```typescript
// POST /api/mobile/sos/heartbeat
{
  sessionId: string;
  lat?: number;          // position actuelle si dispo
  lng?: number;
  accuracy?: number;
  batteryLevel?: number; // bonus : niveau de batterie
}

// Reponse
{
  expiresAt: string;     // nouveau timestamp d'expiration
  currentStage: number;  // 0, 1, ou 2
}
```

---

### 7. Alarme sonore (3 minutes par stade)

C'est la feature critique du SOS. L'alarme DOIT sonner meme sans reseau, meme en mode silencieux.

**Fonctionnalites** :

- [ ] Declenchee par le timer LOCAL quand il expire (stade 0)
- [ ] Re-declenchee a chaque changement de stade (stade 1 a T+15min, stade 2 a T+30min)
- [ ] Duree : 3 minutes continues
- [ ] **Passe au-dessus du mode silencieux et du DND**
- [ ] Vibration continue en parallele
- [ ] Son distinct et reconnaissable (pas une sonnerie standard)
- [ ] S'arrete quand l'user interagit (bouton "Je suis OK" ou "Je suis sorti")

**Implementation technique** :

```
iOS
───
→ Critical Alerts (UNNotificationSound.criticalSoundNamed)
→ Necessite une autorisation speciale Apple
  (formulaire : https://developer.apple.com/contact/request/notifications-critical-alerts-entitlement)
→ Justification : securite des travailleurs souterrains
→ Passe au-dessus du DND et du mode silencieux

Android
───────
→ Canal de notification IMPORTANCE_HIGH
→ setBypassDnd(true)
→ Son personnalise sur le canal
→ setCategory(NotificationCompat.CATEGORY_ALARM)
→ Fullscreen intent pour afficher l'ecran d'alerte meme verrouille
```

**Ecran d'alarme** :

- [ ] Ecran plein rouge qui s'affiche par-dessus tout (fullscreen intent)
- [ ] Affiche : stade actuel, temps ecoule, ce qui va se passer ensuite
- [ ] Boutons "Je suis OK (+15min)" et "Je suis sorti"
- [ ] Barre de progression de l'alarme (3 min)
- [ ] Pas de bouton "Fermer" ou "Ignorer" → l'alarme ne s'arrete qu'avec une action SOS

---

### 8. Ecran d'alerte stade (info user)

A chaque stade, en plus de l'alarme, l'user voit clairement ce qui se passe :

**Stade 0 (T+0)** :

```
┌─────────────────────────────────┐
│  !! ALERTE SOS !!               │
│                                 │
│  Ton timer de 2H est expire     │
│                                 │
│  → Personne n'a ete prevenu     │
│    pour le moment               │
│                                 │
│  Dans 15 min :                  │
│  Les users Qvarry du site       │
│  seront alertes                 │
│                                 │
│  [JE SUIS OK (+15min)]          │
│  [JE SUIS SORTI]                │
└─────────────────────────────────┘
```

**Stade 1 (T+15min)** :

```
┌─────────────────────────────────┐
│  !! ALERTE SOS - STADE 1 !!    │
│                                 │
│  Timer expire depuis 15 min     │
│                                 │
│  → TOUS les users Qvarry        │
│    ont ete PREVENUS              │
│                                 │
│  Dans 15 min :                  │
│  SMS envoye a tes contacts      │
│  d'urgence                      │
│                                 │
│  [JE SUIS OK (+15min)]          │
│  [JE SUIS SORTI]                │
└─────────────────────────────────┘
```

**Stade 2 (T+30min)** :

```
┌─────────────────────────────────┐
│  !! ALERTE SOS - STADE 2 !!    │
│                                 │
│  Timer expire depuis 30 min     │
│                                 │
│  → SMS ENVOYES a tes contacts   │
│    d'urgence                    │
│                                 │
│  Tes contacts sont responsables │
│  de prevenir les secours        │
│  si necessaire                  │
│                                 │
│  [JE SUIS OK (+15min)]          │
│  [JE SUIS SORTI]                │
└─────────────────────────────────┘
```

---

### 9. Gestion du cycle de vie de l'app

Le SOS doit survivre a tout :

- [ ] **App en background** → le timer et le heartbeat continuent (background task)
- [ ] **App killee** → le timer serveur continue. Au relancement, check `GET /sos/status` et reprendre
- [ ] **Telephone redemarr** → la notification persistante relance le service. Check `GET /sos/status`
- [ ] **Perte de batterie** → le timer serveur continue seul, l'escalade se fait cote serveur
- [ ] **Changement de reseau (wifi ↔ 4G)** → heartbeat reprend automatiquement

**Persistance locale** :

```typescript
// Stocker dans MMKV / AsyncStorage au moment de l'activation
{
  activeSessionId: string;
  expiresAt: string;        // ISO timestamp
  activatedAt: string;
  contactIds: string[];
}
```

---

### Recap MVP - Ecrans a developper

| #   | Ecran                         | Type            |
| --- | ----------------------------- | --------------- |
| 1   | Contacts d'urgence (settings) | Ecran complet   |
| 2   | Bouton SOS (home)             | Composant       |
| 3   | Activation SOS                | Modal / ecran   |
| 4   | SOS actif (timer)             | Ecran complet   |
| 5   | Alarme SOS (fullscreen)       | Ecran overlay   |
| 6   | Notification persistante      | Notification OS |

### Recap MVP - Services a developper

| #   | Service               | Description                                    |
| --- | --------------------- | ---------------------------------------------- |
| 1   | SosTimerService       | Double timer (local + sync serveur)            |
| 2   | SosHeartbeatService   | Ping auto toutes les 60s                       |
| 3   | SosAlarmService       | Alarme sonore 3min (Critical Alerts / Android) |
| 4   | SosBackgroundService  | Background task / foreground service           |
| 5   | SosPersistenceService | Sauvegarde locale de la session active         |
| 6   | SosApiService         | Appels API vers /api/mobile/sos/\*             |

---

## V2 - Ameliorations UX & admin

> Objectif : meilleure experience utilisateur + outils de suivi.

### 1. Contacts de session (override)

- [ ] A l'activation, pouvoir ajouter/retirer des contacts ponctuellement
- [ ] Interface : liste des contacts par defaut pre-coches + bouton "Ajouter pour cette session"
- [ ] Les contacts de session ne sont pas sauvegardes dans le profil

---

### 2. Note / zone precise

- [ ] Champ texte libre a l'activation : "Zone B, galerie 3"
- [ ] Affiche dans l'ecran SOS actif
- [ ] Transmis au serveur et inclus dans les alertes (stade 1 et 2)
- [ ] Modifiable pendant la session active

---

### 3. Historique des sessions SOS

**Ou** : Parametres → "Historique SOS"

- [ ] Liste des sessions passees (date, duree prevue, duree reelle, stade max atteint)
- [ ] Detail d'une session : timeline des events (activation, heartbeats, stades, resolution)
- [ ] Filtre par periode
- [ ] Indicateur : nombre de fausses alertes (stade > 0 alors que tout allait bien)

**API** :

- `GET /api/mobile/sos/history` → Liste paginee
- `GET /api/mobile/sos/history/:sessionId` → Detail

---

### 4. Dashboard SOS (vue des sessions actives)

**Ou** : Ecran dedie accessible depuis le menu

- [ ] Liste des sessions SOS actives de TOUS les users Qvarry en escalade
- [ ] Pour chaque session : nom de l'user, temps restant, stade actuel
- [ ] Bouton "Il est avec moi, tout va bien" → confirme au serveur que l'user est safe
- [ ] Notifications push quand un user Qvarry passe en stade 1

**API** :

- `GET /api/mobile/sos/active` → Sessions actives visibles pour l'user connecte
- `POST /api/mobile/sos/:sessionId/confirm-safe` → "Il est avec moi"

---

### 5. Detection GPS de surface

- [ ] Si le SOS est actif et que le GPS detecte un mouvement significatif en surface
- [ ] → Notification : "Tu sembles etre en surface. Desactiver le Mode SOS ?"
- [ ] Pas de desactivation automatique (eviter les faux positifs)
- [ ] Configurable dans les parametres (on/off)

---

### 6. Detection reconnexion prolongee

- [ ] Si l'app a une connexion stable depuis > 5 minutes pendant un SOS actif
- [ ] → Notification : "Tu as du reseau depuis 5 min. Tout va bien ? Desactiver le SOS ?"
- [ ] Pas de desactivation automatique

---

### Recap V2 - Ecrans supplementaires

| #   | Ecran                        | Type          |
| --- | ---------------------------- | ------------- |
| 7   | Activation SOS (v2 contacts) | Mise a jour   |
| 8   | Historique SOS               | Ecran complet |
| 9   | Detail session SOS           | Ecran complet |
| 10  | Dashboard sessions actives   | Ecran complet |

---

## V3 - Features avancees

> Objectif : intelligence, automatisation, et polish.

### 1. Stats et rapports

- [ ] Temps moyen passe sous terre (par site, par user)
- [ ] Nombre de sessions SOS par mois
- [ ] Taux de fausses alertes (sessions ou l'escalade s'est declenchee inutilement)
- [ ] Graphiques visuels (temps sous terre par semaine/mois)
- [ ] Export PDF / partage

---

### 2. Widget ecran de verrouillage

- [ ] **iOS** : Widget Lock Screen (iOS 16+) affichant le timer SOS en cours
- [ ] **Android** : Widget home screen avec timer + boutons rapides
- [ ] Activation rapide du SOS depuis le widget (avec contacts par defaut)

---

### 3. Appel vocal automatise Vonage

> Uniquement si le besoin est identifie apres retours utilisateurs.

- [ ] Stade 3 optionnel : appel vocal automatise aux contacts d'urgence
- [ ] Message pre-enregistre avec infos de la session
- [ ] Demande de confirmation (touche 1)
- [ ] Rappel automatique si pas de reponse

---

### 4. Ameliorations alarme

- [ ] Son personnalisable (choix parmi plusieurs alarmes)
- [ ] Intensite progressive (volume qui monte sur les 3 minutes)
- [ ] Pattern de vibration distinct par stade

---

### 5. Mode SOS rapide (1 tap)

- [ ] Si les contacts et un site par defaut sont configures
- [ ] → Activation en 1 tap avec la derniere config utilisee
- [ ] → "SOS rapide : 2H, Carriere Nord, Marc + Sophie. Confirmer ?"
- [ ] Raccourci depuis la notification persistante ou le widget

---

### Recap V3 - Ecrans supplementaires

| #   | Ecran                 | Type          |
| --- | --------------------- | ------------- |
| 11  | Stats SOS             | Ecran complet |
| 12  | Widget iOS/Android    | Widget OS     |
| 13  | SOS rapide (shortcut) | Modal rapide  |

---

## Dependances techniques

### Librairies React Native a evaluer

| Besoin                     | Librairie                                     | Plateforme  |
| -------------------------- | --------------------------------------------- | ----------- |
| Background tasks           | `react-native-background-actions`             | iOS/Android |
| Notifications locales      | `notifee` ou `react-native-push-notification` | iOS/Android |
| Push notifications         | `@react-native-firebase/messaging`            | iOS/Android |
| Son / alarme               | `react-native-sound` ou `expo-av`             | iOS/Android |
| Vibration                  | `react-native-haptic-feedback`                | iOS/Android |
| Connectivity check         | `@react-native-community/netinfo`             | iOS/Android |
| GPS                        | `react-native-geolocation-service`            | iOS/Android |
| Stockage local             | `react-native-mmkv`                           | iOS/Android |
| Foreground service (Andr.) | `react-native-background-actions`             | Android     |
| Critical Alerts (iOS)      | `notifee` (supporte les critical alerts)      | iOS         |
| Fullscreen intent (Andr.)  | `notifee` (fullScreenAction)                  | Android     |

### Autorisations requises

| Permission                | Plateforme | Quand                        |
| ------------------------- | ---------- | ---------------------------- |
| Notifications             | iOS/Andr.  | Au setup des contacts        |
| Critical Alerts           | iOS        | A l'activation du 1er SOS    |
| Localisation (foreground) | iOS/Andr.  | A l'activation SOS           |
| Localisation (background) | iOS/Andr.  | Pour heartbeat en background |
| Foreground service        | Android    | Pendant SOS actif            |
| Bypass DND                | Android    | Config canal notification    |
| Vibration                 | Android    | Auto                         |

### Autorisation speciale Apple

Pour les **Critical Alerts iOS**, il faut faire une demande a Apple :

- URL : https://developer.apple.com/contact/request/notifications-critical-alerts-entitlement
- Justification : securite des travailleurs isoles en milieu souterrain
- Delai : quelques jours a quelques semaines
- **A faire le plus tot possible** car bloquant pour le MVP

---

## Estimation de charge (indicatif)

| Phase | Ecrans            | Services   | Estimation   |
| ----- | ----------------- | ---------- | ------------ |
| MVP   | 5 + 1 composant   | 6 services | 3-4 semaines |
| V2    | 4 ecrans          | 2 services | 2-3 semaines |
| V3    | 3 ecrans + widget | 1 service  | 2-3 semaines |

> Ces estimations sont indicatives et dependront de la maturite de l'app mobile de base au moment du dev.
