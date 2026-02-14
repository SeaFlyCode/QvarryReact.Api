import { Request, Response } from "express";
import speakeasy from "speakeasy";
import QRCode from "qrcode";
import bcrypt from "bcrypt";
import crypto from "crypto";
import UserModel from "../models/users";
import { encrypt, decrypt } from "../utils/masterEncryptionUtils";
import { auditService } from "../services/auditService";

// ═══════════════════════════════════════════════════════════════════════════
// AUTHENTIFICATION À DEUX FACTEURS (2FA/TOTP)
// ═══════════════════════════════════════════════════════════════════════════
// Implémentation TOTP conforme RFC 6238
// Compatible avec Google Authenticator, Authy, 1Password, etc.
// ═══════════════════════════════════════════════════════════════════════════

const APP_NAME = process.env.APP_NAME || "Qvarry";
const RECOVERY_CODES_COUNT = 10;

// ─────────────────────────────────────────────────────────────────────────
// GÉNÉRER LES CODES DE RÉCUPÉRATION
// ─────────────────────────────────────────────────────────────────────────
function generateRecoveryCodes(): string[] {
    const codes: string[] = [];
    for (let i = 0; i < RECOVERY_CODES_COUNT; i++) {
        // Format: XXXX-XXXX-XXXX (12 caractères alphanumériques)
        const code = crypto.randomBytes(9).toString('base64')
            .replace(/[^a-zA-Z0-9]/g, '')
            .substring(0, 12)
            .toUpperCase();
        const formattedCode = `${code.slice(0, 4)}-${code.slice(4, 8)}-${code.slice(8, 12)}`;
        codes.push(formattedCode);
    }
    return codes;
}

// ─────────────────────────────────────────────────────────────────────────
// HASHER LES CODES DE RÉCUPÉRATION
// ─────────────────────────────────────────────────────────────────────────
async function hashRecoveryCodes(codes: string[]): Promise<string[]> {
    const hashedCodes: string[] = [];
    for (const code of codes) {
        const hash = await bcrypt.hash(code.replace(/-/g, ''), 10);
        hashedCodes.push(hash);
    }
    return hashedCodes;
}

