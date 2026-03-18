# Modèle User

Fichier source : `src/models/users.ts`

Le modèle `User` est le modèle central de l'application. Il gère l'authentification, le profil, la vérification d'email, la validation admin, le consentement RGPD et l'authentification à deux facteurs.

---

## Interface TypeScript

```typescript
export interface IUserBase {
  name: string;
  surname: string;
  pseudo?: string;
  showPseudo?: boolean;
  password: string;
  password_history?: string[];
  email: string;
  emailHash?: string;
  ip_creation: string;
  ip_last_connection: string;
  creation_date: Date;
  last_connection: Date;
  is_admin: boolean;
  is_blocked: boolean;
  blocked_at?: Date;
  blocked_reason?: string;
  contact_code: number;
  reset_password_token: string;
  reset_password_expires: Date;
  is_verified: boolean;
  is_auth: boolean;
  email_verification_token?: string;
  email_verification_code?: string;
  email_verification_expires?: Date;
  is_admin_validated: boolean;
  admin_validated_at?: Date;
  admin_validated_by?: string;
  admin_validation_rejected?: boolean;
  admin_rejection_reason?: string;
  gdpr_consent: boolean;
  gdpr_consent_date?: Date;
  gdpr_consent_version?: string;
  gdpr_marketing_consent?: boolean;
  gdpr_marketing_consent_date?: Date;
  two_factor_enabled: boolean;
  two_factor_secret?: string;
  two_factor_confirmed_at?: Date;
  two_factor_recovery_codes?: string[];
  login_notifications_enabled?: boolean;
}

export interface IUser extends IUserBase, Document {}
```

---

## Schéma complet

### Identité et profil

| Champ        | Type    | Contraintes                   | Description                                  |
| ------------ | ------- | ----------------------------- | -------------------------------------------- |
| `name`       | String  | required, maxlength 200, trim | Prénom                                       |
| `surname`    | String  | required, maxlength 200, trim | Nom de famille                               |
| `pseudo`     | String  | optional, maxlength 50, trim  | Pseudo optionnel                             |
| `showPseudo` | Boolean | default `false`               | Affiche le pseudo à la place de name/surname |

### Authentification

| Champ                | Type     | Contraintes             | Description                                                     |
| -------------------- | -------- | ----------------------- | --------------------------------------------------------------- |
| `password`           | String   | required, maxlength 200 | Hash bcrypt (12 rounds) — jamais en clair                       |
| `password_history`   | [String] | default `[]`            | 5 derniers hashes bcrypt (REM-006)                              |
| `email`              | String   | required, maxlength 500 | Email en clair (non indexé)                                     |
| `emailHash`          | String   | optional                | HMAC-SHA256 de l'email — utilisé pour les recherches sécurisées |
| `ip_creation`        | String   | required                | IP au moment de l'inscription                                   |
| `ip_last_connection` | String   | required                | IP de la dernière connexion                                     |
| `creation_date`      | Date     | default `Date.now`      | Date d'inscription                                              |
| `last_connection`    | Date     | default `Date.now`      | Date de dernière connexion                                      |

> ⚠️ L'`emailHash` est calculé avec HMAC-SHA256 + clé secrète `EMAIL_HMAC_KEY` pour se protéger contre les attaques rainbow table. Les recherches par email utilisent `emailHash`, jamais le champ `email` en clair.

### Rôles et statuts

| Champ            | Type    | Contraintes     | Description                          |
| ---------------- | ------- | --------------- | ------------------------------------ |
| `is_admin`       | Boolean | default `false` | Droits administrateur                |
| `is_blocked`     | Boolean | default `false` | Compte bloqué — connexion refusée    |
| `blocked_at`     | Date    | optional        | Date du blocage                      |
| `blocked_reason` | String  | maxlength 500   | Raison du blocage                    |
| `contact_code`   | Number  | default `0`     | Code court pour ajouter des contacts |
| `is_verified`    | Boolean | default `false` | Email vérifié                        |
| `is_auth`        | Boolean | default `false` | Session active                       |

