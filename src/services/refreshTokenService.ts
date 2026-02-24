// server/src/services/refreshTokenService.ts
import crypto from "crypto";
import RefreshTokenModel, { IRefreshToken } from "../models/refreshTokens";
import mongoose from "mongoose";
import { auditService } from "./auditService";
import { encrypt, decrypt } from "../utils/masterEncryptionUtils";

interface CreateRefreshTokenOptions {
  userId: string;
  tokenId: string;
  ipAddress?: string;
  userAgent?: string;
  deviceFingerprint?: string;
  tokenFamily?: string;
}

class RefreshTokenService {
  private readonly REFRESH_TOKEN_EXPIRY =
    parseInt(process.env.REFRESH_TOKEN_EXPIRES_IN || "48") * 60 * 60 * 1000; // 48h par défaut
  private readonly MAX_SESSIONS_PER_USER = 10;

  /**
   * Chiffrer une valeur si elle est définie
   */
  private encryptIfPresent(value: string | undefined): string | undefined {
    if (!value) return undefined;
    try {
      return encrypt(value);
    } catch (error) {
      console.error("❌ [REFRESH_TOKEN] Erreur de chiffrement:", error);
      return undefined;
    }
  }

  /**
   * Déchiffrer une valeur si elle est définie
   */
  private decryptIfPresent(value: string | undefined): string | undefined {
    if (!value) return undefined;
    try {
      return decrypt(value);
    } catch (error) {
      // Peut être une ancienne valeur non chiffrée
      console.warn(
        "⚠️ [REFRESH_TOKEN] Valeur non chiffrée détectée, retour en clair",
      );
      return value;
    }
  }

  /**
   * Générer un refresh token sécurisé
   */
  generateRefreshToken(): string {
    return crypto.randomBytes(64).toString("hex");
  }

  /**
   * Hash un refresh token pour le stockage
   */
  hashToken(token: string): string {
    return crypto.createHash("sha256").update(token).digest("hex");
  }

  /**
   * Limite le nombre de sessions actives par utilisateur
   * Révoque automatiquement les sessions les plus anciennes si la limite est atteinte
   */
  private async enforceSessionLimit(userId: string): Promise<void> {
    const activeSessions = await RefreshTokenModel.find({
      userId: new mongoose.Types.ObjectId(userId),
      revoked: false,
      expiresAt: { $gt: new Date() },
    })
      .sort({ lastUsedAt: 1 }) // Trier par lastUsedAt ASC (les plus anciennes en premier)
      .lean();

    const activeCount = activeSessions.length;

    if (activeCount >= this.MAX_SESSIONS_PER_USER) {
      // Calculer combien de sessions doivent être révoquées pour faire de la place
      const sessionsToRevoke = activeCount - this.MAX_SESSIONS_PER_USER + 1;
      const oldestSessions = activeSessions.slice(0, sessionsToRevoke);

      const tokenIdsToRevoke = oldestSessions.map(
        (session: any) => session.tokenId,
      );

      await RefreshTokenModel.updateMany(
        { tokenId: { $in: tokenIdsToRevoke } },
        {
          revoked: true,
          revokedAt: new Date(),
          revokedReason: "session_limit_exceeded",
        },
      );

      await auditService.log({
        userId,
        action: "SESSIONS_AUTO_REVOKED",
        level: "info",
        details: {
          count: sessionsToRevoke,
          reason: "session_limit_exceeded",
          maxSessions: this.MAX_SESSIONS_PER_USER,
        },
      });

      console.log(
        `🔒 [SESSIONS] ${sessionsToRevoke} sessions les plus anciennes révoquées pour userId: ${userId}`,
      );
    }
  }

