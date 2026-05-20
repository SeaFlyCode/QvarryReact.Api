// ═══════════════════════════════════════════════════════════════════════════
// MED-06: Module auth — Barrel file (re-exports)
// ═══════════════════════════════════════════════════════════════════════════

// Login, refresh, check auth, 2FA, profil /me
export {
  handleLoginUser,
  handleRefreshToken,
  checkAuth,
  completeLoginAfter2FA,
  handleAuthMe,
} from "./loginController";

// P1 Auth — handlers unifiés (web + mobile, JSON body, pas de cookies serveur)
export {
  handleUnifiedLogin,
  handleUnifiedComplete2FA,
} from "./unifiedAuthController";

// Password reset
export {
  handleForgotPassword,
  handleResetPassword,
  handleResetPasswordByToken,
} from "./passwordController";

// Logout
export { handleLogoutUser } from "./logoutController";

// WebSocket token
export { getWebSocketToken } from "./websocketController";

// Shared helpers (used by other modules: authMiddleware, syncService, etc.)
export {
  isTokenBlacklisted,
  blacklistToken,
  loadAndDecryptUserData,
  syncUserDataToDB,
  refreshFromDB,
  encryptUserData,
  decryptPointOptimized,
  decryptFicheOptimized,
  generateSecureToken,
  checkLoginAttempts,
  recordFailedLogin,
  resetLoginAttempts,
} from "./authHelpers";

// Shared interfaces
export type { BlacklistedToken } from "./authHelpers";
