# Deploiement automatique GitHub -> VPS

Repo: https://github.com/Camillerimichel/MyOptiwealth
Workflow: `.github/workflows/deploy.yml`

## 1) Creer une cle SSH dediee deploy (sur le VPS)
```bash
ssh-keygen -t ed25519 -C "github-actions-myoptiwealth" -f /root/.ssh/id_ed25519_myoptiwealth_deploy -N ""
cat /root/.ssh/id_ed25519_myoptiwealth_deploy.pub >> /root/.ssh/authorized_keys
chmod 600 /root/.ssh/authorized_keys
```

## 2) Recuperer la cle privee (a coller dans GitHub Secret)
```bash
cat /root/.ssh/id_ed25519_myoptiwealth_deploy
```
Copier tout le bloc (de `-----BEGIN OPENSSH PRIVATE KEY-----` a `-----END OPENSSH PRIVATE KEY-----`).

## 3) Ajouter les secrets GitHub
Dans `Settings -> Secrets and variables -> Actions -> New repository secret`:
- `VPS_HOST` = `72.61.94.45`
- `VPS_USER` = `root`
- `VPS_SSH_PRIVATE_KEY` = contenu de la cle privee ci-dessus

## 4) Tester
Faire un commit sur `main` puis verifier l'onglet `Actions`.
Le job `Deploy VPS` doit finir en vert.

## 5) Ce que fait le deploy
Le workflow se connecte en SSH puis execute:
```bash
cd /var/www/myoptiwealth
git pull --ff-only origin main
bash /var/www/myoptiwealth/ops/deploy-local.sh
```
