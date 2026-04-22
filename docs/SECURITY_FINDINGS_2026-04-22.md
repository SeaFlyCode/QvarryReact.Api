# Security Findings — Audit 2026-04-22

Audit niveau bancaire — 6 domaines couverts. 36 findings au total.  
Format : [ ] = à corriger, [x] = corrigé.

**Statut au 2026-04-22 :** 36/36 findings corrigés.

---

## CRITIQUE — 5 findings (blocker MEP absolu)

---

### [x] [C1] Tout participant peut résoudre une session SOS pour tous (scope=all)

**Fichier :** `src/services/sosService.ts:1063-1080`  
**Domaine :** Logique métier SOS / Autorisation

**Problème :** `deactivateSession` avec `scope="all"` vérifie uniquement que l'appelant est un participant actif, mais ne vérifie jamais que `userId === session.userId` (créateur). N'importe quel participant peut résoudre immédiatement la session pour tous.

**Impact :** Un co-participant malveillant peut mettre fin à une session SOS en cours et empêcher les secours d'être alertés.

**Fix appliqué :** Vérification `session.userId.toString() === userId` ajoutée avant l'exécution du scope `"all"`. Controller mis à jour avec 403 sur `NOT_AUTHORIZED_TO_DEACTIVATE_ALL`.

---

### [x] [C2] Race condition adminActivateSession sans transaction MongoDB

**Fichier :** `src/services/sosService.ts:3597-3660`  
**Domaine :** Logique métier SOS

**Problème :** La vérification "pas de session active" et la création de session étaient deux opérations distinctes sans transaction. Deux appels admin concurrents pouvaient créer deux sessions actives simultanées.

**Impact :** Double session SOS active, double envoi SMS Vonage, état incohérent.

**Fix appliqué :** `adminActivateSession` enveloppée dans une transaction MongoDB (`startTransaction` / `commitTransaction` / `abortTransaction`).

---

### [x] [C3] Absence de protection anti-replay sur les codes TOTP

**Fichier :** `src/services/totpMigrationService.ts:108,147,165`  
**Domaine :** Authentification / 2FA

**Problème :** Aucun mécanisme de suivi des codes TOTP déjà utilisés. Un code valide pouvait être soumis plusieurs fois dans la même fenêtre de validité (90s).

**Impact :** Un code TOTP intercepté peut générer plusieurs sessions légitimes.

**Fix appliqué :** Anti-replay via Redis — clé `totp:used:{userId}:{code}` avec TTL 90s, ajouté aux 3 chemins de validation.

---

### [x] [C4] Vérification admin systématiquement fausse — is_admin vs isAdmin

**Fichier :** `src/controllers/userControllers.ts:334, 397, 442`  
**Domaine :** Autorisation / Contrôle d'accès

**Problème :** `requestingUser.is_admin` (snake_case) lu à la place de `requestingUser.isAdmin` (camelCase) — propriété inexistante, contrôles d'accès admin cassés.

**Fix appliqué :** 3 occurrences remplacées par `requestingUser.isAdmin`.

---

### [x] [C5] isMobileToken déterminé par header X-Platform forgeable

**Fichier :** `src/middlewares/authMiddleware.ts:121-124`  
**Domaine :** Authentification / JWT

**Problème :** `isMobileToken` utilisait `req.headers["x-platform"]` (forgeable) pour les décisions de sécurité.

**Fix appliqué :** `isMobileToken = decoded.platform === "mobile"` uniquement. Header `x-platform` retiré de toute logique de sécurité.

---

## HAUT — 13 findings

---

### [x] [H1] authMiddleware web ne valide pas issuer/audience

**Fichier :** `src/middlewares/authMiddleware.ts:114-116`

**Problème :** `jwt.verify()` n'incluait pas `audience` ni `issuer` — un token mobile était accepté sur les routes web.

**Fix appliqué :** `issuer: "qvarry-api"` et `audience: ["qvarry-client", "qvarry-mobile"]` ajoutés dans `jwt.verify()`.

---

### [x] [H2] Pas de rate limiting 2FA web par userId

**Fichier :** `src/controllers/twoFactorControllers.ts:360-515`

**Problème :** `verifyTwoFactorLogin` (web) sans tracking de tentatives par `userId` — brute-force TOTP possible.

**Fix appliqué :** `checkTwoFactorAttempts` / `recordTwoFactorFailure` / `resetTwoFactorAttempts` implémentés dans `twoFactorControllers.ts` sur le même modèle que la version mobile (5 tentatives, blocage 30 min).

