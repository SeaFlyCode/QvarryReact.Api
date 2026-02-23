# Mode SOS - Feature Design Document

**Statut** : BROUILLON - En cours de conception
**Auteur** : Matheo / Chef IA
**Date** : 23/02/2026
**Version** : 0.2

---

## Vue d'ensemble

Le Mode SOS est un systeme de securite pour les utilisateurs Qvarry qui descendent sous terre (carrieres, galeries, tunnels). L'utilisateur active un timer avant de perdre le reseau. Si aucun signe de vie n'est detecte a l'expiration du timer, un protocole d'alerte progressif se declenche.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          FLUX MODE SOS                                      │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  1. ACTIVATION (avant descente)                                             │
│     User → Active le Mode SOS                                               │
│     User → Definit la duree prevue (ex: 2H)                                │
│     User → Selectionne les contacts d'urgence                               │
│     User → Confirme → Le serveur demarre le countdown                       │
│     User → Derniere position GPS enregistree automatiquement                │
│                                                                             │
│  2. SOUS TERRE (pas de reseau)                                              │
│     Serveur → Timer SERVEUR tourne (fait foi pour l'escalade)               │
│     App → Timer LOCAL tourne en parallele (pour alarme sonore)              │
│     App (si reseau partiel) → Envoie des heartbeats silencieux              │
│     Chaque heartbeat recu → Reset/prolonge le timer serveur                 │
│     Heartbeat recu → Resync du timer local avec le timer serveur            │
│                                                                             │
│  3. SORTIE NORMALE                                                          │
│     User retrouve le reseau → App envoie heartbeat automatique              │
│     User → Appuie sur "Je suis sorti" → Desactive le Mode SOS              │
│     OU → Heartbeat auto detecte = timer annule silencieusement              │
│                                                                             │
│  4. SORTIE ANORMALE (pas de signe de vie)                                   │
│     Timer expire → Protocole d'escalade demarre                             │
│     Voir section "Protocole d'escalade" ci-dessous                          │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Protocole d'escalade

L'escalade est **progressive** pour eviter les fausses alertes tout en garantissant la securite.

```
Temps 0                    Timer expire
    │
    ├── STADE 0 (T+0)     Timer local expire → ALARME SONORE 3 MIN sur le telephone
    │                      (meme sans reseau, le timer local declenche l'alarme)
    │                      + Notification push si reseau dispo
    │                      "Ta session de 2H est terminee. Tout va bien ?"
    │                      → Bouton "Je suis OK" / "Prolonger de Xmin"
    │                      → L'alarme s'arrete si l'user interagit
    │
    ├── STADE 1 (T+15min)  ALARME SONORE 3 MIN sur le telephone
    │                       + Alerte aux utilisateurs Qvarry du meme site
    │                       Notification : "[User] n'a pas donne signe de vie
    │                       depuis la fin de sa session sous terre"
    │                       → Les autres users peuvent confirmer "Il est avec moi"
    │
    └── STADE 2 (T+30min)  ALARME SONORE 3 MIN sur le telephone
                            + SMS aux contacts d'urgence via Twilio
                            Message : "Alerte Qvarry - [User] est entre sous terre
                            a [heure] sur le site [nom] et n'a pas donne signe
                            de vie depuis [duree]. Derniere position connue : [GPS]"
                            → C'est la responsabilite des contacts de prevenir
                              les secours si necessaire. Qvarry ne le fait pas.
```

> **Note** : Pas de stade 3/4 (appel vocal, services de secours).
> La responsabilite d'appeler les secours revient aux contacts designes par l'utilisateur.

> **IMPORTANT** : Pas de mode SOS silencieux. L'alarme sonore est OBLIGATOIRE a chaque stade.
> C'est une feature de securite vitale, pas une notification optionnelle.

### Delais configurables

| Parametre                  | Valeur par defaut | Configurable par |
| -------------------------- | ----------------- | ---------------- |
| Delai avant Stade 1        | 15 min            | Admin site       |
| Delai avant Stade 2        | 30 min            | Admin site       |
| Duree alarme sonore        | 3 min             | Systeme          |
| Duree min session SOS      | 30 min            | Systeme          |
| Duree max session SOS      | 12H               | Systeme          |
| Prolongation par heartbeat | +15 min           | User             |
| Nb max de prolongations    | 3                 | Admin site       |

---

## Double Timer (Serveur + App locale)

Le Mode SOS repose sur **deux timers qui tournent en parallele** :

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                     DOUBLE TIMER                                            │
├──────────────────────────────┬──────────────────────────────────────────────┤
│      TIMER SERVEUR           │        TIMER LOCAL (App mobile)             │
├──────────────────────────────┼──────────────────────────────────────────────┤
│                              │                                              │
│  → Fait FOI pour             │  → Declenche l'ALARME SONORE                │
│    l'escalade (stade 1, 2)   │    quand il expire (stade 0)                │
│                              │                                              │
│  → Gere l'envoi des          │  → Fonctionne SANS RESEAU                   │
│    notifications push        │    (countdown purement local)               │
│    et SMS Twilio             │                                              │
│                              │  → Se RESYNCHRONISE avec le                 │
│  → Prolonge par heartbeat    │    timer serveur des qu'un                   │
│    (+15 min)                 │    heartbeat passe                           │
│                              │                                              │
│  → Si le tel est mort/casse  │  → Alerte l'user a chaque                   │
│    le serveur continue       │    stade (alarme 3 min)                      │
│    l'escalade normalement    │                                              │
│                              │  → Si le tel est mort, le timer             │
│                              │    local meurt aussi → le serveur            │
│                              │    prend le relai seul                       │
│                              │                                              │
└──────────────────────────────┴──────────────────────────────────────────────┘
```

### Synchronisation des deux timers

1. **A l'activation** : les deux timers demarrent avec la meme valeur
2. **Heartbeat recu** : le serveur prolonge son timer de +15min → renvoie le nouveau `expiresAt` → l'app local se recale
3. **Prolongation manuelle** ("Je suis OK") : idem, les deux se recalent
4. **Pas de reseau** : les deux timers avancent independamment. Ils peuvent deriver legerement mais c'est acceptable (le timer local sert juste pour l'alarme)
5. **Reconnexion** : l'app appelle `GET /sos/status` et recale son timer local sur le timer serveur

---

## Alarme sonore

### Comportement

- **Declenchee par le timer LOCAL** (fonctionne meme sans reseau)
- **Duree** : 3 minutes continues
- **Obligatoire** : pas de mode silencieux, pas de DND qui override. L'alarme doit passer au-dessus de tout
- **A chaque stade** : stade 0, stade 1, stade 2 → alarme 3 min a chaque fois
- **Arret** : l'user interagit (bouton "Je suis OK" ou "Je suis sorti")

### Implementation technique (app mobile)

- iOS : utiliser les **Critical Alerts** (necessite une autorisation Apple speciale)
  → Passe au-dessus du mode silencieux et du mode Ne Pas Deranger
  → Necessite une demande aupres d'Apple (formulaire de justification medical/securite)
- Android : utiliser le canal **IMPORTANCE_HIGH** avec `setBypassDnd(true)`
  → Son personnalise, vibration, plein ecran meme si verrouille
- Le son doit etre distinct et reconnaissable (pas une sonnerie classique)
- Vibration continue en parallele du son

### UX de l'alarme

```
┌─────────────────────────────────┐
│  !! ALERTE SOS !!               │
│                                 │
│  Ton timer de 2H est expire     │
│  depuis 15 minutes              │
│                                 │
│  STADE 1 ACTIF                  │
│  Les users Qvarry du site       │
│  ont ete prevenus               │
│                                 │
│  Dans 15 min → SMS envoye       │
│  a tes contacts d'urgence       │
│                                 │
│  ┌───────────────────────────┐  │
│  │     JE SUIS OK (+15min)   │  │
│  └───────────────────────────┘  │
│  ┌───────────────────────────┐  │
│  │   JE SUIS SORTI (fin SOS) │  │
│  └───────────────────────────┘  │
│                                 │
│  Alarme : ████████░░ 2:14       │
└─────────────────────────────────┘
```

---

---

## Detection de signe de vie (Heartbeat)

Plusieurs mecanismes combines pour detecter si l'utilisateur est en vie / sorti :

### 1. Heartbeat reseau automatique

- L'app envoie un ping silencieux toutes les **60 secondes** quand le Mode SOS est actif
- Si le telephone capte du reseau meme brievement (ex: proche de la sortie), le heartbeat part
- Chaque heartbeat recu par le serveur **prolonge le timer de 15 minutes**
- Pas d'action requise de l'utilisateur

### 2. Bouton "Je suis OK"

- Accessible depuis l'ecran de verrouillage / notification persistante
- Prolonge le timer de la duree choisie
- Utile si l'utilisateur sait qu'il va rester plus longtemps

### 3. Bouton "Je suis sorti"

- Desactive proprement le Mode SOS
- Enregistre l'heure de sortie (stats / historique)

### 4. Detection GPS (bonus)

- Si la position GPS change significativement (l'utilisateur se deplace en surface)
- → Proposition automatique de desactiver le Mode SOS
- Pas de desactivation auto pour eviter les faux positifs

### 5. Detection de reconnexion prolongee (bonus)

- Si l'app detecte une connexion stable pendant > 5 minutes
- → Le serveur considere que l'utilisateur est probablement sorti
- → Notification "Tu sembles etre en surface, desactiver le Mode SOS ?"

---

## Contacts d'urgence

### Deux niveaux de contacts

**Contacts permanents (profil)**

- Definis une fois dans les parametres du profil
- Nom, telephone, relation (collegue, famille, responsable securite)
- Maximum 5 contacts permanents
- Au moins 1 contact obligatoire pour activer le Mode SOS

**Contacts de session (override)**

- A chaque activation SOS, l'utilisateur peut :
  - Utiliser ses contacts par defaut (1 tap)
  - Ajouter des contacts supplementaires pour cette session
  - Retirer temporairement un contact
- Cas d'usage : "Aujourd'hui c'est Paul qui est de garde, pas Marc"

### Informations transmises aux contacts

| Info                           | Stade 1 (Qvarry users) | Stade 2 (SMS Twilio) |
| ------------------------------ | ---------------------- | -------------------- |
| Nom de l'utilisateur           | Oui                    | Oui                  |
| Nom du site / carriere         | Oui                    | Oui                  |
| Heure d'entree                 | Oui                    | Oui                  |
| Duree prevue                   | Oui                    | Oui                  |
| Temps ecoule depuis expiration | Oui                    | Oui                  |
| Derniere position GPS          | Lien carte             | Lien carte           |
| Lien dashboard SOS             | Oui                    | Oui                  |
| Numero a rappeler              | Non                    | Oui                  |

---

## Activation du Mode SOS - UX Flow

```
┌─────────────────────────────────┐
│  Ecran principal Qvarry         │
│                                 │
│  ┌───────────────────────────┐  │
│  │  [BOUTON SOS]             │  │
│  │  Gros, visible, rouge     │  │
│  │  "Activer Mode SOS"       │  │
│  └───────────────────────────┘  │
│                                 │
└─────────────────┬───────────────┘
                  │
                  v
┌─────────────────────────────────┐
│  Configuration rapide           │
│                                 │
│  Duree prevue :                 │
│  [30min] [1H] [2H] [4H] [___]  │
│                                 │
│  Contacts d'urgence :           │
│  [v] Marc Dupont (default)      │
│  [v] Sophie Martin (default)    │
│  [ ] + Ajouter un contact       │
│                                 │
│  Site / Carriere :              │
│  [Auto-detecte: Carriere Nord]  │
│  ou [Changer]                   │
│                                 │
│  Note optionnelle :             │
│  [Zone B, galerie 3            ]│
│                                 │
│  ┌───────────────────────────┐  │
│  │  ACTIVER LE MODE SOS      │  │
│  │  (confirmation par swipe)  │  │
│  └───────────────────────────┘  │
└─────────────────┬───────────────┘
                  │
                  v
┌─────────────────────────────────┐
│  Mode SOS ACTIF                 │
│                                 │
│  Timer : 01:47:23 restant       │
│  Statut : Sous terre            │
│  Heartbeat : Pas de reseau      │
│                                 │
│  [Je suis OK +15min]            │
│  [Je suis sorti - Desactiver]   │
│                                 │
│  Note : Zone B, galerie 3       │
└─────────────────────────────────┘
```

---

## Architecture technique (haut niveau)

### Cote serveur (API Node.js)

```
┌──────────────────────────────────────────────────────────┐
│                     SOS SERVICE                          │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  Endpoints :                                             │
│  POST   /api/mobile/sos/activate    → Demarre session    │
│  POST   /api/mobile/sos/heartbeat   → Signe de vie       │
│  POST   /api/mobile/sos/extend      → Prolonger timer    │
│  POST   /api/mobile/sos/deactivate  → Fin de session     │
│  GET    /api/mobile/sos/status      → Etat courant       │
│  GET    /api/mobile/sos/history     → Historique          │
│                                                          │
│  Admin :                                                 │
│  GET    /api/sos/active             → Sessions en cours   │
│  GET    /api/sos/dashboard          → Vue d'ensemble      │
│  POST   /api/sos/cancel/:id        → Annuler alerte      │
│                                                          │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  Timer Engine :                                          │
│  → Cron job / Bull queue qui verifie les sessions        │
│  → Toutes les 60 secondes, check les sessions expirees   │
│  → Declenche l'escalade appropriee                       │
│                                                          │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  Notification Engine :                                   │
│  → Push notifications (Firebase / APNs)                  │
│  → SMS via Twilio                                        │
│  → Notifications in-app pour les users Qvarry            │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

### Modele de donnees (a affiner)

```
SosSession {
  id                : UUID
  userId            : UUID (ref User)
  siteId            : UUID (ref Site) - nullable
  status            : ENUM [ACTIVE, EXPIRED, ESCALATING, RESOLVED, CANCELLED]

  // Timing
  activatedAt       : DateTime
  expectedDuration  : Integer (minutes)
  expiresAt         : DateTime (activatedAt + expectedDuration)
  lastHeartbeatAt   : DateTime - nullable
  resolvedAt        : DateTime - nullable

  // Localisation
  lastKnownLat      : Float
  lastKnownLng      : Float
  lastKnownAccuracy : Float
  note              : String - nullable (ex: "Zone B, galerie 3")

  // Escalade
  currentStage      : Integer (0-2)
  stage1TriggeredAt : DateTime - nullable
  stage2TriggeredAt : DateTime - nullable

  // Meta
  heartbeatCount    : Integer
  extensionCount    : Integer
  resolvedBy        : ENUM [USER, HEARTBEAT_AUTO, ADMIN, CONTACT_CONFIRM] - nullable

  createdAt         : DateTime
  updatedAt         : DateTime
}

SosContact {
  id                : UUID
  userId            : UUID (ref User) - contacts permanents
  sessionId         : UUID (ref SosSession) - nullable, si specifique a une session

  name              : String
  phone             : String (format international +33...)
  relationship      : String (collegue, famille, responsable, autre)
  isDefault         : Boolean

  // Tracking des notifications envoyees
  smsSentAt         : DateTime - nullable

  createdAt         : DateTime
  updatedAt         : DateTime
}

SosEvent {
  id                : UUID
  sessionId         : UUID (ref SosSession)

  type              : ENUM [ACTIVATED, HEARTBEAT, EXTENDED, STAGE_CHANGE,
                           SMS_SENT, RESOLVED, CANCELLED, CONTACT_CONFIRMED]
  metadata          : JSON (details variables selon le type)

  createdAt         : DateTime
}
```

---

## Considerations importantes

### Securite & Fiabilite

- Le timer DOIT tourner cote serveur (le telephone peut etre mort/casse)
- Redundance : si le serveur principal tombe, queue persistante (Redis/BullMQ)
- Les SMS/Appels doivent etre envoyes meme si l'API est sous charge
- Retry automatique si l'envoi SMS echoue (3 tentatives, espacement exponentiel)

### Fausses alertes

- Le stade 0 (notification push) sert de buffer avant l'escalade
- Possibilite pour un autre user Qvarry de confirmer "Il est avec moi, tout va bien"
- L'admin du site peut annuler une alerte en cours
- Historique des fausses alertes pour ajuster les delais

### Legal / RGPD

- Consentement explicite pour la collecte GPS
- Les contacts d'urgence doivent etre informes qu'ils sont designes
- Droit de retrait des contacts (lien de desinscription dans le SMS ?)
- Retention des donnees : combien de temps garde-t-on l'historique SOS ?
- Responsabilite : disclaimer clair que Qvarry ne remplace PAS un dispositif PTI/DATI homologue

### Monetisation

- Pour le moment, les couts SMS Twilio sont payes par Matheo (fondateur)
- Cout Twilio estime : ~0.05EUR/SMS
- A revoir quand la base utilisateurs grandit (integration dans l'abonnement ?)

### Reglementation PTI/DATI

- En France, les travailleurs isoles doivent avoir un dispositif PTI
  (Protection du Travailleur Isole)
- Le Mode SOS pourrait completer (pas remplacer) un dispositif PTI
- Se renseigner sur la norme NF V 03-002 pour la conformite
- Partenariat possible avec des fabricants de boitiers PTI ?

---

## MVP vs Full Feature

### MVP (v1)

- [ ] Activation du Mode SOS avec duree (avant perte de reseau)
- [ ] Contacts d'urgence (permanents uniquement, pas de notion d'equipe)
- [ ] Double timer (serveur + app locale)
- [ ] Alarme sonore obligatoire 3 min a chaque stade (pas de mode silencieux)
- [ ] Heartbeat automatique basique (+15min par heartbeat)
- [ ] Bouton "Je suis sorti"
- [ ] Stade 0 : Alarme locale + notification push
- [ ] Stade 1 : Alarme locale + notification aux users Qvarry du site
- [ ] Stade 2 : Alarme locale + SMS aux contacts via Twilio

### v2

- [ ] Contacts de session (override)
- [ ] Dashboard admin SOS (sessions en cours)
- [ ] Historique des sessions
- [ ] Note / zone precise
- [ ] Detection GPS de surface
- [ ] Detection reconnexion prolongee

### v3

- [ ] Stats et rapports (temps moyen sous terre, fausses alertes, etc.)
- [ ] Widget ecran de verrouillage iOS/Android
- [ ] Appel vocal automatise Twilio (si besoin identifie)

---

## Decisions prises

| #   | Question                       | Decision                                                                                                                                                                        |
| --- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Provider SMS/Appel             | **Twilio** - On part dessus                                                                                                                                                     |
| 2   | Prolongation par heartbeat     | **+15 minutes** par heartbeat recu                                                                                                                                              |
| 3   | Stade 4 (appel secours)        | **Non** - Pas notre responsabilite. Les contacts decides par l'user sont responsables de prevenir les secours si besoin                                                         |
| 4   | Mode SOS obligatoire / equipes | **Non** - Pas de notion d'equipe. Chaque user cree et gere son propre Mode SOS individuellement                                                                                 |
| 5   | Activation hors-ligne          | **L'user doit activer le Mode SOS AVANT de perdre le reseau** (en surface). Pas de mecanisme d'activation sans connexion                                                        |
| 6   | Apple Watch / Wear OS          | **Non** - Pas prevu pour le moment                                                                                                                                              |
| 7   | Qui paie les SMS               | **Matheo** (fondateur) pour le moment. A revoir quand la base users grandit                                                                                                     |
| 8   | Double timer                   | **Oui** - Timer serveur (fait foi pour l'escalade) + Timer local app (pour alarme sonore sans reseau)                                                                           |
| 9   | Alarme sonore                  | **Obligatoire 3 min a chaque stade**. Pas de mode silencieux. Passe au-dessus du DND (Critical Alerts iOS)                                                                      |
| 10  | Mode SOS silencieux            | **Non** - Le SOS est toujours bruyant. C'est une feature de securite vitale                                                                                                     |
| 11  | Activation auto suggeree       | **Non** - Impossible : la detection de perte reseau arrive quand on ne peut plus contacter le serveur. L'activation doit se faire AVANT la descente, en surface, avec du reseau |

## Questions ouvertes (restantes)

_Aucune question bloquante pour le MVP. Ajouter ici les nouvelles questions au fil du dev._

---

## Notes de brainstorming

_Espace libre pour ajouter des idees en vrac :_

- Integration avec des talkies-walkies connectes ?
- QR code a l'entree de la carriere qui pre-remplit la config SOS ?
