# Tableau de bord

## Objectif

Définir une approche top-down du tableau de bord CAPTIVA pour :

- le régulateur
- la direction de la captive
- les fonctions de pilotage / analyse

L'approche UI cible repose sur :

- des **cadres cliquables** (niveau 1)
- des **pages thématiques** (niveau 2)
- des **résumés cliquables** (niveau 3)
- des **détails / tableaux / graphes / traçabilité** (niveau 4)

## Architecture top-down (blocs)

### Bloc 1 - Régulateur / Solvabilité & Conformité

#### Finalité

Donner une vue synthétique de la solvabilité, de la liquidité, des limites et de la conformité.

#### Entrée UI (cadre cliquable)

- Statut global (vert / orange / rouge)
- Ratio de solvabilité
- Couverture MCR/SCR
- Alertes réglementaires actives
- Indicateur de qualité de données

#### Pages thématiques

- `Solvabilité`
- `Liquidité réglementaire`
- `Concentrations & limites`
- `Conformité / incidents`
- `Qualité de données & traçabilité`

#### Présentation attendue

- Jauges
- KPI cards
- Tendances
- Listes d'alertes priorisées
- Drill-down par périmètre

### Bloc 2 - Direction captive / Performance & Pilotage

#### Finalité

Piloter la performance technique, les flux de trésorerie et l'exécution opérationnelle.

#### Entrée UI (cadre cliquable)

- Primes encaissées vs attendues
- Sinistres enregistrés vs règlements
- Résultat technique
- Trésorerie
- Alertes opérationnelles

#### Pages thématiques

- `Performance technique`
- `Trésorerie & flux`
- `Primes`
- `Sinistres`
- `Réassurance / fronting`
- `Portefeuille`

#### Présentation attendue

- Courbes cumulées
- Jauges (réel vs attendu)
- Tableaux masquables
- Comparaisons N / N-1
- Segmentation par branche / partenaire / client

### Bloc 3 - Diagnostic & Analyse

#### Finalité

Expliquer les écarts, dérives et ruptures observées dans les blocs de synthèse.

#### Entrée UI (cadre cliquable)

- Principaux écarts du mois
- Top causes
- Segments en dérive

#### Pages thématiques

- `Analyse des écarts`
- `Fréquence / sévérité`
- `Top contributeurs`
- `Segments en dérive`
- `Chronologie des événements`

#### Présentation attendue

- Waterfall d'écarts
- Heatmaps
- Classements / top lists
- Timelines annotées
- Filtres temporels et segmentaires

### Bloc 4 - Alertes & Seuils

#### Finalité

Transformer les indicateurs en dispositif d'action (surveillance + traitement + suivi).

#### Entrée UI (cadre cliquable)

- Alertes critiques
- Alertes non traitées
- Délai moyen de traitement

#### Pages thématiques

- `Alertes primes`
- `Alertes sinistres`
- `Alertes financières`
- `Alertes solvabilité / liquidité`
- `Suivi de résolution`

#### Présentation attendue

- File d'alertes priorisée
- Statut de traitement
- Historique de résolution
- SLA / backlog

### Bloc 5 - Gouvernance, Comité & Reporting

#### Finalité

Préparer les instances de gouvernance et industrialiser la production des supports.

#### Entrée UI (cadre cliquable)

- Prochain comité
- Pack prêt / en préparation
- Actions en retard

#### Pages thématiques

- `Pack comité`
- `Historique des décisions`
- `Reporting réglementaire`
- `Suivi des actions`

#### Présentation attendue

- Résumé exécutif exportable
- Historique de décisions
- Journal des actions
- Statut des exports et jobs

## Pattern UI commun (déclinaison top-down)

### Niveau 1 - Cadres cliquables (accueil du tableau de bord)

- 5 grands blocs (les blocs ci-dessus)
- Statut synthétique
- 3 à 5 KPI majeurs
- Alertes résumées

### Niveau 2 - Page thématique

- Résumé exécutif
- KPI de synthèse
- Graphes de tendance
- Jauges / alertes

### Niveau 3 - Sous-résumés cliquables

- Sous-thèmes / segments / horizons
- Vue comparative (périodes / entités)

### Niveau 4 - Détail / Traçabilité

- Tableaux détaillés
- Historique
- Export
- Définition KPI / formule / source / périmètre / date de calcul

## Principes de présentation des KPI

Chaque KPI doit afficher au minimum :

- Périmètre
- Période
- Valeur
- Comparatif (N-1 / objectif / seuil)
- Tendance
- Statut (normal / vigilance / alerte)

Chaque KPI cliquable doit ouvrir :

- Définition métier
- Formule de calcul
- Source(s) de données
- Détail de composition

## Ordre de mise en oeuvre (proposition)

1. `Bloc 2` - Direction captive / Performance & Pilotage
2. `Bloc 4` - Alertes & Seuils
3. `Bloc 1` - Régulateur / Solvabilité & Conformité
4. `Bloc 3` - Diagnostic & Analyse
5. `Bloc 5` - Gouvernance, Comité & Reporting

## MVP détaillé - Bloc 2 (Direction captive / Performance & Pilotage)

### Objectif MVP

Livrer un bloc direction utilisable au quotidien pour :

- voir la situation globale
- identifier les écarts
- entrer dans le détail par thème

