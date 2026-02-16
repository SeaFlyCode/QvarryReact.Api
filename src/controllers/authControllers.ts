import { getErrorMessage, isErrorWithName } from '../utils/errorUtils';
import { Request, Response } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { getUserByEmail } from "../services/userServices";
import { memoryStorage } from "../services/memoryStorageService";
import { sessionService } from "../services/sessionService";
import PointModel from "../models/points";
import FicheModel from "../models/fiches";
import ListModel from "../models/lists";
import KeysModel from "../models/keys";
import { decrypt, encrypt } from "../utils/masterEncryptionUtils";
import { decryptUserKeys } from "../utils/userEncryptionUtils";
import crypto from "crypto";
import { syncService } from "../services/syncService";
import mongoose from "mongoose";
import { refreshTokenService } from "../services/refreshTokenService";
import { auditService } from "../services/auditService";
import { resetRateLimit } from "../middlewares/rateLimitMiddleware";
import { redisSessionService } from "../services/redisSessionService";
import { sendSecurityAlertEmail } from "../services/emailService";
import { jwtKeyManager } from "../utils/jwtKeyManager";
import { isPasswordInHistory, addToPasswordHistory } from "../utils/passwordUtils";
import { generateDeviceFingerprint } from "../utils/deviceFingerprint";
import MaintenanceModel from "../models/maintenance";
import dataArchiveService from "../services/dataArchiveService";
import { getJwtCookieOptions, getRefreshTokenCookieOptions, clearCookieOptions, getCookieConfig } from "../config/cookieConfig";

// ═══════════════════════════════════════════════════════════════════════════
// GESTION DES TOKENS ET BLACKLIST (VIA REDIS)
// ═══════════════════════════════════════════════════════════════════════════
// VULN-007 CORRIGÉE: Utilisation de Redis au lieu de la mémoire
// - Survit aux redémarrages
// - Compatible clustering
// - TTL automatique
// ═══════════════════════════════════════════════════════════════════════════

interface BlacklistedToken {
    token: string;
    expiresAt: Date;
    blacklistedAt: Date;
    reason: string;
    userId: string;
}

// DEPRECATED: Conservé pour rétrocompatibilité avec authMiddleware
// Les nouvelles opérations utilisent redisSessionService
export const blacklistedTokens: Set<string> = new Set();
const blacklistedTokensDetails: Map<string, BlacklistedToken> = new Map();

// Helper pour synchroniser Redis -> Mémoire (fallback)
async function isTokenBlacklisted(token: string): Promise<boolean> {
    // Vérifier d'abord dans Redis
    const redisResult = await redisSessionService.isTokenBlacklisted(token);
    if (redisResult) return true;

    // Fallback mémoire
    return blacklistedTokens.has(token);
}

// Helper pour blacklister un token
async function blacklistToken(token: string, details: BlacklistedToken): Promise<void> {
    const expiresInSeconds = Math.floor((details.expiresAt.getTime() - Date.now()) / 1000);

    // Blacklister dans Redis
    await redisSessionService.blacklistToken(token, details, expiresInSeconds);

    // Fallback mémoire
    blacklistedTokens.add(token);
    blacklistedTokensDetails.set(token, details);
}

// ═══════════════════════════════════════════════════════════════════════════
// AUTH-006: TENTATIVES DE CONNEXION - STOCKAGE REDIS
// ═══════════════════════════════════════════════════════════════════════════
// DEPRECATED: loginAttempts en mémoire - maintenant géré par redisSessionService
// L'interface et le Map sont conservés pour rétrocompatibilité du nettoyage automatique
interface LoginAttempt {
    email: string;
    attempts: number;
    lastAttempt: Date;
    blockedUntil?: Date;
}
// DEPRECATED: Utilisé uniquement pour le nettoyage de l'ancien système
const loginAttempts: Map<string, LoginAttempt> = new Map();

// ═══════════════════════════════════════════════════════════════════════════
// NETTOYAGE AUTOMATIQUE DES DONNÉES DE SÉCURITÉ
// ═══════════════════════════════════════════════════════════════════════════

// Nettoyer les tokens expirés et les tentatives de connexion toutes les heures
setInterval(() => {
    const now = new Date();
    let cleanedTokens = 0;
    let cleanedAttempts = 0;

    // Nettoyage des tokens blacklistés expirés
    for (const [token, details] of blacklistedTokensDetails.entries()) {
        if (details.expiresAt < now) {
            blacklistedTokens.delete(token);
            blacklistedTokensDetails.delete(token);
            cleanedTokens++;
        }
    }

    // Nettoyage des tentatives de connexion anciennes (> 24h)
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    for (const [email, attempt] of loginAttempts.entries()) {
        if (attempt.lastAttempt < oneDayAgo && (!attempt.blockedUntil || attempt.blockedUntil < now)) {
            loginAttempts.delete(email);
            cleanedAttempts++;
        }
    }

    if (cleanedTokens > 0 || cleanedAttempts > 0) {
        console.log(`🧹 [SECURITY CLEANUP] Tokens supprimés: ${cleanedTokens} | Tentatives nettoyées: ${cleanedAttempts}`);
        console.log(`   📊 Tokens restants: ${blacklistedTokens.size} | Tentatives surveillées: ${loginAttempts.size}`);
    }
}, 60 * 60 * 1000); // Toutes les heures

// ═══════════════════════════════════════════════════════════════════════════
// AUTH-006: TENTATIVES DE CONNEXION VIA REDIS (PERSISTÉES)
// ═══════════════════════════════════════════════════════════════════════════
// Les tentatives sont désormais stockées dans Redis pour survivre aux redémarrages
// Fallback automatique vers la mémoire si Redis non disponible

// Vérification et gestion des tentatives de connexion
async function checkLoginAttempts(email: string): Promise<{ allowed: boolean; message?: string; waitTime?: number }> {
    const now = new Date();
    const attempt = await redisSessionService.getLoginAttempts(email);

    if (!attempt) {
        return { allowed: true };
    }

    // Si l'utilisateur est bloqué
    if (attempt.blockedUntil && attempt.blockedUntil > now) {
        const waitTimeMinutes = Math.ceil((attempt.blockedUntil.getTime() - now.getTime()) / 60000);
        return {
            allowed: false,
            message: `Trop de tentatives échouées. Veuillez réessayer dans ${waitTimeMinutes} minute(s).`,
            waitTime: waitTimeMinutes
        };
    }

    // Si plus de 5 tentatives dans les 15 dernières minutes
    const fifteenMinutesAgo = new Date(now.getTime() - 15 * 60 * 1000);
    if (attempt.lastAttempt > fifteenMinutesAgo && attempt.attempts >= 5) {
        // Bloquer pour 30 minutes
        await redisSessionService.recordLoginAttempt(email, true, 30);
        console.warn(`⚠️ [SECURITY] Email bloqué pour 30min après 5 tentatives: ${email}`);
        return {
            allowed: false,
            message: "Trop de tentatives échouées. Compte temporairement bloqué pour 30 minutes.",
            waitTime: 30
        };
    }

    return { allowed: true };
}

// Enregistrer une tentative de connexion échouée
async function recordFailedLogin(email: string): Promise<void> {
    await redisSessionService.recordLoginAttempt(email, false);
    const attempt = await redisSessionService.getLoginAttempts(email);
    console.warn(`⚠️ [SECURITY] Tentative de connexion échouée pour: ${email} (${attempt?.attempts || 1} tentatives)`);
}

// Réinitialiser les tentatives après un login réussi
async function resetLoginAttempts(email: string): Promise<void> {
    await redisSessionService.resetLoginAttempts(email);
}

// Générer un token JWT sécurisé avec des claims appropriés (courte durée)
// REM-003: Support du key versioning pour rotation de clés
function generateSecureToken(userId: string, isAdmin: boolean = false, tokenId?: string): { token: string; tokenId: string; keyVersion: string } {
    // REM-003: Utiliser le JWT Key Manager pour le versioning
    const { secret, version } = jwtKeyManager.getCurrentKey();

    // AUTH-005: Validation longueur minimum du JWT_SECRET
    if (secret.length < 32) {
        throw new Error("JWT_SECRET doit contenir au moins 32 caractères pour garantir la sécurité.");
    }

    const jti = tokenId || crypto.randomBytes(16).toString('hex');
    const expiresIn = process.env.JWT_EXPIRES_IN || '15m'; // 15 minutes par défaut

    // Ajouter des claims de sécurité
    // REM-003: Inclure la version de la clé dans le token pour la vérification
    const token = jwt.sign(
        {
            id: userId,
            isAdmin,
            iat: Math.floor(Date.now() / 1000), // Issued at
            jti, // JWT ID unique pour l'invalidation
            kv: version // REM-003: Key Version pour le versioning
        },
        secret,
        {
            expiresIn: expiresIn, // Durée courte configurable
            algorithm: 'HS256',
            issuer: 'qvarry-api',
            audience: 'qvarry-client'
        } as jwt.SignOptions
    );

    return { token, tokenId: jti, keyVersion: version };
}