---

### [x] [H3] COOKIE_SECURE désactivable accidentellement en production

**Fichier :** `src/config/cookieConfig.ts:20`

**Problème :** `COOKIE_SECURE = process.env.COOKIE_SECURE === "true"` — défaut `false`, cookies JWT en HTTP si variable absente.

**Fix appliqué :** `COOKIE_SECURE` forcé à `true` si `NODE_ENV === "production"`, indépendamment de la variable d'env.

---

### [x] [H4] Migration TOTP SHA1→SHA512 génère nouveau secret sans confirmation utilisateur

**Fichier :** `src/services/totpMigrationService.ts:122-130`

**Problème :** Un nouveau secret SHA512 était persisté automatiquement — l'utilisateur ne l'avait pas enregistré dans son app TOTP, verrouillage de compte garanti.

**Fix appliqué :** Blocs de génération/persistance du nouveau secret commentés. La validation reste intacte. La migration ne se déclenchera que lors d'un re-setup explicite.

---

### [x] [H5] err.message retourné brut au client sur toutes les opérations WebSocket messages

**Fichier :** `src/services/webSocketService.ts:2086, 2106, 2128, 2149, 2170, 2188`

**Problème :** 6 blocs catch envoyaient `err.message` directement — erreurs Mongoose et internes exposées.

**Fix appliqué :** Tous les blocs catch retournent désormais `code: "NOT_*"` si erreur métier, `"OPERATION_FAILED"` sinon. Aucun message interne exposé.

---

### [x] [H6] Éléments des tableaux userIds/messageIds non validés comme ObjectId

**Fichier :** `src/controllers/conversationsControllers.ts:712-723`, `src/controllers/messagesControllers.ts:326`

**Problème :** Éléments de tableaux non vérifiés avant `new Types.ObjectId(uid)` — CastError non géré → 500.

**Fix appliqué :** Validation `Types.ObjectId.isValid()` sur chaque élément avant traitement, avec réponse 400 si invalide.

---

### [x] [H7] targetUserId non validé comme ObjectId dans add/remove-participant SOS

**Fichier :** `src/controllers/mobileSosControllers.ts:881-893, 976-988`

**Problème :** `targetUserId` passait directement dans `new mongoose.Types.ObjectId()` sans validation — BSONError → 500.

**Fix appliqué :** `Types.ObjectId.isValid()` ajouté sur `targetUserId` et `sessionId` dans les deux handlers.

---

### [x] [H8] Note SMS sans filtre Unicode bidirectionnel

**Fichier :** `src/services/vonageService.ts:290-294`

**Problème :** Caractères Unicode bidirectionnels (U+202E RLO, etc.) non filtrés — SMS d'urgence spoofable.

**Fix appliqué :** Regex étendue aux caractères bidirectionnels Unicode, `.trim()` ajouté, limite réduite à 140 caractères (1 segment SMS).

---

### [x] [H9] Log [AUTH-DEBUG] en production — oracle user enumeration

**Fichier :** `src/controllers/mobileAuthControllers.ts:107-111`

**Problème :** Log `info` en production contenant `userExists: true/false` — oracle d'énumération utilisateurs.

**Fix appliqué :** Bloc `[AUTH-DEBUG]` supprimé intégralement.

---

### [x] [H10] IPs création/connexion déchiffrées et retournées dans /me

**Fichier :** `src/controllers/auth/loginController.ts:909-910`, `src/controllers/mobileAuthControllers.ts:650-651`

**Problème :** `ip_creation` et `ip_last_connection` incluses dans la réponse `/me` — données personnelles RGPD inutiles côté client.

**Fix appliqué :** Champs ajoutés aux listes d'exclusion et retirés du bloc de déchiffrement dans les deux handlers.

---

### [x] [H11] Champs is_admin/is_blocked non exclus du $set dans handleUpdateUser

**Fichier :** `src/services/userService.ts:451`, `src/controllers/userControllers.ts:576`

**Problème :** `updateUserById` effectuait un `$set` sans liste blanche — champs privilégiés potentiellement injectables.

**Fix appliqué :** Suppression explicite de `is_admin`, `is_blocked`, `is_admin_validated`, `password`, `password_history` de `updatedUser` avant le `$set`.

---

### [x] [H12] node-forge CVE HIGH en production (via firebase-admin)

**Package :** `node-forge@1.3.3` via `firebase-admin`

