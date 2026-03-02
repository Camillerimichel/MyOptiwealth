# S2 / Solvabilité - Guide métier

## Objectif du document

Ce document explique, en langage métier, comment utiliser les écrans `S2` et `Solvabilité & conformité` pour :

- suivre le besoin de fonds propres (SCR / MCR)
- comprendre la couverture par les fonds propres éligibles
- produire des snapshots mensuels sur données réelles
- analyser les variations mensuelles

## 1. Ce que l'on cherche à piloter

La solvabilité se lit avec 4 notions principales :

- **Fonds propres éligibles** : capital disponible pour couvrir les exigences
- **SCR** : besoin de capital (capital requis)
- **MCR** : minimum réglementaire absolu de capital
- **Ratio SCR** : `Fonds propres éligibles / SCR`

## 1.1 Lecture simple

- `Ratio SCR >= 100%` : le SCR est couvert
- `Ratio SCR < 100%` : insuffisance de couverture SCR
- `Couverture MCR < 100%` : situation critique

En pratique de pilotage, on surveille aussi une zone de vigilance (ex. proche de `100%`).

## 2. Où trouver l'information dans CAPTIVA

## 2.1 `Pilotage > Solvabilité & conformité`

Page cible pour la lecture régulateur / direction (MVP) :

- KPI de solvabilité
- jauges SCR / MCR
- alertes et traçabilité
- suivi mensuel
- historique récent
- analyse des variations mensuelles (waterfalls)

## 2.2 `Actuariat > S2`

Page de travail (production / réglages / analyses) :

- sélection d'un run S2
- `Inputs S2 par branche`
- `Paramétrage moteur S2 (placeholder)`
- `Analyse S2 sur données réelles (date d'arrêté)`

## 3. Différence entre `Simulation` et `Réel`

## 3.1 Simulation

Résultats produits par des runs de simulation / ORSA.

Usage :

- tests d'hypothèses
- stress
- scénarios
- comparaisons de runs

## 3.2 Réel

Snapshots construits à partir des données constatées à une date d'arrêté :

- primes encaissées
- sinistres / règlements
- réserves (MVP reconstituées)
- réassurance / fronting (selon disponibilité)

Usage :

- suivi mensuel de solvabilité
- pilotage en vision régulateur
- préparation de comité / reporting

## 3.3 Mode `Auto (réel prioritaire)`

Dans `Pilotage > Solvabilité`, le filtre `Source` permet de choisir :

- `Réel`
- `Simulation`
- `Auto (réel prioritaire)`

En mode `Auto` :

- la page utilise les snapshots **réels** quand ils existent
- sinon elle utilise les snapshots de **simulation**

## 4. Workflow métier recommandé (mensuel)

## 4.1 Préparer / vérifier les données

Avant calcul de solvabilité mensuelle :

- primes encaissées à jour
- sinistres / règlements à jour
- éléments de réassurance/fronting disponibles (si applicables)

## 4.2 Produire le snapshot S2 réel

Dans `Actuariat > S2` :

1. choisir un `run S2` de référence (cadre run)
2. ouvrir `Analyse S2 sur données réelles (date d'arrêté)`
3. choisir la date d'analyse (ex. fin de mois)
4. choisir le mode de fonds propres :
   - `Auto`
   - `Proxy`
   - `Manuel`
5. lancer :
   - `Calculer` (prévisualisation), puis
   - `Calculer + enregistrer snapshot réel`

## 4.3 Batch mensuel (fins de mois)

Pour remplir rapidement une année :

- utiliser `Générer fins de mois (année)`

Remarques :

- si les snapshots existent déjà, ils ne sont pas écrasés sauf option dédiée
- l'historique batch affiche les mois générés et les statuts

## 4.4 Contrôler dans `Pilotage > Solvabilité`

Sur `Pilotage > Solvabilité` :

1. choisir `Source = Réel` (ou `Auto`)
2. vérifier les KPI / jauges
3. ouvrir le `Suivi mensuel`
4. vérifier la cohérence des snapshots du mois

## 5. Comment lire les jauges SCR / MCR

## 5.1 Jauge SCR

Deux cas :

### Cas 1 - couverture suffisante

La jauge montre :

- `SCR couvert`
- `Marge`

La **marge** correspond à la part des fonds propres éligibles au-delà du SCR.

### Cas 2 - couverture insuffisante

La jauge montre :

- `FP éligibles`
- `Insuffisance`

L'insuffisance représente le manque de capital pour couvrir le SCR.

## 5.2 Jauge MCR

Même logique que la jauge SCR, appliquée au `MCR`.

## 6. Alertes & traçabilité (ce qu'il faut vérifier)

Le bloc `Alertes & traçabilité` permet de contrôler :

- `Dernier snapshot S2`
- `Run S2`
- `Source S2` (`réel` / `simulation`)
- `Méthodologie`
- `Dernier snapshot ALM`
- `Fraîcheur ALM`

