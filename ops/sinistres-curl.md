# API Sinistres (ventilation par branche) - Exemples cURL

## 0) Variables

```bash
export API_URL="http://127.0.0.1:3000"
export EMAIL="admin@myoptiwealth.local"
export PASSWORD="ChangeMe123!"
export CAPTIVE_ID="1"
```

## 1) Login + token

```bash
export TOKEN=$(
  curl -sS -X POST "$API_URL/api/auth/login" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\",\"captive_id\":$CAPTIVE_ID}" \
  | jq -r '.token'
)

echo "$TOKEN"
```

## 2) Récupérer les IDs utiles (programme + branches)

```bash
curl -sS "$API_URL/api/programmes?page=1&limit=20" \
  -H "Authorization: Bearer $TOKEN" | jq .

curl -sS "$API_URL/api/captive/branches?page=1&limit=100" \
  -H "Authorization: Bearer $TOKEN" | jq .
```

## 3) Créer un sinistre ventilé sur 1 branche

```bash
export PROGRAMME_ID="1"
export BRANCH_ID_A="1"

curl -sS -X POST "$API_URL/api/sinistres" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"programme_id\": $PROGRAMME_ID,
    \"date_survenue\": \"2026-02-15\",
    \"date_decl\": \"2026-02-16\",
    \"devise\": \"EUR\",
    \"description\": \"Dégât matériel - entrepôt nord\",
    \"lignes\": [
      {
        \"id_branch\": $BRANCH_ID_A,
        \"statut\": \"ouvert\",
        \"montant_estime\": 12000,
        \"montant_paye\": 0,
        \"montant_recours\": 0,
        \"montant_franchise\": 500,
        \"description\": \"Ligne branche A\"
      }
    ]
  }" | jq .
```

## 4) Lire un sinistre + ses lignes

```bash
export SINISTRE_ID="1"

curl -sS "$API_URL/api/sinistres/$SINISTRE_ID" \
  -H "Authorization: Bearer $TOKEN" | jq .

curl -sS "$API_URL/api/sinistres/$SINISTRE_ID/lignes" \
  -H "Authorization: Bearer $TOKEN" | jq .
```

## 5) Ajouter une ligne (autre branche)

```bash
export BRANCH_ID_B="2"

curl -sS -X POST "$API_URL/api/sinistres/$SINISTRE_ID/lignes" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"id_branch\": $BRANCH_ID_B,
    \"statut\": \"en_cours\",
    \"montant_estime\": 8000,
    \"montant_paye\": 0,
    \"montant_recours\": 0,
    \"montant_franchise\": 300,
    \"description\": \"Ligne branche B\"
  }" | jq .
```

## 6) Mettre à jour une ligne

```bash
export LINE_ID="1"

curl -sS -X PATCH "$API_URL/api/sinistres/$SINISTRE_ID/lignes/$LINE_ID" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"statut\": \"en_cours\",
    \"montant_estime\": 14000
  }" | jq .
```

## 7) Créer un règlement ventilé (ligne obligatoire si plusieurs lignes)

```bash
curl -sS -X POST "$API_URL/api/sinistres/$SINISTRE_ID/reglements" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"sinistre_ligne_id\": $LINE_ID,
    \"date\": \"2026-02-16\",
    \"montant\": 2500
  }" | jq .
```

## 8) Lister les règlements d'un sinistre

```bash
curl -sS "$API_URL/api/sinistres/$SINISTRE_ID/reglements" \
  -H "Authorization: Bearer $TOKEN" | jq .
```

## 9) Vérifier la liste paginée des sinistres

```bash
curl -sS "$API_URL/api/sinistres?page=1&limit=20" \
  -H "Authorization: Bearer $TOKEN" | jq .
```

## Erreurs métier attendues

- `reglement_line_required`: règlement sans `sinistre_ligne_id` alors que le sinistre a plusieurs lignes.
- `cannot_delete_last_line`: tentative de suppression de la dernière ligne d'un sinistre.
- `line_has_reglements`: tentative de suppression d'une ligne qui possède déjà des règlements.
- `line_branch_exists`: branche déjà utilisée dans les lignes du sinistre.
- `branch_not_in_scope`: branche hors périmètre captive.