### Structure UI (top-down)

#### Page d'entrée - Pilotage direction

Cadres cliquables :

1. `Primes`
2. `Sinistres`
3. `Trésorerie & flux`
4. `Performance technique`
5. `Portefeuille`
6. `Réassurance / fronting`

Chaque cadre affiche :

- 3 KPI max
- 1 jauge ou mini tendance
- 1 statut (normal / vigilance / alerte)

#### Pages thématiques (niveau 2)

Pour chaque thème :

- bandeau résumé
- sous-résumés cliquables
- graphes + jauges
- tableau masquable
- zoom période
- traçabilité (périmètre, période)

### Ordre de développement (MVP)

#### Étape 1 - Page d'entrée "Pilotage direction"

But :

- poser l'UX top-down
- relier vers pages existantes / en cours

Livrable :

- cadres cliquables pour les 6 thèmes
- placeholders sur les thèmes non encore développés

#### Étape 2 - Page `Primes` (capitaliser sur l'existant)

Contenu MVP :

- jauge globale sous le titre
- cadres par branche avec jauges
- popup graphiques (global + branche)
- zoom période
- jauge de fin de période
- tableau masquable

KPI MVP `Primes` :

- `Montant versé (année)`
- `Montant total attendu`
- `Taux de recouvrement`
- `Contrats à jour / en retard / à configurer`
- `Écart cumulé vs attendu`

#### Étape 3 - Page `Sinistres` (capitaliser sur la vue Graphiques)

Contenu MVP :

- cadre `Suivi règlements`
- courbes cumulées (sinistres enregistrés / règlements)
- jauge règlements / reste à payer
- jauge de répartition par statut
- zoom période
- tableau masquable

KPI MVP `Sinistres` :

- `Sinistres enregistrés`
- `Règlements cumulés`
- `Reste à payer`
- `% réglé`
- `Répartition ouverts / en cours / clos / rejetés`

#### Étape 4 - Page `Trésorerie & flux` (MVP simple)

KPI MVP :

- `Cash actuel`
- `Encaissements primes (mois / cumul)`
- `Décaissements sinistres (mois / cumul)`
- `Solde net de flux`
- `Tendance 3 mois`

Présentation :

- courbe de cash
- waterfall flux entrants / sortants
- jauge encaissements vs décaissements

#### Étape 5 - Page `Performance technique`

KPI MVP :

- `Primes (année)`
- `Sinistres enregistrés (année)`
- `Règlements (année)`
- `Ratio sinistres / primes`
- `Marge technique simplifiée` (si disponible)
- `Tendance mensuelle`

Présentation :

- KPI cards
- courbes cumulées
- histogrammes mensuels
- comparatif N / N-1 (si disponible)

#### Étape 6 - Page `Portefeuille`

KPI MVP :

- `Répartition primes par branche`
- `Répartition sinistres par branche`
- `Top partenaires`
- `Top clients`
- `Concentration top 5 / top 10`

Présentation :

- barres empilées
- treemap / top lists
- tableaux filtrables

#### Étape 7 - Page `Réassurance / fronting` (MVP partiel ou placeholder)

Si données disponibles :

- `Primes cédées`
- `Recoveries`
- `Coût fronting`
- `Net retained`

Sinon :

- page placeholder documentée "à venir"
- cadre cliquable déjà en place

### KPI par cadre (page d'entrée du Bloc 2)

#### Cadre `Primes`

- `Montant versé (année)`
- `Montant attendu (année)`
- `Taux de recouvrement`

#### Cadre `Sinistres`

- `Sinistres enregistrés`
- `Règlements cumulés`
- `% réglé`

#### Cadre `Trésorerie & flux`

- `Cash actuel`
- `Flux net mois`
- `Tension de trésorerie`

#### Cadre `Performance technique`

- `Primes`
- `Sinistres`
- `Ratio S/P`

#### Cadre `Portefeuille`

- `Branche dominante`
- `Top partenaire`
- `Concentration top 5`

#### Cadre `Réassurance / fronting`

- `Coût fronting`
- `Recoveries`
- `Net retained` (ou placeholder)

### Principes UX du MVP Bloc 2

- mêmes patterns partout :
  - zoom période
  - tableau masquable
  - jauges de fin de période
  - légendes colorées cohérentes
- vocabulaire homogène :
  - `attendu`
  - `factuel`
  - `cumul`
  - `reste`
- affichage systématique :
  - année / période
  - périmètre (global / branche)

### Ordre de mise en oeuvre technique (recommandé)

1. Créer page `Pilotage direction` (cadres)
2. Brancher liens vers `Primes` et `Sinistres`
3. Stabiliser labels / KPI `Primes`
4. Stabiliser labels / KPI `Sinistres`
5. Ajouter `Trésorerie & flux` MVP
6. Ajouter `Performance technique` MVP
7. Ajouter `Portefeuille` MVP
8. Ajouter `Réassurance / fronting` (partiel / placeholder)

### Critère de succès MVP

La direction doit pouvoir répondre en moins de 2 minutes à :

- "où en sont les encaissements primes ?"
- "où en sont les règlements vs sinistres ?"
- "y a-t-il une tension de cash ?"
- "quelles branches expliquent la situation ?"

## Étape suivante

Définir le plan de build UI concret (écrans, routes, composants, ordre de développement sur le repo).
