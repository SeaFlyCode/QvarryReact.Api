# Page Politique de Confidentialité (RGPD)

## Vue d'ensemble

Page statique présentant la politique de confidentialité conforme au RGPD. 11 sections. Aucun appel API. Aucun état. Lien de retour vers `/`.

---

## Route & fichier source

| Élément | Valeur |
|---------|--------|
| Route Next.js | `/privacy` |
| Fichier | `src/app/privacy/page.tsx` |
| Rendu | Serveur (pas de `'use client'`) |

---

## Structure du contenu

| # | Section |
|---|---------|
| 1 | Responsable du traitement |
| 2 | Données collectées |
| 3 | Finalités du traitement |
| 4 | Base légale |
| 5 | Durée de conservation |
| 6 | Destinataires des données |
| 7 | Droits des personnes |
| 8 | Sécurité des données |
| 9 | Cookies |
| 10 | Modifications de la politique |
| 11 | Contact |

---

## Comportements spéciaux

- Aucun appel API
- Aucun état React
- Composant de type **Server Component** (Next.js 15)
- Lien `<Link href="/">` vers la page d'accueil

---

## Note d'implémentation

Cette page étant un Server Component, elle est rendue côté serveur et ne nécessite pas de JavaScript côté client. Elle est donc très performante (pas de bundle JS additionnel).
