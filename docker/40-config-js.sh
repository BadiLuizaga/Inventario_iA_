#!/bin/sh
# Genera js/config.js con la configuración PÚBLICA del cliente.
# Se niega a escribir claves secretas (sb_secret_… o service_role).
set -eu

OUT=/usr/share/nginx/html/js/config.js
URL="${SUPABASE_URL:-}"
KEY="${SUPABASE_PUBLISHABLE_KEY:-}"
NOMBRE="${TIENDA_NOMBRE:-Tienda de calzado}"
MONEDA="${MONEDA:-Bs}"

case "$KEY" in
  sb_secret_*)
    echo "ERROR: SUPABASE_PUBLISHABLE_KEY contiene una clave SECRETA. Usa la publishable/anon." >&2
    KEY="" ;;
esac
# JWT con role service_role
if [ -n "$KEY" ] && echo "$KEY" | cut -d. -f2 | tr '_-' '/+' | base64 -d 2>/dev/null | grep -q '"role":"service_role"'; then
  echo "ERROR: SUPABASE_PUBLISHABLE_KEY es una clave service_role. Usa la publishable/anon." >&2
  KEY=""
fi

# Escapa comillas y barras para un literal JS
esc() { printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e "s/'/\\\\'/g"; }

cat > "$OUT" <<EOF
/* Generado al arrancar el contenedor. Solo valores públicos. */
export default {
  SUPABASE_URL: '$(esc "$URL")',
  SUPABASE_PUBLISHABLE_KEY: '$(esc "$KEY")',
  TIENDA_NOMBRE: '$(esc "$NOMBRE")',
  MONEDA: '$(esc "$MONEDA")',
};
EOF

if [ -z "$URL" ] || [ -z "$KEY" ]; then
  echo "AVISO: faltan SUPABASE_URL o SUPABASE_PUBLISHABLE_KEY; la app arrancará sin base de datos." >&2
fi
