#!/usr/bin/env bash
# Trae `main` a una rama de agente en un worktree temporal, resuelve lo mecánico y verifica.
#
#   scripts/integrar.sh agente/a4-panel            # mezcla y verifica, no sube nada
#   scripts/integrar.sh agente/a4-panel --push     # además sube la rama si todo pasa
#
# Resuelve solo conflictos mecánicos:
#   - .claude/integration/*.md y .claude/STATUS.md → unión de ambos lados
#   - pnpm-lock.yaml y packages/contracts/*        → se regeneran con pnpm (nunca a mano)
# Cualquier otro conflicto detiene el script y deja el worktree para resolverlo a mano.
# Verifica con lint, typecheck, pruebas y contratos sin cambios. Variables: DB_DATABASE
# (por defecto argosisp_test_integracion; se borra y se crea de nuevo) y PORT (por defecto 3490).
set -euo pipefail

rama="${1:?uso: scripts/integrar.sh <rama> [--push]}"
subir="${2:-}"
raiz="$(git rev-parse --show-toplevel)"
dir="$(mktemp -d "${TMPDIR:-/tmp}/integrar-XXXXXX")"
export DB_DATABASE="${DB_DATABASE:-argosisp_test_integracion}" PORT="${PORT:-3490}" AAA_PRUEBAS_DOCKER="${AAA_PRUEBAS_DOCKER:-0}"
# Redis también se comparte: colas y claves AAA con prefijo propio, para que la limpieza de una
# suite no borre las claves de otra que corre al mismo tiempo.
export COLAS_PREFIJO="${COLAS_PREFIJO:-integracion}"
export AAA_REDIS_PREFIJO="${AAA_REDIS_PREFIJO:-$COLAS_PREFIJO:aaa:user:}"

git -C "$raiz" fetch -q origin
git -C "$raiz" worktree add -q --detach "$dir" "origin/$rama"
cd "$dir"
echo "== $rama ($(git rev-parse --short HEAD)) ← origin/main ($(git rev-parse --short origin/main))"

if git merge-base --is-ancestor origin/main HEAD; then
    echo "La rama ya contiene main."
elif ! git merge -q --no-edit origin/main -m "merge: main en $rama" >/dev/null 2>&1; then
    for f in $(git diff --name-only --diff-filter=U); do
        case "$f" in
            .claude/integration/*.md | .claude/STATUS.md)
                base="$(mktemp)"; nuestro="$(mktemp)"; suyo="$(mktemp)"
                git show ":1:$f" >"$base" 2>/dev/null || : >"$base"
                git show ":2:$f" >"$nuestro"; git show ":3:$f" >"$suyo"
                git merge-file --union "$nuestro" "$base" "$suyo"
                cp "$nuestro" "$f"; git add "$f" ;;
            pnpm-lock.yaml | packages/contracts/*)
                git checkout --ours "$f"; git add "$f" ;;
            *) echo "Conflicto que requiere decisión: $f" ;;
        esac
    done
    if [ -n "$(git diff --name-only --diff-filter=U)" ]; then
        echo "Quedan conflictos reales. Worktree en $dir para resolverlos."
        exit 1
    fi
    git commit -q --no-edit
fi

[ -f apps/api/.env ] || cp apps/api/.env.example apps/api/.env

# Base de pruebas recién creada: una base usada por otra rama puede tener migraciones que esta
# rama no conoce y el rollback inicial de las pruebas falla. Requiere dropdb/createdb y un
# usuario con permiso para crear bases (en desarrollo, el de apps/api/.env).
if command -v createdb >/dev/null 2>&1; then
    export PGHOST="${DB_HOST:-localhost}" PGPORT="${DB_PORT:-5432}" PGUSER="${DB_USER:-argosisp}" PGPASSWORD="${DB_PASSWORD:-argosisp}"
    dropdb --if-exists "$DB_DATABASE" && createdb "$DB_DATABASE" && echo "Base de pruebas $DB_DATABASE recreada."
fi
pnpm install >/dev/null
pnpm contracts:build >/dev/null
if [ -n "$(git status --porcelain -- packages/contracts pnpm-lock.yaml)" ]; then
    git add packages/contracts pnpm-lock.yaml
    git commit -q -m "chore(contracts): regenerar tras traer main"
    echo "Contratos y lockfile regenerados."
fi

fallo=0
for c in lint typecheck test; do
    if pnpm "$c" >"$dir/.integrar-$c.log" 2>&1; then echo "  $c: ok"; else echo "  $c: FALLA (ver $dir/.integrar-$c.log)"; fallo=1; fi
done
if [ -f scripts/verificar-permisos.mjs ]; then
    node scripts/verificar-permisos.mjs >/dev/null 2>&1 && echo "  permisos: ok" || { echo "  permisos: FALLA"; fallo=1; }
fi

if [ "$fallo" = 1 ]; then
    echo "No se sube nada. Worktree en $dir"
    exit 1
fi
if [ "$subir" = "--push" ]; then
    git push -q origin "HEAD:$rama"
    echo "Subida $rama → $(git rev-parse --short HEAD)"
fi
cd "$raiz"
git worktree remove --force "$dir"
echo "Listo."
