/**
 * Source de vérité backend des enums Fiche.
 * Aligné strictement sur Qvarry-phone/src/constants/fiches.ts (option A).
 * Toute modification doit être répliquée mobile + backend pour rester cohérente.
 */

export const FICHE_TYPES = [
  "Carrière",
  "Mine",
  "Grotte",
  "Tunnel",
  "Catacombe",
  "Bunker",
  "Cave",
  "Autre",
] as const;

export const FICHE_ETATS = [
  "Ouvert",
  "Partiellement accessible",
  "Fermé",
  "Inconnu",
] as const;

export const FICHE_ACCESSIBILITES = [
  "Accès libre",
  "Accès réglementé",
  "Propriété privée",
  "Interdit",
  "Inconnu",
] as const;

export const FICHE_ACCES_SOUTERRAIN = [
  "Porte",
  "Chatière",
  "Escalade",
  "Ouvert",
  "Autre",
] as const;

export const FICHE_DIFFICULTE_ACCES = ["1", "2", "3", "4", "5"] as const;

export const FICHE_RISQUE_OXYGENE = ["1", "2", "3", "4", "5"] as const;

export const FICHE_ETAT_GENERAL = ["1", "2", "3", "4", "5"] as const;

export const FICHE_PRATICITE_SOUTERRAIN = [
  "Sol dégagé",
  "Sol accidenté",
  "Zones inondées",
  "Passages étroits",
  "Ramping nécessaire",
  "Labyrinthique",
  "Verticale (échelles/puits)",
  "Autre",
] as const;

export const FICHE_EQUIPEMENT_AUTRE_VALUE = "Autre (à préciser)";

export const FICHE_EQUIPEMENT_CONSEILLE = [
  "Chaussures de marche",
  "Bottes",
  "Cuissardes",
  "Combinaison néoprène",
  "Bateau/Canot",
  "Casque",
  "Éclairage (frontale)",
  "Éclairage de secours",
  "Baudrier",
  "Corde",
  "Descendeur/Bloqueur",
  "Détecteur O2/CO2",
  "Gants",
  "Genouillères",
  FICHE_EQUIPEMENT_AUTRE_VALUE,
] as const;

export const FICHE_SURFACE = [
  "< 500 m²",
  "500 m² - 1 ha",
  "1 - 5 ha",
  "5 - 20 ha",
  "> 20 ha",
  "Inconnue",
] as const;

export const FICHE_TYPE_GALERIES = [
  "Galeries hautes (> 2m)",
  "Galeries basses (< 1.5m)",
  "Galeries étroites",
  "Galeries larges",
  "Salles/Chambres",
  "Puits verticaux",
  "Boyaux",
  "Inconnue",
] as const;

// Zone protégée renseignée MANUELLEMENT par l'utilisateur (pas de détection auto).
export const FICHE_ZONES_PROTEGEES = [
  "Non concernée",
  "Natura 2000",
  "Réserve naturelle",
  "Arrêté de protection de biotope",
  "Parc national",
  "Parc naturel régional",
  "Site classé/inscrit",
  "ZNIEFF",
  "Autre",
  "Inconnu",
] as const;

export type FicheType = (typeof FICHE_TYPES)[number];
export type FicheEtat = (typeof FICHE_ETATS)[number];
export type FicheAccessibilite = (typeof FICHE_ACCESSIBILITES)[number];
export type FicheAccesSouterrain = (typeof FICHE_ACCES_SOUTERRAIN)[number];
export type FicheDifficulteAcces = (typeof FICHE_DIFFICULTE_ACCES)[number];
export type FicheRisqueOxygene = (typeof FICHE_RISQUE_OXYGENE)[number];
export type FicheEtatGeneral = (typeof FICHE_ETAT_GENERAL)[number];
export type FichePraticiteSouterrain =
  (typeof FICHE_PRATICITE_SOUTERRAIN)[number];
export type FicheEquipementConseille =
  (typeof FICHE_EQUIPEMENT_CONSEILLE)[number];
export type FicheSurface = (typeof FICHE_SURFACE)[number];
export type FicheTypeGaleries = (typeof FICHE_TYPE_GALERIES)[number];
export type FicheZoneProtegee = (typeof FICHE_ZONES_PROTEGEES)[number];