  /**
   * Créer un nouveau refresh token en base
   * Les données sensibles (IP, User-Agent, fingerprint) sont chiffrées
   */
  async createRefreshToken(
    options: CreateRefreshTokenOptions,
  ): Promise<string> {
    // Limiter le nombre de sessions actives
    await this.enforceSessionLimit(options.userId);

    const refreshToken = this.generateRefreshToken();
    const hashedToken = this.hashToken(refreshToken);

    const expiresAt = new Date(Date.now() + this.REFRESH_TOKEN_EXPIRY);

    // Chiffrer les données sensibles
    const encryptedIp = this.encryptIfPresent(options.ipAddress);
    const encryptedUserAgent = this.encryptIfPresent(options.userAgent);
    const encryptedFingerprint = this.encryptIfPresent(
      options.deviceFingerprint,
    );

    await RefreshTokenModel.create({
      tokenId: options.tokenId,
      userId: new mongoose.Types.ObjectId(options.userId),
      token: hashedToken,
      ipAddress: encryptedIp,
      userAgent: encryptedUserAgent,
      deviceFingerprint: encryptedFingerprint,
      tokenFamily:
        options.tokenFamily || crypto.randomBytes(16).toString("hex"),
      expiresAt,
      createdAt: new Date(),
      lastUsedAt: new Date(),
      revoked: false,
    });

    await auditService.log({
      userId: options.userId,
      action: "REFRESH_TOKEN_CREATED",
      level: "info",
      ipAddress: options.ipAddress,
      userAgent: options.userAgent,
      details: { tokenId: options.tokenId, expiresAt },
    });

    return refreshToken;
  }

  /**
   * Valider un refresh token
   */
  async validateRefreshToken(token: string): Promise<IRefreshToken | null> {
    const hashedToken = this.hashToken(token);

    const refreshToken = await RefreshTokenModel.findOne({
      token: hashedToken,
      revoked: false,
      expiresAt: { $gt: new Date() },
    });

    if (!refreshToken) {
      return null;
    }

    // Mettre à jour le timestamp de dernière utilisation
    refreshToken.lastUsedAt = new Date();
    await refreshToken.save();

    return refreshToken;
  }

  /**
   * Révoquer un refresh token
   */
  async revokeToken(tokenId: string, reason: string = "used"): Promise<void> {
    // Si c'est une rotation (used), on ne révoque pas - on va mettre à jour le hash
    if (reason === "used") {
      return; // La rotation est gérée par rotateToken()
    }

    const result = await RefreshTokenModel.updateOne(
      { tokenId },
      {
        revoked: true,
        revokedAt: new Date(),
        revokedReason: reason,
      },
    );

    if (result.modifiedCount > 0) {
      await auditService.log({
        action: "REFRESH_TOKEN_REVOKED",
        level: "info",
        details: { tokenId, reason },
      });
    }
  }

