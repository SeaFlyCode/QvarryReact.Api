# Firebase App Check — Intégration mobile (Qvarry Phone)

## Vue d'ensemble

L'application mobile envoie un token Firebase App Check sur **toutes les requêtes HTTP** vers le backend. Ce token prouve que la requête vient d'un vrai build de l'app signé par Google Play / Apple App Store, et non d'un client modifié ou d'un script.

Le backend doit vérifier ce token côté serveur via le SDK Admin Firebase. Sans cette vérification, l'App Check n'offre aucune protection.

---

## Ce que fait le mobile

### Initialisation

Au démarrage de l'app (`App.tsx`), `initializeAppCheck()` est appelé en parallèle des autres initialisations. Il configure le provider selon la plateforme :

| Environnement | Android | iOS |
|---|---|---|
| `__DEV__` (dev local) | Debug provider | Debug provider |
| Staging / Production | Play Integrity API | App Attest |

En mode debug, un token de test est généré automatiquement par le SDK Firebase et logué dans Logcat (Android) ou la console Xcode (iOS) sous le tag `DebugAppCheckProvider`. Ce token doit être enregistré dans la Firebase Console > App Check > Manage debug tokens pour que les requêtes passent.

### Injection dans les requêtes

**Depuis `src/services/api/secureFetch.ts`**, avant chaque requête HTTP, le mobile appelle `getAppCheckHeader()` qui retourne :

```
{ "X-Firebase-AppCheck": "<token>" }
```

Ce header est fusionné dans les options `fetch` et envoyé avec toutes les requêtes (y compris SSL-pinnées). Si l'obtention du token échoue (timeout, device compromis, quota dépassé), la requête est quand même envoyée sans le header — le backend doit alors décider de rejeter ou non.

### Activation par environnement

| Env | `enablePlayIntegrity` | `enableAppAttest` | Comportement |
|---|---|---|---|
| `development` | `false` | `false` | Attestation désactivée, aucun header envoyé |
| `staging` | `true` | `true` | Token Play Integrity / App Attest |
| `production` | `true` | `true` | Token Play Integrity / App Attest |

---

## Ce que le backend doit faire

### Dépendance

```bash
npm install firebase-admin
```

### Vérification du token

```typescript
import { initializeApp, cert } from 'firebase-admin/app';
import { getAppCheck } from 'firebase-admin/app-check';

// À initialiser une fois au démarrage
initializeApp({ credential: cert(serviceAccount) });

// Middleware Express
async function verifyAppCheck(req, res, next) {
  const token = req.headers['x-firebase-appcheck'];

  if (!token) {
    return res.status(401).json({ error: 'App Check token manquant' });
  }

  try {
    await getAppCheck().verifyToken(token);
    next();
  } catch (err) {
    return res.status(401).json({ error: 'App Check token invalide' });
  }
}
```

### Routes à protéger

À minima, les routes sensibles suivantes doivent exiger un token App Check valide :

- Authentification (`/auth/*`)
- Synchronisation des données (`/mobile/sync/*`)
- Contacts SOS (`/sos/*`)
- Messages / conversations
- Upload de photos

Les routes publiques (webhooks Firebase, health check) sont exemptées.

### Comportement recommandé si le token est absent

En **staging** : logger l'absence et retourner `401` pour valider l'intégration.  
En **production** : retourner `401` strictement — ne jamais laisser passer une requête sans token valide.

---

## Vérification côté Firebase Console

1. Ouvrir [Firebase Console](https://console.firebase.google.com) > App Check
2. Vérifier que l'app Android et iOS sont enregistrées avec les bons providers
3. Pour les tests en dev : enregistrer les debug tokens générés par le SDK (visibles dans Logcat / Xcode console)
4. Monitorer le dashboard App Check pour voir le ratio requêtes vérifiées / non vérifiées

---

## Limites et points d'attention

- **Le verdict granulaire (MEETS_DEVICE_INTEGRITY, PLAY_RECOGNIZED, etc.) n'est pas exposé côté client** par le SDK Firebase. Seul le backend peut le lire via le SDK Admin si Google le fournit dans le token décodé.
- **Les tokens expirent toutes les heures.** Le SDK renouvelle automatiquement (`isTokenAutoRefreshEnabled: true`), mais une requête longue en background peut échouer si le token expire pendant l'exécution.
- **Quota Firebase App Check** : en production, les appels Play Integrity sont limités à 10 000/jour par app par défaut. Contacter Google pour augmenter la limite si nécessaire.
- **Le WebSocket** (`/messages`) ne passe pas par `secureFetch` — le token App Check n'y est pas envoyé. À traiter séparément si la connexion WS doit être protégée (ex: passer le token en query param à la connexion, puis le vérifier côté serveur à l'upgrade HTTP→WS).