### Point important

`Dernier snapshot ALM` est aligné sur la date S2 affichée (pour éviter une confusion avec des dates ALM de projection futures).

## 7. Suivi mensuel (usage métier)

Le tableau `Suivi mensuel (dernière photo S2 par mois sur l'année)` permet de comparer, mois par mois :

- ratio SCR
- couverture MCR
- fonds propres éligibles
- SCR
- source (`réel` / `simulation`)

### Conseils de lecture

- vérifier les mois sans snapshot (`—`)
- surveiller les ruptures de ratio entre deux mois
- comparer la source utilisée (réel vs simulation)

## 8. Analyse des variations mensuelles (nouveau bloc)

Le bloc `Variation mensuelle du besoin de fonds propres (SCR)` aide à expliquer **pourquoi** la solvabilité change d'un mois à l'autre.

## 8.1 Ce que montre le bloc

- comparaison d'un mois `M` avec le mois précédent disponible `M-1`
- `Δ SCR total`
- `Δ ratio solvabilité`
- tableau de détail des composantes

## 8.2 Waterfall SCR (M-1 → M)

Le waterfall SCR décompose la variation du `SCR total` en contributions :

- `Non-vie`
- `Contrepartie`
- `Marché`
- `Opérationnel`

Cela permet d'identifier rapidement ce qui pousse la hausse / baisse du besoin de capital.

## 8.3 Waterfall ratio SCR (M-1 → M)

Le second waterfall décompose la variation du ratio SCR en :

- **effet Δ Fonds propres**
- **effet Δ SCR**

Lecture utile :

- le ratio peut baisser parce que le SCR monte
- ou parce que les fonds propres éligibles baissent
- ou les deux

## 8.4 Code couleur (ligne `Ratio solvabilité`)

Dans le tableau de variation :

- `< 100%` : rouge (insuffisant)
- `100% à <120%` : ambre (vigilance)
- `>= 120%` : vert (zone de confort MVP)

## 9. Paramétrage moteur S2 (placeholder) - quand l'utiliser

Le bloc `Paramétrage moteur S2 (placeholder)` sert à ajuster les hypothèses simplifiées du moteur S2.

À utiliser pour :

- calibrer des runs de simulation / ORSA
- tester des sensibilités sur les composantes de SCR
- améliorer la cohérence des résultats avec les hypothèses métier

### Attention

Modifier le paramétrage ne change pas les runs déjà calculés :

- il faut relancer les calculs S2 (bouton `Enregistrer + relancer S2`)

## 10. Règles métier recommandées (MVP)

## 10.1 Production mensuelle

- produire un snapshot `S2 réel` à chaque fin de mois
- utiliser `Source = Réel` pour la lecture de pilotage
- conserver la simulation pour :
  - stress
  - scénarios
  - projections

## 10.2 Mode de fonds propres

Par défaut recommandé :

- `Auto (manuel > proxy)`

Pourquoi :

- permet d'utiliser une valeur manuelle validée si disponible
- sinon un proxy pour continuer le pilotage

## 10.3 Gouvernance

À organiser dans la pratique :

- qui calcule
- qui valide
- qui interprète
- qui arbitre en cas d'écart important

## 11. Cas d'usage concrets

## 11.1 Fin de mois - comité de pilotage

Objectif :

- vérifier si la couverture SCR se dégrade
- identifier la cause principale (SCR vs fonds propres)

Action :

- produire snapshot réel fin de mois
- lire le bloc de variation mensuelle
- documenter les écarts significatifs

## 11.2 Comparaison réel vs simulation

Objectif :

- comparer un run de simulation avec la réalité observée

Action :

- `Pilotage > Solvabilité`
- basculer le filtre `Source` entre `Réel` et `Simulation`
- comparer ratios, SCR et trajectoire mensuelle

## 11.3 Recalibrage des hypothèses S2

Objectif :

- corriger des résultats manifestement trop optimistes / trop prudents

Action :

- `Actuariat > S2 > Paramétrage moteur S2`
- ajuster coefficients
- relancer S2 sur le run de travail
- comparer dans `Overview` et `Solvabilité`

## 12. Limites connues (à garder en tête)

- le moteur S2 actuel reste en partie `placeholder` (simplifié)
- le calcul des réserves `as-of` est en mode MVP (reconstitution)
- tous les runs ne supportent pas toute la chaîne de recalcul

Ces limites n'empêchent pas le pilotage, mais elles doivent être connues pour l'interprétation.

## 13. Prochaines améliorations métier utiles

1. Export CSV/PDF des variations mensuelles pour comité/régulateur
2. Statut `provisoire / validé` visible sur les snapshots `S2 réel`
3. Explication enrichie des variations (par branche)
4. Rapprochement plus fin avec les données ALM / fonds propres proxy
