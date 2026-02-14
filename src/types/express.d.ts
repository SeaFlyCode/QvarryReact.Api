// server/src/types/express.d.ts
// Extension globale des types Express pour l'authentification

declare global {
    namespace Express {
        interface Request {
            user?: {
                id: string;
                isAdmin: boolean;
                tokenIssuedAt?: number;
                tokenId?: string;
            };
        }
    }
}

export {};
