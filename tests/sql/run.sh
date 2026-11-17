#!/bin/bash
# Teste les migrations Supabase sur un PostgreSQL vide : chaque script s'applique, se relance sans erreur,
# et les scénarios (amis, messagerie, protection des mineurs, avis, fan arts, modération…) donnent les résultats attendus.
# Usage : PGHOST=… PGUSER=postgres PGPASSWORD=… bash tests/sql/run.sh            (compare à tests/sql/attendu.txt)
#         bash tests/sql/run.sh --maj                                              (enregistre le nouveau résultat attendu)
set -euo pipefail
D=$(cd "$(dirname "$0")" && pwd); M="$D/../../supabase/migrations"
psql -X -q -d postgres -c "drop database if exists animetest" -c "create database animetest template template0 encoding 'UTF8' lc_collate 'C.UTF-8' lc_ctype 'C.UTF-8'" >/dev/null
export PGDATABASE=animetest
P="psql -X -q -v ON_ERROR_STOP=1"
$P -f "$D/stub.sql" >/dev/null 2>&1
for pass in 1 2; do     # deux passages : les scripts doivent pouvoir être relancés
  for f in "$M"/2026*.sql; do
    $P -f "$f" >/dev/null 2>"$D/.err" || { echo "ÉCHEC (passage $pass) : $(basename "$f")"; cat "$D/.err"; exit 1; }
  done
done
echo "migrations : OK (appliquées puis relancées)"
cat "$D"/[0-9]-*.sql | psql -X -q -t -v ON_ERROR_STOP=0 2>&1 \
  | grep -v '^\s*$' | grep -v 'set_config\|NOTICE\|CONTEXT\|PL/pgSQL\|SQL statement\|SQL function\|wal_level\|logical' \
  | grep -vE '^ ?[0-9a-f]{8}-[0-9a-f]{4}-' \
  | sed -E 's#^psql:[^:]*:[0-9]+: ##; s#[0-9]{2}/[0-9]{2} [0-9]{2}:[0-9]{2}#JJ/MM HH:MM#g' > "$D/.resultat.txt"
if [ "${1:-}" = "--maj" ]; then cp "$D/.resultat.txt" "$D/attendu.txt"; echo "résultat attendu mis à jour"; exit 0; fi
if diff -u "$D/attendu.txt" "$D/.resultat.txt"; then echo "scénarios : OK ($(wc -l < "$D/attendu.txt") lignes identiques)"; else echo "ÉCHEC : résultat différent de tests/sql/attendu.txt"; exit 1; fi
