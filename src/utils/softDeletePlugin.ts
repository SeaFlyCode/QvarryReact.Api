/**
 * Plugin Mongoose : soft-delete par défaut.
 *
 * Cf. REFONTE §4.2.2 — éliminer les bugs où une query oublie de filtrer
 * `deletedAt: null` et expose des entités supprimées.
 *
 * Comportement :
 *   - Toute query `find*` ou `count*` exclut par défaut les documents avec
 *     `deletedAt !== null`.
 *   - Pour récupérer aussi les soft-deleted (archivage, sync delete-batch,
 *     audit), passer `.setOptions({ withDeleted: true })` sur la query, OU
 *     filtrer explicitement `deletedAt` dans le query object (ex:
 *     `{ deletedAt: { $ne: null } }`, `{ deletedAt: { $gt: someDate } }`).
 *     Le plugin détecte la présence de `deletedAt` dans le query et n'écrase
 *     pas le filtre user.
 *
 * Le plugin ne s'applique qu'aux schémas qui ont déjà déclaré le champ
 * `deletedAt`. Pour les autres modèles (sans soft-delete), aucun effet.
 *
 * Exemple :
 *   FicheSchema.plugin(softDeletePlugin); // exclut deletedAt par défaut
 *
 *   // Récupération normale (exclut deleted)
 *   FicheModel.find({ userId });
 *
 *   // Récupération avec deleted (archivage, sync diff)
 *   FicheModel.find({ userId }).setOptions({ withDeleted: true });
 *
 *   // Filtre explicite (le plugin ne touche pas)
 *   FicheModel.find({ userId, deletedAt: { $gt: since } });
 */

import { Schema } from "mongoose";

// Regex couvrant find / findOne / findOneAndUpdate / findOneAndDelete /
// findOneAndRemove / count / countDocuments / estimatedDocumentCount /
// updateOne / updateMany / deleteOne / deleteMany.
const FIND_OPS_REGEX = /^(find|count|estimated|update|delete)/;

export function softDeletePlugin(schema: Schema): void {
  schema.pre(FIND_OPS_REGEX, function (this: any) {
    // Si le caller a explicité `withDeleted: true` dans les options → bypass.
    const opts = this.getOptions ? this.getOptions() : {};
    if (opts && opts.withDeleted) return;

    const query = this.getQuery ? this.getQuery() : this.getFilter();
    // Si le query référence déjà `deletedAt` (caller filtre explicitement),
    // ne pas écraser : il sait ce qu'il fait.
    if (query && Object.prototype.hasOwnProperty.call(query, "deletedAt")) {
      return;
    }
    // Filtre par défaut : on ne renvoie que les non-supprimés.
    this.where({ deletedAt: null });
  });
}
