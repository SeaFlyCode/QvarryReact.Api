# Structure du Projet — IHM Qvarry

## Arborescence complète

```
QvarryReact/                            # Projet Next.js (IHM)
├── src/                                # Code source TypeScript
│   ├── app/                            # Next.js App Router
│   │   ├── layout.tsx                  # Layout racine (Server Component) - nonce CSP, polices, metadata
│   │   ├── page.tsx                    # Page d'authentification (/, login/register/2FA/reset)
│   │   ├── ClientProviders.tsx         # Providers React globaux (Client Component)
│   │   ├── error.tsx                   # Page d'erreur globale
│   │   ├── global-error.tsx            # Erreur niveau layout (Sentry)
│   │   ├── not-found.tsx               # Page 404
│   │   ├── dashboard/                  # Tableau de bord - carte interactive
│   │   │   ├── layout.tsx              # Layout dashboard
│   │   │   └── page.tsx                # Page principale avec carte Leaflet
│   │   ├── fiches/                     # Gestion des fiches terrain
│   │   │   ├── page.tsx                # Liste des fiches
│   │   │   ├── create/                 # Création d'une fiche
│   │   │   └── [id]/                   # Détail/édition d'une fiche
│   │   ├── (messaging)/                # Groupe de routes messagerie
│   │   │   ├── layout.tsx              # Layout messagerie
│   │   │   ├── contacts/               # Gestion des contacts
│   │   │   └── conversations/          # Conversations + messages
│   │   ├── profil/                     # Profil utilisateur
│   │   │   ├── page.tsx                # Édition du profil
│   │   │   └── security/               # Sécurité (2FA, sessions, alertes)
│   │   ├── partage/                    # Partages reçus/envoyés
│   │   ├── import/                     # Import de points GPS
│   │   ├── admin/                      # Administration (admin uniquement)
│   │   │   ├── layout.tsx              # Layout admin
│   │   │   ├── page.tsx                # Dashboard admin
│   │   │   ├── users/                  # Gestion des utilisateurs
│   │   │   ├── audit/                  # Logs d'audit
│   │   │   ├── security/               # Sécurité (IPs bloquées)
│   │   │   └── sos/                    # Supervision SOS
│   │   ├── maintenance/                # Page de maintenance
│   │   └── privacy/                    # Politique de confidentialité
│   │
│   ├── components/                     # Composants React réutilisables
│   │   ├── auth/                       # Authentification
│   │   │   ├── AuthGuard.tsx           # Protection des routes (redirect si non auth)
│   │   │   ├── LoginForm.tsx           # Formulaire de connexion
│   │   │   ├── RegisterForm.tsx        # Formulaire d'inscription
│   │   │   ├── ForgotPasswordForm.tsx  # Demande de reset mot de passe
│   │   │   ├── ResetPasswordForm.tsx   # Reset avec code + nouveau mdp
│   │   │   ├── VerifyEmailForm.tsx     # Vérification code email
│   │   │   ├── TwoFactorVerifyModal.tsx# Modal de vérification TOTP
│   │   │   ├── TwoFactorSection.tsx    # Section config 2FA (profil)
│   │   │   ├── Turnstile.tsx           # Widget CAPTCHA Cloudflare Turnstile
│   │   │   ├── AuthTips.tsx            # Tips défilants sur la page de connexion
│   │   │   └── index.ts                # Barrel exports
│   │   │
│   │   ├── layout/                     # Mise en page
│   │   │   ├── Navbar.tsx              # Barre de navigation principale
│   │   │   └── MobileBlocker.tsx       # Blocage mobile (redirection app mobile)
│   │   │
│   │   ├── map/                        # Composants cartographiques (Leaflet)
│   │   │   ├── Map.tsx                 # Composant carte principal (react-leaflet)
│   │   │   ├── CaviteMap.tsx           # Carte spécialisée cavités
│   │   │   ├── FicheViewMap.tsx        # Mini-carte dans les fiches
│   │   │   ├── MiniMapRayon.tsx        # Mini-carte avec rayon de recherche
│   │   │   ├── MapComparison.tsx       # Comparaison de deux calques
│   │   │   ├── MapPopup.tsx            # Popup sur les marqueurs
│   │   │   ├── MarkerCluster.tsx       # Clustering de marqueurs
│   │   │   ├── LayerPreview.tsx        # Aperçu des calques cartographiques
│   │   │   ├── AdaptiveGeologyLayer.tsx# Calque géologique adaptatif (BRGM)
│   │   │   ├── WMSTileLayer.tsx        # Calque WMS personnalisé
│   │   │   ├── PointCreatePopover.tsx  # Popover création point sur carte
│   │   │   └── index.ts                # Barrel exports
│   │   │
│   │   ├── dashboard/                  # Panneaux du tableau de bord
│   │   │   ├── LayersPanel.tsx         # Panneau de sélection des calques
│   │   │   ├── LegendPanel.tsx         # Légende des calques
│   │   │   ├── MapToolbar.tsx          # Barre d'outils de la carte
│   │   │   └── PointsPanel.tsx         # Panneau des points
│   │   │
│   │   ├── fiches/                     # Composants de formulaire pour fiches
│   │   │   ├── StarRating.tsx          # Notation par étoiles (éditable)
│   │   │   ├── ReadOnlyStarRating.tsx  # Notation par étoiles (lecture seule)
│   │   │   ├── LevelSlider.tsx         # Curseur de niveau (éditable)
│   │   │   ├── ReadOnlyLevelSlider.tsx # Curseur de niveau (lecture seule)
│   │   │   ├── ChipCheckbox.tsx        # Cases à cocher style chips (éditable)
│   │   │   ├── ReadOnlyChipCheckbox.tsx# Cases à cocher style chips (lecture)
│   │   │   ├── ColorRadio.tsx          # Sélecteur de couleur (éditable)
│   │   │   ├── ReadOnlyColorRadio.tsx  # Sélecteur de couleur (lecture seule)
│   │   │   ├── EmojiRadio.tsx          # Sélecteur d'emoji (éditable)
│   │   │   ├── ReadOnlyEmojiRadio.tsx  # Sélecteur d'emoji (lecture seule)
│   │   │   └── index.ts                # Barrel exports
│   │   │
│   │   ├── messaging/                  # Messagerie temps réel
│   │   │   ├── ConversationsList.tsx   # Liste des conversations
│   │   │   ├── MessagesPanel.tsx       # Panneau des messages d'une conversation
│   │   │   ├── MessageInput.tsx        # Saisie et envoi de message
│   │   │   ├── NewConversationModal.tsx# Modal création de conversation
│   │   │   ├── GroupSettingsModal.tsx  # Paramètres de groupe
│   │   │   └── index.ts                # Barrel exports
│   │   │
│   │   ├── contacts/                   # Gestion des contacts
│   │   ├── admin/                      # Composants d'administration
│   │   ├── points/                     # Affichage des points
│   │   ├── search/                     # Recherche globale
│   │   │
│   │   ├── modals/                     # Modales génériques et métier
│   │   │   ├── ConfirmModal.tsx        # Modal de confirmation générique
│   │   │   ├── ConfirmModalProvider.tsx# Provider + hook useConfirm()
│   │   │   ├── NotificationModal.tsx   # Modal de notification toast
│   │   │   ├── NotificationProvider.tsx# Provider + hook useNotification()
│   │   │   ├── CreatePointModal.tsx    # Création d'un point géologique
│   │   │   ├── PointEditModal.tsx      # Édition d'un point
│   │   │   ├── PointDetailsContent.tsx # Contenu détail d'un point
│   │   │   ├── FicheViewModal.tsx      # Visualisation d'une fiche
│   │   │   ├── AddPointsToFicheModal.tsx # Ajout de points à une fiche
│   │   │   ├── AddPointsToListModal.tsx  # Ajout de points à une liste
│   │   │   ├── ListEditModal.tsx       # Édition d'une liste
│   │   │   ├── PointListsEditor.tsx    # Éditeur des listes d'un point
│   │   │   ├── ShareModal.tsx          # Modal de partage de données
│   │   │   ├── ExportPDFModal.tsx      # Export PDF d'une fiche
│   │   │   └── ImportPreviewModal.tsx  # Prévisualisation avant import
│   │   │
│   │   ├── notifications/              # Cloche de notifications
│   │   │   ├── NotificationBell.tsx    # Icône cloche + dropdown
│   │   │   └── index.ts
│   │   │
│   │   ├── providers/                  # Providers React
│   │   │   └── SyncProvider.tsx        # Synchronisation périodique des données
│   │   │
│   │   └── ui/                         # Composants UI de base
│   │       ├── Button.tsx              # Bouton générique (variants)
│   │       ├── Modal.tsx               # Composant modal de base
│   │       ├── LoadingScreen.tsx       # Écran de chargement initial
│   │       ├── LoginLoadingScreen.tsx  # Écran animation connexion
│   │       ├── PageLoader.tsx          # Loader de changement de page
│   │       ├── InlineSpinner.tsx       # Spinner inline
│   │       ├── PasswordInput.tsx       # Input mot de passe avec toggle visibilité
│   │       ├── Tooltip.tsx             # Infobulle
│   │       ├── GdprConsentBanner.tsx   # Bannière RGPD
│   │       └── index.ts                # Barrel exports
│   │
│   ├── api/                            # Client HTTP (appels API back-end)
│   │   ├── client.ts                   # Client fetch centralisé (base URL, headers, errors)
│   │   ├── auth.ts                     # API authentification
│   │   ├── useAuth.ts                  # Hook React pour l'état d'auth
│   │   ├── tokenRefresh.ts             # Refresh token automatique
│   │   ├── fiches.ts                   # API fiches
│   │   ├── lists.ts                    # API listes
│   │   ├── points.ts                   # API points
│   │   ├── conversations.ts            # API conversations
│   │   ├── contacts.ts                 # API contacts
│   │   ├── notifications.ts            # API notifications
│   │   ├── share.ts                    # API partages
│   │   ├── user.ts                     # API utilisateurs
│   │   ├── admin.ts                    # API administration
│   │   ├── adminSos.ts                 # API supervision SOS
│   │   ├── sync.ts                     # API synchronisation
│   │   ├── twoFactor.ts                # API authentification 2FA
│   │   ├── maintenance.ts              # API état de maintenance
│   │   ├── geo.ts                      # API géolocalisation (adresses)
│   │   └── websocket.ts                # Client WebSocket (messages temps réel)
│   │
│   ├── config/                         # Configuration applicative
│   │   ├── navigation.ts               # Items de navigation, titres de pages
│   │   └── mapLayers.ts                # Définition des calques cartographiques
│   │
│   ├── contexts/                       # Contextes React
│   │   ├── MobileContext.tsx           # Détection et état mobile
│   │   └── NonceContext.tsx            # Propagation du nonce CSP
│   │
│   ├── hooks/                          # Hooks React personnalisés
│   │   ├── useDashboardSearch.ts       # Recherche dans le dashboard
│   │   ├── useMaintenanceCheck.ts      # Vérification mode maintenance
│   │   └── useSyncRefresh.ts           # Refresh après synchronisation
│   │
│   ├── lib/                            # Utilitaires bas niveau
│   │   └── cookieNames.ts              # Noms des cookies JWT (prod vs dev)
│   │
│   ├── middleware.ts                   # Middleware Edge Next.js (auth + CSP)
│   │
│   ├── middleware/                     # Middlewares client
│   │   └── console-interceptor.ts      # Interception des logs console (prod)
│   │
│   ├── styles/                         # Styles globaux
│   │   └── globals.css                 # Tailwind + animations CSS personnalisées
│   │
│   ├── types/                          # Types TypeScript partagés
│   │
│   ├── utils/                          # Utilitaires
│   │   └── logger.ts                   # Logger client (désactivé en prod)
│   │
│   └── __tests__/                      # Tests (Vitest)
│
├── public/                             # Assets statiques
│   ├── images-background/              # Images de fond
│   ├── Icon2.png                       # Logo Qvarry
│   └── web-app-manifest-512x512.png    # Icône PWA
│
├── scripts/                            # Scripts utilitaires
│   ├── smoke-test.sh                   # Test de fumée post-déploiement
│   └── test-local-prod.sh              # Test local en mode production
│
├── security-tests/                     # Tests de sécurité
├── docs/                               # Documentation (ce dossier)
├── Dockerfile                          # Image Docker multi-stage
├── next.config.ts                      # Configuration Next.js
├── tailwind.config.ts                  # Configuration Tailwind CSS
├── tsconfig.json                       # Configuration TypeScript
├── vitest.config.ts                    # Configuration Vitest
├── eslint.config.mjs                   # Configuration ESLint
├── postcss.config.js                   # Configuration PostCSS
├── .env                                # Variables d'environnement (local)
├── .env.example                        # Template variables d'environnement
└── .env.production                     # Variables de production
```

---

## Conventions de nommage

| Type | Convention | Exemple |
|------|-----------|---------|
| Pages Next.js | `page.tsx`, `layout.tsx` | `dashboard/page.tsx` |
| Composants React | `PascalCase.tsx` | `LoginForm.tsx` |
| Hooks React | `use` + `PascalCase.ts` | `useDashboardSearch.ts` |
| Fichiers d'API client | `camelCase.ts` | `fiches.ts` |
| Fichiers de config | `camelCase.ts` | `navigation.ts` |
| Contextes | `PascalCase` + `Context.tsx` | `MobileContext.tsx` |
| Providers | `PascalCase` + `Provider.tsx` | `SyncProvider.tsx` |
| Barrel exports | `index.ts` | `components/ui/index.ts` |
| Tests | `NomOriginal.test.ts(x)` | `LoginForm.test.tsx` |
| Variables/Fonctions | `camelCase` | `handleLogin`, `fetchFiches` |
| Constantes | `UPPER_SNAKE_CASE` | `JWT_COOKIE_NAME` |
| Interfaces/Types | `PascalCase` | `NavItem`, `ViewMode` |
