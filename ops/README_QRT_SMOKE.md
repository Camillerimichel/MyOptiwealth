# QRT Smoke

Script: `ops/qrt-smoke.mjs`
Seed: `ops/qrt-seed-minimal.mjs`
Reset: `ops/qrt-smoke-reset.mjs`

## Exécution rapide

```bash
npm run smoke:qrt
```

Smoke CI strict:

```bash
npm run smoke:qrt:strict
```

Seed dataset minimal:

```bash
npm run seed:qrt:smoke
```

Reset cleanup:

```bash
npm run reset:qrt:smoke
```

## Variables utiles

- `API_BASE_URL` (défaut: `http://127.0.0.1:3000`)
- `SMOKE_TOKEN` (si fourni, bypass login)
- `SMOKE_EMAIL`
- `SMOKE_PASSWORD`
- `SMOKE_CAPTIVE_ID`
- `SMOKE_STRICT` (`true`/`false`)

## Exemples

Avec login:

```bash
API_BASE_URL=http://127.0.0.1:3000 \
SMOKE_EMAIL=admin@myoptiwealth.local \
SMOKE_PASSWORD='***' \
SMOKE_CAPTIVE_ID=1 \
npm run smoke:qrt
```

Avec token direct:

```bash
API_BASE_URL=http://127.0.0.1:3000 \
SMOKE_TOKEN='eyJ...' \
npm run smoke:qrt
```

Enchaînement complet demandé:

```bash
npm run seed:qrt:smoke
SMOKE_TOKEN='eyJ...' npm run smoke:qrt:strict
npm run reset:qrt:smoke
```
