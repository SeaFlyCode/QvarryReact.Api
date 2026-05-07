/**
 * Helper de test : mock un chainable Mongoose Query.
 *
 * Cf. REFONTE V7 — la classe la plus fréquente de fails sur le backend
 * provient de mocks chainables incomplets (`find().select().lean()` qui
 * retourne `undefined` parce qu'un maillon manque).
 *
 * Usage :
 *   import { chainableQuery } from "../utils/chainableQuery";
 *
 *   (FicheModel.find as jest.Mock).mockReturnValue(
 *     chainableQuery([{ _id: "abc", name: "test" }]),
 *   );
 *
 *   // Le code peut chaîner :
 *   //   .find().select().sort().limit().setOptions().lean()
 *   //   .find().populate().lean()
 *   //   .find().exec()
 *   // Tous renvoient le même objet chainable, le terminal résout `data`.
 *
 * Helpers terminal supportés (résolvent `data`) :
 *   - lean(): Promise<data>
 *   - exec(): Promise<data>
 *   - then(cb): Promise (pour `await query`)
 *
 * Helpers chainable (retournent `this`) :
 *   - select, sort, limit, skip, populate, where, in, gt, gte, lt, lte, ne,
 *     equals, setOptions, hint, lean (en mode chain), countDocuments
 *
 * Si tu as besoin d'un terminal qui retourne autre chose que `data`,
 * fournir `terminals` :
 *   chainableQuery([], { terminals: { count: 42 } })
 */
export function chainableQuery<T>(
  data: T,
  options: { terminals?: Record<string, any> } = {},
): any {
  const chain: any = {};

  const chainMethods = [
    "select",
    "sort",
    "limit",
    "skip",
    "populate",
    "where",
    "in",
    "gt",
    "gte",
    "lt",
    "lte",
    "ne",
    "equals",
    "setOptions",
    "hint",
    "session",
    "collation",
    "explain",
    "maxTimeMS",
    "comment",
  ];

  for (const m of chainMethods) {
    chain[m] = jest.fn(() => chain);
  }

  // Terminals : par défaut résolvent `data`. Surcharge via options.terminals.
  const terminals = {
    lean: data,
    exec: data,
    ...(options.terminals || {}),
  };

  for (const [name, value] of Object.entries(terminals)) {
    chain[name] = jest.fn(() => Promise.resolve(value));
  }

  // `then` permet `await query` directement
  chain.then = (resolve: (v: T) => any, reject?: (e: any) => any) =>
    Promise.resolve(data).then(resolve, reject);

  return chain;
}

/**
 * Variante : mock un chainable qui throw au terminal (pour tester le rollback /
 * gestion d'erreur).
 *
 *   (FicheModel.find as jest.Mock).mockReturnValue(
 *     chainableQueryRejecting(new Error("Mongo down")),
 *   );
 */
export function chainableQueryRejecting(error: Error): any {
  const chain: any = {};

  const chainMethods = [
    "select", "sort", "limit", "skip", "populate", "where", "in",
    "gt", "gte", "lt", "lte", "ne", "equals", "setOptions", "hint",
    "session", "collation", "explain", "maxTimeMS", "comment",
  ];

  for (const m of chainMethods) {
    chain[m] = jest.fn(() => chain);
  }

  chain.lean = jest.fn(() => Promise.reject(error));
  chain.exec = jest.fn(() => Promise.reject(error));
  chain.then = (_resolve: any, reject: (e: any) => any) =>
    Promise.reject(error).catch(reject);

  return chain;
}
