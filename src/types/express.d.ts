// server/src/types/express.d.ts
// Extension globale des types Express pour l'authentification et le logging

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        isAdmin: boolean;
        tokenIssuedAt?: number;
        tokenId?: string;
        clientType?: "web" | "mobile";
      };
      correlationId?: string;
      id?: string; // Request ID / Correlation ID (alias pour requestIdMiddleware)
    }
  }
}

export {};
