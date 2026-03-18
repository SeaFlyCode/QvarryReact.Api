# Composant `TwoFactorSection`

## Localisation

```
src/components/auth/TwoFactorSection.tsx` (section dans la page `/profil/security`)
```

---

## Vue d'ensemble

Section de gestion de l'authentification à deux facteurs dans les paramètres de sécurité du profil. Flux en 5 étapes de la configuration à la désactivation. Téléchargement des codes de récupération. Alerte si codes restants ≤ 2.

---

## Interface / Props

```ts
interface TwoFactorSectionProps {
  user:         User;
  onUpdate?:    () => void;  // Callback après activation/désactivation
}
```

---

## États internes

| État | Type | Valeur initiale | Rôle |
|------|------|-----------------|------|
| `step` | `StepType` | `'status'` | Étape courante du flux |
| `qrCodeUrl` | `string \| null` | `null` | URL du QR code TOTP |
| `secret` | `string \| null` | `null` | Secret TOTP en clair (pour saisie manuelle) |
| `verificationCode` | `string` | `''` | Code de vérification saisi |
| `recoveryCodes` | `string[]` | `[]` | Codes de récupération générés |
| `isLoading` | `boolean` | `false` | Opération en cours |
| `error` | `string \| null` | `null` | Erreur |
| `recoveryCodesRemaining` | `number` | `0` | Codes de récupération encore valides |

### Type `StepType`

```ts
type StepType = 'status' | 'setup' | 'verify' | 'recoveryCodes' | 'disable';
```

---

## Flux de configuration (activation)

```
'status' → [Activer] → 'setup'
  ├─ setupTwoFactor()
  │     → qrCodeUrl + secret
  │
  └─ [Scanner QR / Saisir secret] → [Suivant] → 'verify'
        ├─ verifyTwoFactorSetup(code)
        │     → recoveryCodes[]
        │
        └─ Succès → 'recoveryCodes'
              ├─ Affichage des codes
              ├─ [Télécharger] → download .txt
              └─ [Terminer] → 'status' (2FA activé)
```

---

## Flux de désactivation

```
'status' → [Désactiver] → 'disable'
  ├─ Saisie du code TOTP courant
  └─ disableTwoFactor(code) → 'status' (2FA désactivé)
```

---

## Téléchargement des codes de récupération

```ts
const handleDownloadCodes = () => {
  const content = recoveryCodes.join('\n');
  const blob = new Blob([content], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'qvarry-recovery-codes.txt';
  a.click();
  URL.revokeObjectURL(url);
};
```

---

## Alerte codes de récupération faibles

```tsx
{recoveryCodesRemaining <= 2 && (
  <div className="warning-banner">
    ⚠️ Il ne vous reste que {recoveryCodesRemaining} code(s) de récupération.
    <button onClick={regenerateCodes}>Régénérer</button>
  </div>
)}
```

---

## Appels API

| Fonction | Module | Étape | Description |
|----------|--------|-------|-------------|
| `getTwoFactorStatus()` | `src/api/twoFactor.ts` | Montage | Statut 2FA + `recoveryCodesRemaining` |
| `setupTwoFactor()` | `src/api/twoFactor.ts` | `setup` | Génère QR code + secret |
| `verifyTwoFactorSetup(code)` | `src/api/twoFactor.ts` | `verify` | Valide le code et génère les recovery codes |
| `disableTwoFactor(code)` | `src/api/twoFactor.ts` | `disable` | Désactive la 2FA |
| `regenerateRecoveryCodes(code)` | `src/api/twoFactor.ts` | `status` | Régénère les codes de récupération |

---

## Utilisation typique

```tsx
// Dans src/app/profil/security/page.tsx
<TwoFactorSection
  user={currentUser}
  onUpdate={() => refreshUserData()}
/>
```