**Problème :** Forgery de signature RSA/Ed25519, bypass basicConstraints, DoS BigInteger.

**Fix appliqué :** Override `"node-forge": "^1.3.7"` ajouté dans `package.json`.

---

### [x] [H13] path-to-regexp CVE HIGH en production (via express@5)

**Package :** `path-to-regexp@8.x` via `express@5.2.1`

**Problème :** ReDoS via URLs forgées avec wildcards multiples (GHSA-j3q9-mxjg-w52f, GHSA-27v5-c462-wpq7). Range vulnérable : >=8.0.0 <8.4.0.

**Fix appliqué :** Override npm `"path-to-regexp": "^8.4.2"` ajouté dans `package.json`. Version forcée à 8.4.2 qui corrige les deux CVEs. `npm audit` : 0 finding restant.

---

## MOYEN — 12 findings

---

### [x] [M4] confirmSafe non atomique — double résolution concurrente

**Fichier :** `src/services/sosService.ts:1165-1197`

**Fix appliqué :** Pattern `findOne` + `save()` remplacé par `findOneAndUpdate` atomique avec `arrayFilters`.

---

### [x] [M5] Handler 404 retourne req.path au client

**Fichier :** `src/server.ts:924-929`

**Fix appliqué :** `path` et `method` retirés de la réponse 404.

---

### [x] [M8] .env.local non ignoré dans .gitignore

**Fichier :** `.gitignore`

**Fix appliqué :** `.env.local` ajouté en tête du fichier.

---

### [x] [M9] Serveur démarre sans JWT_SECRET — erreur silencieuse

**Fichier :** `src/services/secretsManagerService.ts`

**Fix appliqué :** Validation fatale des 5 secrets requis (`JWT_SECRET`, `ENCRYPTION_KEY_MASTER`, `ENCRYPTION_KEY_COMMUNICATION`, `DB_CONN_STRING`, `EMAIL_HMAC_KEY`) — `throw Error` au démarrage si manquants.

---

### [x] [M10] Redis TLS désactivé par défaut dans .env.example

**Fichier :** `.env.example:127`

**Fix appliqué :** `REDIS_TLS=true` avec commentaire explicatif.

---

### [x] [M11] CSP autorise ws: en production (devrait être wss: uniquement)

**Fichier :** `src/server.ts:405-406`

**Fix appliqué :** `ws:` et `http:` conditionné à `NODE_ENV !== "production"` dans `connectSrc`.

---

### [x] [M12] participantIds dans $in sans validation par élément

**Fichier :** `src/controllers/conversationsControllers.ts:290`

**Fix appliqué :** Validation `Types.ObjectId.isValid()` sur chaque élément avant utilisation dans `$in`.

---

### [x] [M1] Reset token stocké en plaintext en base

**Fichier :** `src/controllers/auth/passwordController.ts`

**Fix appliqué :** `resetCode` haché avec `bcrypt(resetCode, 10)` avant stockage. Vérification via `bcrypt.compare`. Anciens tokens au format `token:code` rejetés automatiquement (migration transparente).

---

### [x] [M2] twoFactorAttempts en Map mémoire locale

**Fichier :** `src/controllers/mobileTwoFactorControllers.ts`, `src/services/redisSessionService.ts`

**Fix appliqué :** 3 méthodes ajoutées dans `RedisSessionService` (`checkTwoFactorAttempts`, `recordTwoFactorFailure`, `resetTwoFactorAttempts`). Map + setInterval supprimés du controller.

---

### [x] [M3] Refresh token mobile 48h — trop long

**Fichier :** `src/services/refreshTokenService.ts:22`

**Fix appliqué :** Durée par défaut réduite de 48h à 24h.

---

### [x] [M6] Numéros de téléphone absents de SENSITIVE_KEYS

**Fichier :** `src/services/loggerService.ts:126-143`

**Fix appliqué :** `"phone"`, `"phonenumber"`, `"phone_number"`, `"mobile"`, `"telephone"`, `"tel"` ajoutés dans `PARTIAL_MASK_KEYS`.

---

### [x] [M7] GPS retournés aux participants non-créateurs via /sos/status

**Fichier :** `src/controllers/mobileSosControllers.ts:504-507`

**Fix appliqué :** `lastKnownLat`, `lastKnownLng`, `lastKnownAccuracy` retournés `null` si `userId !== session.userId.toString()`.

---

## FAIBLE — 6 findings (post-MEP)

---

