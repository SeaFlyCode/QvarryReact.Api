/**
 * scripts/export-openapi.ts
 *
 * Vague 6 Niveau 1 — dump la spec OpenAPI vers `openapi.json` à la racine du
 * repo. Ce fichier sert de SSOT (single source of truth) pour le codegen
 * `openapi-typescript` côté mobile et web. Pas besoin du serveur Express up.
 *
 * Usage :
 *   npx ts-node scripts/export-openapi.ts
 *
 * Output : openapi.json à la racine du repo (commité).
 *
 * Workflow attendu : à régénérer après toute modification des annotations
 * @swagger dans src/routes/*. Les clients régénèrent ensuite leurs types
 * via `npm run codegen:api`.
 */

import * as fs from "fs";
import * as path from "path";
import { swaggerSpec } from "../src/config/swagger";

const OUTPUT_PATH = path.resolve(process.cwd(), "openapi.json");

const spec = swaggerSpec as unknown as { paths?: Record<string, unknown> };
const paths = Object.keys(spec.paths || {});
const operations = paths.reduce((acc, p) => {
  const ops = spec.paths?.[p] as Record<string, unknown> | undefined;
  if (!ops) return acc;
  return acc + Object.keys(ops).filter((k) =>
    ["get", "post", "put", "patch", "delete"].includes(k),
  ).length;
}, 0);

fs.writeFileSync(OUTPUT_PATH, JSON.stringify(spec, null, 2));

console.log(`✓ OpenAPI spec exportée : ${OUTPUT_PATH}`);
console.log(`  ${paths.length} paths / ${operations} opérations`);
