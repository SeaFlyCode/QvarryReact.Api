import mongoose, { Schema, Document, Model } from "mongoose";

// Base interface for User properties
export interface IUserBase {
  name: string;
  surname: string;
  pseudo?: string; // Pseudo optionnel de l'utilisateur
  showPseudo?: boolean; // Si true, affiche le pseudo au lieu de name/surname
  password: string;
  password_history?: string[]; // REM-006: Historique des 5 derniers mots de passe hashés
  email: string;
  emailHash?: string;
  ip_creation: string;
  ip_last_connection: string;
  creation_date: Date;
  last_connection: Date;
  is_admin: boolean;
  is_blocked: boolean; // Si true, l'utilisateur ne peut pas se connecter
  blocked_at?: Date; // Date du blocage
  blocked_reason?: string; // Raison du blocage
  contact_code: number;
  reset_password_token: string;
  reset_password_expires: Date;
  is_verified: boolean;
  is_auth: boolean;
  // Champs pour la vérification d'email
  email_verification_token?: string;
  email_verification_code?: string;
  email_verification_expires?: Date;
  // Champs pour la validation par un administrateur
  is_admin_validated: boolean; // Si true, l'utilisateur peut se connecter
  admin_validated_at?: Date; // Date de validation par admin
  admin_validated_by?: string; // ID de l'admin qui a validé
  admin_validation_rejected?: boolean; // Si true, le compte a été refusé
  admin_rejection_reason?: string; // Raison du refus
  // RGPD-002: Champs de consentement explicite (Art. 7)
  gdpr_consent: boolean; // Consentement aux CGU et politique de confidentialité
  gdpr_consent_date?: Date; // Date du consentement
  gdpr_consent_version?: string; // Version des CGU acceptées
  gdpr_marketing_consent?: boolean; // Consentement pour communications marketing (optionnel)
  gdpr_marketing_consent_date?: Date;
  // 2FA/TOTP - Authentification à deux facteurs
  two_factor_enabled: boolean; // Si true, 2FA est activé
  two_factor_secret?: string; // Secret TOTP chiffré (AES-256-GCM)
  two_factor_algorithm?: "sha1" | "sha256" | "sha512"; // Algorithme TOTP (SHA512 recommandé)
  two_factor_confirmed_at?: Date; // Date de confirmation de la 2FA
  two_factor_recovery_codes?: string[]; // Codes de récupération hashés
  // Préférences de notifications
  login_notifications_enabled?: boolean; // Si true, envoie un email à chaque connexion (défaut: true)
  notificationPreferences?: {
    messages: boolean; // P1 — message, group_invite
    contacts: boolean; // P1 — contact_request, contact_accepted, contact_refused
    shares: boolean; // P2 — share_*
    groups: boolean; // P2 — group_member_*, group_deleted
    community_sos: boolean; // P0 — sos_stage1_alert broadcast (peut être désactivé)
    quietHours: {
      enabled: boolean;
      start: string; // 'HH:MM' UTC
      end: string; // 'HH:MM' UTC
    };
  };
  // Gestion du stockage de photos
  storage_quota: number; // Quota de stockage en octets (défaut: 2 Go)
  storage_used: number; // Espace de stockage utilisé en octets
  // MED-001: Device Binding pour tokens mobiles
  authorized_devices?: Array<{
    device_id: string;
    device_name?: string;
    device_os?: string;
    first_seen: Date;
    last_seen: Date;
    trusted: boolean;
  }>;
  // Dernière position connue (utilisée pour le filtre géographique des
  // broadcasts SOS Stage 1, etc.). GeoJSON Point [lng, lat] + index 2dsphere.
  lastKnownLocation?: {
    type: "Point";
    coordinates: [number, number]; // [lng, lat]
    updatedAt?: Date;
  };
}

// Interface for User Document (includes mongoose Document properties)
export interface IUser extends IUserBase, Document {}

