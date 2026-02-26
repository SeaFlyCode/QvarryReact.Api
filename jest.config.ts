import type { Config } from "@jest/types";

const config: Config.InitialOptions = {
  // Utilise ts-jest pour compiler TypeScript
  preset: "ts-jest",

  // Environnement de test Node.js
  testEnvironment: "node",

  // Racine des tests
  roots: ["<rootDir>/src"],

  // Patterns pour identifier les fichiers de test
  testMatch: [
    "**/__tests__/**/*.test.ts",
    "**/__tests__/**/*.spec.ts",
    "**/*.test.ts",
    "**/*.spec.ts",
  ],

  // Extensions de fichiers à traiter
  moduleFileExtensions: ["ts", "js", "json"],

  // Fichier de setup global exécuté après l'environnement de test
  setupFilesAfterEnv: ["<rootDir>/src/__tests__/setup.ts"],

  // Configuration de la couverture de code
  collectCoverageFrom: [
    "src/**/*.ts",
    "!src/**/*.d.ts",
    "!src/**/*.test.ts",
    "!src/**/*.spec.ts",
    "!src/__tests__/**",
    "!src/server.ts",
    "!src/test-logger.ts",
  ],

  coverageDirectory: "coverage",

  coverageReporters: ["text", "lcov", "html", "json"],

  coverageThreshold: {
    global: {
      branches: 50,
      functions: 50,
      lines: 50,
      statements: 50,
    },
  },

  // Configuration du transformer TypeScript
  transform: {
    "^.+\\.ts$": [
      "ts-jest",
      {
        tsconfig: {
          target: "ES2020",
          module: "CommonJS",
          lib: ["ES2020"],
          strict: false,
          esModuleInterop: true,
          skipLibCheck: true,
          forceConsistentCasingInFileNames: true,
          resolveJsonModule: true,
          moduleResolution: "node",
          allowSyntheticDefaultImports: true,
          types: ["node", "jest"],
        },
        isolatedModules: false,
        diagnostics: {
          warnOnly: true,
        },
      },
    ],
  },

  // Configuration supplémentaire
  verbose: true,
  clearMocks: true,
  resetMocks: true,
  restoreMocks: true,

  // Timeout par défaut des tests (10 secondes)
  testTimeout: 10000,

  // Ignore les dépendances dans node_modules sauf si nécessaire
  transformIgnorePatterns: ["node_modules/(?!(module-to-transform)/)"],
};

export default config;
