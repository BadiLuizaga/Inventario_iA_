# Sitio estático (tienda, almacén y panel) servido con Nginx.
# No contiene secretos: js/config.js se genera al arrancar a partir de las
# variables públicas SUPABASE_URL y SUPABASE_PUBLISHABLE_KEY.
FROM nginx:1.27-alpine

COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY docker/40-config-js.sh /docker-entrypoint.d/40-config-js.sh
RUN chmod +x /docker-entrypoint.d/40-config-js.sh

COPY index.html almacen.html admin.html manifest.webmanifest /usr/share/nginx/html/
COPY icon-192.png icon-512.png icon-maskable-512.png /usr/share/nginx/html/
COPY css /usr/share/nginx/html/css
COPY js /usr/share/nginx/html/js
COPY modelos /usr/share/nginx/html/modelos

# El usuario de Nginx debe poder escribir config.js al arrancar
RUN rm -f /usr/share/nginx/html/js/config.js \
 && touch /usr/share/nginx/html/js/config.js \
 && chown nginx:nginx /usr/share/nginx/html/js/config.js

EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --retries=3 CMD wget -qO- http://127.0.0.1/salud >/dev/null || exit 1