### [x] [F3] docker-compose.prod.yml sans cap_drop et no-new-privileges

**Fix appliqué :** `security_opt: [no-new-privileges:true]` et `cap_drop: [ALL]` ajoutés au service `api`.

---

### [x] [F4] /health expose version et environment publiquement

**Fichier :** `src/server.ts:272-280`

**Fix appliqué :** `version` et `environment` retirés de la réponse publique `/health`.

---

### [x] [F1] Recovery codes — entropie réduite par replace base64

**Fichier :** `src/controllers/twoFactorControllers.ts`, `src/controllers/mobileTwoFactorControllers.ts`

**Fix appliqué :** `.toString("base64url")` sans `.replace(/[^a-zA-Z0-9]/g, "")` — entropie complète des 9 bytes préservée.

---

### [x] [F2] sosCriticalRateLimitStore non partagé multi-instance

**Fichier :** `src/routes/mobileSosRoutes.ts`

**Fix appliqué :** Map + setInterval supprimés. Redis local (pattern identique à `totpMigrationService.ts`) avec INCR/EXPIRE + clé de blocage. Fallback permissif si Redis absent (SOS safety-critical).

---

### [x] [F5] Secrets Manager sans backend externe — rotation en mémoire uniquement

**Fichier :** `src/services/secretsManagerService.ts`

**Fix appliqué :** Support AWS Secrets Manager opt-in via `AWS_SECRETS_MANAGER_SECRET_ID`. Quand défini : secrets chargés depuis AWS SM au démarrage (`GetSecretValueCommand`), `rotateSecret()` persiste via `PutSecretValueCommand` puis recharge en mémoire. Fallback `.env` inchangé si variable absente. Package `@aws-sdk/client-secrets-manager` ajouté.

---

### [x] [F6] SMTP_SECURE=false prête à confusion dans .env.example

**Fichier :** `.env.example`

**Fix appliqué :** Commentaire ajouté : `false + port 587 = STARTTLS (chiffré). Mettre true + port 465 pour SSL direct.`

**Fix :** Commenter que `false` + port 587 = STARTTLS (chiffré), pas HTTP.

---

## Récapitulatif statut

| Sévérité | Total | Corrigés | Restants |
|---|---|---|---|
| CRITIQUE | 5 | 5 | 0 |
| HAUT | 13 | 13 | 0 |
| MOYEN | 12 | 12 | 0 |
| FAIBLE | 6 | 6 | 0 |
| **Total** | **36** | **36** | **0** |

## Récapitulatif par fichier

| Fichier | Findings |
|---|---|
| `src/services/sosService.ts` | C1 ✅, C2 ✅, M4 ✅ |
| `src/middlewares/authMiddleware.ts` | C5 ✅, H1 ✅ |
| `src/controllers/userControllers.ts` | C4 ✅, H11 ✅ |
| `src/services/totpMigrationService.ts` | C3 ✅, H4 ✅ |
| `src/services/webSocketService.ts` | H5 ✅ |
| `src/controllers/mobileAuthControllers.ts` | H9 ✅, H10 ✅ |
| `src/controllers/mobileSosControllers.ts` | H7 ✅, M7 ✅ |
| `src/services/vonageService.ts` | H8 ✅ |
| `src/config/cookieConfig.ts` | H3 ✅ |
| `src/controllers/auth/loginController.ts` | H10 ✅ |
| `src/controllers/twoFactorControllers.ts` | H2 ✅, F1 ✅ |
| `src/controllers/mobileTwoFactorControllers.ts` | M2 ✅, F1 ✅ |
| `src/controllers/conversationsControllers.ts` | H6 ✅, M12 ✅ |
| `src/controllers/messagesControllers.ts` | H6 ✅ |
| `src/controllers/auth/passwordController.ts` | M1 ✅ |
| `src/services/userService.ts` | H11 ✅ |
| `src/services/refreshTokenService.ts` | M3 ✅ |
| `src/services/loggerService.ts` | M6 ✅ |
| `src/services/secretsManagerService.ts` | M9 ✅, F5 ✅ |
| `src/server.ts` | M5 ✅, M11 ✅, F4 ✅ |
| `src/routes/mobileSosRoutes.ts` | F2 ✅ |
| `docker-compose.prod.yml` | F3 ✅ |
| `.gitignore` | M8 ✅ |
| `.env.example` | M10 ✅, F6 ✅ |
| `package.json` (deps) | H12 ✅, H13 ✅ |
