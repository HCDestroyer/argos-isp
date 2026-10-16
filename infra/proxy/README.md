# Proxy público (perfil `publico`)

Caddy con TLS automático delante de la API y del panel. El portal **no** pasa por aquí: se publica directo (`PORTAL_BIND_IP`) para que la API vea la IP real del cliente suspendido (`infra/README.md`, "Portal: IP real del cliente").

| Dominio (`infra/.env`) | Va a | Notas |
| --- | --- | --- |
| `PROXY_DOMINIO_API` (`api.localhost`) | `api:3333` | Incluye `POST /api/v1/pasarela/webhook/<proveedor>` con el cuerpo crudo (abajo) |
| `PROXY_DOMINIO_PANEL` (`panel.localhost`) | `web:3000` | |

```sh
# infra/.env: PROXY_DOMINIO_API=api.isp.example, PROXY_DOMINIO_PANEL=panel.isp.example,
# PROXY_BIND_IP=<IP pública>, PROXY_HTTP_PORT=80, PROXY_HTTPS_PORT=443,
# API_PUBLIC_URL=https://api.isp.example (y PASARELA_URL_PUBLICA si usas la pasarela falsa)
COMPOSE_PROFILES=publico docker compose -f infra/docker-compose.yml up -d proxy
```

Con dominios públicos (DNS apuntando a `PROXY_BIND_IP`, puertos 80 y 443 abiertos) Caddy pide el certificado a Let's Encrypt. Con `*.localhost` usa su CA interna (laboratorio). Los certificados viven en el volumen `caddydata`.

Por defecto escucha en `127.0.0.1:8080` y `:8443` para no chocar con el puerto 80 del portal (`PORTAL_BIND_IP`). En producción usa la IP pública con 80 y 443; el portal queda en la IP de la LAN o del túnel hacia los MikroTik.

## Webhook de la pasarela: cuerpo crudo

La pasarela firma el webhook con HMAC sobre el cuerpo **tal como lo envía** (`a3.md`, `app/billing/pasarelas`). Si un proxy lo reformatea (normaliza el JSON, cambia el charset, descomprime, agrega un salto de línea) la firma deja de coincidir y la API responde 401 `firma_invalida`: el pago no se registra.

El `Caddyfile` trata `/api/v1/pasarela/webhook/*` aparte: `reverse_proxy` sin `encode`, sin reescrituras y con `flush_interval -1`; `request_body` solo limita el tamaño (1 MB). No agregues ahí WAF, normalización ni compresión. Si se usa otro proxy (nginx, un balanceador del proveedor), las mismas reglas: en nginx, `proxy_pass` sin `proxy_set_body`, sin `gunzip on` y con `proxy_request_buffering off` en esa ruta.

**Prueba** (`infra/proxy/probar-webhook.sh`, también en CI): levanta Caddy con este `Caddyfile` y una "API" de eco que verifica la firma como la pasarela falsa, y manda por HTTPS un JSON con espacios, acentos y escapes, un formulario, un cuerpo con `Content-Encoding: gzip` y uno de 200 KB. Los bytes y la firma llegan intactos; una firma alterada vuelve como 401.
