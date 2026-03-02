# GitHub Branch Protection (main)

Depot: https://github.com/Camillerimichel/MyOptiwealth

## Reglage recommande
1. Ouvrir `Settings` -> `Branches` -> `Add branch protection rule`.
2. Branch name pattern: `main`.
3. Activer:
- Require a pull request before merging
- Require approvals: 1
- Dismiss stale pull request approvals when new commits are pushed
- Require status checks to pass before merging
- Status check requis: `build`
- Require branches to be up to date before merging
- Include administrators
4. Enregistrer la regle.

## Resultat
La branche `main` ne sera modifiable que via PR validee + pipeline CI vert.
