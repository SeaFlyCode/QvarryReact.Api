# Contextes (Context Providers) — Application Mobile Qvarry

## Architecture des providers

Les contextes sont imbriqués dans `App.tsx` dans cet ordre précis (de l'extérieur vers l'intérieur) :

```
GestureHandlerRootView
└── ErrorBoundary
    └── SafeAreaProvider
        └── ThemeProvider
            └── HapticsProvider
                └── AuthProvider
                    └── SyncSettingsProvider
                        └── SyncProvider
                            └── WebSocketProvider
                                └── SosProvider
                                    └── NavigationContainer
                                        └── AppNavigator
```

> ⚠️ L'ordre d'imbrication est important. `AuthProvider` doit être avant `SyncProvider` (qui a besoin du token). `WebSocketProvider` doit être après `AuthProvider` (connexion WS nécessite un token).

---

## Contextes disponibles

### `ThemeContext`

**Fichier** : `src/contexts/ThemeContext.tsx`

Gère le thème clair / sombre de l'application.

```typescript
interface ThemeContextType {
  isDark: boolean;
  colors: typeof LightColors | typeof DarkColors;
  toggleTheme: () => void;
}

// Usage
const { isDark, colors } = useTheme();
```

Le thème est persisté dans AsyncStorage. Les couleurs (`LightColors`, `DarkColors`) sont définies dans `src/constants/theme.ts`.

---

### `HapticsContext`

**Fichier** : `src/contexts/HapticsContext.tsx`

Gère le retour haptique (vibrations tactiles) avec possibilité de désactiver globalement.

```typescript
// Usage
const haptics = useHaptics();
haptics.selection();    // Feedback léger (changement d'onglet)
haptics.success();      // Feedback positif
haptics.error();        // Feedback d'erreur
haptics.warning();      // Feedback d'avertissement
haptics.impact();       // Impact physique
```

---

### `AuthContext`

**Fichier** : `src/contexts/AuthContext.tsx`

Le contexte central de l'application. Gère l'état d'authentification, les tokens, les modes de connexion et les sessions.

```typescript
interface AuthContextType {
  // État
  user: User | null;
  token: string | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  isOnline: boolean;
  isVerified: boolean;
  connectionMode: 'full' | 'limited' | 'disconnected';
  sessionExpired: boolean;
  showSessionExpiredModal: boolean;
  isInitialVerification: boolean;
  isMaintenance: boolean;
  showMaintenanceModal: boolean;
  isReconnecting: boolean;

  // Actions
  login: (email, password, turnstileToken?) => Promise<{requiresTwoFactor?, tempToken?}>;
  complete2FALogin: (tempToken, code) => Promise<void>;
  logout: () => Promise<void>;
  register: (name, surname, email, password) => Promise<void>;
  refreshToken: () => Promise<boolean>;
  refreshUser: () => Promise<void>;
  verifyAuth: () => Promise<boolean>;
  reconnect: () => Promise<boolean>;
  dismissSessionExpiredModal: () => void;
  dismissMaintenanceModal: () => void;
  forceLogout: (reason?) => Promise<void>;
}

// Usage
const { user, isAuthenticated, connectionMode, login, logout } = useAuth();
```

**Modes de connexion** :

| Mode           | Déclencheur                                                   |
| -------------- | ------------------------------------------------------------- |
| `full`         | Token valide + serveur accessible                             |
| `limited`      | Hors ligne, token expiré, ou maintenance serveur              |
| `disconnected` | Aucune session (token absent ou logout explicite)             |

**Stockage sécurisé** :
- Token JWT → `Keychain` (iOS) / `Keystore` (Android) via `react-native-keychain`
- Fallback vers `AsyncStorage` si Keychain indisponible

---

### `SyncSettingsContext`

**Fichier** : `src/contexts/SyncSettingsContext.tsx`

Expose les paramètres de synchronisation configurables par l'utilisateur (fréquence, sync automatique, etc.).

---

### `SyncContext`

**Fichier** : `src/contexts/SyncContext.tsx`

Orchestre la synchronisation offline-first. Configuré avec :

```typescript
<SyncProvider
  autoSyncOnMount={true}      // Sync au démarrage
  syncOnForeground={true}     // Sync quand l'app revient au premier plan
  syncOnReconnect={true}      // Sync au retour de la connexion réseau
  syncInterval={240000}       // Sync automatique toutes les 4 minutes
>
```

```typescript
interface SyncContextType {
  isSyncing: boolean;
  lastSyncDate: string | null;
  pendingChangesCount: number;
  syncError: string | null;
  sync: (options?: { forceFull?: boolean }) => Promise<void>;
  resetSync: () => Promise<void>;
}

// Usage
const { isSyncing, lastSyncDate, sync } = useSync();
```

---

### `WebSocketContext`

**Fichier** : `src/contexts/WebSocketContext.tsx`

Gère la connexion WebSocket persistante avec l'API pour la messagerie en temps réel et les notifications.

```typescript
interface WebSocketContextType {
  isConnected: boolean;
  send: (message: object) => void;
  subscribe: (event: string, callback: Function) => () => void;
}

// Usage
const { isConnected, send, subscribe } = useWebSocket();
```

La connexion est établie automatiquement après l'authentification et reconnectée en cas de perte.

---

### `SosContext`

**Fichier** : `src/contexts/SosContext.tsx`

Gère l'état du mode SOS de l'utilisateur connecté.

```typescript
interface SosContextType {
  isSosActive: boolean;
  activeSosId: string | null;
  activateSos: (contactIds: string[], message?: string) => Promise<void>;
  deactivateSos: () => Promise<void>;
}

// Usage
const { isSosActive, activateSos, deactivateSos } = useSos();
```

Quand un SOS est actif, la `SosActiveBanner` est affichée en permanence en haut de l'écran.

---

### `AdminSosContext`

**Fichier** : `src/contexts/AdminSosContext.tsx`

Contexte réservé aux administrateurs. Expose les alertes SOS en cours et les actions de supervision.

---

## Hooks d'accès aux contextes

Chaque contexte expose un hook dédié avec vérification d'usage correct :

```typescript
export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
```

**Hooks disponibles** :
- `useTheme()` → ThemeContext
- `useHaptics()` → HapticsContext
- `useAuth()` → AuthContext
- `useSyncSettings()` → SyncSettingsContext
- `useSync()` → SyncContext
- `useWebSocket()` → WebSocketContext
- `useSos()` → SosContext
- `useAdminSos()` → AdminSosContext