  /**
   * Rotation du refresh token (mise à jour du hash dans le même document)
   * Le token précédent devient invalide, mais la session reste la même
   * Les données sensibles (IP, User-Agent) sont chiffrées
   *
   * BUG-004: Concurrency Guard
   * La condition { tokenId: oldTokenId, revoked: false } dans findOneAndUpdate
   * agit comme un verrou optimiste. Si deux requêtes tentent de faire tourner
   * le même token simultanément, seule la première réussira ; la seconde
   * recevra result === null et lancera une erreur "Token non trouvé pour rotation".
   * Cela protège contre les race conditions de rotation concurrente.
   */
  async rotateToken(
    oldTokenId: string,
    newTokenId: string,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<string> {
    const newRefreshToken = this.generateRefreshToken();
    const newHashedToken = this.hashToken(newRefreshToken);
    const newExpiresAt = new Date(Date.now() + this.REFRESH_TOKEN_EXPIRY);

    // Chiffrer les données sensibles
    const encryptedIp = this.encryptIfPresent(ipAddress);
    const encryptedUserAgent = this.encryptIfPresent(userAgent);

    const result = await RefreshTokenModel.findOneAndUpdate(
      { tokenId: oldTokenId, revoked: false },
      {
        tokenId: newTokenId,
        token: newHashedToken,
        lastUsedAt: new Date(),
        expiresAt: newExpiresAt,
        ipAddress: encryptedIp,
        userAgent: encryptedUserAgent,
      },
      { new: true },
    );

    if (!result) {
      throw new Error("Token non trouvé pour rotation");
    }

    return newRefreshToken;
  }

  /**
   * Révoquer tous les tokens d'un utilisateur
   */
  async revokeAllUserTokens(
    userId: string,
    reason: string = "logout_all",
  ): Promise<number> {
    const result = await RefreshTokenModel.updateMany(
      { userId: new mongoose.Types.ObjectId(userId), revoked: false },
      {
        revoked: true,
        revokedAt: new Date(),
        revokedReason: reason,
      },
    );

    await auditService.log({
      userId,
      action: "ALL_TOKENS_REVOKED",
      level: "warning",
      details: { count: result.modifiedCount, reason },
    });

    return result.modifiedCount || 0;
  }

  /**
   * Détecter le vol de token (Refresh Token Rotation Attack)
   */
  async detectTokenTheft(
    tokenFamily: string,
    userId: string,
    ipAddress?: string,
  ): Promise<boolean> {
    // Si un token révoqué de la même famille est réutilisé = vol détecté
    const revokedTokenInFamily = await RefreshTokenModel.findOne({
      tokenFamily,
      revoked: true,
    });

    if (revokedTokenInFamily) {
      console.error(
        `🚨 [SECURITY] Vol de refresh token détecté! UserId: ${userId}, TokenFamily: ${tokenFamily}`,
      );

      // Révoquer TOUS les tokens de cet utilisateur
      await this.revokeAllUserTokens(userId, "token_theft_detected");

      await auditService.log({
        userId,
        action: "TOKEN_THEFT_DETECTED",
        level: "critical",
        ipAddress,
        details: { tokenFamily, revokedTokenId: revokedTokenInFamily.tokenId },
      });

      return true;
    }

    return false;
  }

  /**
   * Obtenir les sessions actives d'un utilisateur (avec données déchiffrées)
   */
  async getUserActiveSessions(userId: string): Promise<any[]> {
    const sessions = await RefreshTokenModel.find({
      userId: new mongoose.Types.ObjectId(userId),
      revoked: false,
      expiresAt: { $gt: new Date() },
    })
      .sort({ lastUsedAt: -1 })
      .lean();

    // Déchiffrer les données sensibles pour l'affichage
    return sessions.map((session: any) => ({
      ...session,
      ipAddress: this.decryptIfPresent(session.ipAddress),
      userAgent: this.decryptIfPresent(session.userAgent),
      deviceFingerprint: this.decryptIfPresent(session.deviceFingerprint),
    }));
  }

  /**
   * Révoquer les sessions inactives (non utilisées depuis 24h)
   */
  async revokeInactiveSessions(): Promise<number> {
    const inactivityThreshold = new Date(Date.now() - 24 * 60 * 60 * 1000); // 24h

    const result = await RefreshTokenModel.updateMany(
      {
        revoked: false,
        lastUsedAt: { $lt: inactivityThreshold },
      },
      {
        revoked: true,
        revokedAt: new Date(),
        revokedReason: "inactive_cleanup",
      },
    );

    return result.modifiedCount || 0;
  }

  /**
   * Nettoyer les tokens expirés (optionnel, TTL index le fait déjà)
   */
  async cleanupExpiredTokens(): Promise<number> {
    // D'abord, révoquer les sessions inactives
    const inactiveCount = await this.revokeInactiveSessions();

    // Ensuite, supprimer les tokens expirés et révoqués
    const result = await RefreshTokenModel.deleteMany({
      $or: [
        { expiresAt: { $lt: new Date() } },
        {
          revoked: true,
          revokedAt: { $lt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
        }, // Révoqués depuis > 7 jours
      ],
    });

    return (result.deletedCount || 0) + inactiveCount;
  }
}

export const refreshTokenService = new RefreshTokenService();
