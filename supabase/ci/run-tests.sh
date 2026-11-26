#!/usr/bin/env bash
# Aplica todas as migrations num PostgreSQL vazio (com uma simulação mínima do Supabase)
# e roda supabase/tests/*.sql. Conexão pelas variáveis padrão: PGHOST, PGPORT, PGUSER, PGPASSWORD.
# Uso: supabase/ci/run-tests.sh [nome-do-banco]
set -euo pipefail
cd "$(dirname "$0")/.."
DB="${1:-junto_ci}"
dropdb --if-exists "$DB" 2>/dev/null || true
createdb "$DB"
run() { PGOPTIONS="-c client_min_messages=warning" psql -d "$DB" -v ON_ERROR_STOP=1 -q -f "$1"; }
run ci/supabase-shim.sql
for file in migrations/*.sql; do
  run "$file" || { echo "Migration falhou: $file"; exit 1; }
done
echo "Migrations aplicadas: $(ls migrations/*.sql | wc -l)"
run ci/seed-users.sql
failed=0
for file in tests/*.sql; do
  if output=$(run "$file" 2>&1); then echo "ok   $file"; else echo "FAIL $file"; echo "$output"; failed=1; fi
done
exit $failed