### Vérification d'email

| Champ                        | Type   | Description                               |
| ---------------------------- | ------ | ----------------------------------------- |
| `email_verification_token`   | String | Token de vérification email (lien)        |
| `email_verification_code`    | String | Code à 6 chiffres (formulaire)            |
| `email_verification_expires` | Date   | Expiration du token/code                  |
| `reset_password_token`       | String | Token de réinitialisation de mot de passe |
| `reset_password_expires`     | Date   | Expiration du token de réinitialisation   |

### Validation admin

Un nouveau compte peut nécessiter une validation manuelle par un administrateur avant de pouvoir se connecter.

| Champ                       | Type    | Default             | Description                           |
| --------------------------- | ------- | ------------------- | ------------------------------------- |
| `is_admin_validated`        | Boolean | `false`             | Le compte a été approuvé par un admin |
| `admin_validated_at`        | Date    | optional            | Date de validation                    |
| `admin_validated_by`        | String  | `""`                | ID de l'admin validateur              |
| `admin_validation_rejected` | Boolean | `false`             | Compte refusé                         |
| `admin_rejection_reason`    | String  | `""`, maxlength 500 | Motif du refus                        |

### Consentement RGPD (Art. 7)

> ⚠️ Le champ `gdpr_consent` est `required: true`. Un utilisateur ne peut pas être créé sans avoir explicitement accepté les CGU.

| Champ                         | Type    | Contraintes     | Description                                          |
| ----------------------------- | ------- | --------------- | ---------------------------------------------------- |
| `gdpr_consent`                | Boolean | required        | Consentement aux CGU et politique de confidentialité |
| `gdpr_consent_date`           | Date    | optional        | Timestamp du consentement                            |
| `gdpr_consent_version`        | String  | default `"1.0"` | Version des CGU acceptées                            |
| `gdpr_marketing_consent`      | Boolean | default `false` | Consentement marketing (optionnel)                   |
| `gdpr_marketing_consent_date` | Date    | optional        | Timestamp du consentement marketing                  |

### Authentification à deux facteurs (TOTP)

| Champ                       | Type     | Description                            |
| --------------------------- | -------- | -------------------------------------- |
| `two_factor_enabled`        | Boolean  | 2FA activée pour ce compte             |
| `two_factor_secret`         | String   | Secret TOTP chiffré en AES-256-GCM     |
| `two_factor_confirmed_at`   | Date     | Date de confirmation du setup 2FA      |
| `two_factor_recovery_codes` | [String] | Codes de récupération hashés en bcrypt |

> ⚠️ Le `two_factor_secret` est **chiffré en base** avec AES-256-GCM via `masterEncryptionUtils`. Il n'est jamais stocké en clair.

### Préférences

| Champ                         | Type    | Default | Description                                 |
| ----------------------------- | ------- | ------- | ------------------------------------------- |
| `login_notifications_enabled` | Boolean | `true`  | Envoie un email à chaque nouvelle connexion |

---

## Index

| Champs                                     | Options        | Usage                                                                   |
| ------------------------------------------ | -------------- | ----------------------------------------------------------------------- |
| `emailHash: 1`                             | —              | Recherche d'utilisateur par email (sécurisée)                           |
| `is_admin_validated: 1, creation_date: -1` | —              | Liste d'attente de validation admin                                     |
| `is_blocked: 1`                            | —              | Filtrage des comptes bloqués                                            |
| `contact_code: 1`                          | unique, sparse | Recherche par code de contact — sparse car pas tous les users en ont un |
| `creation_date: -1`                        | —              | Tri chronologique inversé                                               |

---

## Modèle Mongoose

```typescript
export const UserModel: Model<IUser> =
  mongoose.models.User || mongoose.model<IUser>("User", UserSchema);
```

Le pattern `mongoose.models.User || mongoose.model(...)` évite les erreurs de ré-enregistrement en environnement de test ou hot-reload.
