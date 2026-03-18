# Stratégie de Versioning API

## Principe général

Toutes les routes de l'API métier sont préfixées par `/api/v1/`. Ce versioning dans l'URL garantit que les clients existants (web et mobile) continuent de fonctionner sans modification lors de l'introduction d'une version `v2`.

```
https://api.qvarry.fr/api/v1/users/me
https://api.qvarry.fr/api/v1/fiches
https://api.qvarry.fr/api/v1/mobile/auth/login
```

---

## Middleware de rétrocompatibilité

Un middleware de réécriture d'URL est monté en amont des routes. Il réécrit silencieusement les requêtes qui ciblent `/api/` (sans version) vers `/api/v1/` afin de ne pas casser les anciens clients qui n'auraient pas encore intégré le préfixe de version.

```typescript
// Réécriture /api/* → /api/v1/*
app.use((req, _res, next) => {
  if (req.url.startsWith("/api/") && !req.url.startsWith("/api/v")) {
    req.url = req.url.replace("/api/", "/api/v1/");
  }
  next();
});
```

> ⚠️ Ce middleware ne doit réécrire que les chemins `/api/` non versionnés. Les chemins commençant déjà par `/api/v` (ex: `/api/v1/`, `/api/v2/`) sont laissés intacts.

---

## Routes et endpoints exemptés du versioning

Certains endpoints ne font pas partie de l'API versionnée. Ils sont montés directement à la racine du serveur :

| Chemin              | Description                    | Raison                                       |
| ------------------- | ------------------------------ | -------------------------------------------- |
| `/webhooks/vonage`  | Réception webhooks Vonage SMS  | Chemin imposé par le fournisseur tiers       |
| `/public/*`         | Ressources publiques statiques | Pas d'API REST, pas de versioning nécessaire |
| `/health`           | Health check général           | Endpoint d'infrastructure, stable par nature |
| `/health/sos`       | Health check sous-système SOS  | Endpoint d'infrastructure                    |
| `/metrics`          | Métriques applicatives         | Endpoint d'infrastructure interne            |
| `/ws/notifications` | WebSocket notifications        | Protocole WebSocket, pas REST                |
| `/ws/messages`      | WebSocket messagerie           | Protocole WebSocket, pas REST                |

---

## Montage des routes dans server.ts

```typescript
// Routes versionnées
app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/users", userRoutes);
app.use("/api/v1/fiches", fichesRoutes);
app.use("/api/v1/lists", listsRoutes);
app.use("/api/v1/points", pointsRoutes);
app.use("/api/v1/conversations", conversationsRoutes);
app.use("/api/v1/messages", messagesRoutes);
app.use("/api/v1/contacts", contactRoutes);
app.use("/api/v1/share", dataShareRoutes);
app.use("/api/v1/notifications", notificationsRoutes);
app.use("/api/v1/security", securityRoutes);
app.use("/api/v1/admin", adminRoutes);
app.use("/api/v1/maintenance", maintenanceRoutes);
app.use("/api/v1/2fa", twoFactorRoutes);

// Routes mobiles versionnées
app.use("/api/v1/mobile/auth", mobileAuthRoutes);
app.use("/api/v1/mobile/2fa", mobileTwoFactorRoutes);
app.use("/api/v1/mobile/sync", mobileSyncRoutes);
app.use("/api/v1/mobile/sos", mobileSosRoutes);
app.use("/api/v1/mobile/push-tokens", mobilePushTokenRoutes);

// Routes non versionnées
app.use("/webhooks/vonage", webhookRoutes);
app.use("/public", publicRoutes);
app.get("/health", healthHandler);
app.get("/health/sos", healthSosHandler);
app.get("/metrics", adminMiddleware, metricsHandler);
```

---

## Stratégie de migration pour les versions futures

### Règles générales

1. **Une version reste stable** : une fois publiée, une version ne reçoit que des correctifs de sécurité, jamais de breaking changes.
2. **Introduction d'une v2** : un nouveau préfixe `/api/v2/` est ajouté. Les routes `v1` restent actives en parallèle pendant une période de transition.
3. **Dépréciation progressive** : la version obsolète est signalée via un header `Deprecation: true` et une date de fin de support (`Sunset: <date>`).
4. **Suppression** : la version obsolète est retirée uniquement après que tous les clients connus ont migré (vérifiable via les logs et métriques).

### Processus d'introduction d'une v2

```
1. Créer src/routes/v2/ avec les nouvelles routes
2. Monter app.use('/api/v2/*', ...) dans server.ts
3. Documenter les changements dans le CHANGELOG
4. Mettre à jour le middleware de rétrocompatibilité
   pour pointer vers v2 si c'est la nouvelle version stable
5. Ajouter le header Deprecation sur les routes v1 concernées
6. Planifier la date de suppression (minimum 6 mois après publication v2)
```

### Gestion des clients mobiles

Les versions minimales d'iOS/Android acceptées sont contrôlées via les variables `MIN_IOS_VERSION` et `MIN_ANDROID_VERSION`. Un client trop ancien est redirigé vers une mise à jour avant d'accéder à l'API. Cela permet de retirer les anciennes versions d'API sereinement.

> ⚠️ Ne jamais retirer une version d'API sans avoir vérifié dans les logs (et métriques `/metrics`) que les appels vers cette version sont tombés à zéro ou à un seuil négligeable.