// ═══════════════════════════════════════════════════════════════════════════
// HANDLER: LOGIN UTILISATEUR
// ═══════════════════════════════════════════════════════════════════════════

export async function handleLoginUser(req: Request, res: Response) {
    const startTime = Date.now();

    try {
        const { email, password } = req.body;

        // ─────────────────────────────────────────────────────────────────────
        // 1. VALIDATION DES ENTRÉES
        // ─────────────────────────────────────────────────────────────────────
        if (!email || !password) {
            console.warn(`⚠️ [AUTH] Tentative de connexion avec champs manquants`);
            return res.status(400).json({
                error: "Email et mot de passe requis."
            });
        }

        // Validation du format email
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            console.warn(`⚠️ [AUTH] Format d'email invalide: ${email}`);
            return res.status(400).json({
                error: "Format d'email invalide."
            });
        }

        // ─────────────────────────────────────────────────────────────────────
        // 2. VÉRIFICATION DES TENTATIVES DE CONNEXION (PROTECTION BRUTE FORCE)
        // ─────────────────────────────────────────────────────────────────────
        const attemptCheck = await checkLoginAttempts(email);
        if (!attemptCheck.allowed) {
            return res.status(429).json({
                error: attemptCheck.message,
                waitTime: attemptCheck.waitTime,
                tooManyAttempts: true
            });
        }

        // ─────────────────────────────────────────────────────────────────────
        // 3. VÉRIFICATION DE L'UTILISATEUR
        // ─────────────────────────────────────────────────────────────────────
        const user = await getUserByEmail(email);

        // ─────────────────────────────────────────────────────────────────────
        // 4. VÉRIFICATION DU MOT DE PASSE (AUTH-003: Protection timing attack)
        // ─────────────────────────────────────────────────────────────────────
        // AUTH-003 CORRIGÉ: Exécuter bcrypt.compare même pour utilisateurs inexistants
        // Cela prévient les timing attacks pour l'énumération d'utilisateurs
        // Le hash factice a été pré-généré avec le même coût que les vrais hashs (12 rounds)
        const DUMMY_HASH = "$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/X4.KPYWxv0Y2dwzOe";
        const passwordToCompare = user?.password || DUMMY_HASH;

        const isPasswordValid = await bcrypt.compare(password, passwordToCompare);

        if (!user || !isPasswordValid) {
            await recordFailedLogin(email);
            // Message générique pour éviter l'énumération des utilisateurs
            return res.status(401).json({
                error: "Email ou mot de passe incorrect."
            });
        }

        // ─────────────────────────────────────────────────────────────────────
        // 4.1 VÉRIFICATION DU MODE MAINTENANCE
        // ─────────────────────────────────────────────────────────────────────
        const maintenance = await MaintenanceModel.findOne().lean();
        const isMaintenanceActive = maintenance?.isActive || false;

        if (isMaintenanceActive && !user.is_admin) {
            console.warn(`🔧 [AUTH] Connexion refusée pendant maintenance pour non-admin: ${email}`);
            return res.status(503).json({
                error: "Le site est actuellement en maintenance. Seuls les administrateurs peuvent se connecter.",
                maintenance: true,
                message: maintenance?.message || "Site en maintenance"
            });
        }

        // ─────────────────────────────────────────────────────────────────────
        // 4.3 VÉRIFICATION DU BLOCAGE DU COMPTE
        // ─────────────────────────────────────────────────────────────────────
        if (user.is_blocked) {
            console.warn(`🚫 [AUTH] Tentative de connexion d'un compte bloqué: ${email}`);
            return res.status(403).json({
                error: "Votre compte a été suspendu. Contactez l'administrateur pour plus d'informations.",
                accountBlocked: true
            });
        }

        // ─────────────────────────────────────────────────────────────────────
        // 4.5 VÉRIFICATION DE L'EMAIL
        // ─────────────────────────────────────────────────────────────────────
        if (!user.is_verified) {
            return res.status(403).json({
                error: "Veuillez vérifier votre adresse email avant de vous connecter.",
                emailNotVerified: true,
                email: email // Pour permettre le renvoi du code
            });
        }

        // ─────────────────────────────────────────────────────────────────────
        // 4.6 VÉRIFICATION DE LA VALIDATION PAR UN ADMIN
        // ─────────────────────────────────────────────────────────────────────
        if (!user.is_admin_validated) {
            // Vérifier si le compte a été refusé
            if (user.admin_validation_rejected) {
                console.warn(`🚫 [AUTH] Tentative de connexion d'un compte refusé: ${email}`);
                return res.status(403).json({
                    error: "Votre demande de compte a été refusée. Contactez l'administrateur pour plus d'informations.",
                    accountRejected: true,
                    rejectionReason: user.admin_rejection_reason || undefined
                });
            }

            console.warn(`⏳ [AUTH] Tentative de connexion d'un compte en attente de validation: ${email}`);
            return res.status(403).json({
                error: "Votre compte est en attente de validation par un administrateur. Vous recevrez un email lorsque votre compte sera activé.",
                pendingAdminValidation: true
            });
        }

        // ─────────────────────────────────────────────────────────────────────
        // 4.7 VÉRIFICATION 2FA (si activée)
        // ─────────────────────────────────────────────────────────────────────
        if (user.two_factor_enabled) {
            const userId = (user._id as mongoose.Types.ObjectId).toString();
            console.log(`🔐 [AUTH] 2FA requis pour ${email}`);

            // Réinitialiser les tentatives car le mot de passe est correct
            await resetLoginAttempts(email);

            return res.status(200).json({
                requiresTwoFactor: true,
                userId: userId,
                message: "Veuillez entrer votre code d'authentification à deux facteurs"
            });
        }

        // ─────────────────────────────────────────────────────────────────────
        // 5. GÉNÉRATION DES TOKENS (JWT + REFRESH TOKEN)
        // ─────────────────────────────────────────────────────────────────────
        const userId = (user._id as mongoose.Types.ObjectId).toString();
        const { token, tokenId } = generateSecureToken(userId, user.is_admin || false);

        // Métadonnées de sécurité
        const ipAddress = req.ip || req.connection.remoteAddress;
        const userAgent = req.headers['user-agent'];
        // SÉCURITÉ: Calcul du fingerprint côté serveur (évite manipulation client)
        const deviceFingerprint = generateDeviceFingerprint(req);

        // Créer le refresh token en base de données
        const refreshToken = await refreshTokenService.createRefreshToken({
            userId,
            tokenId,
            ipAddress,
            userAgent,
            deviceFingerprint
        });

        // ─────────────────────────────────────────────────────────────────────
        // 6. CONFIGURATION DES COOKIES SÉCURISÉS
        // ─────────────────────────────────────────────────────────────────────
        // Cookie pour le JWT (courte durée)
        res.cookie("token", token, getJwtCookieOptions());

        // Cookie pour le refresh token (longue durée)
        res.cookie("refreshToken", refreshToken, getRefreshTokenCookieOptions());

        // ─────────────────────────────────────────────────────────────────────
        // 7. CHARGEMENT ET DÉCHIFFREMENT DES DONNÉES UTILISATEUR
        // ─────────────────────────────────────────────────────────────────────
        await loadAndDecryptUserData(userId);

        // ─────────────────────────────────────────────────────────────────────
        // 8. CRÉATION DE LA SESSION AVEC MÉTADONNÉES
        // ─────────────────────────────────────────────────────────────────────
        sessionService.createSession(userId, ipAddress, userAgent);

        // AUTH-007: Stocker le JTI pour validation ultérieure
        const jwtExpiresInSeconds = parseInt(process.env.JWT_EXPIRES_IN?.replace(/[^0-9]/g, '') || '15') * 60;
        await redisSessionService.storeSessionJti(userId, tokenId, jwtExpiresInSeconds);

        // ─────────────────────────────────────────────────────────────────────
        // 9. RÉINITIALISATION DES TENTATIVES, AUDIT ET LOGGING
        // ─────────────────────────────────────────────────────────────────────
        await resetLoginAttempts(email);
        resetRateLimit(req.ip || req.connection.remoteAddress || 'unknown');

        await auditService.log({
            userId,
            action: 'LOGIN_SUCCESS',
            level: 'info',
            ipAddress,
            userAgent,
            details: { tokenId }
        });

        const loginDuration = Date.now() - startTime;
        console.log(`✅ [AUTH] Connexion réussie: ${email} (user: ${userId}) en ${loginDuration}ms`);

        // ─────────────────────────────────────────────────────────────────────
        // 9.5 ENVOI D'EMAIL D'ALERTE DE SÉCURITÉ (optionnel, configurable)
        // ─────────────────────────────────────────────────────────────────────
        console.log(`📧 [AUTH] SEND_LOGIN_ALERTS = '${process.env.SEND_LOGIN_ALERTS}' (type: ${typeof process.env.SEND_LOGIN_ALERTS})`);
        console.log(`📧 [AUTH] User login_notifications_enabled = ${user.login_notifications_enabled ?? true}`);

        // Vérifier à la fois la variable d'environnement globale ET la préférence utilisateur
        const userWantsLoginNotifications = user.login_notifications_enabled !== false; // true par défaut

        if (process.env.SEND_LOGIN_ALERTS === 'true' && userWantsLoginNotifications) {
            console.log(`📧 [AUTH] Envoi d'email d'alerte de connexion pour ${email}...`);
            const userName = decrypt(user.name);
            const loginTime = new Date().toLocaleString('fr-FR', {
                dateStyle: 'full',
                timeStyle: 'short',
                timeZone: 'Europe/Paris'
            });

            sendSecurityAlertEmail(
                email,
                userName,
                ipAddress || 'Inconnue',
                userAgent || 'Navigateur inconnu',
                loginTime // location/time info
            ).then(() => {
                console.log(`📧 [AUTH] ✅ Email d'alerte envoyé à ${email}`);
            }).catch(err => {
                console.error(`📧 [AUTH] ❌ Erreur envoi email alerte connexion:`, err);
            });
        } else {
            if (!userWantsLoginNotifications) {
                console.log(`📧 [AUTH] Email d'alerte désactivé par l'utilisateur`);
            } else {
                console.log(`📧 [AUTH] Email d'alerte de connexion désactivé (SEND_LOGIN_ALERTS != 'true')`);
            }
        }

        // ─────────────────────────────────────────────────────────────────────
        // 10. PRÉPARATION DE LA RÉPONSE (MODE DEBUG OPTIONNEL)
        // ─────────────────────────────────────────────────────────────────────
        const cookieConfig = getCookieConfig();
        const response: any = {
            login: true,
            userId: userId,
            email: user.email,
            isAdmin: user.is_admin || false,
            redirectToAdmin: isMaintenanceActive && user.is_admin, // Rediriger vers /admin si maintenance active
            sessionCreated: new Date().toISOString(),
            tokenExpiresIn: cookieConfig.jwtMaxAgeMinutes * 60 // secondes
        };

        // En développement, ajouter des infos de debug
        if (!cookieConfig.isProduction && process.env.DEBUG_MODE === 'true') {
            const memoryData = memoryStorage.getAllUserData(userId);
            response.debug = {
                pointsCount: memoryData.points?.length || 0,
                fichesCount: memoryData.fiches?.length || 0,
                listsCount: memoryData.lists?.length || 0,
                hasEncryptionKey: !!memoryData.encryptionKey,
                sessionInitialized: memoryStorage.hasSession(userId),
                tokenId
            };
        }

        res.status(200).json(response);
    }
    catch (error: unknown) {
        console.error(`❌ [AUTH] Erreur lors de la connexion:`, error);
        res.status(500).json({
            error: "Erreur lors de la connexion. Veuillez réessayer."
        });
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// HANDLER: REFRESH TOKEN (RENOUVELLEMENT DU JWT)
// ═══════════════════════════════════════════════════════════════════════════

export async function handleRefreshToken(req: Request, res: Response) {
    try {
        // ─────────────────────────────────────────────────────────────────────
        // 1. RÉCUPÉRATION DU REFRESH TOKEN
        // ─────────────────────────────────────────────────────────────────────
        console.log(`🔍 [AUTH DEBUG] Cookies reçus:`, Object.keys(req.cookies || {}));
        console.log(`🔍 [AUTH DEBUG] RefreshToken présent:`, !!req.cookies?.refreshToken);

        const refreshToken = req.cookies?.refreshToken || req.body?.refreshToken;

        if (!refreshToken) {
            console.warn(`⚠️ [AUTH] Tentative de refresh sans token`);
            console.warn(`⚠️ [AUTH DEBUG] Cookies disponibles:`, req.cookies);
            return res.status(401).json({
                error: "Refresh token manquant. Veuillez vous reconnecter.",
                code: 'NO_REFRESH_TOKEN'
            });
        }

        // ─────────────────────────────────────────────────────────────────────
        // 2. VALIDATION DU REFRESH TOKEN
        // ─────────────────────────────────────────────────────────────────────
        const storedToken = await refreshTokenService.validateRefreshToken(refreshToken);

        if (!storedToken) {
            console.warn(`⚠️ [AUTH] Refresh token invalide ou expiré`);

            await auditService.log({
                action: 'REFRESH_TOKEN_INVALID',
                level: 'warning',
                ipAddress: req.ip || req.connection.remoteAddress,
                userAgent: req.headers['user-agent']
            });

            return res.status(401).json({
                error: "Refresh token invalide ou expiré. Veuillez vous reconnecter.",
                code: 'INVALID_REFRESH_TOKEN'
            });
        }

        // ─────────────────────────────────────────────────────────────────────
        // 3. DÉTECTION DE VOL DE TOKEN (Refresh Token Rotation Attack)
        // ─────────────────────────────────────────────────────────────────────
        const userId = storedToken.userId.toString();
        const tokenFamily = storedToken.tokenFamily;
        const ipAddress = req.ip || req.connection.remoteAddress;

        if (tokenFamily) {
            const isStolen = await refreshTokenService.detectTokenTheft(tokenFamily, userId, ipAddress);

            if (isStolen) {
                console.error(`🚨 [SECURITY] Vol de token détecté! Tous les tokens révoqués pour userId: ${userId}`);
                return res.status(401).json({
                    error: "Activité suspecte détectée. Tous vos tokens ont été révoqués. Veuillez vous reconnecter.",
                    code: 'TOKEN_THEFT_DETECTED'
                });
            }
        }

        // ─────────────────────────────────────────────────────────────────────
        // 4. VALIDATION DES MÉTADONNÉES (DÉTECTION DE CHANGEMENT SUSPECT)
        // ─────────────────────────────────────────────────────────────────────
        const userAgent = req.headers['user-agent'];

        if (process.env.VALIDATE_SESSION_METADATA === 'true') {
            // Changement d'IP
            if (storedToken.ipAddress && storedToken.ipAddress !== ipAddress) {
                console.warn(`⚠️ [SECURITY] Changement d'IP détecté pour userId: ${userId} (${storedToken.ipAddress} -> ${ipAddress})`);

                await auditService.log({
                    userId,
                    action: 'IP_CHANGE_DETECTED',
                    level: 'warning',
                    ipAddress,
                    details: { oldIp: storedToken.ipAddress, newIp: ipAddress }
                });

                // Option: forcer MFA ou bloquer
                // return res.status(401).json({ error: "Changement d'IP détecté", code: 'IP_CHANGED' });
            }

            // Changement de User-Agent
            if (storedToken.userAgent && storedToken.userAgent !== userAgent) {
                console.warn(`⚠️ [SECURITY] Changement de User-Agent détecté pour userId: ${userId}`);

                await auditService.log({
                    userId,
                    action: 'USER_AGENT_CHANGE_DETECTED',
                    level: 'warning',
                    ipAddress,
                    details: { oldUA: storedToken.userAgent, newUA: userAgent }
                });
            }
        }

        // ─────────────────────────────────────────────────────────────────────
        // 5. GÉNÉRER UN NOUVEAU JWT
        // ─────────────────────────────────────────────────────────────────────
        const { getUserById } = await import('../services/userServices');
        const user = await getUserById(userId);
        const { token: newJwt, tokenId: newTokenId } = generateSecureToken(userId, user?.is_admin || false);

        // ─────────────────────────────────────────────────────────────────────
        // 6. ROTATION DU REFRESH TOKEN (même session, nouveau hash)
        // ─────────────────────────────────────────────────────────────────────
        // Au lieu de révoquer + créer, on met à jour le hash dans le même document
        // Cela garde 1 session = 1 appareil et invalide l'ancien token
        const newRefreshToken = await refreshTokenService.rotateToken(
            storedToken.tokenId,
            newTokenId,
            ipAddress,
            userAgent
        );

        // ─────────────────────────────────────────────────────────────────────
        // 7. RESTAURER LA SESSION SI NÉCESSAIRE
        // ─────────────────────────────────────────────────────────────────────
        if (!memoryStorage.hasSession(userId)) {
            console.log(`🔄 [AUTH] Restauration de la session pour userId: ${userId}`);
            await loadAndDecryptUserData(userId);
            sessionService.createSession(userId, ipAddress, userAgent);
        } else {
            // Mettre à jour le timestamp de dernière activité
            memoryStorage.touchSession?.(userId);
        }

        // AUTH-007: Stocker le nouveau JTI pour validation ultérieure
        const jwtExpiresInSeconds = parseInt(process.env.JWT_EXPIRES_IN?.replace(/[^0-9]/g, '') || '15') * 60;
        await redisSessionService.storeSessionJti(userId, newTokenId, jwtExpiresInSeconds);

        // ─────────────────────────────────────────────────────────────────────
        // 8. CONFIGURER LES NOUVEAUX COOKIES
        // ─────────────────────────────────────────────────────────────────────
        res.cookie("token", newJwt, getJwtCookieOptions());

        res.cookie("refreshToken", newRefreshToken, getRefreshTokenCookieOptions());

        // ─────────────────────────────────────────────────────────────────────
        // 9. AUDIT ET RÉPONSE
        // ─────────────────────────────────────────────────────────────────────
        await auditService.log({
            userId,
            action: 'TOKEN_REFRESHED',
            level: 'info',
            ipAddress,
            userAgent,
            details: { oldTokenId: storedToken.tokenId, newTokenId }
        });

        console.log(`✅ [AUTH] Token renouvelé pour userId: ${userId}`);

        res.status(200).json({
            success: true,
            tokenExpiresIn: getCookieConfig().jwtMaxAgeMinutes * 60,
            message: "Token renouvelé avec succès"
        });
    } catch (error: unknown) {
        console.error(`❌ [AUTH] Erreur lors du refresh du token:`, error);
        res.status(500).json({
            error: "Erreur lors du renouvellement du token.",
            code: 'REFRESH_ERROR'
        });
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// HANDLER: LOGOUT UTILISATEUR
// ═══════════════════════════════════════════════════════════════════════════

export async function handleLogoutUser(req: Request, res: Response) {
    try {
        // ────────────────────────────────────────���────────────────────────────
        // 1. RÉCUPÉRATION ET VALIDATION DU TOKEN
        // ─────────────────────────────────────────────────────────────────────
        const token = req.cookies?.token || req.headers.authorization?.split(" ")[1];

        if (!token) {
            console.warn(`⚠️ [AUTH] Tentative de logout sans token`);
            return res.status(400).json({
                success: false,
                message: "Token manquant."
            });
        }

        // ─────────────────────────────────────────────────────────────────────
        // 2. SUPPRESSION DES COOKIES
        // ─────────────────────────────────────────────────────────────────────
        res.clearCookie("token", clearCookieOptions);

        res.clearCookie("refreshToken", clearCookieOptions);

        // ─────────────────────────────────────────────────────────────────────
        // 3. AJOUT DU TOKEN À LA BLACKLIST ET RÉVOCATION DU REFRESH TOKEN
        // ─────────────────────────────────────────────────────────────────────
        let userId: string;
        let tokenId: string | undefined;

        try {
            if (!process.env.JWT_SECRET) {
                console.error('❌ [SECURITY] JWT_SECRET non défini');
                throw new Error('Configuration de sécurité manquante');
            }

            const decoded = jwt.verify(
                token,
                process.env.JWT_SECRET
            ) as { id: string; jti?: string; exp?: number };

            userId = decoded.id;
            tokenId = decoded.jti;
            const expiresAt = decoded.exp
                ? new Date(decoded.exp * 1000)
                : new Date(Date.now() + 24 * 60 * 60 * 1000);

            // Blacklister le token (Redis + fallback mémoire)
            await blacklistToken(token, {
                token,
                expiresAt,
                blacklistedAt: new Date(),
                reason: 'logout',
                userId
            });

            // Révoquer le refresh token associé
            if (tokenId) {
                await refreshTokenService.revokeToken(tokenId, 'logout');
                console.log(`🚫 [AUTH] Refresh token révoqué (tokenId: ${tokenId})`);
            }

            console.log(`🚫 [AUTH] Token blacklisté lors du logout (userId: ${userId}). Total: ${blacklistedTokens.size}`);
        } catch (jwtError) {
            console.error(`❌ [AUTH] Erreur lors du décodage du token pour logout:`, jwtError);
            return res.status(200).json({
                success: true,
                message: "Déconnexion effectuée (token invalide ou expiré)."
            });
        }

        // ─────────────────────────────────────────────────────────────────────
        // 4. NETTOYAGE DU CACHE DES CLÉS
        // ─────────────────────────────────────────────────────────────────────
        const { clearUserKeyCache } = await import("../utils/userEncryptionUtils");
        clearUserKeyCache(userId);

        // ─────────────────────────────────────────────────────────────────────
        // 5. SYNCHRONISATION DES DONNÉES SI NÉCESSAIRE
        // ─────────────────────────────────────────────────────────────────────
        if (!memoryStorage.hasSession(userId)) {
            console.log(`ℹ️ [AUTH] Logout sans session active pour userId: ${userId}`);
            return res.status(200).json({
                success: true,
                message: "Déconnexion réussie (pas de session active)."
            });
        }

        // Synchroniser si des modifications sont en attente
        if (memoryStorage.isDirty(userId)) {
            try {
                console.log(`🔄 [AUTH] Synchronisation des données modifiées avant logout...`);
                const syncResult = await syncService.syncNow(userId);

                if (!syncResult.success) {
                    console.error(`❌ [AUTH] Échec de la synchronisation lors du logout:`, syncResult.error);
                    memoryStorage.endSession(userId);
                    return res.status(500).json({
                        success: false,
                        message: "Déconnexion effectuée mais échec de la synchronisation des données.",
                        error: syncResult.error,
                        logout: true,
                        syncFailed: true
                    });
                }

                console.log(`✅ [AUTH] Synchronisation réussie lors du logout`);
            } catch (syncError: any) {
                console.error(`❌ [AUTH] Erreur lors de la synchronisation:`, syncError);
                memoryStorage.endSession(userId);
                return res.status(500).json({
                    success: false,
                    message: "Déconnexion effectuée mais erreur lors de la synchronisation.",
                    error: syncError.message,
                    logout: true,
                    syncFailed: true
                });
            }
        }

        // ─────────────��───────────────────────────────────────────────────────
        // 6. FERMETURE DE LA SESSION
        // ─────────────────────────────────────────────────────────────────────
        memoryStorage.endSession(userId);
        console.log(`✅ [AUTH] Déconnexion réussie pour userId: ${userId}`);

        return res.status(200).json({
            success: true,
            message: "Déconnexion réussie et données synchronisées.",
            logout: true,
            syncSuccess: true
        });
    } catch (error: unknown) {
        console.error(`❌ [AUTH] Erreur lors de la déconnexion:`, error);

        // Note: Le nettoyage de session devrait être fait avant cette erreur
        // Si on arrive ici, on ne peut plus accéder aux données du token

        return res.status(500).json({
            success: false,
            message: "Erreur lors de la déconnexion de l'utilisateur.",
            error: getErrorMessage(error) || "Une erreur inconnue s'est produite.",
            logout: false
        });
    }
}


// ═══════════════════════════════════════════════════════════════════════════
// HANDLER: VÉRIFICATION DE L'AUTHENTIFICATION
// ═══════════════════════════════════════════════════════════════════════════

export const checkAuth = (req: Request, res: Response) => {
    try {
        // ─────────────────────────────────────────────────────────────────────
        // 1. RÉCUPÉRATION DU TOKEN
        // ─────────────────────────────────────────────────────────────────────
        const token = req.cookies?.token ||
            req.headers.authorization?.split(" ")[1] ||
            req.query?.token as string ||
            req.body?.token;

        if (!token) {
            return res.status(401).json({
                authenticated: false,
                reason: 'no_token'
            });
        }

        // ─────────────────────────────────────────────────────────────────────
        // 2. VÉRIFICATION DE LA BLACKLIST
        // ─────────────────────────────────────────────────────────────────────
        if (blacklistedTokens.has(token)) {
            console.warn(`⚠️ [AUTH] Tentative d'utilisation d'un token blacklisté`);
            // Supprimer le cookie invalide
            res.clearCookie("token", clearCookieOptions);
            return res.status(401).json({
                authenticated: false,
                reason: 'token_revoked'
            });
        }

        // ─────────────────────────────────────────────────────────────────────
        // 3. VÉRIFICATION ET DÉCODAGE DU TOKEN
        // ─────────────────────────────────────────────────────────────────────
        if (!process.env.JWT_SECRET) {
            console.error('❌ [SECURITY] JWT_SECRET non défini');
            throw new Error('Configuration de sécurité manquante');
        }

        const decoded = jwt.verify(
            token,
            process.env.JWT_SECRET
        ) as { id: string; isAdmin?: boolean; iat?: number; exp?: number };

        // Vérifier l'expiration explicite
        if (decoded.exp && decoded.exp * 1000 < Date.now()) {
            console.warn(`⚠️ [AUTH] Token expiré pour userId: ${decoded.id}`);
            // Supprimer le cookie expiré
            res.clearCookie("token", clearCookieOptions);
            return res.status(401).json({
                authenticated: false,
                reason: 'token_expired'
            });
        }

        // ─────────────────────────────────────────────────────────────────────
        // 4. VÉRIFICATION DE LA SESSION (OPTIONNEL EN MODE STRICT)
        // ─────────────────────────────────────────────────────────────────────
        // Note: On peut désactiver cette vérification si trop stricte
        const requireActiveSession = process.env.REQUIRE_ACTIVE_SESSION === 'true';
        if (requireActiveSession && !memoryStorage.hasSession(decoded.id)) {
            console.warn(`⚠️ [AUTH] Pas de session active pour userId: ${decoded.id}`);
            return res.status(401).json({
                authenticated: false,
                reason: 'no_active_session'
            });
        }

        // ─────────────────────────────────────────────────────────────────────
        // 5. RÉPONSE DE SUCCÈS
        // ─────────────────────────────────────────────────────────────────────
        return res.status(200).json({
            authenticated: true,
            userId: decoded.id,
            isAdmin: decoded.isAdmin || false,
            tokenIssuedAt: decoded.iat ? new Date(decoded.iat * 1000).toISOString() : undefined
        });
    } catch (error: unknown) {
        // Supprimer le cookie invalide dans tous les cas d'erreur
        res.clearCookie("token", clearCookieOptions);

        // Distinguer les différents types d'erreurs JWT
        if (isErrorWithName(error, 'TokenExpiredError')) {
            console.warn(`⚠️ [AUTH] Token expiré`);
            return res.status(401).json({
                authenticated: false,
                reason: 'token_expired'
            });
        } else if (isErrorWithName(error, 'JsonWebTokenError')) {
            console.warn(`⚠️ [AUTH] Token invalide:`, getErrorMessage(error));
            return res.status(401).json({
                authenticated: false,
                reason: 'token_invalid'
            });
        } else {
            console.error(`❌ [AUTH] Erreur lors de la vérification du token:`, error);
            return res.status(401).json({
                authenticated: false,
                reason: 'verification_error'
            });
        }
    }
};


// NOUVEAU: Charger et déchiffrer toutes les données utilisateur (VERSION OPTIMISÉE)
export async function loadAndDecryptUserData(userId: string): Promise<void> {
    const startTime = Date.now();
    console.log(`🚀 Chargement des données de l'utilisateur ${userId}...`);

    // 1. Récupérer la clé AES utilisateur (type "user") - IGNORE les clés RSA
    let userKeyData = await KeysModel.findOne({
        userId,
        type: "user" // IMPORTANT : Chercher uniquement la clé AES, pas les clés RSA
    });

    // Si la clé AES utilisateur n'existe pas, la créer
    if (!userKeyData || !userKeyData.key) {
        console.log(`⚠️ Création d'une clé AES utilisateur pour ${userId}...`);
        const key = crypto.randomBytes(32).toString("hex");
        const cryptedKey = encrypt(key);

        // Créer une nouvelle clé AES de type "user"
        userKeyData = await KeysModel.create({
            userId: new mongoose.Types.ObjectId(userId),
            key: cryptedKey,
            type: "user", // Type "user" = clé AES pour les données
            date: new Date(),
        });
        console.log(`✅ Clé AES utilisateur créée pour ${userId}`);
    }

    // Vérifier que la clé existe avant de la déchiffrer
    if (!userKeyData || !userKeyData.key) {
        throw new Error(`Impossible de récupérer la clé AES utilisateur pour ${userId}`);
    }

    // Vérifier que ce n'est pas une clé RSA (sécurité)
    if (userKeyData.key.includes('-----BEGIN')) {
        throw new Error(`Erreur : La clé récupérée est une clé RSA, pas une clé AES utilisateur`);
    }

    // Déchiffrer la clé AES utilisateur avec la clé maître
    const userKey = decrypt(userKeyData.key);

    // 2. Initialiser la session
    memoryStorage.initSession(userId, userKey);

    // 3. Charger TOUTES les données en parallèle (au lieu de séquentiellement)
    const [points, fiches, lists] = await Promise.all([
        PointModel.find({ userId }).lean(), // .lean() pour de meilleures performances
        FicheModel.find({ userId }).lean(),
        ListModel.find({ userId }).lean()
    ]);

    console.log(`📊 Chargement de ${points.length} points, ${fiches.length} fiches, ${lists.length} listes...`);

    // 4. Déchiffrer tous les points EN PARALLÈLE
    const decryptPointsStart = Date.now();
    const decryptedPoints = await Promise.all(
        points.map(point => decryptPointOptimized(point, userKey))
    );
    console.log(`⚡ Points déchiffrés en ${Date.now() - decryptPointsStart}ms`);

    // 5. Déchiffrer toutes les fiches EN PARALLÈLE
    const decryptFichesStart = Date.now();
    const decryptedFiches = await Promise.all(
        fiches.map(fiche => decryptFicheOptimized(fiche, userKey))
    );
    console.log(`⚡ Fiches déchiffrées en ${Date.now() - decryptFichesStart}ms`);

    // 6. Stocker toutes les données déchiffrées en mémoire
    decryptedPoints.forEach(point => memoryStorage.storePoint(userId, point as any));
    decryptedFiches.forEach(fiche => memoryStorage.storeFiche(userId, fiche as any));
    lists.forEach(list => memoryStorage.storeList(userId, list as any));

    // Marquer comme synchronisé (pas de modifications à ce stade)
    memoryStorage.markAsSynced(userId);
    
    const totalTime = Date.now() - startTime;
    console.log(`✅ Données de l'utilisateur ${userId} chargées en ${totalTime}ms`);
}

// Fonction pour déchiffrer un point (VERSION OPTIMISÉE)
async function decryptPointOptimized(point: any, userKey: string) {
    try {
        // Import des fonctions optimisées
        const { decryptWithKey } = await import("../utils/userEncryptionUtils");

        // Déchiffrer les champs simples
        const name = decryptWithKey(point.name, userKey);
        const description = point.description ? decryptWithKey(point.description, userKey) : "";

        // Déchiffrer et parser les coordonnées
        let location = null;

        if (point.location_encrypted) {
            const locationJson = decryptWithKey(point.location_encrypted, userKey);
            const parsedLocation = JSON.parse(locationJson);

            // Convertir les coordonnées en nombres pour l'affichage
            location = {
                type: parsedLocation.type,
                coordinates: [
                    parseFloat(parsedLocation.coordinates[0]),
                    parseFloat(parsedLocation.coordinates[1])
                ]
            };
        }

        // Construire et retourner l'objet point déchiffré
        return {
            ...point,
            name,
            description,
            location,
            location_encrypted: point.location_encrypted // Conserver pour le rechiffrement ultérieur
        };
    } catch (error) {
        console.error("Erreur lors du déchiffrement du point:", error);
        return point;
    }
}

// Fonction pour déchiffrer une fiche (VERSION OPTIMIZÉE)
async function decryptFicheOptimized(fiche: any, userKey: string) {
    try {
        const { decryptWithKey } = await import("../utils/userEncryptionUtils");

        // Déchiffrer les champs
        const name = decryptWithKey(fiche.name, userKey);
        const ville = decryptWithKey(fiche.ville, userKey);
        const type = decryptWithKey(fiche.type, userKey);
        const etat = decryptWithKey(fiche.etat, userKey);

        // Déchiffrer les champs optionnels s'ils existent
        const difficulte_acces = fiche.difficulte_acces
            ? decryptWithKey(fiche.difficulte_acces, userKey) : undefined;
        const risque_oxygene = fiche.risque_oxygene
            ? decryptWithKey(fiche.risque_oxygene, userKey) : undefined;
        const acces_souterrain = fiche.acces_souterrain
            ? decryptWithKey(fiche.acces_souterrain, userKey) : undefined;
        const praticite_souterrain = fiche.praticite_souterrain
            ? decryptWithKey(fiche.praticite_souterrain, userKey) : undefined;
        const etat_general = fiche.etat_general
            ? decryptWithKey(fiche.etat_general, userKey) : undefined;
        const commentaire = fiche.commentaire
            ? decryptWithKey(fiche.commentaire, userKey) : '';
        // Construire l'objet fiche déchifré sans les versions chiffrées
        return {
            _id: fiche._id,
            name,
            ville,
            type,
            etat,
            difficulte_acces,
            risque_oxygene,
            acces_souterrain,
            praticite_souterrain,
            etat_general,
            commentaire,
            points_ids: fiche.points_ids,
            userId: fiche.userId,
            date_creation: fiche.date_creation,
            date_modification: fiche.date_modification,
        };
    } catch (error) {
        console.error("Erreur lors du déchiffrement de la fiche:", error);
        return fiche;
    }
}

// Anciennes fonctions conservées pour compatibilité mais dépréciées
async function decryptPoint(point: any, userId: string) {
    try {
        // Convertir userId string en ObjectId pour decryptUserKeys
        const userIdObjectId = new mongoose.Types.ObjectId(userId);

        // Déchiffrer les champs simples
        const name = await decryptUserKeys(userIdObjectId, point.name);
        const description = point.description ? await decryptUserKeys(userIdObjectId, point.description) : "";

        // Déchiffrer et parser les coordonnées
        let location = null;
        
        if (point.location_encrypted) {
            const locationJson = await decryptUserKeys(userIdObjectId, point.location_encrypted);
            const parsedLocation = JSON.parse(locationJson);
            
            // Convertir les coordonnées en nombres pour l'affichage
            location = {
                type: parsedLocation.type,
                coordinates: [
                    parseFloat(parsedLocation.coordinates[0]),
                    parseFloat(parsedLocation.coordinates[1])
                ]
            };
        }
        
        // Construire et retourner l'objet point déchiffré
        return {
            ...point.toObject(),
            name,
            description,
            location,
            location_encrypted: point.location_encrypted // Conserver pour le rechiffrement ultérieur
        };
    } catch (error) {
        console.error("Erreur lors du déchiffrement du point:", error);
        return point;
    }
}

// Fonction pour déchiffrer une fiche - version originale
async function decryptFiche(fiche: any, userId: string) {
    try {
        // Convertir userId string en ObjectId pour decryptUserKeys
        const userIdObjectId = new mongoose.Types.ObjectId(userId);

        // Déchiffrer les champs
        const name = await decryptUserKeys(userIdObjectId, fiche.name);
        const ville = await decryptUserKeys(userIdObjectId, fiche.ville);
        const type = await decryptUserKeys(userIdObjectId, fiche.type);
        const etat = await decryptUserKeys(userIdObjectId, fiche.etat);

        // Déchiffrer les champs optionnels s'ils existent
        const difficulte_acces = fiche.difficulte_acces 
            ? await decryptUserKeys(userIdObjectId, fiche.difficulte_acces) : undefined;
        const risque_oxygene = fiche.risque_oxygene
            ? await decryptUserKeys(userIdObjectId, fiche.risque_oxygene) : undefined;
        const acces_souterrain = fiche.acces_souterrain
            ? await decryptUserKeys(userIdObjectId, fiche.acces_souterrain) : undefined;
        const praticite_souterrain = fiche.praticite_souterrain
            ? await decryptUserKeys(userIdObjectId, fiche.praticite_souterrain) : undefined;
        const etat_general = fiche.etat_general
            ? await decryptUserKeys(userIdObjectId, fiche.etat_general) : undefined;

        // Construire l'objet fiche déchifré sans les versions chiffrées
        return {
            _id: fiche._id,
            name,
            ville,
            type,
            etat,
            difficulte_acces,
            risque_oxygene,
            acces_souterrain,
            praticite_souterrain,
            etat_general,
            points_ids: fiche.points_ids,
            userId: fiche.userId,
            date_creation: fiche.date_creation,
            date_modification: fiche.date_modification,
            // Vous pouvez conserver l'ID de document MongoDB pour faciliter les opérations
        };
    } catch (error) {
        console.error("Erreur lors du déchiffrement de la fiche:", error);
        return fiche;
    }
}

// Synchroniser les données de l'utilisateur vers la base de données
async function syncUserDataToDB(userId: string): Promise<void> {
    console.log(`Synchronisation des données de l'utilisateur ${userId}...`);
    
    try {
        // Récupérer toutes les données en mémoire
        const points = memoryStorage.getAllPoints(userId);
        const fiches = memoryStorage.getAllFiches(userId);
        const lists = memoryStorage.getAllLists(userId);  // Récupération des listes
        const userKey = memoryStorage.getUserEncryptionKey(userId);
        
        if (!userKey) {
            throw new Error("Clé de chiffrement non trouvée pour l'utilisateur");
        }
        
        // 1. Synchronisation des points
        
        // 1.1 Récupérer tous les points existants dans la base de données
        const allPointsInDB = await PointModel.find({ userId });
        
        // 1.2 Identifier les points à supprimer (présents dans DB mais plus en mémoire)
        const pointIdsInMemory = new Set(points.map((p: { _id: any }) => p._id.toString()));
        const pointsToDelete = allPointsInDB.filter(p => !pointIdsInMemory.has((p._id as any).toString()));
        
        // 1.3 Supprimer les points qui n'existent plus en mémoire
        for (const pointToDelete of pointsToDelete) {
            console.log(`Suppression du point ${pointToDelete._id} de la base de données`);
            // Archiver le point avant suppression (données chiffrées)
            await dataArchiveService.archiveAndRecordDeletion(
                'point',
                pointToDelete._id as mongoose.Types.ObjectId,
                pointToDelete.toObject() as unknown as Record<string, unknown>,
                userId,
                { reason: 'Synchronisation - point supprimé par utilisateur' }
            );
            await PointModel.findByIdAndDelete(pointToDelete._id);
        }
        
        // 1.4 Synchroniser les points existants
        for (const point of points) {
            // Le reste du code de synchronisation des points reste inchangé
            let pointFromDB = await PointModel.findById(point._id);

            if (!pointFromDB) {
                console.log(`Création d'un nouveau point ${point._id} pour l'utilisateur ${userId}`);
                pointFromDB = new PointModel({
                    _id: point._id,
                    userId: point.userId
                });
            }
            
            const { name, description, location_encrypted } = point;
            
            // Rechifrer les données modifiées
            if (name) {
                pointFromDB.name = await encryptUserData(userKey, name);
            }
            
            if (description) {
                pointFromDB.description = await encryptUserData(userKey, description);
            }
            
            // CORRECTION: Valider et chiffrer les coordonnées
            // Valider que les coordonnées sont présentes et valides
            if ((point as any).location &&
                Array.isArray((point as any).location.coordinates) &&
                (point as any).location.coordinates.length === 2 &&
                !isNaN((point as any).location.coordinates[0]) &&
                !isNaN((point as any).location.coordinates[1])) {
        try {
            const locationData = {
                type: "Point",
                coordinates: [
                    (point as any).location.coordinates[0].toString(),
                    (point as any).location.coordinates[1].toString()
                ]
            };
            
            // Chiffrer les données de localisation
            pointFromDB.location_encrypted = await encryptUserData(userKey, JSON.stringify(locationData));
            console.log(`Coordonnées chiffrées pour le point ${point._id}`);
        } catch (locError) {
            console.error(`Erreur lors du chiffrement des coordonnées pour le point ${point._id}:`, locError);
            return Promise.reject(
                new Error(
                    `Erreur lors du chiffrement des coordonnées: ${
                        locError && typeof locError === "object" && "message" in locError
                            ? (locError as any).message
                            : String(locError)
                    }`
                )
            );
        }
    } else if (point.location_encrypted) {
        // Si nous avons déjà une version chiffrée, l'utiliser
        pointFromDB.location_encrypted = point.location_encrypted;
    } else {
        // Si aucune coordonnée n'est fournie, utiliser des coordonnées par défaut
        try {
            const defaultLocation = {
                type: "Point",
                coordinates: ["0", "0"]
            };
            pointFromDB.location_encrypted = await encryptUserData(userKey, JSON.stringify(defaultLocation));
            console.log(`Coordonnées par défaut utilisées pour le point ${point._id}`);
        } catch (defLocError) {
            console.error(`Erreur lors de la création des coordonnées par défaut pour le point ${point._id}:`, defLocError);
            return Promise.reject(
                new Error(
                    `Erreur lors de la création des coordonnées par défaut: ${
                        defLocError && typeof defLocError === "object" && "message" in defLocError
                            ? (defLocError as any).message
                            : String(defLocError)
                    }`
                )
            );
        }
    }
            
            // IMPORTANT: Supprimer le champ location avant la sauvegarde pour éviter l'erreur MongoDB
            // MongoDB n'accepte pas { coordinates: [] } ou des coordonnées invalides
            (pointFromDB as any).location = undefined;

            // AJOUT IMPORTANT : Synchroniser le ficheId comme ObjectID ou le supprimer si nécessaire
            if ((point as any).ficheId) {
                try {
                    // Si ficheId est déjà un ObjectID, l'utiliser directement
                    if ((point as any).ficheId instanceof mongoose.Types.ObjectId) {
                        pointFromDB.ficheId = (point as any).ficheId;
                    }
                    // Si c'est une chaîne valide, la convertir en ObjectID
                    else if (mongoose.Types.ObjectId.isValid((point as any).ficheId)) {
                        pointFromDB.ficheId = new mongoose.Types.ObjectId((point as any).ficheId);
                    }
                    // Sinon, laisser tel quel (mais c'est un cas d'erreur)
                    else {
                        console.warn(`ficheId invalide pour le point ${point._id}: ${(point as any).ficheId}`);
                        pointFromDB.ficheId = (point as any).ficheId;
                    }
                    
                    console.log(`Point ${point._id} associé à la fiche ${pointFromDB.ficheId}`);
                } catch (idError) {
                    console.error(`Erreur lors de la manipulation du ficheId:`, idError);
                    // En cas d'erreur, garder la valeur originale
                    pointFromDB.ficheId = (point as any).ficheId;
                }
            } else {
                // Si ficheId est undefined/null dans la version mémoire, s'assurer qu'il est aussi null dans la BDD
                // C'est crucial pour les dissociations
                if (pointFromDB.ficheId) {
                    console.log(`Suppression de l'association entre le point ${point._id} et la fiche ${pointFromDB.ficheId}`);
                    pointFromDB.ficheId = undefined;
                }
            }
            
            // Sauvegarder le point
            await pointFromDB.save();

            console.log(`Point ${point._id} synchronisé pour l'utilisateur ${userId}`);
        }
        
        // 2. Synchronisation des fiches
        
        // 2.1 Récupérer toutes les fiches existantes dans la base de données
        const allFichesInDB = await FicheModel.find({ userId });
        
        // 2.2 Identifier les fiches à supprimer
        const ficheIdsInMemory = new Set(fiches.map(f => (f._id as mongoose.Types.ObjectId).toString()));
        const fichesToDelete = allFichesInDB.filter(f => !ficheIdsInMemory.has((f._id as mongoose.Types.ObjectId).toString()));

        // 2.3 Supprimer les fiches qui n'existent plus en mémoire
        for (const ficheToDelete of fichesToDelete) {
            console.log(`Suppression de la fiche ${ficheToDelete._id} de la base de données`);
            // Archiver la fiche avant suppression (données chiffrées)
            await dataArchiveService.archiveAndRecordDeletion(
                'fiche',
                ficheToDelete._id as mongoose.Types.ObjectId,
                ficheToDelete.toObject() as unknown as Record<string, unknown>,
                userId,
                { reason: 'Synchronisation - fiche supprimée par utilisateur' }
            );
            await FicheModel.findByIdAndDelete(ficheToDelete._id);
        }
        
        // 2.4 Synchroniser les fiches existantes
        for (const fiche of fiches) {
            // Vérifier si la fiche existe déjà dans la base de données
            let ficheFromDB = await FicheModel.findById(fiche._id);

            // Si la fiche n'existe pas, la créer
            if (!ficheFromDB) {
                console.log(`Création d'une nouvelle fiche ${fiche._id} pour l'utilisateur ${userId}`);
                ficheFromDB = new FicheModel({
                    _id: fiche._id,
                    userId: fiche.userId,
                    points_ids: fiche.points_ids,
                    date_creation: fiche.date_creation || new Date(),
                    date_modification: new Date()
                });
            }
            
            // Chiffrer toutes les données de la fiche
            ficheFromDB.name = await encryptUserData(userKey, fiche.name);
            ficheFromDB.ville = await encryptUserData(userKey, fiche.ville);
            ficheFromDB.type = await encryptUserData(userKey, fiche.type);
            ficheFromDB.etat = await encryptUserData(userKey, fiche.etat);
            
            // Chiffrer les champs optionnels s'ils existent
            if (fiche.difficulte_acces) {
                ficheFromDB.difficulte_acces = await encryptUserData(userKey, fiche.difficulte_acces);
            }
            
            if (fiche.risque_oxygene) {
                ficheFromDB.risque_oxygene = await encryptUserData(userKey, fiche.risque_oxygene);
            }
            
            if (fiche.acces_souterrain) {
                ficheFromDB.acces_souterrain = await encryptUserData(userKey, fiche.acces_souterrain);
            }
            
            if (fiche.praticite_souterrain) {
                ficheFromDB.praticite_souterrain = await encryptUserData(userKey, fiche.praticite_souterrain);
            }
            
            if (fiche.etat_general) {
                ficheFromDB.etat_general = await encryptUserData(userKey, fiche.etat_general);
            }
            
            // Chiffrer le commentaire s'il existe
            if ((fiche as any).commentaire) {
                (ficheFromDB as any).commentaire = await encryptUserData(userKey, (fiche as any).commentaire);
            } else {
                (ficheFromDB as any).commentaire = '';
            }

            ficheFromDB.points_ids = fiche.points_ids || [];

            // Journaliser pour faciliter le débogage
            console.log(`Fiche ${fiche._id}: ${ficheFromDB.points_ids.length} points synchronisés`);
            
            // Mettre à jour la date de modification
            ficheFromDB.date_modification = new Date();
            
            // Sauvegarder la fiche
            await ficheFromDB.save();


            console.log(`Fiche ${fiche._id} synchronisée pour l'utilisateur ${userId}`);
        }

        // 3.1 Récupérer toutes les listes existantes dans la base de données
        const allListsInDB = await ListModel.find({ userId });
        
        // 3.2 Identifier les listes à supprimer (présentes dans DB mais plus en mémoire)
        const listIdsInMemory = new Set(lists.map(l => (l._id as mongoose.Types.ObjectId).toString()));
        const listsToDelete = allListsInDB.filter(l => !listIdsInMemory.has((l._id as mongoose.Types.ObjectId).toString()));

        // 3.3 Supprimer les listes qui n'existent plus en mémoire
        for (const listToDelete of listsToDelete) {
            console.log(`Suppression de la liste ${listToDelete._id} de la base de données`);
            // Archiver la liste avant suppression
            await dataArchiveService.archiveAndRecordDeletion(
                'list',
                listToDelete._id as mongoose.Types.ObjectId,
                listToDelete.toObject() as unknown as Record<string, unknown>,
                userId,
                { reason: 'Synchronisation - liste supprimée par utilisateur' }
            );
            await ListModel.findByIdAndDelete(listToDelete._id);
        }
        
        // 3.4 Synchroniser les listes existantes
        for (const list of lists) {
            // Vérifier si la liste existe déjà dans la base de données
            let listFromDB = await ListModel.findById(list._id);

            // Si la liste n'existe pas, la créer
            if (!listFromDB) {
                console.log(`Création d'une nouvelle liste ${list._id} pour l'utilisateur ${userId}`);
                listFromDB = new ListModel({
                    _id: list._id,
                    userId,
                    // Utiliser les noms de champs du modèle lists.ts
                    name: list.name || "Liste sans nom", // Valeur par défaut pour éviter l'erreur de validation
                    description: list.description || "",
                    points: list.points || [], // Utiliser pointIds de la mémoire -> points du modèle
                    color: list.color || "#000000",
                    icon: list.icon || "default-icon"
                });
            } else {
                // Mettre à jour les champs existants
                listFromDB.name = list.name || "Liste sans nom";
                listFromDB.description = list.description || "";
                listFromDB.points = list.points || []; // Utiliser pointIds de la mémoire -> points du modèle
                listFromDB.color = list.color || "#000000";
                listFromDB.icon = list.icon || "default-icon";
            }
            
            // Sauvegarder la liste
            await listFromDB.save();

            console.log(`Liste ${list._id} synchronisée pour l'utilisateur ${userId} avec ${listFromDB.points.length} points`);
        }
        
        memoryStorage.markAsSynced(userId);
        console.log(`Données de l'utilisateur ${userId} synchronisées avec succès.`);
    } catch (error) {
        console.error(`Erreur lors de la synchronisation des données utilisateur ${userId}:`, error);
        throw error;
    }

}

// Fonction utilitaire pour chiffrer les données avec la clé utilisateur
// IMPORTANT: Utiliser le même algorithme et format que decryptWithKey (AES-256-GCM avec format iv:authTag:encrypted)
async function encryptUserData(userKey: string, data: string): Promise<string> {
    const { encryptWithKey } = await import("../utils/userEncryptionUtils");
    return encryptWithKey(data, userKey);
}

// Exporter la fonction de synchronisation pour l'utiliser dans d'autres contrôleurs
export { syncUserDataToDB };

// ═══════════════════════════════════════════════════════════════════════════
// HANDLER: OBTENIR UN TOKEN TEMPORAIRE POUR WEBSOCKET
// ═══════════════════════════════════════════════════════════════════════════

export const getWebSocketToken = (req: Request, res: Response) => {
    try {
        // Récupérer l'utilisateur authentifié (via le middleware authMiddleware)
        const userId = req.user?.id;

        if (!userId) {
            return res.status(401).json({
                error: 'Non authentifié'
            });
        }

        // Générer un token JWT temporaire spécifique pour WebSocket
        // Durée de vie courte : 5 minutes
        if (!process.env.JWT_SECRET) {
            console.error('❌ [SECURITY] JWT_SECRET non défini');
            throw new Error('Configuration de sécurité manquante');
        }

        // AUTH-004 CORRIGÉ: Ajout d'un JTI unique pour token à usage unique
        const tokenJti = crypto.randomBytes(16).toString('hex');

        const wsToken = jwt.sign(
            {
                id: userId,
                type: 'websocket',
                isAdmin: req.user?.isAdmin || false,
                jti: tokenJti // JTI unique pour validation à usage unique
            },
            process.env.JWT_SECRET,
            { expiresIn: '5m' } // Token valide 5 minutes
        );

        console.log(`🔑 [AUTH] Token WebSocket généré pour userId: ${userId} (jti: ${tokenJti.substring(0, 8)}..., expire dans 5min)`);

        return res.status(200).json({
            token: wsToken,
            expiresIn: 300 // 5 minutes en secondes
        });
    } catch (error: unknown) {
        console.error('❌ [AUTH] Erreur lors de la génération du token WebSocket:', error);
        return res.status(500).json({
            error: 'Erreur lors de la génération du token',
            details: getErrorMessage(error)
        });
    }
};

// ═══════════════════════════════════════════════════════════════════════════
// RÉINITIALISATION DE MOT DE PASSE
// ═══════════════════════════════════════════════════════════════════════════

import { sendPasswordResetEmail, sendPasswordChangedEmail, generateVerificationCode } from "../services/emailService";
import UserModel from "../models/users";

/**
 * Demande de réinitialisation de mot de passe
 * Envoie un email avec un code à 6 chiffres
 */
export async function handleForgotPassword(req: Request, res: Response) {
    try {
        const { email } = req.body;

        if (!email) {
            return res.status(400).json({ message: "Email requis." });
        }

        // Rechercher l'utilisateur par email
        const user = await getUserByEmail(email);

        // Réponse générique pour éviter l'énumération d'utilisateurs
        if (!user) {
            return res.status(200).json({
                message: "Si cet email est associé à un compte, un lien de réinitialisation sera envoyé."
            });
        }

        // Générer un token et un code de réinitialisation
        const resetToken = crypto.randomBytes(32).toString('hex');
        const resetCode = generateVerificationCode(6);
        const resetExpires = new Date(Date.now() + 60 * 60 * 1000); // 1 heure

        // Mettre à jour l'utilisateur
        user.reset_password_token = resetToken;
        user.reset_password_expires = resetExpires;
        // Stocker le code temporairement (on réutilise le champ token pour stocker token:code)
        user.reset_password_token = `${resetToken}:${resetCode}`;
        await user.save();

        // Récupérer les infos pour l'email
        const userName = decrypt(user.name);
        const ipAddress = req.ip || req.connection.remoteAddress || 'Inconnue';
        const deviceInfo = req.headers['user-agent'] || 'Navigateur inconnu';
        const frontendUrl = process.env.FRONTEND_URL || 'https://qvarry.com';
        const resetLink = `${frontendUrl}/?reset=${encodeURIComponent(email)}`;

        // Envoyer l'email de réinitialisation
        await sendPasswordResetEmail(
            email,
            userName,
            resetLink,
            resetCode,
            ipAddress,
            deviceInfo,
            '1 heure'
        );

        console.log(`🔐 [FORGOT-PASSWORD] Code de réinitialisation envoyé à: ${email}`);

        res.status(200).json({
            message: "Si cet email est associé à un compte, un lien de réinitialisation sera envoyé."
        });
    } catch (error: unknown) {
        console.error("❌ [FORGOT-PASSWORD] Erreur:", error);
        res.status(500).json({
            message: "Erreur lors de l'envoi de l'email de réinitialisation.",
            error: getErrorMessage(error)
        });
    }
}

/**
 * Réinitialisation du mot de passe avec le code
 */
export async function handleResetPassword(req: Request, res: Response) {
    try {
        const { email, code, newPassword } = req.body;

        if (!email || !code || !newPassword) {
            return res.status(400).json({
                message: "Email, code et nouveau mot de passe requis."
            });
        }

        // Validation du mot de passe
        if (newPassword.length < 8) {
            return res.status(400).json({
                message: "Le mot de passe doit contenir au moins 8 caractères."
            });
        }

        // Rechercher l'utilisateur
        const user = await getUserByEmail(email);

        if (!user) {
            return res.status(400).json({
                message: "Code invalide ou expiré.",
                expired: true
            });
        }

        // Vérifier que le token n'est pas expiré
        if (!user.reset_password_expires || user.reset_password_expires < new Date()) {
            return res.status(400).json({
                message: "Le code a expiré. Veuillez demander un nouveau code.",
                expired: true
            });
        }

        // Vérifier le code (stocké comme token:code)
        const [storedToken, storedCode] = (user.reset_password_token || '').split(':');
        if (storedCode !== code) {
            return res.status(400).json({
                message: "Code invalide.",
                expired: false
            });
        }

        // REM-006: Vérifier que le nouveau mot de passe n'est pas dans l'historique des 5 derniers
        const passwordHistory = user.password_history || [];
        // Inclure le mot de passe actuel dans la vérification
        const allPasswordsToCheck = [user.password, ...passwordHistory];

        const isInHistory = await isPasswordInHistory(newPassword, allPasswordsToCheck);
        if (isInHistory) {
            console.warn(`⚠️ [RESET-PASSWORD] Tentative de réutilisation d'un ancien mot de passe pour: ${email}`);
            return res.status(400).json({
                message: "Ce mot de passe a déjà été utilisé récemment. Veuillez en choisir un nouveau.",
                passwordReused: true
            });
        }

        // Hasher le nouveau mot de passe
        const hashedPassword = await bcrypt.hash(newPassword, 10);

        // REM-006: Mettre à jour l'historique des mots de passe
        const newPasswordHistory = addToPasswordHistory(user.password, passwordHistory);

        // Mettre à jour le mot de passe et effacer les tokens de reset
        user.password = hashedPassword;
        user.password_history = newPasswordHistory;
        user.reset_password_token = '';
        user.reset_password_expires = new Date(0);
        await user.save();

        // REM-007: Révoquer TOUS les tokens de l'utilisateur pour forcer la reconnexion
        const userId = (user._id as mongoose.Types.ObjectId).toString();
        const revokedCount = await refreshTokenService.revokeAllUserTokens(userId, 'password_changed');

        // Supprimer également la session Redis
        await redisSessionService.deleteSession(userId);

        console.log(`🔐 [RESET-PASSWORD] ${revokedCount} tokens révoqués pour: ${email}`);

        // Audit de la révocation
        await auditService.log({
            userId,
            action: 'PASSWORD_CHANGED',
            level: 'warning',
            ipAddress: req.ip || req.connection.remoteAddress,
            userAgent: req.headers['user-agent'],
            details: {
                tokensRevoked: revokedCount,
                passwordHistoryUpdated: true
            }
        });

        // Envoyer un email de confirmation
        const userName = decrypt(user.name);
        const ipAddress = req.ip || req.connection.remoteAddress || 'Inconnue';
        const deviceInfo = req.headers['user-agent'] || 'Navigateur inconnu';

        await sendPasswordChangedEmail(email, userName, ipAddress, deviceInfo);

        console.log(`✅ [RESET-PASSWORD] Mot de passe réinitialisé pour: ${email}`);

        res.status(200).json({
            message: "Mot de passe réinitialisé avec succès ! Vous pouvez maintenant vous connecter.",
            success: true
        });
    } catch (error: unknown) {
        console.error("❌ [RESET-PASSWORD] Erreur:", error);
        res.status(500).json({
            message: "Erreur lors de la réinitialisation du mot de passe.",
            error: getErrorMessage(error)
        });
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// HANDLER: COMPLÉTER LE LOGIN APRÈS VÉRIFICATION 2FA
// ═══════════════════════════════════════════════════════════════════════════
export async function completeLoginAfter2FA(req: Request, res: Response) {
    try {
        const { userId } = req.body;

        if (!userId) {
            return res.status(400).json({ error: "userId requis" });
        }

        const user = await UserModel.findById(userId);
        if (!user) {
            return res.status(404).json({ error: "Utilisateur non trouvé" });
        }

        // Générer les tokens
        const { token, tokenId } = generateSecureToken(userId, user.is_admin || false);

        // Métadonnées de sécurité
        const ipAddress = req.ip || req.connection.remoteAddress;
        const userAgent = req.headers['user-agent'];
        // SÉCURITÉ: Calcul du fingerprint côté serveur (évite manipulation client)
        const deviceFingerprint = generateDeviceFingerprint(req);

        // Créer le refresh token en base de données
        const refreshToken = await refreshTokenService.createRefreshToken({
            userId,
            tokenId,
            ipAddress,
            userAgent,
            deviceFingerprint
        });

        // Configuration des cookies
        // Cookie pour le JWT
        res.cookie("token", token, getJwtCookieOptions());

        // Cookie pour le refresh token
        res.cookie("refreshToken", refreshToken, getRefreshTokenCookieOptions());

        // Charger les données utilisateur
        await loadAndDecryptUserData(userId);

        // Créer la session
        sessionService.createSession(userId, ipAddress, userAgent);

        // Stocker le JTI
        const jwtExpiresInSeconds = parseInt(process.env.JWT_EXPIRES_IN?.replace(/[^0-9]/g, '') || '15') * 60;
        await redisSessionService.storeSessionJti(userId, tokenId, jwtExpiresInSeconds);

        await auditService.log({
            userId,
            action: 'LOGIN_SUCCESS_2FA',
            level: 'info',
            ipAddress,
            userAgent,
            details: { tokenId, method: '2fa' }
        });

        console.log(`✅ [AUTH] Connexion 2FA réussie pour ${userId}`);

        return res.status(200).json({
            login: true,
            userId,
            email: user.email,
            sessionCreated: new Date().toISOString(),
            tokenExpiresIn: getCookieConfig().jwtMaxAgeMinutes * 60
        });

    } catch (error: unknown) {
        console.error("❌ [AUTH] Erreur lors de la finalisation du login 2FA:", error);
        return res.status(500).json({ error: "Erreur lors de la connexion" });
    }
}

