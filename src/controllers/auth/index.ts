// ═══════════════════════════════════════════════════════════════════════════
// MED-06: Module auth — Barrel file (re-exports)
// ═══════════════════════════════════════════════════════════════════════════

// Login, refresh, check auth, 2FA
export {
  handleLoginUser,
  handleRefreshToken,
  checkAuth,
  completeLoginAfter2FA,
} from "./loginController";

// Password reset
export {
  handleForgotPassword,
  handleResetPassword,
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
  encryptUserData,
  decryptPoint,
  decryptFiche,
  decryptPointOptimized,
  decryptFicheOptimized,
  generateSecureToken,
  checkLoginAttempts,
  recordFailedLogin,
  resetLoginAttempts,
} from "./authHelpers";

// Shared interfaces
export type { BlacklistedToken } from "./authHelpers";
