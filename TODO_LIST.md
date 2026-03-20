# 📋 TODO List - QvarryReact.Api

**Date de scan** : 19 Mars 2026  
**Total TODO trouvés** : 5

---

## 📊 Vue d'ensemble

```
Répartition par Priorité
════════════════════════════════════════════════════════════════════
🟡 Optimisation     → 1 TODO
🔵 Phase 2          → 2 TODO (attestation devices)
🟢 Nice to have     → 2 TODO (WebSocket features)
```

---

## 🟡 OPTIMISATION (Priorité : BASSE)

### 1. Mode "silent store" pour les données utilisateur

**Fichier** : `src/controllers/auth/authHelpers.ts:480`

**Contexte** :

```typescript
// TODO: Pour optimiser davantage, on pourrait ajouter un mode "silent store"
// qui ne marque pas dirty. Mais pour l'instant c'est acceptable.
```

**Détails** :

- Lors du refresh de session, les données sont rechargées depuis la DB
- Ces données sont stockées via `storePoint()` qui les marque comme "dirty"
- Cela déclenche un re-sync inutile (no-op car données identiques)
- Coût : Re-chiffrement inutile

**Impact** : 🟡 Faible (optimisation de performance mineure)

**Solution proposée** :

```typescript
// Option 1 : Paramètre silent
function storePoint(point, options = { silent: false }) {
  if (!options.silent) {
    dirtySet.add(point._id);
  }
}

// Option 2 : Fonction dédiée
function reloadPointFromDB(point) {
  // Stocke sans marquer dirty
}
```

**Estimation** : 2-4 heures  
**Recommandation** : ⏸️ Reporter (faible impact, système stable)

---

## 🔵 PHASE 2 : Attestation Devices (Priorité : MOYENNE)

### 2. Vérification attestation iOS (Apple DeviceCheck)

**Fichier** : `src/services/deviceAttestationService.ts:157`

**Contexte** :

```typescript
// TODO PHASE 2:
// 1. Décoder le token d'attestation
// 2. Vérifier la signature avec la clé publique Apple
// 3. Valider le challenge/nonce
// 4. Vérifier le Team ID et App ID
// 5. Retourner verified: true si tout est OK
```

**État actuel** :

```typescript
return {
  verified: false,
  bypassed: true, // ⚠️ Validation désactivée
  reason: "iOS attestation not implemented yet",
};
```

**Impact** : 🟡 Moyen (sécurité mobile iOS non vérifiée)

**Solution proposée** :

1. Intégrer SDK Apple DeviceCheck
2. Implémenter la vérification cryptographique
3. Valider les certificats Apple
4. Gérer les erreurs et timeouts

**Estimation** : 1-2 jours  
**Recommandation** : 📅 Planifier pour Phase 2 sécurité mobile

---

### 3. Vérification attestation Android (Google Play Integrity)

**Fichier** : `src/services/deviceAttestationService.ts:194`

**Contexte** :

```typescript
// TODO PHASE 2:
// 1. Envoyer le token à l'API Google Play Integrity
// 2. Vérifier le verdicts (MEETS_DEVICE_INTEGRITY, MEETS_BASIC_INTEGRITY, etc.)
// 3. Valider le package name et les certificats
// 4. Vérifier le verdict d'application (PLAY_RECOGNIZED, etc.)
// 5. Retourner verified: true si tout est OK
```

**État actuel** :

```typescript
return {
  verified: false,
  bypassed: true, // ⚠️ Validation désactivée
  reason: "Android attestation not implemented yet",
};
```

**Impact** : 🟡 Moyen (sécurité mobile Android non vérifiée)

**Solution proposée** :

1. Créer compte Google Cloud Platform
2. Activer Play Integrity API
3. Implémenter la vérification serveur
4. Gérer les différents niveaux de verdicts

**Estimation** : 1-2 jours  
**Recommandation** : 📅 Planifier pour Phase 2 sécurité mobile

---

## 🟢 NICE TO HAVE : WebSocket Features (Priorité : BASSE)

### 4. Push notification pour messages en attente

**Fichier** : `src/services/webSocketReconnectionService.ts:175`

**Contexte** :

