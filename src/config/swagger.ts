import swaggerJsdoc from "swagger-jsdoc";
import swaggerUi from "swagger-ui-express";
import { Express, Request, Response, NextFunction } from "express";
import { logger } from "../services/loggerService";

const swaggerLogger = logger.child({ service: "swagger" });

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "Qvarry API",
      version: "1.0.0",
      description: "Documentation de l'API Qvarry React",
      contact: {
        name: "Qvarry Team",
      },
    },
    servers: [
      {
        url: "http://localhost:3000/api",
        description: "Serveur de développement",
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
          description: "Token JWT d'authentification",
        },
        cookieAuth: {
          type: "apiKey",
          in: "cookie",
          name: "accessToken",
          description: "Token JWT dans le cookie",
        },
      },
    },
    security: [{ bearerAuth: [] }, { cookieAuth: [] }],
    tags: [
      { name: "Auth", description: "Authentification et gestion des sessions" },
      { name: "Users", description: "Gestion des utilisateurs" },
      { name: "2FA", description: "Authentification à deux facteurs" },
      { name: "Points", description: "Gestion des points géographiques" },
      { name: "Fiches", description: "Gestion des fiches" },
      { name: "Lists", description: "Gestion des listes" },
      { name: "Contacts", description: "Gestion des contacts" },
      { name: "Messages", description: "Messagerie" },
      { name: "Conversations", description: "Gestion des conversations" },
      { name: "Notifications", description: "Notifications utilisateur" },
      { name: "DataShare", description: "Partage de données" },
      { name: "Security", description: "Sécurité et audit" },
      { name: "Admin", description: "Administration" },
      { name: "Maintenance", description: "Mode maintenance" },
      { name: "Mobile Auth", description: "Authentification mobile" },
      { name: "Mobile Sync", description: "Synchronisation mobile" },
      { name: "Mobile 2FA", description: "2FA mobile" },
    ],
  },
  // Chemins vers les fichiers contenant les annotations JSDoc
  apis: ["./src/routes/*.ts", "./src/controllers/*.ts", "./src/models/*.ts"],
};

/**
 * Génère la spec Swagger à la demande (hot-reload)
 */
const generateSwaggerSpec = () => swaggerJsdoc(options);

// Spec initiale
let swaggerSpec = generateSwaggerSpec();

/**
 * Configure Swagger UI pour l'application Express
 * En mode développement, la spec est rechargée à chaque requête
 * @param app - Instance Express
 */
export const setupSwagger = (app: Express): void => {
  // Middleware pour rafraîchir la spec à chaque requête (hot-reload en dev)
  const refreshSwaggerSpec = (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    // Régénérer la spec à chaque requête pour capturer les nouvelles annotations
    swaggerSpec = generateSwaggerSpec();
    (req as any).swaggerDoc = swaggerSpec;
    next();
  };

  // Route pour accéder à la documentation Swagger UI avec hot-reload
  app.use(
    "/api-docs",
    refreshSwaggerSpec,
    swaggerUi.serveFiles(undefined, {
      swaggerOptions: { url: "/api-docs.json" },
    }),
    swaggerUi.setup(undefined, {
      explorer: true,
      customCss: ".swagger-ui .topbar { display: none }",
      customSiteTitle: "Qvarry API Documentation",
      swaggerOptions: {
        url: "/api-docs.json", // Charge le JSON dynamiquement
        persistAuthorization: true, // Garde le token entre les refreshs
        docExpansion: "none", // Collapse toutes les sections par défaut
        filter: true, // Active la recherche
        showRequestDuration: true, // Affiche la durée des requêtes
      },
    }),
  );

  // Route pour obtenir le JSON de la spec OpenAPI (rechargé à chaque fois)
  app.get("/api-docs.json", (req, res) => {
    // Régénérer pour avoir les dernières modifications
    const freshSpec = generateSwaggerSpec();
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.send(freshSpec);
  });

  swaggerLogger.info("Swagger UI available on http://localhost:3000/api-docs");
  swaggerLogger.info("Hot-reload enabled: documentation updates automatically");
};

export { swaggerSpec };