// ═══════════════════════════════════════════════════════════════════════════
// SETUP 2FA - Générer le secret et le QR Code
// ═══════════════════════════════════════════════════════════════════════════
export async function setupTwoFactor(req: Request, res: Response): Promise<Response> {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({ error: "Non authentifié" });
        }

        const user = await UserModel.findById(userId).select('email two_factor_enabled two_factor_secret');
        if (!user) {
            return res.status(404).json({ error: "Utilisateur non trouvé" });
        }

        // Si 2FA déjà activé, empêcher la régénération
        if (user.two_factor_enabled) {
            return res.status(400).json({
                error: "L'authentification à deux facteurs est déjà activée. Désactivez-la d'abord pour la reconfigurer."
            });
        }

        // Générer un nouveau secret TOTP
        const secret = speakeasy.generateSecret({
            name: `${APP_NAME} (${decrypt(user.email)})`,
            length: 32, // 256 bits
        });

        if (!secret.base32 || !secret.otpauth_url) {
            return res.status(500).json({ error: "Erreur lors de la génération du secret 2FA" });
        }

        // Chiffrer et stocker temporairement le secret (non confirmé)
        const encryptedSecret = encrypt(secret.base32);
        user.two_factor_secret = encryptedSecret;
        await user.save();

        // Générer le QR Code
        const qrCodeDataUrl = await QRCode.toDataURL(secret.otpauth_url);

        console.log(`🔐 [2FA] Setup initié pour l'utilisateur ${userId}`);

        await auditService.log({
            userId,
            action: '2FA_SETUP_INITIATED',
            level: 'info',
            ipAddress: req.ip || req.socket.remoteAddress,
            userAgent: req.headers['user-agent'],
            details: {}
        });

        return res.status(200).json({
            success: true,
            qrCode: qrCodeDataUrl,
            secret: secret.base32, // Afficher le secret pour saisie manuelle
            message: "Scannez le QR code avec votre application d'authentification"
        });

    } catch (error) {
        console.error("❌ [2FA] Erreur setup:", error);
        return res.status(500).json({ error: "Erreur lors de la configuration de la 2FA" });
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// VÉRIFIER ET ACTIVER 2FA
// ═══════════════════════════════════════════════════════════════════════════
export async function verifyAndEnableTwoFactor(req: Request, res: Response): Promise<Response> {
    try {
        const userId = req.user?.id;
        const { code } = req.body;

        if (!userId) {
            return res.status(401).json({ error: "Non authentifié" });
        }

        if (!code || typeof code !== 'string' || code.length !== 6) {
            return res.status(400).json({ error: "Code de vérification invalide (6 chiffres requis)" });
        }

        const user = await UserModel.findById(userId);
        if (!user) {
            return res.status(404).json({ error: "Utilisateur non trouvé" });
        }

        if (user.two_factor_enabled) {
            return res.status(400).json({ error: "La 2FA est déjà activée" });
        }

        if (!user.two_factor_secret) {
            return res.status(400).json({ error: "Aucune configuration 2FA en attente. Initiez d'abord la configuration." });
        }

        // Déchiffrer le secret et vérifier le code
        const decryptedSecret = decrypt(user.two_factor_secret);
        const isValid = speakeasy.totp.verify({
            secret: decryptedSecret,
            encoding: 'base32',
            token: code,
            window: 1 // Permet ±30 secondes de décalage
        });

        if (!isValid) {
            await auditService.log({
                userId,
                action: '2FA_VERIFY_FAILED',
                level: 'warning',
                ipAddress: req.ip || req.socket.remoteAddress,
                userAgent: req.headers['user-agent'],
                details: { reason: 'invalid_code' }
            });
            return res.status(400).json({ error: "Code invalide. Vérifiez que l'heure de votre téléphone est correcte." });
        }

        // Générer les codes de récupération
        const recoveryCodes = generateRecoveryCodes();
        const hashedRecoveryCodes = await hashRecoveryCodes(recoveryCodes);

        // Activer la 2FA
        user.two_factor_enabled = true;
        user.two_factor_confirmed_at = new Date();
        user.two_factor_recovery_codes = hashedRecoveryCodes;
        await user.save();

        console.log(`✅ [2FA] Activé pour l'utilisateur ${userId}`);

        await auditService.log({
            userId,
            action: '2FA_ENABLED',
            level: 'info',
            ipAddress: req.ip || req.socket.remoteAddress,
            userAgent: req.headers['user-agent'],
            details: {}
        });

        return res.status(200).json({
            success: true,
            message: "Authentification à deux facteurs activée avec succès",
            recoveryCodes // Les afficher une seule fois !
        });

    } catch (error) {
        console.error("❌ [2FA] Erreur vérification:", error);
        return res.status(500).json({ error: "Erreur lors de l'activation de la 2FA" });
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// DÉSACTIVER 2FA
// ═══════════════════════════════════════════════════════════════════════════
export async function disableTwoFactor(req: Request, res: Response): Promise<Response> {
    try {
        const userId = req.user?.id;
        const { password, code } = req.body;

        if (!userId) {
            return res.status(401).json({ error: "Non authentifié" });
        }

        if (!password) {
            return res.status(400).json({ error: "Mot de passe requis pour désactiver la 2FA" });
        }

        const user = await UserModel.findById(userId);
        if (!user) {
            return res.status(404).json({ error: "Utilisateur non trouvé" });
        }

        if (!user.two_factor_enabled) {
            return res.status(400).json({ error: "La 2FA n'est pas activée" });
        }

        // Vérifier le mot de passe
        const bcrypt = await import("bcrypt");
        const isPasswordValid = await bcrypt.compare(password, user.password);
        if (!isPasswordValid) {
            await auditService.log({
                userId,
                action: '2FA_DISABLE_FAILED',
                level: 'warning',
                ipAddress: req.ip || req.socket.remoteAddress,
                userAgent: req.headers['user-agent'],
                details: { reason: 'invalid_password' }
            });
            return res.status(401).json({ error: "Mot de passe incorrect" });
        }

        // Vérifier le code 2FA ou un code de récupération
        if (code) {
            const decryptedSecret = decrypt(user.two_factor_secret!);
            const isValidTotp = speakeasy.totp.verify({
                secret: decryptedSecret,
                encoding: 'base32',
                token: code,
                window: 1
            });

            if (!isValidTotp) {
                // Essayer comme code de récupération
                const codeNormalized = code.replace(/-/g, '').toUpperCase();
                let recoveryCodeUsed = false;

                for (let i = 0; i < user.two_factor_recovery_codes!.length; i++) {
                    const isMatch = await bcrypt.compare(codeNormalized, user.two_factor_recovery_codes![i]);
                    if (isMatch) {
                        recoveryCodeUsed = true;
                        break;
                    }
                }

                if (!recoveryCodeUsed) {
                    return res.status(400).json({ error: "Code 2FA ou code de récupération invalide" });
                }
            }
        }

        // Désactiver la 2FA
        user.two_factor_enabled = false;
        user.two_factor_secret = undefined;
        user.two_factor_confirmed_at = undefined;
        user.two_factor_recovery_codes = [];
        await user.save();

        console.log(`🔓 [2FA] Désactivé pour l'utilisateur ${userId}`);

        await auditService.log({
            userId,
            action: '2FA_DISABLED',
            level: 'info',
            ipAddress: req.ip || req.socket.remoteAddress,
            userAgent: req.headers['user-agent'],
            details: {}
        });

        return res.status(200).json({
            success: true,
            message: "Authentification à deux facteurs désactivée"
        });

    } catch (error) {
        console.error("❌ [2FA] Erreur désactivation:", error);
        return res.status(500).json({ error: "Erreur lors de la désactivation de la 2FA" });
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// VÉRIFIER CODE 2FA (pendant le login)
// ═══════════════════════════════════════════════════════════════════════════
export async function verifyTwoFactorLogin(req: Request, res: Response): Promise<Response> {
    try {
        const { userId, code, isRecoveryCode } = req.body;

        if (!userId || !code) {
            return res.status(400).json({ error: "userId et code requis" });
        }

        const user = await UserModel.findById(userId);
        if (!user) {
            return res.status(404).json({ error: "Utilisateur non trouvé" });
        }

        if (!user.two_factor_enabled || !user.two_factor_secret) {
            return res.status(400).json({ error: "2FA non activée pour cet utilisateur" });
        }

        if (isRecoveryCode) {
            // Vérifier comme code de récupération
            const codeNormalized = code.replace(/-/g, '').toUpperCase();
            let recoveryCodeIndex = -1;

            for (let i = 0; i < user.two_factor_recovery_codes!.length; i++) {
                const isMatch = await bcrypt.compare(codeNormalized, user.two_factor_recovery_codes![i]);
                if (isMatch) {
                    recoveryCodeIndex = i;
                    break;
                }
            }

            if (recoveryCodeIndex === -1) {
                await auditService.log({
                    userId,
                    action: '2FA_LOGIN_FAILED',
                    level: 'warning',
                    ipAddress: req.ip || req.socket.remoteAddress,
                    userAgent: req.headers['user-agent'],
                    details: { reason: 'invalid_recovery_code' }
                });
                return res.status(400).json({ error: "Code de récupération invalide" });
            }

            // Supprimer le code utilisé
            user.two_factor_recovery_codes!.splice(recoveryCodeIndex, 1);
            await user.save();

            await auditService.log({
                userId,
                action: '2FA_RECOVERY_CODE_USED',
                level: 'warning',
                ipAddress: req.ip || req.socket.remoteAddress,
                userAgent: req.headers['user-agent'],
                details: { remainingCodes: user.two_factor_recovery_codes!.length }
            });

            console.log(`⚠️ [2FA] Code de récupération utilisé pour ${userId}, ${user.two_factor_recovery_codes!.length} restants`);
        } else {
            // Vérifier comme code TOTP normal
            const decryptedSecret = decrypt(user.two_factor_secret);
            const isValid = speakeasy.totp.verify({
                secret: decryptedSecret,
                encoding: 'base32',
                token: code,
                window: 1
            });

            if (!isValid) {
                await auditService.log({
                    userId,
                    action: '2FA_LOGIN_FAILED',
                    level: 'warning',
                    ipAddress: req.ip || req.socket.remoteAddress,
                    userAgent: req.headers['user-agent'],
                    details: { reason: 'invalid_totp' }
                });
                return res.status(400).json({ error: "Code invalide" });
            }
        }

        await auditService.log({
            userId,
            action: '2FA_LOGIN_SUCCESS',
            level: 'info',
            ipAddress: req.ip || req.socket.remoteAddress,
            userAgent: req.headers['user-agent'],
            details: { method: isRecoveryCode ? 'recovery_code' : 'totp' }
        });

        return res.status(200).json({
            success: true,
            verified: true
        });

    } catch (error) {
        console.error("❌ [2FA] Erreur vérification login:", error);
        return res.status(500).json({ error: "Erreur lors de la vérification 2FA" });
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// RÉGÉNÉRER LES CODES DE RÉCUPÉRATION
// ═══════════════════════════════════════════════════════════════════════════
export async function regenerateRecoveryCodes(req: Request, res: Response): Promise<Response> {
    try {
        const userId = req.user?.id;
        const { password } = req.body;

        if (!userId) {
            return res.status(401).json({ error: "Non authentifié" });
        }

        if (!password) {
            return res.status(400).json({ error: "Mot de passe requis" });
        }

        const user = await UserModel.findById(userId);
        if (!user) {
            return res.status(404).json({ error: "Utilisateur non trouvé" });
        }

        if (!user.two_factor_enabled) {
            return res.status(400).json({ error: "La 2FA n'est pas activée" });
        }

        // Vérifier le mot de passe
        const isPasswordValid = await bcrypt.compare(password, user.password);
        if (!isPasswordValid) {
            return res.status(401).json({ error: "Mot de passe incorrect" });
        }

        // Générer de nouveaux codes
        const recoveryCodes = generateRecoveryCodes();
        const hashedRecoveryCodes = await hashRecoveryCodes(recoveryCodes);

        user.two_factor_recovery_codes = hashedRecoveryCodes;
        await user.save();

        console.log(`🔄 [2FA] Codes de récupération régénérés pour ${userId}`);

        await auditService.log({
            userId,
            action: '2FA_RECOVERY_CODES_REGENERATED',
            level: 'info',
            ipAddress: req.ip || req.socket.remoteAddress,
            userAgent: req.headers['user-agent'],
            details: {}
        });

        return res.status(200).json({
            success: true,
            recoveryCodes,
            message: "Nouveaux codes de récupération générés. Conservez-les en lieu sûr."
        });

    } catch (error) {
        console.error("❌ [2FA] Erreur régénération codes:", error);
        return res.status(500).json({ error: "Erreur lors de la régénération des codes" });
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// OBTENIR LE STATUT 2FA
// ═══════════════════════════════════════════════════════════════════════════
export async function getTwoFactorStatus(req: Request, res: Response): Promise<Response> {
    try {
        const userId = req.user?.id;

        if (!userId) {
            return res.status(401).json({ error: "Non authentifié" });
        }

        const user = await UserModel.findById(userId).select('two_factor_enabled two_factor_confirmed_at two_factor_recovery_codes');
        if (!user) {
            return res.status(404).json({ error: "Utilisateur non trouvé" });
        }

        return res.status(200).json({
            enabled: user.two_factor_enabled,
            confirmedAt: user.two_factor_confirmed_at,
            recoveryCodesRemaining: user.two_factor_recovery_codes?.length || 0
        });

    } catch (error) {
        console.error("❌ [2FA] Erreur statut:", error);
        return res.status(500).json({ error: "Erreur lors de la récupération du statut 2FA" });
    }
}