```typescript
// TODO: Intégrer avec le service de notifications push
// await notificationService.sendPushNotification(connection.userId, {
//   title: "Messages en attente",
//   body: `Vous avez ${connection.pendingMessages} message(s) en attente`,
//   data: { type: "reconnection_needed", deviceId: connection.deviceId }
// });
```

**Détails** :

- Lorsqu'une connexion WebSocket devient stale avec des messages pendants
- Le système pourrait envoyer une push notification pour inciter à la reconnexion
- Actuellement : Seul un log est généré

**Impact** : 🟢 Faible (UX amélioration)

**Solution proposée** :

```typescript
if (connection.pendingMessages > 0) {
  await NotificationService.sendPushNotification(
    connection.userId,
    "Messages en attente",
    `Vous avez ${connection.pendingMessages} message(s) non lus`,
    {
      type: "reconnection_needed",
      pendingCount: connection.pendingMessages.toString(),
    },
  );
}
```

**Estimation** : 1-2 heures  
**Recommandation** : ⏸️ Reporter (feature nice-to-have)

---

### 5. Mise à jour du statut utilisateur (away)

**Fichier** : `src/services/webSocketReconnectionService.ts:192`

**Contexte** :

```typescript
// TODO: Mettre à jour le statut utilisateur (si nécessaire)
// await userStatusService.markAsAway(connection.userId);
```

**Détails** :

- Lorsqu'une connexion devient inactive (away)
- Le système pourrait mettre à jour le statut de l'utilisateur
- Actuellement : Seul un log debug est généré

**Impact** : 🟢 Faible (feature de présence)

**Prérequis** :

- Créer un service `userStatusService`
- Définir les statuts possibles (online, away, offline)
- Implémenter la logique de présence

**Solution proposée** :

```typescript
// Créer src/services/userStatusService.ts
export async function updateUserStatus(
  userId: string,
  status: "online" | "away" | "offline",
) {
  await User.updateOne(
    { _id: userId },
    { $set: { status, lastSeen: new Date() } },
  );
}
```

**Estimation** : 4-6 heures (création complète du service)  
**Recommandation** : ⏸️ Reporter (feature de présence non prioritaire)

---

## 📈 Statistiques

```
Total TODO                 : 5
Par priorité
  - Haute                  : 0
  - Moyenne                : 2 (Phase 2)
  - Basse                  : 3 (Optimisations/Features)

Par catégorie
  - Sécurité mobile        : 2 TODO
  - Performance            : 1 TODO
  - Features WebSocket     : 2 TODO

Code coverage
  - Fichiers avec TODO     : 3 / ~80 fichiers (3.75%)
  - Proportion             : Très faible ✅
```

---

## ✅ Recommandations

### Court Terme (Urgent - 0 TODO)

Aucun TODO urgent identifié. Le code est stable.

### Moyen Terme (Phase 2 - 2 TODO)

1. ✓ Planifier l'implémentation des attestations devices
2. ✓ Créer un sprint dédié "Sécurité Mobile Phase 2"
3. ✓ Estimer 2-4 jours de développement

### Long Terme (Nice to have - 3 TODO)

1. ⏸️ Mode silent store (si performance devient un problème)
2. ⏸️ Push notifications pour reconnexion (UX improvement)
3. ⏸️ Service de présence utilisateur (nouvelle feature)

---

## 🔍 Méthode de Scan

```bash
# Commandes utilisées
grep -rn "TODO\|FIXME" src/ --include="*.ts" --include="*.js"
find . -name "*TODO*" -o -name "*todo*"
```

**Critères d'exclusion** :

- ❌ Formats de validation (`@XXXXXX`, `XXXX-XXXX`)
- ❌ Commentaires de doc API
- ❌ TODO dans node_modules

---

## 📝 Notes

**Qualité du code** : ✅ Excellente

- Très peu de TODO (5 sur ~80 fichiers)
- Tous documentés et contextualisés
- Aucun TODO critique ou bloquant
- Système stable et en production

**Prochaine revue** : Dans 3-6 mois ou après Phase 2 mobile

---

**Date de génération** : 19 Mars 2026  
**Généré automatiquement** : Scripts de diagnostic disponibles dans `scripts/`