const UserSchema: Schema<IUser> = new Schema({
  name: { type: String, required: true, maxlength: 200, trim: true },
  surname: { type: String, required: true, maxlength: 200, trim: true },
  pseudo: { type: String, required: false, maxlength: 50, trim: true },
  showPseudo: { type: Boolean, default: false },
  password: { type: String, required: true, maxlength: 200, select: false },
  password_history: { type: [String], default: [], select: false }, // REM-006: Historique des 5 derniers mots de passe
  email: { type: String, required: true, maxlength: 500 },
  emailHash: { type: String },
  ip_creation: { type: String, required: true },
  ip_last_connection: { type: String, required: true },
  creation_date: { type: Date, default: Date.now },
  last_connection: { type: Date, default: Date.now },
  is_admin: { type: Boolean, default: false },
  is_blocked: { type: Boolean, default: false },
  blocked_at: { type: Date },
  blocked_reason: { type: String, default: "", maxlength: 500 },
  contact_code: { type: Number, default: 0 },
  reset_password_token: { type: String, default: "", select: false },
  reset_password_expires: { type: Date },
  is_verified: { type: Boolean, default: false },
  is_auth: { type: Boolean, default: false },
  // Champs pour la vérification d'email
  email_verification_token: { type: String, default: "", select: false },
  email_verification_code: { type: String, default: "", select: false },
  email_verification_expires: { type: Date },
  // Champs pour la validation par un administrateur
  is_admin_validated: { type: Boolean, default: false },
  admin_validated_at: { type: Date },
  admin_validated_by: { type: String, default: "" },
  admin_validation_rejected: { type: Boolean, default: false },
  admin_rejection_reason: { type: String, default: "", maxlength: 500 },
  // RGPD-002: Champs de consentement explicite (Art. 7)
  gdpr_consent: { type: Boolean, default: false, required: true },
  gdpr_consent_date: { type: Date },
  gdpr_consent_version: { type: String, default: "1.0" },
  gdpr_marketing_consent: { type: Boolean, default: false },
  gdpr_marketing_consent_date: { type: Date },
  // 2FA/TOTP - Authentification à deux facteurs
  two_factor_enabled: { type: Boolean, default: false },
  two_factor_secret: { type: String, select: false },
  two_factor_algorithm: {
    type: String,
    enum: ["sha1", "sha256", "sha512"],
    default: "sha1", // Rétrocompatibilité avec anciens utilisateurs
    required: false,
  },
  two_factor_confirmed_at: { type: Date },
  two_factor_recovery_codes: { type: [String], default: [], select: false },
  // Préférences de notifications
  login_notifications_enabled: { type: Boolean, default: true },
  notificationPreferences: {
    type: new Schema(
      {
        messages: { type: Boolean, default: true },
        contacts: { type: Boolean, default: true },
        shares: { type: Boolean, default: true },
        groups: { type: Boolean, default: true },
        community_sos: { type: Boolean, default: true },
        quietHours: {
          type: new Schema(
            {
              enabled: { type: Boolean, default: false },
              start: { type: String, default: "22:00" },
              end: { type: String, default: "07:00" },
            },
            { _id: false },
          ),
          default: () => ({ enabled: false, start: "22:00", end: "07:00" }),
        },
      },
      { _id: false },
    ),
    default: () => ({
      messages: true,
      contacts: true,
      shares: true,
      groups: true,
      community_sos: true,
      quietHours: { enabled: false, start: "22:00", end: "07:00" },
    }),
  },
  // Gestion du stockage de photos
  storage_quota: {
    type: Number,
    default: 2 * 1024 * 1024 * 1024, // 2 Go par défaut
    required: true,
  },
  storage_used: {
    type: Number,
    default: 0,
    required: true,
  },
  // MED-001: Device Binding pour tokens mobiles
  authorized_devices: {
    type: [
      {
        device_id: { type: String, required: true, index: true },
        device_name: { type: String, required: false },
        device_os: { type: String, required: false },
        first_seen: { type: Date, default: Date.now },
        last_seen: { type: Date, default: Date.now },
        trusted: { type: Boolean, default: false },
      },
    ],
    default: [],
  },
  // Dernière position connue — GeoJSON Point [lng, lat]
  // Indexée 2dsphere pour les requêtes $geoWithin / $centerSphere.
  lastKnownLocation: {
    type: new Schema(
      {
        type: {
          type: String,
          enum: ["Point"],
          required: true,
          default: "Point",
        },
        coordinates: {
          type: [Number],
          required: true,
          validate: {
            validator: (v: number[]) =>
              Array.isArray(v) &&
              v.length === 2 &&
              v[0] >= -180 &&
              v[0] <= 180 &&
              v[1] >= -90 &&
              v[1] <= 90,
            message: "coordinates must be [lng, lat] dans les bornes valides",
          },
        },
        updatedAt: { type: Date, default: Date.now },
      },
      { _id: false },
    ),
    required: false,
  },
});

// SEC: filtre défense en profondeur à la sérialisation — évite toute fuite
// accidentelle de champs sensibles dans les réponses API, même si un controller
// oublie d'utiliser sanitizeUserForResponse ou .select("-password").
const SENSITIVE_USER_FIELDS = [
  "password",
  "password_history",
  "reset_password_token",
  "reset_password_expires",
  "email_verification_token",
  "email_verification_code",
  "email_verification_expires",
  "two_factor_secret",
  "two_factor_recovery_codes",
] as const;

const stripSensitiveFields = (_doc: unknown, ret: any) => {
  for (const field of SENSITIVE_USER_FIELDS) {
    delete ret[field];
  }
  return ret;
};

UserSchema.set("toJSON", { transform: stripSensitiveFields });
UserSchema.set("toObject", { transform: stripSensitiveFields });

UserSchema.index({ emailHash: 1 });
UserSchema.index({ is_admin_validated: 1, creation_date: -1 });
UserSchema.index({ is_blocked: 1 });
UserSchema.index({ contact_code: 1 }, { unique: true, sparse: true });
UserSchema.index({ creation_date: -1 });
UserSchema.index({ storage_used: 1 }); // Index pour tri par espace utilisé
UserSchema.index({ last_connection: -1 }); // Pour stats admin
UserSchema.index({ is_verified: 1 }); // Filtres de recherche
UserSchema.index({ is_verified: 1, is_admin_validated: 1 }); // Compound pour registration flow
UserSchema.index({ lastKnownLocation: "2dsphere" }); // Geo queries (SOS Stage 1 broadcast)

export const UserModel: Model<IUser> =
  mongoose.models.User || mongoose.model<IUser>("User", UserSchema);

export default UserModel;
