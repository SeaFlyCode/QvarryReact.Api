// ═══════════════════════════════════════════════════════════════════════════
// MIDDLEWARE DE VÉRIFICATION CLOUDFLARE TURNSTILE
// ═══════════════════════════════════════════════════════════════════════════
// Documentation: https://developers.cloudflare.com/turnstile/get-started/server-side-validation/
// ═══════════════════════════════════════════════════════════════════════════

import { Request, Response, NextFunction } from 'express';

interface TurnstileResponse {
    success: boolean;
    'error-codes'?: string[];
    challenge_ts?: string;
    hostname?: string;
    action?: string;
    cdata?: string;
}

const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/**
 * Middleware pour vérifier le token Cloudflare Turnstile
 * Le token doit être envoyé dans le body sous le nom 'cf-turnstile-response' ou 'turnstileToken'
 */
export const verifyTurnstile = async (req: Request, res: Response, next: NextFunction) => {
    // Récupérer la clé secrète depuis les variables d'environnement
    const secretKey = process.env.TURNSTILE_SECRET_KEY;

    if (!secretKey) {
        // En développement, on peut bypasser si pas de clé configurée
        if (process.env.NODE_ENV !== 'production') {
            console.warn('⚠️ [TURNSTILE] Clé secrète non configurée - bypass en développement');
            return next();
        }
        console.error('❌ [TURNSTILE] TURNSTILE_SECRET_KEY non définie');
        return res.status(500).json({
            error: 'Configuration du serveur incomplète',
            code: 'CAPTCHA_CONFIG_ERROR'
        });
    }

    // Récupérer le token du body (plusieurs noms possibles)
    const token = req.body['cf-turnstile-response'] || req.body.turnstileToken || req.body.captchaToken;

    if (!token) {
        console.warn(`⚠️ [TURNSTILE] Token manquant depuis ${req.ip}`);
        return res.status(400).json({
            error: 'Veuillez compléter la vérification anti-robot',
            code: 'CAPTCHA_MISSING'
        });
    }

    try {
        // Préparer les données pour la vérification
        const formData = new URLSearchParams();
        formData.append('secret', secretKey);
        formData.append('response', token);

        // Ajouter l'IP du client (optionnel mais recommandé)
        const clientIp = req.ip || req.connection.remoteAddress;
        if (clientIp) {
            formData.append('remoteip', clientIp);
        }

        // Appeler l'API Cloudflare pour vérifier le token
        const response = await fetch(TURNSTILE_VERIFY_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: formData.toString(),
        });

        const result = await response.json() as TurnstileResponse;

        if (result.success) {
            // Token valide, continuer
            console.log(`✅ [TURNSTILE] Vérification réussie pour ${req.ip}`);
            return next();
        } else {
            // Token invalide
            const errorCodes = result['error-codes'] || ['unknown-error'];
            console.warn(`⚠️ [TURNSTILE] Vérification échouée pour ${req.ip}: ${errorCodes.join(', ')}`);

            // Mapper les codes d'erreur Cloudflare vers des messages utilisateur
            const errorMessage = mapTurnstileError(errorCodes);

            return res.status(400).json({
                error: errorMessage,
                code: 'CAPTCHA_FAILED',
                details: process.env.NODE_ENV === 'development' ? errorCodes : undefined
            });
        }
    } catch (error) {
        console.error('❌ [TURNSTILE] Erreur lors de la vérification:', error);

        // En cas d'erreur réseau, on peut choisir de laisser passer ou bloquer
        // Ici on bloque par sécurité
        return res.status(503).json({
            error: 'Service de vérification temporairement indisponible',
            code: 'CAPTCHA_SERVICE_ERROR'
        });
    }
};

/**
 * Mappe les codes d'erreur Turnstile vers des messages utilisateur
 */
function mapTurnstileError(errorCodes: string[]): string {
    const errorMap: Record<string, string> = {
        'missing-input-secret': 'Erreur de configuration du serveur',
        'invalid-input-secret': 'Erreur de configuration du serveur',
        'missing-input-response': 'Veuillez compléter la vérification anti-robot',
        'invalid-input-response': 'La vérification a échoué, veuillez réessayer',
        'bad-request': 'Requête invalide',
        'timeout-or-duplicate': 'La vérification a expiré, veuillez réessayer',
        'internal-error': 'Erreur du service de vérification',
    };

    for (const code of errorCodes) {
        if (errorMap[code]) {
            return errorMap[code];
        }
    }

    return 'La vérification anti-robot a échoué';
}

/**
 * Version optionnelle du middleware qui ne bloque pas si le captcha échoue
 * Utile pour les environnements de test
 */
export const verifyTurnstileOptional = async (req: Request, res: Response, next: NextFunction) => {
    // Si pas de clé configurée ou en mode test, bypass
    if (!process.env.TURNSTILE_SECRET_KEY || process.env.BYPASS_CAPTCHA === 'true') {
        return next();
    }

    return verifyTurnstile(req, res, next);
};

export default verifyTurnstile;
