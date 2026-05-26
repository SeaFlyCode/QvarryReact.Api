# Audit backend QvarryReact.Api — Plan de correction

> Audit produit le 2026-05-01. Premier audit ciblé sur le backend Express/Mongo (les Phases 1-3 traitaient le mobile + web). 3 passes parallèles ont produit ~120 findings bruts ; après vérification, **30 % étaient des faux positifs** (ex. secrets `.env` faussement signalés comme commités, index `email` faussement absent alors que `emailHash` est l'index canonique). Ce document ne retient que les findings **vérifiés sur le code**.
>
> Cross-stack : ce backend est consommé par `Qvarry-phone` (RN) et `QvarryReact` (Next.js). Les findings impactent donc indirectement les 2 clients ; les annotations cross-project ci-dessous précisent quand un fix backend ferme aussi un bug client connu.

---

## Problème N° 1 — Pattern `memoryStorage` étendu : points + listes (extension Phase 1 #20)

**Description** : Le bug critique Phase 1 #20 (fiches créées en mémoire mais perdues si `syncService.syncNow()` échoue) a été corrigé uniquement pour `handleCreateFiche`. **Le même pattern dangereux existe dans `pointsControllers` et `listsControllers`** sur quasiment toutes les opérations CUD.

**Fichiers / composants impactés** :
- `src/controllers/pointsControllers.ts:182` — `handleCreatePoint` : `memoryStorage.storePoint(userId, ...)` puis `syncService.syncNow(userId)`. Si sync KO → response 500 mais data en mémoire.
- `src/controllers/pointsControllers.ts:196-229` — `addPointToFiche` : enchaîne `getFicheById` (memory) → `storeFiche` (memory) → `addPointToFiche` (memory) sans round-trip Mongo.
- `src/controllers/listsControllers.ts:33` — `handleCreateList` : même pattern.
- `src/controllers/listsControllers.ts:160-167` — `handleDeleteList` : delete in memory puis sync.
- `src/controllers/listsControllers.ts:205-218` — `handleUpdateList` : update in memory puis sync.
- `src/controllers/listsControllers.ts:347-617` — Toutes les opérations `addPointToList`, `removePointFromList`, `updatePointsOrder` suivent le même pattern.
- `src/services/memoryStorageService.ts` — store volatile RAM avec TTL session 30 min (cf. audit Phase 4 finding I1).

**Flux reconstitué (du bug)** :
1. Client mobile crée un point → POST `/points`.
2. Controller appelle `memoryStorage.storePoint()` — succès immédiat (RAM).
3. Controller appelle `syncService.syncNow(userId)` — échec (Mongo down, timeout, index conflict, etc.).
4. Controller retourne 500 + `syncFailed: true`.
5. Le client mobile reçoit 500, considère que le point n'a pas été créé.
6. **MAIS** la donnée est restée dans le memoryStorage du serveur.
7. Si l'utilisateur continue d'utiliser l'app pendant 30 min, `GET /points` retourne le point depuis le memoryStorage → l'utilisateur le voit.
8. Au reboot du serveur ou expiration de session : le point disparaît définitivement (jamais persisté).

**Cause racine** :
Architecture « write-aside cache » mal contrainte : la RAM est traitée comme source de vérité avant la DB. Le rollback de la Phase 1 #20 a été appliqué seulement à `handleCreateFiche` (ajout d'un `findById` Mongo + rollback `memoryStorage.deleteFiche` en cas de sync KO). Les autres controllers n'ont jamais reçu ce traitement.

**Projets impactés** : 2 / 3 — QvarryReact.Api (cause) + Qvarry-phone (effet visible — l'utilisateur voit son point « créé » puis disparaître après reboot).

**Solution proposée** :
1. **Court terme — étendre le pattern de Phase 1 #20** à `handleCreatePoint`, `handleCreateList`, `handleUpdatePoint`, `handleUpdateList`, `handleDeletePoint`, `handleDeleteList`. Recette pour chaque :
   - Round-trip Mongo après `syncNow` (`PointModel.findById`, `ListModel.findById`) pour confirmer la persistance réelle.
   - Si pas trouvé en Mongo → rollback `memoryStorage.delete*()` + retourner 503 (pas 500) avec `{ persisted: false }`.
   - Côté client (déjà fait pour fiches) : sur 503, throw error et afficher `AlertHelper.error`.
2. **Moyen terme — inverser l'ordre architecturalement** : DB first, mémoire en cache secondaire. Le controller écrit en Mongo, succès → met à jour le cache mémoire. Élimine la classe entière de bugs.
3. **Long terme** : remplacer le memoryStorage par un Redis avec TTL et sync DB en write-through ou write-behind avec une queue persistante (BullMQ).

**Cross-project** : ce fix ferme un bug latent qui aurait fini par toucher `Qvarry-phone` côté points/listes après que les utilisateurs aient relancé l'app. Aucun changement requis côté client RN — les hooks `usePoints` / `useLists` gèrent déjà le 503 (cf. ce qu'on a fait pour fiches en Phase 1).

**Priorité suggérée** : Critique

---

## Problème N° 2 — `incrementStorageUsed` : race condition asymétrique (quota by-pass)

**Description** : `decrementStorageUsed` vérifie le seuil avec `$gte` (atomique), mais `incrementStorageUsed` fait juste `$inc` sans aucune contrainte de quota. Deux uploads concurrents peuvent dépasser le quota.

**Fichiers / composants impactés** :
- `src/services/storageQuotaService.ts:88-92` — `incrementStorageUsed(userId, bytes)` : `findByIdAndUpdate(userId, { $inc: { storage_used: bytes } })`. Aucune vérification que `storage_used + bytes <= storage_quota`.
- `src/services/storageQuotaService.ts:114-163` — `decrementStorageUsed(userId, bytes)` (correctement implémenté avec `$gte` + rollback).
- Appelants : `src/controllers/photosControllers.ts` et `src/services/photoStorage.ts` (à valider en grep).

**Flux reconstitué** :
- User a quota 100 Mo, déjà 90 Mo utilisés.
- Lance deux uploads simultanés de 20 Mo chacun.
- Thread 1 : `canUploadPhoto()` voit 90 Mo + 20 = 110 Mo > quota → théoriquement refusé.
- **MAIS** : entre `canUploadPhoto()` et `incrementStorageUsed()`, il n'y a aucune transaction. Thread 2 peut passer la même check au même moment.
- Si la check est faite avant les `$inc`, les deux peuvent voir 90 Mo et accepter. Résultat : 130 Mo utilisés sur 100 de quota.

**Cause racine** :
Read-then-write sans atomicité. Le `canUploadPhoto()` (lecture) et `incrementStorageUsed()` (écriture) sont deux opérations Mongo distinctes. Pas de version field, pas de transaction, pas d'update conditionnel.

**Projets impactés** : 1 / 3 — QvarryReact.Api uniquement. Côté client, l'utilisateur est juste content de pouvoir over-allocate.

**Solution proposée** :
Remplacer le pattern check + increment par un seul update conditionnel atomique :
```ts
async incrementStorageUsed(userId: string, bytes: number): Promise<boolean> {
  const result = await UserModel.findOneAndUpdate(
    {
      _id: userId,
      $expr: { $lte: [{ $add: ['$storage_used', bytes] }, '$storage_quota'] },
    },
    { $inc: { storage_used: bytes } },
    { new: true }
  );
  if (!result) {
    // Quota dépassé : caller doit aborter l'upload + ne pas écrire le blob.
    throw new QuotaExceededError(`Quota dépassé pour user ${userId}`);
  }
  return true;
}
```
Conséquence sur le caller : doit gérer le throw + cleanup du blob déjà uploadé sur S3/disk.

**Priorité suggérée** : Critique (exploitation triviale, peut faire fuir le disque)

---

## Problème N° 3 — Observabilité prod : aveugle

**Description** : Aucune intégration Sentry, aucun endpoint `/metrics` Prometheus, aucun slow-query logging Mongo. Tu pilotes en prod sans aucun signal de dégradation. À 1k users c'est inconfortable, à 10k+ c'est dangereux.

**Fichiers / composants impactés** :
- `src/server.ts` — pas d'init Sentry, pas de middleware metrics.
- `src/config/database.ts` — pas de `db.setProfilingLevel(1, { slowms: 100 })`.
- `package.json` — ni `@sentry/node`, ni `prom-client`.

**Cause racine** :
Probablement pas une priorité MVP. Mais maintenant que la stack est en prod, les bugs Phase 1-3 qu'on a fixés ont tous été identifiés par audit manuel — ils auraient dû être détectés automatiquement.

**Projets impactés** : 1 / 3 — QvarryReact.Api directement. **Indirect cross-project** : si Sentry est ajouté ici, on devrait l'aligner avec celui qu'on devrait avoir aussi côté `Qvarry-phone` et `QvarryReact` (un seul projet Sentry, plusieurs sources, request IDs corrélés).

**Solution proposée** :

### 3a — Sentry
```bash
npm i @sentry/node @sentry/profiling-node
```
Init très tôt dans `server.ts`, avant les routes. Configurer `tracesSampleRate: 0.1` en prod, `1.0` en dev. Ajouter `Sentry.requestHandler()` + `Sentry.errorHandler()` aux middlewares Express. Wrapper `unhandledRejection` / `uncaughtException` pour les capter (déjà câblés à `auditService` côté code, juste à ajouter `Sentry.captureException`).

### 3b — Prometheus
```bash
npm i prom-client
```
Endpoint `GET /metrics` dans un router séparé, protégé par auth basic ou ACL IP (pas exposé publiquement). Métriques par défaut + custom :
- `http_request_duration_seconds` par route + status.
- `mongo_query_duration_seconds` (via mongoose hooks).
- `redis_command_duration_seconds`.
- `sos_active_sessions` (gauge), `pending_notifications` (gauge), `memory_storage_size` (gauge).

### 3c — MongoDB slow query log
Ajouter au démarrage dans `src/config/database.ts` :
```ts
mongoose.connection.once('connected', async () => {
  if (process.env.NODE_ENV === 'production') {
    await mongoose.connection.db.command({ profile: 1, slowms: 100 });
  }
});
```
Les requêtes >100ms iront dans `system.profile`. À grepper périodiquement ou pousser dans Datadog.

**Priorité suggérée** : Haute (pas un bug actif mais nécessaire avant 10k users)

---

## Problème N° 4 — Fire-and-forget sans retry persistant (emails admin, audit logs, broadcasts WS)

**Description** : 3 patterns « tire et oublie » identifiés sans queue de retry persistante. Une panne SMTP / Redis / WebSocket cause des pertes silencieuses.

**Fichiers / composants impactés** :
- `src/controllers/adminControllers.ts:1610` — `sendAccountApprovedEmail()` lancé sans `await`. Si SMTP down : utilisateur approuvé ne reçoit jamais son email.
- `src/controllers/adminControllers.ts:1685` — `sendAccountRejectedEmail()` idem.
- `src/server.ts:966-980` — global error handler appelle `auditService.log().then(...)` sans await. Si Redis/Mongo audit collection down : audit critique perdu.
- `src/controllers/messagesControllers.ts:76-92` — broadcast WebSocket sur nouveau message en try-catch non-bloquant. Si WS service down : clients connectés ne reçoivent pas le message en temps réel (le `GET /messages` REST reste fonctionnel, donc dégradé pas critique).

**Cause racine** :
Design « best-effort » volontaire pour ne pas bloquer la réponse HTTP. Mais aucune queue persistante (Bull, BullMQ, agenda) pour rejouer les opérations échouées.

**Projets impactés** : 1 / 3 — QvarryReact.Api uniquement. Cross-project : impacte la confiance UX côté mobile et web (admin valide un compte → user ne reçoit rien → user demande à l'admin → admin pense que c'est fait).

**Solution proposée** :
1. **Court terme** : Logger les échecs en `error` + fixer le bug critique du #2 ci-dessous (storage_used) qui peut empêcher les emails d'être envoyés.
2. **Moyen terme** : ajouter une collection `PendingOperation` Mongo avec retry exponentiel (5 tentatives sur 24h). Un cron toutes les 5 min replay les échecs. Pattern similaire au `PendingNotificationModel` qui existe déjà.
3. **Long terme** : remplacer par BullMQ + Redis pour tous les jobs async (queue durable, scheduling, dead letter queue).

**Priorité suggérée** : Haute

---

## Problème N° 5 — Validation de configuration au démarrage

**Description** : Plusieurs variables d'environnement critiques ont des defaults dangereux. Si `.env` ne charge pas correctement, le serveur démarre avec un comportement non sécurisé.

**Fichiers / composants impactés** :
- `src/server.ts:117-118` — `PORT` et `NODE_ENV` defaults à `3000` / `"development"`.
- `src/config/database.ts:16-17` — `DB_NAME` et `DB_CONN_STRING` ont des defaults ; risque de connexion à mauvaise BDD.
- `src/server.ts:604` — `REDIS_ENABLED !== "false"` → activé par défaut ; si manquant, comportement implicite.
- `src/middlewares/authMiddleware.ts:104-110` — `JWT_SECRET` validé seulement à la première requête auth. Si manquant, serveur démarre puis crash sur la première requête réelle.

**Cause racine** :
Pas de fail-fast au démarrage. Les configs sont validées paresseusement au premier usage.

**Projets impactés** : 1 / 3 — QvarryReact.Api.

**Solution proposée** :
Créer `src/config/validateEnv.ts` qui s'exécute en haut de `server.ts` et **throw** si une variable critique manque, AVANT que le serveur ne démarre :
```ts
const REQUIRED_ENV = [
  'JWT_SECRET',
  'DB_CONN_STRING',
  'ENCRYPTION_KEY_MASTER',
  'ENCRYPTION_KEY_COMMUNICATION',
  // ...
];
const REQUIRED_IN_PROD = ['CLIENT_URL', 'COOKIE_SECURE', 'TURNSTILE_SECRET_KEY'];

export function validateEnv() {
  const missing: string[] = [];
  for (const key of REQUIRED_ENV) {
    if (!process.env[key]) missing.push(key);
  }
  if (process.env.NODE_ENV === 'production') {
    for (const key of REQUIRED_IN_PROD) {
      if (!process.env[key]) missing.push(key);
    }
    if (process.env.COOKIE_SECURE !== 'true') {
      missing.push('COOKIE_SECURE doit être "true" en production');
    }
    if (process.env.BYPASS_CAPTCHA === 'true') {
      throw new Error('BYPASS_CAPTCHA=true interdit en production');
    }
  }
  if (missing.length > 0) {
    throw new Error(`Variables d'environnement manquantes : ${missing.join(', ')}`);
  }
}
```

**Priorité suggérée** : Moyenne (défense en profondeur)

---

## Problème N° 6 — Petits findings de durcissement

Sub-bugs vérifiés mais à faible impact individuel. Regroupés ici par catégorie.

### 6a — Validation `ObjectId` inconsistante
**Fichier** : `src/controllers/conversationsControllers.ts:72-73` (et ailleurs).
**Description** : `new Types.ObjectId(userId)` sans `Types.ObjectId.isValid()` au préalable. Mongoose lèvera CastError, mais c'est une 500 au lieu d'une 400.
**Reco** : helper `assertObjectId(req.params.id)` à utiliser systématiquement.

### 6b — Rate limiter global trop permissif
**Fichier** : `src/server.ts:138-139, 154`. `globalRateLimiter` à 1000 req/min en prod.
**Description** : Filet de sécurité catch-all trop large. Les rate limiters spécialisés (login, register) sont OK ; mais une endpoint authentifiée peut être abusée à 1000 req/min.
**Reco** : Réduire à 200 req/min en prod.

### 6c — `LOG_LEVEL` par défaut peut noyer les erreurs
**Fichier** : `src/server.ts:243-244`. Default `info` en prod.
**Description** : OK pour info, mais les `debug` calls dispersés peuvent rester actifs si `LOG_LEVEL` est mal configuré. Vérifier qu'aucun `logger.debug` n'est dans une hot path qui pourrit les logs prod.
**Reco** : audit grep `logger.debug` dans `src/services` et `src/controllers`, dégrader en `trace` ou supprimer ce qui est en prod hot path.

### 6d — N+1 sur `getUserDisplayName` dans dataShareService
**Fichier** : `src/services/dataShareService.ts:30-59` + ligne 165.
**Description** : `getFicheWithPoints` itère les points en `Promise.all` et appelle `getUserDisplayName(point.userId)` pour chacun → 1 findById par point. Pour 20 points partagés = 20 requêtes.
**Reco** : batch via `UserModel.find({ _id: { $in: userIds } })` puis Map.

### 6e — `messageOperationsService.getDisplayName` swallow déchiffrement
**Fichier** : `src/services/messageOperationsService.ts:28, 34`.
**Description** : Try-catch silencieux sur déchiffrement du pseudo. Si la clé est corrompue, fallback "Un utilisateur" sans log → dégradation invisible.
**Reco** : `logger.warn` avec userId pour permettre debug.

**Priorité suggérée (groupée)** : Basse à Moyenne

---

## 📊 Synthèse globale

| # | Sujet | Sévérité | Effort estimé | Cross-project ? |
|---|-------|----------|---------------|------------------|
| 1 | Pattern memoryStorage points + listes | 🔴 Critique | ~6h (4 controllers + tests) | Oui (impact mobile latent) |
| 2 | storage_used race | 🔴 Critique | ~1h | Non |
| 3 | Observabilité (Sentry + metrics + slow query) | 🟠 Haute | ~6h (setup + intégration) | Oui (Sentry partagé idéal) |
| 4 | Retry queue (emails + audit + WS) | 🟠 Haute | ~8h (queue persistante) | Indirect (UX clients) |
| 5 | Validation env au démarrage | 🟡 Moyenne | ~2h | Non |
| 6 | Petits durcissements (×5) | 🟡 Basse-Moy | ~4h cumulé | Non |

**Total estimé : ~27h** pour boucler la dette backend identifiée.

---

## Découvertes clés de cet audit

1. **Le bug Phase 1 #20 n'a été que partiellement corrigé.** Le pattern `memoryStorage` est dans les 3 controllers (points, fiches, lists) — seul fiches a reçu le rollback Mongo. **À corriger en priorité absolue**.
2. **Aucun finding de sécurité critique réel** une fois les faux positifs écartés. Le code est solide : CSP strict, CSRF en place, JWT correctement géré, secrets en env (pas commités), validation ObjectId dans la majorité des cas.
3. **L'observabilité est le point faible structurel.** Tous les bugs Phase 1-3 (mobile + maintenant backend) ont été identifiés par audit manuel. Sans Sentry/metrics, on dépend de cette ressource pour détecter les régressions futures.
4. **Les agents d'audit ont produit ~30 % de faux positifs.** L'audit reste utile (60 % de signal), mais il faut systématiquement vérifier les findings critiques avec un grep ciblé avant de les inscrire en backlog.

---

## Ordre de correction recommandé

1. **N° 2** — `storage_used` race (1h, exploitation triviale).
2. **N° 1** — étendre rollback memoryStorage aux points + listes (6h, ferme une classe de bugs).
3. **N° 5** — validation env au démarrage (2h, ferme #6c indirectement et durcit la prod).
4. **N° 3** — Sentry + Prometheus + slow query log (6h, débloque la suite).
5. **N° 4** — retry queue persistante (8h, gros payoff long terme).
6. **N° 6** — durcissements (4h, opportuniste).

---

## ✅ Statut des correctifs

> Mis à jour au fur et à mesure des fix.

| # | Sujet | Statut | Notes |
|---|-------|--------|-------|
| 1 | Pattern memoryStorage points + listes | ✅ | `pointsControllers.handleCreatePoint/UpdatePoint/DeletePoint` + `listsControllers.handleCreateList/UpdateList/DeleteList` durcis : check retour `storeXxx`, rollback `memoryStorage.deleteXxx`/`storeXxx` (snapshot) sur sync KO, **round-trip Mongo** (`PointModel.findById` / `ListModel.findById` selon le sens) avec rollback si l'état attendu n'est pas confirmé. Réponses 503 + `persisted: false` au lieu de 500 muet. |
| 2 | storage_used race | ✅ | `incrementStorageUsed` durci : `findOneAndUpdate` avec `$expr: $lte($add, $quota)` atomique. Lève `QuotaExceededError` (export public) si dépassement. Caller `pointsPhotosController` mis à jour : nouveau flag `finalFileWritten` + cleanup du fichier orphelin si quota refusé après rename, response 507 typée via `instanceof`. |
| 3a | Sentry init | ✅ | `@sentry/node` installé. `src/config/sentry.ts` créé : init au boot (no-op si `SENTRY_DSN` manquant), `captureException`/`captureMessage` helpers, scrubbing automatique des headers sensibles. Câblé sur `unhandledRejection` + `uncaughtException`. Tag `service: qvarry-api`. |
| 3b | Prometheus /metrics | ✅ | `prom-client` installé. `src/config/metrics.ts` : metrics par défaut + 4 custom (HTTP duration/total, SOS active, memoryStorage size, pending notifications, mongo sync failures). Middleware `metricsMiddleware()` monté avant les routes. Endpoint `/metrics` protégé par token `METRICS_TOKEN` (404 si non configuré, 401 sinon). |
| 3c | Mongo slow query log | ✅ | `db.command({ profile: 1, slowms: 100 })` activé en prod dans `src/config/database.ts` après connexion réussie. Seuil configurable via `MONGO_SLOW_QUERY_MS`. Gracieux si command échoue (warn). |
| 4 | Retry queue persistante | ✅ | `src/models/pendingEmail.ts` créé (calqué sur `PendingNotificationModel`). `src/services/pendingEmailService.ts` avec backoff exponentiel (1min → 12h, 5 tentatives), capture Sentry, status `pending/completed/failed`, TTL 7j. `adminControllers` migrent `sendAccountApprovedEmail`/`sendAccountRejectedEmail` fire-and-forget vers `enqueueAccountApproved`/`enqueueAccountRejected`. Cron `startPendingEmailRetryJob` toutes les 5 min ajouté. Audit logs et WS broadcasts non couverts (à étendre en P5 avec `PendingOperation` générique). |
| 5 | Validation env au démarrage | ✅ | `src/config/validateEnv.ts` créé : `assertValidEnv()` fail-fast au boot. Vérifie `JWT_SECRET`, `DB_CONN_STRING`, `ENCRYPTION_KEY_*` toujours requis. En prod : `CLIENT_URL`, `TURNSTILE_SECRET_KEY`, `COOKIE_SECURE=true`, interdit `BYPASS_CAPTCHA=true`. Warnings non bloquants : DB_SSL, REDIS_TLS, JWT_SECRET court. Appelé en haut de `server.ts` AVANT tout import qui consomme env. |
| 6a | Helper `assertObjectId` | ✅ | `src/utils/objectIdValidator.ts` créé : `parseObjectId` (return null), `assertObjectId(value, res)` (écrit 400 + return false), `requireObjectId` (throw `InvalidObjectIdError`). Adoption progressive recommandée — pas de remplacement en masse pour limiter le diff. |
| 6b | Rate limiter global 200 req/min | ✅ | `src/config/rateLimitConfig.ts:63` — `global: 1000` → `global: 200` (catch-all moins permissif, les rate limiters spécialisés strictAuth/moderate restent en complément). |
| 6c | Audit `logger.debug` hot paths | 📝 | Reporté P5 — grep ciblé à faire sur `src/services/loggerService.ts` levels en hot path (auth middleware, mongoose hooks). Pas urgent tant que `LOG_LEVEL=info` en prod. |
| 6d | Batch `getUserDisplayName` | ❌ faux positif | Vérifié : la `Promise.all` ligne 165 de `dataShareService.ts` est sur `safeDecrypt` des points (champs chiffrés), pas sur des `getUserDisplayName`. L'audit s'est trompé en annonçant un N+1 à cet endroit. `getUserDisplayName` est appelé seulement aux lignes 571 et 937 sur des userIds individuels (pas en boucle). Pas de fix nécessaire. |
| 6e | Log déchiffrement KO | ✅ | `messageOperationsService.getDisplayName` : 2 catches silencieux remplacés par `opsLogger.warn` avec userId + message. Rend visible toute corruption de clé / encryption sans changer le fallback "Un utilisateur". |

---

## ❌ Faux positifs écartés (audit transparent)

Pour mémoire et pour ne pas y revenir :

- **Secrets `.env` dans le repo** (CRIT-001 à 004 de l'audit sécurité) : faux. Le `.gitignore` couvre `.env`, `.env.local`, `.env.docker`, `.env.production`, `.env.production.local`. Seul `.env.example` est commité (template). L'agent a confondu fichier local et fichier versionné.
- **Index `email` manquant sur User** (#1 critique de l'audit perf) : faux. Le login fait `UserModel.findOne({ emailHash })` (cf. `services/userService.ts`), et `emailHash` est correctement indexé (`UserSchema.index({ emailHash: 1 })`). C'est même un meilleur design RGPD (email chiffré, lookup via hash).
- **Redis non gracieusement dégradé** (un des #1 perf) : faux positif. Le code (`server.ts:604`) gère bien le fallback memory en dev ; en prod, l'exit volontaire si Redis manque est un choix conscient (préférer crash visible à dégradation silencieuse). Acceptable.
- **JWT HS256 vs RS256** (CRYPT-001) : pas un bug, c'est un choix. HS256 est OK tant que `JWT_SECRET` est strong et stocké en secret manager. RS256 serait mieux pour multi-services, pas urgent en mono-service.
- **Plusieurs findings « doc Swagger incomplète »** : pas vérifié, scope hors audit code.
- **Plusieurs findings « pas d'OpenTelemetry / tracing distribué »** : prématuré, pertinent seulement à plusieurs services.
