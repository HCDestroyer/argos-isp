# Contrato (borrador): identificar al cliente cortado en la página de corte

> **Estado:** fase 1 implementada (rama `a5/identificar-cortado`), con las decisiones del PM del 8 nov (§5). Fase 2 (túnel, servidor en la LAN y nodo de portal, P6 y P7) diseñada e implementada en `a6/corte-fase2` (§5 ter). La fase 3 (pools repetidos con alias por router, IPv6 por el túnel) sigue abierta. Dueño: A5 (portal). Afecta a A1 (núcleo/IPAM, script de conexión), A2 (aaa/coa), A4 (panel), A6 (infra: WireGuard, Caddy, instalador) y routeros (reconciliador).
>
> **Origen:** bug del PM en producción, v1.12.0: «Ya redirige a la pantalla de corte, pero existe un problema para identificar el servicio que está cortado, ya que toma la IP del server o IP privada y no del servicio asignado».
>
> **Instalación del PM:** servidor con IP pública 167.250.223.15, Nginx Proxy Manager (NPM) en 80/443, Caddy de Argos con el corte en `:8088` (cualquier Host). Router MikroTik con API y RADIUS, clientes PPPoE con IPv4 privadas (p. ej. 10.66.1.3), dst-nat de los suspendidos hacia `portal_v4:portal_puerto` (Configuración → Portal de corte).

## 0. Resumen

- **Causa confirmada en el código:** el portal identifica al cliente solo por la IP de origen de la petición HTTP. En la topología del PM esa IP se pierde dos veces antes de llegar a la API:
    1. **En el router:** el masquerade hacia la WAN cambia 10.66.1.3 por la IP pública del router. Lo instala el propio script de conexión de Argos (§1.2).
    2. **En el servidor:** NPM y la red de Docker cambian el origen por la puerta de enlace del bridge (172.x) si `ARGOSISP_PROXIES_CONFIABLES` no incluye a NPM. Con NPM incluido, Caddy recupera la IP que vio NPM, que sigue siendo la del router (§1.4).
    3. **Además, el portal saca al cliente del camino del dst-nat:** la primera petición llega al `:8088`, pero el portal responde `302` a `https://DOMINIO_PORTAL/corte`. La página y la llamada `quien-soy` que identifica al cliente viajan después por Internet, a NPM:443, con masquerade. Aunque el dst-nat conservara la IP, esa llamada la pierde (§1.3).
- **No hay una sola solución que cubra todos los escenarios.** La recomendación (§4) es identificar en este orden:
    1. **Código por servicio puesto por el router** (`/ip proxy access action=redirect`, RouterOS 7). No depende de la IP que ve el servidor. Sirve para routers con API (el caso del PM).
    2. **IP del cliente sin NAT**, solo cuando la red lo garantiza: túnel WireGuard con las redes de clientes en AllowedIPs, ruta privada sin NAT, o IPv6 nativo. El portal valida que la IP sea de una red de clientes y no de un router, del servidor o de un proxy.
    3. **No identificado, dicho claro:** la página muestra qué IP ve el portal y por qué no sirve, y ofrece identificarse con el código por teléfono o correo que ya existe.
- **Para el PM, lo inmediato es la opción 1** (su router tiene API). La opción 2 (túnel) queda para routers sin API y como respaldo. Las dos se pueden hacer por fases (§4.4).

---

## 1. Cómo funciona hoy, de punta a punta (main, v1.12.0)

### 1.1 Corte en el router

- Suspender PPPoE: `aaa` responde con el perfil `suspendido`. El perfil tiene `address-list=suspendidos` e `interface-list=suspendidos` (`apps/api/app/network/routeros/corte_router.ts`, `estadoCorteRouter`, objeto `/ppp/profile`). `coa` desconecta o manda CoA según `modo_suspension` (`core.portal_corte`). Servicios sin PPPoE: el dispatcher de routeros pone la IPv4 en `suspendidos` (`contratos/routeros.md`).
- Filtro: saltos `argosisp:top corte …` a `argos-corte`, que deja pasar DNS (53) a cualquier resolver, `argos-portal` y `argos-walled`. Todo lo demás recibe `tcp-reset` o `icmp-admin-prohibited` (`reglasFiltro` en `corte_router.ts`; `contratos/control-velocidad.md` §10.5).
- NAT (`reglasNat` en `corte_router.ts`; `infra/mikrotik/piezas/servicio-firewall.rsc`, líneas 93-100):
    - `dstnat` de `suspendidos` → `argos-corte-nat`.
    - `argos-portal` y `argos-walled` → `return` (sin NAT).
    - `tcp dst-port=80` → `dst-nat to-addresses=<portal_v4> to-ports=<portal_puerto>` (comentario `argosisp: corte-nat HTTP a /corte`).
    - IPv6: lo mismo hacia `portal_v6/128`, solo si `portal_v6` está configurado.
- `portal_v4` sale de `core.portal_corte`. Si está vacío, sale de `PORTAL_URL_PUBLICA` (IP, o el FQDN resuelto en cada pasada). Ver `configCorte` y `configCorteResuelta` en `corte_router.ts`, y `configCorteVigente` en `corte_vigente.ts`.

### 1.2 Masquerade: lo instala el propio script de Argos

`infra/mikrotik/piezas/servicio-firewall.rsc:100` y `infra/mikrotik/plantillas/conexion-servicio.rsc.tpl:364`:

```
add chain=srcnat src-address-list=argos-clientes out-interface=$wanIf action=masquerade comment="argosisp: NAT de clientes del laboratorio"
```

El script de conexión con `?incluir=servicio` lo escribe también en producción. El paquete del suspendido sale con destino `portal_v4` (la IP pública del servidor), después del dst-nat. Sale por `$wanIf` y queda con origen = **IP pública del router**. Aunque el router no tuviera esa regla, casi todos los ISP tienen su propio masquerade de clientes privados hacia Internet, y el efecto es el mismo. No se puede quitar: sin él, las respuestas a una IP privada no vuelven por Internet.

### 1.3 Portal: dos saltos, y el segundo sale del camino del corte

1. **Primer salto (dst-nat → Caddy `:8088`).** Ejemplo: `http://ejemplo.com/` o la sonda `connectivitycheck.gstatic.com/generate_204` llega a Caddy (`infra/produccion/config/Caddyfile`, sitio `http://, :{$PORTAL_CORTE_PUERTO:8088}`) y de ahí a Nitro (`portal:3001`). El middleware `apps/portal/server/middleware/portal-cautivo.ts`:
    - pregunta `GET /api/v1/portal/destino-corte` por la IP (`leerDestinoCorte` en `apps/api/app/portal/consultas.ts`);
    - responde `302` a la `url_corte` de la empresa o a `destinoCorte(config)` (`apps/portal/server/utils/portalCautivo.ts`).

   `destinoCorte` es **absoluto** si existe `urlPublica`, y en producción siempre existe: `NUXT_PORTAL_URL_PUBLICA: ${PORTAL_URL_PUBLICA:-https://${DOMINIO_PORTAL}}` (`infra/produccion/docker-compose.produccion.yml:414`).
2. **Segundo salto (navegador → `https://DOMINIO_PORTAL/corte`).** `DOMINIO_PORTAL` está en `argos-portal`, así que el router no lo redirige: el filtro lo acepta y el NAT hace `return`. Pero **sí le aplica el masquerade** hacia la WAN. El navegador llega a NPM:443 → Caddy:8443 → Nitro. La página llama `GET /api/v1/portal/quien-soy` **solo desde el navegador** (`server: false` en `apps/portal/app/composables/useCorte.ts`). Lo mismo hacen `GET /portal/estado` (sondeo cada 5 s), `POST /portal/promesas` sin sesión (`servicioDeLaPeticion` en `apps/api/app/portal/promesas.ts`) y el comprobante.

Conclusión: **aunque el `:8088` viera la IP real** (túnel, ruta privada), la identificación (`quien-soy`), el sondeo de reactivación y la promesa se resuelven en el segundo salto, por Internet.

### 1.4 Cómo resuelven la IP Caddy, Nitro y la API

| Paso | Archivo | Qué hace |
| --- | --- | --- |
| Caddy (todos los sitios, también `:8088`) | `infra/produccion/config/Caddyfile`, bloque global `servers { trusted_proxies static {$ARGOSISP_PROXIES_CONFIABLES}; trusted_proxies_strict; client_ip_headers X-Forwarded-For X-Real-IP }` y snippet `(ip_cliente)` | `{client_ip}` = IP del socket. Solo si el socket viene de `ARGOSISP_PROXIES_CONFIABLES`, toma la IP de `X-Forwarded-For` (de derecha a izquierda) o `X-Real-IP`. Hacia arriba manda `X-Forwarded-For: {client_ip}`, ya resuelta |
| Nitro | `apps/portal/server/utils/reenvioApi.ts` (`cadenaReenvio`, `cabecerasReenvio`), `apps/portal/server/api/v1/portal/[...ruta].ts` | Agrega la IP del socket al final de `X-Forwarded-For` y reenvía a la API. Con token de nodo portal manda `X-Argos-Cliente-Ip` |
| API | `apps/api/app/portal/ip_origen.ts` (`resolverIpOrigen`) | Recorre `X-Forwarded-For` desde la derecha mientras la IP sea de `PORTAL_PROXIES_CONFIABLES` (por defecto la subred de compose, `docker-compose.produccion.yml:120`) |
| IP → servicio | `apps/api/app/network/consultas/ip.ts` (`resolverIp`), usado por `resolverServicio` en `apps/api/app/portal/consultas.ts` | Sesión activa o asignación vigente que contiene la IP. Gana el prefijo más largo. **No considera el router** |

**Dónde se pierde la IP en el caso del PM.** El suspendido 10.66.1.3 abre `https://DOMINIO_PORTAL/corte`:

1. Router: masquerade → origen = IP pública del router (R).
2. NPM (Docker en el mismo servidor) ve R y manda `X-Forwarded-For: R` a Caddy:8443. Docker hace masquerade entre redes, así que Caddy ve el socket desde la puerta de enlace de compose, `172.30.0.1` (`docs/runbooks/detras-de-proxy.md` §1).
    - Con `ARGOSISP_PROXIES_CONFIABLES` vacío: `{client_ip}` = **172.30.0.1** (la «IP privada» del reporte).
    - Con `172.30.0.1/32`: `{client_ip}` = **R** (la «IP del server»: es la IP pública del router, o la del servidor si NPM reenvía por la IP pública y Docker hace hairpin; se confirma con el chequeo de §4.3).
3. Ninguna de las dos es una asignación de un servicio → `identificado: false`.

**Riesgo de seguridad encontrado.** `trusted_proxies` es global en Caddy y también vale para el sitio `:8088`. Si `ARGOSISP_PROXIES_CONFIABLES` incluye la puerta de enlace de Docker y una conexión al `:8088` llega desde ella, Caddy toma el `X-Forwarded-For` que escribió el cliente. Eso pasa con un puerto publicado por `docker-proxy` (userland-proxy), con IPv6 publicado, con hairpin o con Docker sin iptables. En ese caso un suspendido puede hacerse pasar por otra IP: ver datos parciales de otro cliente o crear una promesa a su nombre. El runbook ya lo advierte para IPv6, pero no para el `:8088`. Arreglo propuesto en §4.2 (A6): el sitio del corte nunca confía en encabezados.

### 1.5 Diagnóstico actual

`chequeoPortal` (`apps/api/app/network/routeros/diagnostico.ts`, chequeo `portal_http`) hace `/tool/fetch` **desde el router** a `http://<to-addresses>:<to-ports>/corte`. Solo comprueba que el destino responde. Como el origen es el propio router, **no puede ver** si el portal recibe la IP del cliente o la del NAT.

---

## 2. Matriz de escenarios

Leyenda de mecanismos:

- **IP**: identificación por la IP de origen (hoy).
- **COD**: código por servicio en la URL, puesto por el router (opción B).
- **WG**: túnel WireGuard sin masquerade, con ruta de vuelta (opción A).
- ✅ funciona · ⚠️ funciona con condiciones · ❌ no funciona.

### 2.1 Control del router

| Escenario | IP que ve el portal hoy | Qué identifica | Qué escribe Argos en el router | Qué falla |
| --- | --- | --- | --- | --- |
| RADIUS **y** API (PM) | Pública del router (masquerade) o 172.x (NPM) | COD ✅; WG ⚠️; IP ❌ | Hoy: reglas de corte de nivel router. Con COD: una regla `/ip proxy access` por servicio suspendido | Hoy, la identificación. Con COD, solo si el router estaba sin contacto al suspender (§2.7) |
| Solo RADIUS, sin API | Igual | WG ⚠️ (configurado una vez por script); IP ❌ | Nada en caliente: solo el script de conexión | No hay reglas por cliente (no hay API), así que no hay COD. Sin túnel, nada identifica: la página lo dice y ofrece el código por teléfono o correo |
| Modo `api`, sin RADIUS (`modo_seguridad = 'api'`, WISP) | Igual | COD ✅; WG ⚠️ | Además de colas, leases y `suspendidos` por servicio (`contratos/routeros.md`), la regla `proxy access` | Igual que el caso del PM |

### 2.2 Tipo de acceso y familia IP

| Escenario | IP | COD | WG | Notas |
| --- | --- | --- | --- | --- |
| PPPoE con `Framed-IP` de Argos | ❌ con NAT | ✅ (`src-address` = la IPv4 asignada) | ✅ | La IP no cambia al reconectar suspendido |
| PPPoE con pool del router (sin `Framed-IP`) | ❌ | ⚠️ la regla debe escribirse con la IP de la sesión, y otra vez en cada `sesion.iniciada` del suspendido | ✅ si el pool está en las redes del router | Con `modo_suspension=desconectar` la IP puede cambiar al reconectar |
| DHCP fija / IP estática (WISP) | ❌ | ✅ | ✅ | La IP es la asignación |
| IPv6 nativo (/64 de enlace, /56 delegado), sin NAT | ✅ si el servidor tiene IPv6 nativo **y** no pasa por `docker-proxy` (Docker con IPv6 publicado entrega la puerta de enlace) | ✅ (`src-address` acepta prefijo IPv6; **probar**) | — | `resolverIp` ya resuelve un /128 dentro del /64 o del /56. Requiere `portal_v6` y el perfil suspendido en IPv6 (§10.5) |
| Dual stack | El navegador prefiere IPv6 si `DOMINIO_PORTAL` tiene AAAA | ✅ | ✅ | La identificación puede salir por IPv4 o por IPv6 según el salto: el portal no debe asumir una familia |
| CGNAT del ISP (100.64/10) o NAT en otro equipo entre el router de acceso y el servidor | ❌ | ✅ (la regla está en el router de acceso, que ve la IP real) | ⚠️ solo si el túnel sale del router de acceso | Una IP pública compartida entre muchos clientes no identifica a ninguno |
| Varios equipos detrás del CPE del cliente | Da igual: el router ve la IP del servicio | ✅ | ✅ | Se identifica el servicio, no el equipo |

### 2.3 Dónde corre el servidor

| Escenario | IP que ve la API por el `:8088` | Por el dominio HTTPS | Notas |
| --- | --- | --- | --- |
| IP pública directa, Caddy en 80/443 | Pública del router (masquerade) | Igual | Docker con iptables conserva el origen en puertos publicados por IPv4 |
| Detrás de NPM u otro proxy | Igual por el `:8088` (no pasa por NPM) | 172.30.0.1 sin `ARGOSISP_PROXIES_CONFIABLES`; la que vio NPM con él | **El caso del PM** |
| Docker con userland-proxy (IPv6 publicado, hairpin o `iptables: false`) | Puerta de enlace del bridge | Igual | Con esa puerta de enlace como confiable, cualquiera falsifica `X-Forwarded-For` (§1.4) |
| Servidor en la LAN del ISP | Real **si** el router llega por una ruta sin NAT (el masquerade suele ser `out-interface=WAN`) y el servidor tiene ruta de vuelta a los pools | Pública del router: el dominio resuelve a la IP pública y sale por la WAN | Solo se arregla manteniendo al suspendido en el camino del dst-nat (§3, A′) o con COD |
| Nodo de portal separado (`docker-compose.nodo-portal.yml`, `contratos/nodo-portal.md`) | La que vea el Caddy del nodo; viaja en `X-Argos-Cliente-Ip` | Igual | El problema se mueve al nodo; COD no depende de eso |
| Varios servidores (`api` y `api-portal`, réplicas) | Igual | Igual | COD: los códigos están en Postgres y el límite en Redis, compartidos |

### 2.4 Conectividad router ↔ servidor

| Escenario | IP | COD | Qué hace falta |
| --- | --- | --- | --- |
| Por Internet, con masquerade | ❌ | ✅ | — |
| WireGuard (existe: `infra/wireguard/`, `ARGOSISP_WG_RED`) | ❌ hoy | ✅ | Hoy el túnel solo lleva RADIUS, REST y CoA. `agente.sh:93` pone `AllowedIPs = <ip_tunel>/32` y el firewall `ARGOSISP-IN/FWD-wg-argos` (`servidor.sh`) solo deja entrar UDP 1812/1813. Para identificar por IP (§3, A) hacen falta: las redes de clientes en AllowedIPs, rutas en el host, abrir el puerto del corte, `srcnat accept` en el router y mantener **los dos saltos** dentro del túnel |
| Ruta privada / MPLS sin NAT | ✅ si el masquerade no aplica a esa salida y hay ruta de vuelta | ✅ | El segundo salto por el dominio público sigue con NAT (§1.3) |

### 2.5 Pools privados repetidos en varios routers

- Argos **no permite** hoy que se traslapen redes ni asignaciones:
    - `network.redes_ipv4`: `EXCLUDE USING gist (cidr inet_ops WITH &&)` (`apps/api/database/migrations/1760900000003_crear_network.ts`).
    - IPv4 vigente única: `ipv4_asignaciones_ip_vigente`.
    - Prefijos IPv6 sin traslape: `1793922389658_create_network_reuso_restricciones_table.ts`.
- Pero `network.sesiones` puede traer IPs de pools que el router asigna sin pasar por el IPAM de Argos. Si dos routers repiten 10.66.1.3, `resolverIp` elige la sesión más reciente. **Una IP sola no basta.**
- **COD** no tiene este problema: la regla vive en un solo router.
- **WG** lo resuelve a medias: WireGuard no acepta AllowedIPs traslapados entre peers, así que dos routers con el mismo pool no pueden ir por el túnel sin renumerar. A cambio, el servidor sabe **por qué peer llegó** el paquete, y eso autentica el origen.
- Para identificar por IP con pools repetidos haría falta el par (router, IP): sesiones por `nas_ip` y llegada por un túnel o un puerto distinto por router. Ver opción E.

### 2.6 Multiempresa

- Empresas distintas en el mismo router: el dst-nat es uno solo (global, `core.portal_corte`). COD resuelve el servicio, y con él la empresa y la marca (`marcaDeEmpresa`).
- `url_corte` externa por empresa (§10.6): hoy el portal redirige a ella después de identificar por IP (`destino-corte`). Con COD, la regla del router puede llevar directamente a la `url_corte` de la empresa del servicio. Pero la página externa no sabe resolver el código: **decisión del PM** (§5, P3).

### 2.7 Navegador, sistema operativo y protocolo

| Caso | Qué pasa | IP | COD |
| --- | --- | --- | --- |
| Sitio HTTPS escrito a mano | El router hace `tcp-reset` al 443: no se puede redirigir sin un error de certificado. El navegador muestra error de conexión | — | — (la redirección la hace la sonda HTTP del sistema) |
| HSTS / sitios precargados | Igual: el navegador nunca prueba por HTTP | — | — |
| Detección de portal cautivo: Android (`connectivitycheck.gstatic.com/generate_204` y variantes), iOS/macOS (`captive.apple.com/hotspot-detect.html`), Windows (`www.msftconnecttest.com/connecttest.txt`, `/redirect`), Firefox, GNOME… (catálogo `SONDAS` en `apps/portal/server/utils/portalCautivo.ts`) | La sonda es HTTP/80 y entra al dst-nat. Hoy recibe `302`. Con COD el router responde `307` (documentado: «Answer with HTTP 307») | ❌ con NAT | ✅ |
| Mini-navegador de iOS/macOS (CNA) | Tiene sus propias cookies: no comparte sesión con Safari | ❌ | ✅ (el código va en la URL) |
| Apps que no son navegador | Fallan sin aviso: no hay remedio en red | — | — |
| DNS sobre HTTPS (443) o DoT (853) | Reciben `tcp-reset` y el equipo vuelve al DNS normal (§10.5). **Android con DNS privado estricto** puede quedar «sin Internet» sin abrir el portal: **probar en laboratorio** | — | — |
| QUIC (UDP/443) | Rechazado: el navegador cae a TCP | — | — |

### 2.8 Estado del servicio y ciclo de vida

| Caso | Qué debe pasar | Riesgo |
| --- | --- | --- |
| Limitado (no cortado) | No está en `suspendidos`, así que no hay dst-nat ni regla COD. Navega lento; si abre el portal, lo identifica la sesión o la IP (con NAT no) | Mostrar «limitado» solo si se identificó |
| Promesa activa | Se reactiva: sale de `suspendidos` y la regla COD se borra con `servicio.estado_cambiado` | — |
| Reactivado mientras mira la página | Hoy `/portal/estado` sondea cada 5 s **por IP**, y con NAT nunca se entera. Con COD el sondeo usa el código | El código debe seguir resolviendo un rato después de reactivar (para mostrar «ya tienes servicio») |
| Reactivado, pero con la regla vieja en el router | Inofensivo mientras su IP no esté en `suspendidos`: el proxy solo recibe lo que manda el dst-nat. La reconciliación la borra | — |
| Retirado, o su IP reasignada a otro servicio | **Peligro:** si el nuevo dueño de la IP es suspendido y la regla vieja sigue, el router lo manda con el código **del cliente anterior** | Al escribir la regla de una IP se borra cualquier otra `argosisp:servicio:*` (regla de proxy) con la misma `src-address`. El código solo resuelve mientras el servicio está suspendido o en la ventana de gracia. La regla se reescribe con `asignacion.cambiada` y `sesion.iniciada` |
| Router reiniciado | Las reglas de `/ip proxy access` son configuración persistente: sobreviven al reinicio | — |
| Router sin contacto al suspender | RADIUS suspende igual, pero la regla COD no se escribe. El cliente cae en la regla final sin código → IP → «no identificado» con la salida manual | Reintentos (BullMQ) y reconciliación al volver el router (`reconciliar_router.ts`). `routeros.fallido` |
| Huérfanos | Reglas de proxy `argosisp:servicio:<id>` de servicios no suspendidos, o con otra IP | Las borra el reconciliador (como `argosisp:servicio:*`) |

### 2.9 Seguridad

| Amenaza | Hoy | Con la propuesta |
| --- | --- | --- |
| IP falsa | Por TCP no se puede falsificar el origen. Por WG, cryptokey routing: solo el peer con esa red en AllowedIPs puede mandarla | Igual |
| `X-Forwarded-For` falsificado | Seguro **solo** si los confiables son exactos. En el `:8088`, con `docker-proxy` y la puerta de enlace como confiable, se puede falsificar (§1.4) | El `:8088` ignora siempre los encabezados (§4.2, A6) |
| Código adivinado | — | ≥ 64 bits aleatorios (13 caracteres base32 Crockford). Nunca el id ni algo secuencial. Límite por IP **y** fallos por código en Redis; 404 genérico sin decir si existió |
| Código compartido o filtrado (captura de pantalla, historial) | — | Solo da lo mismo que hoy da la IP: nombre parcial, estado, montos, pedir promesa y subir comprobante. Facturas, pagos y datos siguen detrás de la verificación por código al teléfono o correo. Se renueva en cada suspensión y deja de resolver al reactivar más la gracia |
| Límite por IP con NAT | **Problema actual:** todos los suspendidos detrás de un router comparten la IP pública. El día de corte masivo, 30 peticiones/min (`PORTAL_LIMITE_PETICIONES`, `limite_peticiones.ts`) bloquean a todos | Con código, el límite se cuenta por código o servicio; por IP solo como tope alto anti-abuso |
| Identificar por una IP de infraestructura | Si la IP pública del router o del servidor estuviera dentro de una asignación (bloque público compartido con clientes), se mostrarían datos **de otro cliente** | La identificación por IP descarta las IPs de routers (`network.routers`, túnel), del servidor y de los proxies confiables, y lo explica (§4.3) |

---

## 3. Opciones de solución

### A) Identificación por IP con túnel WireGuard sin masquerade

**Qué es.** El dst-nat apunta a la IP del servidor en el túnel (10.255.0.1). El router no hace masquerade hacia el túnel (`srcnat dst-address=<ip del servidor en el túnel> action=accept`, antes del masquerade). El servidor:

- acepta en `wg-argos` las redes de clientes del router: AllowedIPs = `/32` del túnel + `redes_ipv4` + bloques IPv6 del router, que Argos conoce;
- tiene la ruta de vuelta, porque `wg syncconf` no crea rutas: hace falta `ip route` por cada red, o `wg-quick`;
- abre el puerto del corte desde el túnel (`servidor.sh`, cadenas `ARGOSISP-*-wg-argos`).

**A′ (condición necesaria).** Mantener los dos saltos en el túnel. Para un suspendido que llegó por el dst-nat, el portal redirige a `http://<portal_v4>:<puerto>/corte` (relativo o al destino del NAT), **no** a `https://DOMINIO_PORTAL`. Si no, el segundo salto vuelve a Internet. La alternativa es una política de ruteo en el router (mangle `mark-routing` de `argos-clientes` → `argos-portal` por `wg-argos`), más frágil porque el endpoint del túnel es la misma IP pública.

**Pros:**

- Sirve para routers **sin API**: se configura una vez con el script.
- El origen queda autenticado por WireGuard.
- No escribe nada por cliente.

**Contras:**

- Mucha infraestructura: AllowedIPs dinámicos con eventos de redes, rutas en el host, firewall, y cambiar `portal_v4` según el router (hoy es global).
- La página de corte por HTTP plano en el segundo salto: el pago en línea y `/entrar` ya van a HTTPS por el dominio.
- No sirve con pools que se repiten.
- Depende de que el túnel esté arriba. Si se cae, no hay página de corte: hace falta un respaldo (otra regla dst-nat a la IP pública) y lo identificaría mal.

**Falla en:** routers sin túnel; CGNAT entre el router de acceso y el de borde; pools repetidos; túnel caído.

### B) Código por servicio con `/ip proxy access action=redirect` (recomendada para routers con API)

**Verificado en el manual oficial de RouterOS 7** (`manual.mikrotik.com/docs/7.25/cli-reference/ip/proxy/access/` y `…/network-management/proxy/web-proxy/`):

- `action`: `allow` | `deny` | `redirect` | `url-append`. `redirect`: «Answer with HTTP 307 and the URL in `action-data` as the new location».
- `src-address` acepta IPv4, rango, prefijo o prefijo IPv6.
- `local-port`: «Proxy port the request arrived on… Useful when `port` in `/ip/proxy` lists several ports».
- `action-data` se usa tal cual: **no hay variables** (no se puede poner la IP del cliente con una sola regla).
- Modo transparente: `dstnat … action=redirect to-ports=<puerto>`. Solo HTTP: «it cannot take HTTPS connections in transparent mode».
- Advierte del proxy abierto: hay que bloquear el puerto desde fuera de la LAN.
- (En RouterOS 6 el campo era `redirect-to` con `action=deny`. Argos exige RouterOS 7 por la API REST.)

**Diseño en el router** (comentarios `argosisp:`, administrados por el reconciliador):

```
/ip proxy set enabled=yes port=<puertos del operador>,3346 max-cache-size=none   # solo agrega 3346 si el operador ya usa el proxy
/ip firewall nat  (en argos-corte-nat, en lugar del dst-nat al portal)
  add chain=argos-corte-nat protocol=tcp dst-port=80 action=redirect to-ports=3346 comment="argosisp: corte-nat HTTP al proxy de corte"
/ip firewall filter (argos-corte-in, antes del tcp-reset)
  add chain=argos-corte-in protocol=tcp dst-port=3346 action=accept comment="argosisp: corte-in proxy de corte"
/ip firewall filter (input, arriba)
  add chain=input protocol=tcp dst-port=3346 connection-nat-state=!dstnat action=drop comment="argosisp:top proxy de corte solo redirigido"
/ip proxy access (por servicio suspendido, en orden, antes de la final)
  add local-port=3346 src-address=10.66.1.3 action=redirect action-data="https://portal.isp.gt/corte?c=K7M2QX9TB4RZA" comment="argosisp:servicio:1234"
  add local-port=3346 src-address=2803:xxxx:10:300::/56 action=redirect action-data="…?c=K7M2QX9TB4RZA" comment="argosisp:servicio:1234:delegado"
/ip proxy access (final, sin código)
  add local-port=3346 action=redirect action-data="https://portal.isp.gt/corte" comment="argosisp: corte proxy sin codigo"
```

- El 307 lleva al dominio HTTPS: está en `argos-portal`, así que pasa por el masquerade y por NPM, **y da igual**, porque el código viaja en la URL.
- El portal guarda el código en `sessionStorage` y en una cookie corta, y lo manda a `quien-soy`, `estado`, `promesas` y `comprobantes` (cabecera `X-Argos-Corte`).
- La sonda del sistema recibe 307 → «Iniciar sesión en la red».

**Pros:**

- Funciona en el caso del PM sin tocar el servidor, NPM ni Docker.
- Inmune a NAT, CGNAT, proxies, nodos portal y pools repetidos.
- El límite por IP deja de agrupar a los clientes.
- Reutiliza el ciclo que ya existe para objetos por servicio (`argosisp:servicio:*`, dispatcher y reconciliador de `routeros`).

**Contras:**

- Solo routers con API.
- Escribe una regla por suspendido. El día de corte pueden ser cientos: lotes y orden en `/ip/proxy/access` (**medir en el laboratorio** el costo de `move` y el número de reglas).
- Activa el web proxy del router: CPU y RAM mínimas sin caché, pero el operador debe saberlo.
- Si el router no estaba alcanzable al suspender, no hay código hasta que se reconcilie.
- Con pool sin `Framed-IP` hay que reescribir la regla al reconectar.
- 307 en lugar de 302: los navegadores y las sondas lo siguen igual, pero **probar** en Android, iOS y Windows.

**Falla en:** routers sin API; la ventana entre suspender y escribir la regla; IPv6 sin regla propia.

**Probar en el laboratorio (CHR 7.24.5 del lab):**

1. `action=redirect` + `local-port` + `src-address` IPv4 e IPv6 en modo transparente.
2. `/ipv6 firewall nat action=redirect` hacia el proxy.
3. Que el proxy reciba el `src-address` original (el redirect no hace srcnat).
4. Comportamiento con 500 reglas.
5. Las sondas de Android, iOS y Windows con 307.

### C) Hotspot de MikroTik con variables (`$(ip)`, `$(mac)`)

- `login.html` del hotspot expone `$(ip)` y `$(mac)` (documentación de personalización del hotspot), y podría redirigir a `…/corte?ip=$(ip)`.
- **Contras graves:**
    - el hotspot toma el control de **todos** los clientes de la interfaz: los activos necesitan `ip-binding type=bypassed` uno por uno;
    - no se monta sobre las interfaces dinámicas de PPPoE (sin documentación que lo respalde: **probar**, pero no se recomienda);
    - un parámetro `?ip=` en la URL lo cambia cualquiera, así que habría que firmarlo, y el HTML del hotspot no puede firmar.
- **Descartada** como mecanismo general. Si acaso, solo para un WISP que ya usa hotspot.

### D) Que el router agregue la IP del cliente en un parámetro

- RouterOS no tiene variables en NAT ni en `action-data` del proxy («as-is»). `url-append` agrega texto fijo y reenvía al sitio original, no al portal.
- La única forma es una regla por cliente, que es **B**.
- Un `?ip=` en claro además es falsificable: el código aleatorio de B es la versión segura de esta idea. **Descartada.**

### E) Identificar por el router de origen + la IP privada

- **Con masquerade, la IP privada no llega**: el portal solo ve la IP pública del router. Aunque sepa qué router es, no sabe qué cliente.
- Adivinar «el único suspendido de ese router» es inseguro. **Descartada como mecanismo propio.**
- Útil como **desambiguador** dentro de A: el servidor sabe por qué peer WireGuard llegó la IP, y con eso busca (router, IP) en `network.sesiones` (`nas_ip`) para pools repetidos.

### F) Combinaciones

- **B + respaldo de identificación por IP validada + salida manual** (recomendada). B para routers con API. Si no hay código, la IP solo si pertenece a una red de clientes. Si tampoco, el mensaje claro y el código por teléfono o correo.
- **B + A** para ISP con routers mixtos: A para los routers sin API, conectados por túnel.
- `url_corte` con código: ver P3.

---

## 4. Recomendación

### 4.1 Orden de precedencia en el portal

1. **Código (`?c=` o cabecera `X-Argos-Corte`)** válido. El servicio debe estar `suspendido` o `limitado`, o haber sido reactivado hace menos de `PORTAL_CODIGO_GRACIA_MIN` (30 min, para mostrar «ya tienes servicio»). Si es válido, manda aunque la IP diga otra cosa (se registra la discrepancia en la auditoría).
2. **IP de origen, solo si es «de cliente».** Debe estar dentro de una red de clientes de Argos (`network.redes_ipv4`, bloques y pools IPv6) o de una sesión activa, y **no** ser:
    - una IP de router (`network.routers`: host de la API, `nas_ip`, IP del túnel);
    - la IP del servidor (`PORTAL_IPS_SERVIDOR`);
    - un proxy confiable;
    - la puerta de enlace de Docker.
3. **No identificado, con motivo.** `quien-soy` devuelve `identificado: false`, la `ip` vista y `motivo`:
    - `ip_de_router` — «el portal ve la IP pública del router X: hay NAT en medio»;
    - `ip_de_proxy` — «ve la IP del proxy o de Docker: revisa `ARGOSISP_PROXIES_CONFIABLES`»;
    - `ip_desconocida`;
    - `codigo_vencido`.

   La página muestra «No pudimos reconocer tu servicio desde esta conexión» con dos salidas: **Identificarme con mi teléfono o correo** (el `POST /portal/codigo` que ya existe; tras verificar, la página de corte se llena con la sesión) y **Contacto**. Nunca muestra montos inventados (CLAUDE.md §12).

### 4.2 Cambios por módulo

**A5 (portal y endpoints del portal).**

- Migración `core.servicios_codigo_corte`, o una columna en una tabla de A5: `servicio_id`, `codigo` (único, base32 de 13 caracteres), `creado_en`, `rotado_en`. **Pendiente decidir** si va en `core` (de A1) o en un schema del portal.
- Acción `portal.codigo_corte.emitir`, idempotente por suspensión: genera o rota el código, escribe auditoría y emite el evento `portal.codigo_corte_emitido` **sin el código**, solo `servicio_id`, `empresa_id`, `router_id`. **Pedir al líder la entrada en el catálogo.**
- `resolverServicioPortal(ctx)`: precedencia de §4.1 en `quien-soy`, `estado`, `destino-corte`, `promesas` y `comprobantes`.
- Límite por código o servicio.
- `motivo` en `QuienSoy` y regenerar contracts.
- Página: leer `?c=`, guardarlo, mandarlo y quitarlo de la barra (`history.replaceState`).
- Pantalla «no identificado» con la salida manual.
- Endpoint `GET /portal/eco-ip` (sin datos de clientes, limitado): para el diagnóstico.

**routeros (A1/A5, `apps/api/app/network/routeros/`).**

- En `corte_router.ts`, objetos nuevos de nivel router: `/ip/proxy` (sin pisar los puertos del operador), el NAT `redirect` al proxy, `argos-corte-in` accept y el `input` drop.
- Reglas `/ip/proxy/access` por servicio en el estado deseado del servicio: `argosisp:servicio:<id>` (como los demás objetos por servicio), IPv4 de la asignación o sesión y prefijos IPv6.
- Se escriben y borran con `servicio.estado_cambiado`, `asignacion.cambiada` y `sesion.iniciada` del suspendido.
- Antes de escribir, se borra cualquier regla con la misma `src-address`.
- El reconciliador limpia huérfanos. `audit.red` registra cada comando.
- Modo por router: `corte_identificacion` = `codigo` | `ip` (ver P1).

**Diagnóstico (`diagnostico.ts`, chequeo nuevo `portal_ip_cliente`).**

- `/tool/fetch url=http://<destino>/api/v1/portal/eco-ip src-address=<gateway de una red de clientes> output=user` y comparar la IP que ve el portal con el gateway.
- Si ve la IP pública del router: «hay masquerade entre el router y el portal: la identificación por IP no funciona; usa el código (router con API) o el túnel».
- Si ve 172.x: «hay un proxy o Docker en medio».
- Con COD activo: comprobar que existe la regla final y que cada suspendido tiene la suya.
- **Probar en el laboratorio** que `src-address` en `/tool/fetch` pasa por el masquerade como un cliente.

**A6 (infra).**

- Caddy: el sitio `:{$PORTAL_CORTE_PUERTO}` **no confía** en `X-Forwarded-For` ni en `X-Real-IP`. Va en un `servers :8088 { trusted_proxies static }` propio, o se fija `header_up X-Forwarded-For {remote_host}`. Prueba en `infra/ci/probar-detras-de-proxy.sh`.
- Documentar que no se publique el `:8088` por IPv6 con userland-proxy.
- Si se hace A: AllowedIPs con las redes del router (el endpoint `internal/wireguard/peers` las devuelve), rutas en el host, puerto del corte abierto desde `wg-argos` y `srcnat accept` hacia la IP del servidor en el túnel en el script de conexión.

**A1 (script de conexión).**

- Plantillas `conexion-servicio*.rsc.tpl` y `servicio-firewall.rsc`: las piezas del proxy de corte (§3, B).
- El masquerade «del laboratorio» queda, porque hace falta, pero con `srcnat accept` hacia el portal por el túnel si se usa A.
- Regenerar con `armar.mjs` y probar con `render.test.mjs`.

**A2 (aaa/coa).** Nada para B. Para PPPoE con pool del router, `sesion.iniciada` del suspendido ya existe y lo consume routeros.

**A4 (panel).**

- En Configuración → Portal de corte: el modo de identificación (P1) y el aviso si el diagnóstico detecta NAT.
- Ficha del servicio: «Código de corte: activo / rotado el …», sin mostrar el código salvo con permiso (P4).

### 4.3 Migración de instalaciones existentes

1. Migración de base de datos y código. Los servicios ya suspendidos reciben su código en la primera reconciliación (acción por fila, auditada).
2. `portal.config_cambiada` (nuevo campo de modo) reconcilia todos los routers con API: crea el proxy, el NAT al proxy y las reglas por servicio. **Se quita** el dst-nat directo al portal: el destino ahora es el proxy del router.
3. Routers sin API: siguen con el dst-nat al portal. El diagnóstico dice que la identificación por IP no funciona si hay masquerade, y el script nuevo los actualiza cuando el operador lo corre.
4. Sin cambios en `url_corte` mientras el PM no decida P3.

### 4.4 Qué hace el PM después de actualizar

- **Router (con API):** nada a mano. «Reconciliar ahora» en el router, y comprobar con **Diagnóstico de corte** que `portal_ip_cliente` sale en verde.
    - Si ya usa `/ip proxy` para otra cosa, Argos agrega su puerto (3346) sin tocar el resto. Confirmar (P2).
    - Abrir desde un PPPoE suspendido `http://neverssl.com`: debe llegar a `https://<portal>/corte?c=…` con su nombre parcial y su monto.
- **Servidor:**
    - Revisar `ARGOSISP_PROXIES_CONFIABLES=172.30.0.1/32` (la puerta de enlace de compose, o la IP desde la que NPM llega a Caddy, según el runbook §1). Con B ya no hace falta para identificar, pero sí para el límite por IP y la auditoría.
    - No publicar el `:8088` por IPv6.
    - `sudo argosisp levantar` tras actualizar.
- **Routers sin API:** correr otra vez el script de conexión cuando salga la fase A, o identificarse con el código por teléfono o correo.

### 4.5 Fases propuestas

1. **Fase 1 (urgente, caso del PM):**
    - B completo para routers con API;
    - precedencia y motivos de §4.1;
    - límite por código;
    - Caddy `:8088` sin confianza en encabezados;
    - diagnóstico `portal_ip_cliente`.
2. **Fase 2:** A (túnel con AllowedIPs de clientes y A′) para routers sin API. Diseño final en §5 ter: el primer salto identifica por IP sin NAT (túnel, LAN o IPv6) y redirige con el código de la suspensión; A′ queda para cuando no hay URL pública.
3. **Fase 3:** `url_corte` con código (según P3) y desambiguación (router, IP) para pools repetidos.

---

## 5. Decisiones del PM (8 nov, cerradas)

| # | Decisión |
| --- | --- |
| P1 | **Elegible por router**: `network.routers.corte_identificacion` = `ip` \| `codigo`, sin modo global. Obligatorio en el formulario de alta y edición del panel, que sugiere `codigo` si el router tiene API. En la API es opcional y en el alta vale `ip` por defecto. Los routers existentes quedan en `ip` y el diagnóstico sugiere pasarlos a `codigo` cuando detecta NAT. Sin API solo se admite `ip` (422 `corte_codigo_sin_api`, también al quitar la clave de la API a un router en `codigo`) |
| P2 | **Sí**: Argos activa `/ip proxy` sin caché, en el puerto 3346 y bloqueado desde fuera. Si el router ya usa el proxy, Argos solo agrega su puerto y sus reglas y no toca lo demás |
| P3 | **a)**: el router siempre lleva a la `/corte` de Argos. Argos identifica por el código y después redirige a la `url_corte` de la empresa si la tiene: Nitro, `/corte?c=` → `GET /portal/destino-corte` con `X-Argos-Corte` → `302` |
| P4 | El código permite **lo mismo que hoy la IP**: nombre parcial, estado y montos, pedir promesa y subir comprobante. Facturas, pagos y datos siguen detrás de la verificación por teléfono o correo |
| P5 | **Uno por suspensión**. Se cierra al dejar de estar suspendido y resuelve 30 min más (`PORTAL_CODIGO_CORTE_GRACIA_MIN`) |
| P6 | **Sí, fase 2**: túnel WireGuard con las redes de clientes para los routers sin API |
| P7 | **Existen los dos escenarios** (servidor en la LAN del ISP y nodo de portal aparte): entran en la fase 2 junto con A′ |

## 5 bis. Fase 1: lo implementado (contrato)

### Router (`apps/api/app/network/routeros/`)

| Objeto | Clave (`comment`) | Cuándo |
| --- | --- | --- |
| `/ip proxy` (`set`) | — | `codigo`: si estaba apagado, `enabled=yes port=3346 max-cache-size=none`; si estaba encendido, solo agrega `3346` a `port`. `ip`: quita `3346`, y si era el único puerto lo apaga (`enabled=no port=8080`). Función `ajusteProxy` |
| NAT `argos-corte-nat` (IPv4 e IPv6) | `argosisp: corte-nat HTTP al proxy de corte` | `codigo`: `tcp dst-port=80 action=redirect to-ports=3346`. Reemplaza al `dst-nat` (`argosisp: corte-nat HTTP a /corte`). En IPv6 no hace falta la IPv6 del portal |
| filter `input` (arriba) | `argosisp:top proxy de corte solo redirigido` | `codigo`: `tcp dst-port=3346 connection-nat-state=!dstnat action=drop` (no es un proxy abierto: solo entra lo que trajo el dst-nat de un suspendido) |
| filter `argos-corte-in` | `argosisp: corte-in proxy de corte` | `codigo`: `tcp dst-port=3346 accept`, antes del `tcp-reset` |
| `/ip proxy access` (final) | `argosisp: corte proxy sin codigo` | `codigo`, **siempre**: `local-port=3346 action=redirect action-data=<URL de /corte>` (sin código: el portal cae a la IP); sin URL del portal, `action=deny`. Nunca un 3346 sin regla final: el proxy reenviaría a internet lo que no tiene regla, y ese tráfico sale por `output`, sin pasar por `argos-corte` (hallazgo de A6) |
| `/ip proxy access` (por servicio) | `argosisp:servicio:<id>` (IPv4) y `argosisp:servicio:<id>:enlace\|delegado\|delegado-2` (IPv6) | Solo un suspendido en un router `codigo` (también PPPoE: las direcciones de su sesión abierta, o las fijas): `local-port=3346 src-address=<ip o prefijo> action=redirect action-data=<URL de /corte>?c=<código>` |

- **URL de `/corte`**: la de `PORTAL_URL_PUBLICA` (`urlCortePublica`) o, sin ella, el destino del NAT (`corte_url` en `ConfigCorte`).
- **Orden** (`ordenAccesoProxy`): primero las reglas por servicio, luego la final y al final lo del operador (un `allow` suyo sin `local-port` ganaría en el 3346: la primera regla que coincide decide). Una regla nueva se mueve en el acto (`ordenarAccesoProxy`); el reconciliador ordena justo después de `aplicarCorte` y solo después enciende el proxy. El diagnóstico `proxy_corte` sale en rojo si falta la final, si su `action` no es la esperada o si hay reglas antes de las del corte.
- **IP reasignada** (`liberarAccesoProxy`): al escribir la regla de un suspendido se borra la regla de **otro** servicio con la misma `src-address`.
- **Huérfanos**: el reconciliador borra las reglas `argosisp:servicio:*` de servicios que ya no deben tenerlas, como los demás objetos por servicio.
- **Quién escribe**: `routeros.aplicar_servicio` (por `servicio.estado_cambiado`, `asignacion.cambiada`, `sesion.iniciada`/`terminada`…) y `routeros.reconciliar` (periódico, al volver un router, y con `portal.config_cambiada` con `router_id` al cambiar el modo).
- **Auditoría**: cada comando en `audit.red`, con el `?c=` enmascarado (`limpiarCredenciales`).
- El script de conexión (`.rsc`, A6) todavía no trae estas piezas: el reconciliador las pone en la primera pasada de un router con API.

### Códigos (`apps/api/app/portal/codigos_corte.ts`, tabla `core.codigos_corte`)

- 13 caracteres base32 Crockford (65 bits aleatorios). Un código abierto por servicio (índice único parcial).
- `sincronizarCodigoCorte` corre en la misma transacción que escribe la regla:
    - suspendido en un router `codigo`: reutiliza el abierto o crea uno y emite `portal.codigo_corte_emitido`;
    - en cualquier otro estado: cierra el abierto (`cerrado_en`).
- Resuelve si está abierto o se cerró hace menos de la gracia.

### Evento nuevo

`portal.codigo_corte_emitido`: `codigo_corte_id`, `servicio_id`, `empresa_id`, `cliente_id`, `router_id`. **Nunca el código.** Emite A5 (`sincronizarCodigoCorte`, dentro de `routeros.aplicar_servicio` o `routeros.reconciliar`). Hoy no lo consume nadie.

`portal.config_cambiada` agrega `router_id` (opcional) con `campos: ['corte_identificacion']`, y `routeros` reconcilia solo ese router.

### Portal (API)

- **Precedencia** (`app/portal/identificacion.ts`, `identificarOrigen`):
    1. el código vigente (`X-Argos-Corte` o `?c=`);
    2. la IP, salvo que sea de infraestructura;
    3. no identificado, con `motivo`.
- **IP de infraestructura** (`clasificarIp`):
    - `ip_de_router`: `nas_ip`, `host` o IP del túnel;
    - `ip_de_servidor`: `PORTAL_IPS_SERVIDOR`;
    - `ip_de_proxy`: `PORTAL_PROXIES_CONFIABLES`, por ejemplo la red de compose cuando Caddy no confía en NPM.
- **`QuienSoy`** agrega:
    - `identificado_por`: `codigo` \| `ip` \| null;
    - `motivo`: `codigo_vencido` \| `ip_de_router` \| `ip_de_servidor` \| `ip_de_proxy` \| `ip_desconocida` \| null.
- **Mismo código en todas las rutas por IP**: `estado`, `destino-corte`, `promesas` y `promesas/condiciones` sin sesión, `comprobantes`, `pagos/iniciar`, `pagos/en-linea/:id`, `empresa`, `anuncios` y `codigo` con `por_ip`.
- **Límite**:
    - con código vigente, por código (`codigo:<código>`), no por IP;
    - un código inexistente o vencido cuenta en `PORTAL_LIMITE_CODIGOS_FALLIDOS` por IP (10 por ventana).
- **Auditoría**: `audit.acciones` guarda `codigo: "***"`.
- **`GET /portal/eco-ip`** (público, sin datos de clientes): `{ ip, infraestructura }`, para el diagnóstico.
- **`GET /servicios/:id/codigo-corte`** (`servicios.ver`, con alcance): `{ servicio_id, corte_identificacion, activo, creado_en, cerrado_en, resuelve_hasta }` (`resuelve_hasta`: cierre + `PORTAL_CODIGO_CORTE_GRACIA_MIN`; null si sigue abierto o si nunca hubo). Nunca el código.

### Portal (Nuxt)

- `plugins/api.ts` toma `?c=` al cargar y lo guarda en memoria y en `sessionStorage` de la pestaña. Lo manda en `X-Argos-Corte` en cada llamada.
- `/corte` quita `?c=` de la barra de direcciones.
- El mensaje de «no identificado» depende del `motivo` y nunca habla de la red del ISP.
- `server/middleware/portal-cautivo.ts`: `/corte?c=` en el host del portal consulta `destino-corte` con el código y hace `302` a la `url_corte` de la empresa si la tiene (P3).

### Caddy (`infra/produccion/config/Caddyfile`)

El sitio del corte (`http://, :{$PORTAL_CORTE_PUERTO}`) usa `header_up X-Forwarded-For {remote_host}` (snippet `portal_corte`) y no lee los encabezados de nadie, ni de un proxy de `ARGOSISP_PROXIES_CONFIABLES`. Prueba: `infra/ci/probar-detras-de-proxy.sh`.

### Diagnóstico (`diagnostico.ts`)

- **`portal_ip_cliente`**:
    - `/tool/fetch url=<portal>/api/v1/portal/eco-ip src-address=<gateway de clientes> output=user` y compara.
    - En modo `ip`, si el portal ve otra IP: rojo `portal_ve_otra_ip` («el portal ve la IP X en vez de la del cliente: hay NAT o un proxy en medio»), con la acción «pasa el router a Identificación por código».
    - En modo `codigo` es informativo (verde).
- **`proxy_corte`** (solo en modo `codigo`): el proxy en el 3346, la regla final y una regla por suspendido con código. Si falla, `reconciliar: true`.
- **Por probar en el laboratorio**: que `src-address` en `/tool/fetch` pase por el masquerade como un cliente.

## 5 ter. Fase 2: túnel WireGuard, servidor en la LAN y nodo de portal

> Diseño de A6 (8 nov, rama `a6/corte-fase2` sobre `main` v1.13.0), con las decisiones P6 y P7. Todo sale del código de `main`; cada punto cita el archivo. Implementado en la misma rama (§5 ter.11).

### 5 ter.1 Idea central: el primer salto identifica y el segundo lleva el código

El problema del §1.3 tiene dos partes: la IP se pierde en el masquerade (primer salto) y, aunque llegue bien, la página y `quien-soy` van por Internet (segundo salto). La fase 2 resuelve las dos así:

1. **Primer salto por un camino sin NAT** hasta el destino del dst-nat:
    - **túnel WireGuard** (routers en modo `ip` registrados en el túnel);
    - **ruta directa en la LAN del ISP** (servidor o nodo de portal en la LAN);
    - **IPv6 nativo**, que no tiene NAT.

   El portal (`server/middleware/portal-cautivo.ts`) ya consulta `GET /portal/destino-corte` antes del 302, con la IP real.
2. **El primer salto emite el código de corte de la suspensión y redirige con él**: `302 https://DOMINIO_PORTAL/corte?c=<código>`. A partir de ahí manda el código (fase 1, §5 bis): `quien-soy`, `estado`, `promesas`, `comprobantes` y los pagos ya lo aceptan. El segundo salto puede volver a salir por Internet, con masquerade, NPM o un nodo de portal, y da igual.

### 5 ter.2 Segundo salto: A′ contra código emitido en el primer salto

| | A′: el portal entero en el destino del NAT | Código emitido en el primer salto (recomendada) |
| --- | --- | --- |
| Qué cambia | `destinoCorte` relativo (`/corte`) para el suspendido que llegó por el dst-nat. La página, `quien-soy`, `estado`, promesa y comprobante siguen en `http://<destino>:<puerto>` | `destino-corte` devuelve además el código (lo crea si falta, uno por suspensión, P5) y Nitro redirige a `…/corte?c=` |
| Transporte | HTTP plano todo el tiempo, también al subir el comprobante (foto de un depósito) | HTTP solo en el primer salto, como hoy. La página va por HTTPS |
| Pago en línea y `/entrar` | Salen a `https://DOMINIO_PORTAL` y pierden la identificación: otro origen, otro `sessionStorage` | Siguen en el mismo origen HTTPS que guardó el código |
| Mini-navegador de iOS (CNA) | Funciona mientras no salga del destino | Funciona: el código va en la URL, como en la fase 1 |
| Túnel caído a mitad de la visita | La página deja de cargar | Solo afecta a la primera petición. La página sigue por Internet con el código |
| Nodo de portal aparte | El destino del túnel es el servidor central: la página la sirve el central, no el nodo | El central identifica y redirige al nodo (`DOMINIO_PORTAL`) con el código |
| Código nuevo | Reglas de Nitro para decidir cuándo ser relativo, cookies `Secure` desactivadas y CSP por HTTP | Un campo en `DestinoCorte` y una acción. Reutiliza la tabla, el límite, la auditoría y el ciclo de vida de la fase 1 |
| Seguridad | Igual que la IP: dura lo que dura la visita | El código vale lo mismo que la IP (P4) y dura lo que la suspensión más la gracia (P5). Solo se entrega a quien el portal identificó por una IP que no es de infraestructura (§5 ter.8) |

**Recomendación: el código.** A′ no se descarta: queda como comportamiento automático cuando no hay URL pública (`PORTAL_URL_PUBLICA` vacía). En ese caso `destinoCorte` ya es relativo (`apps/portal/server/utils/portalCautivo.ts`, `destinoCorte`), y ahora además lleva `?c=`. Es el caso del laboratorio y de un servidor solo en la LAN. Así, P7 («A′ entra en la fase 2») se cumple sin perder HTTPS donde existe.

Un token de un solo uso aparte del código no aporta nada. Tendría que canjearse por algo que dure la visita (el sondeo de 5 s, la promesa y el comprobante), y ese algo ya existe: el código de la suspensión.

### 5 ter.3 Cuándo un router manda el corte por el túnel

El destino del dst-nat pasa a ser `<IP del servidor en el túnel>:<PORTAL_CORTE_PUERTO>` (`10.255.0.1:8088` por defecto) cuando se cumplen **todas** estas condiciones (función única `corteTunelDeRouter`, en `app/network/conexion/tunel_corte.ts`):

- WireGuard activo (`ARGOSISP_WIREGUARD=1`) y `PORTAL_CORTE_TUNEL` distinto de `0` (por defecto `1`);
- el router está en modo `ip` (P1). En modo `codigo` el destino es el proxy del router y no hace falta el túnel;
- el router está registrado en el túnel: tiene fila en `network.routers_conexion` con `public_key` y está activo, lo mismo que `listarPeers` (`app/network/conexion/consultas.ts`).

`PORTAL_CORTE_TUNEL=0` es para quien apunta el dst-nat a un servidor suyo que no es Argos. Entonces se respeta `portal_v4`, como en la fase 1.

La misma función alimenta a cuatro consumidores, que así nunca discrepan:

- los peers del agente (§5 ter.4);
- el estado deseado del router (`estadoCorteRouter`, §5 ter.6);
- el script de conexión (§5 ter.6);
- el diagnóstico (§5 ter.9).

### 5 ter.4 AllowedIPs del peer de cada router

**API (`GET /internal/wireguard/peers`).** Cada peer suma `allowed_ips`: su `/32` del túnel y, si el router manda el corte por el túnel, sus redes de clientes IPv4 (`network.redes_ipv4`, `estatico` y `pool`, las mismas de `argos-clientes`: `redesV4DeRouter` en `app/network/routeros/consultas.ts`). También suma `avisos[]` con lo que se descartó. La API arma la lista entera (`peersConRedes`, en `app/network/conexion/tunel_corte.ts`) y descarta, con aviso:

- redes que se traslapan con la red del túnel (`ARGOSISP_WG_RED`) o con `ARGOSISP_WG_REDES_EXCLUIDAS`. Esta variable trae por defecto la red de compose (`COMPOSE_SUBNET_V4`, 172.30.0.0/24): un paquete del túnel con origen 172.30.x se confundiría con un contenedor;
- `0.0.0.0/0` y redes más anchas que `/8`;
- redes que se traslapan con las de **otro** peer. WireGuard no admite AllowedIPs traslapados: `wg syncconf` le da el prefijo al último peer sin avisar. Hoy no pueden traslaparse, porque `network.redes_ipv4` tiene `EXCLUDE USING gist (cidr inet_ops WITH &&)` (`1760900000003_crear_network.ts`). La comprobación es la última defensa. Gana el router de menor id, el orden que ya usa `listarPeers`.

**IPv6, fuera de la fase 2.** Por el túnel no viaja IPv6: el túnel es IPv4 (`10.255.0.0/16`) y el router solo tiene la ruta `/32` al servidor (`conexion-tunel.rsc`). Además, el IPv6 de los clientes casi siempre es público y sin NAT: con `portal_v6` (dst-nat IPv6 a la IPv6 pública del servidor) la IP llega tal cual (§2.2).

Poner los bloques IPv6 en AllowedIPs sin dirección IPv6 en el túnel no sirve de nada. Con rutas de vuelta haría daño: las respuestas del servidor a esos clientes entrarían al túnel con origen público y el router las tiraría (su peer del servidor solo admite `10.255.0.1/32`). Queda descrito como fase 2b (§5 ter.12).

**Agente (`infra/wireguard/agente.sh`).**

- Escribe `AllowedIPs = <allowed_ips>` (antes `AllowedIPs = <ip_tunel>/32`).
- Revalida el formato de cada CIDR y descarta, con aviso en el log, lo que se traslape con la red del túnel.
- Reconcilia la lista **completa**, como siempre, al arrancar y con estos eventos:
    - los de antes: `router.conexion_*` y `router.eliminado`;
    - `portal.config_cambiada`: cambia el modo de un router (`router_id`) o la configuración global;
    - `router.redes_cambiadas` (nuevo, §5 ter.10).
- Idempotente: escribe solo si el archivo cambió (`cmp`), y el servidor aplica con `wg syncconf`, que no corta los túneles vivos.

**IPs repetidas entre routers.**

- Las redes registradas no pueden repetirse (restricción de arriba), así que en el túnel la IP de origen basta para saber de qué router viene: solo un peer puede mandarla (cryptokey routing).
- Lo que sí puede repetirse son IPs de pools que el router entrega sin estar registrados en Argos (§2.5). Esas IPs no están en AllowedIPs: el router no las excluye del masquerade de respaldo (§5 ter.6), así que llegan con la IP del router en el túnel → `ip_de_router` («no identificado» con su motivo, nunca otro cliente).
- **Desambiguación (router, IP) en la API** (`app/portal/identificacion.ts`):
    - si una IPv4 cae en una red registrada (`network.redes_ipv4`), solo cuentan las sesiones y asignaciones de servicios **de ese router**. En IPv6 no hace falta: los prefijos son globales y no se repiten entre routers (`servicioDeLaIp`);
    - si el ganador de `resolverIp` es de otro router, se busca el candidato del router de la red;
    - si no hay ninguno: `ip_desconocida`.

   Así, una sesión de otro router con la misma IP (pool sin registrar) nunca muestra datos ajenos.
- **Pools privados repetidos de verdad**, el mismo `10.66.0.0/16` en dos routers, siguen sin poder registrarse (A1, restricción `EXCLUDE`). Para soportarlos, el router tendría que traducir 1:1 su pool a un rango alias único por router antes de entrar al túnel (`srcnat action=netmap`), con un IPAM de alias. Es la fase 3 (§4.5). Hasta entonces, esos routers usan el modo `codigo`, que no depende de la IP.

### 5 ter.5 Vuelta en el servidor: sin rutas globales, por marca de conexión

**Cómo llega el paquete al contenedor sin perder la IP.** El `proxy` (Caddy) publica `${ARGOSISP_BIND_IP:-0.0.0.0}:${PORTAL_CORTE_PUERTO}` (`infra/produccion/docker-compose.produccion.yml`, servicio `proxy`). Un paquete que entra por `wg-argos` a `10.255.0.1:8088`:

- pasa por el DNAT de Docker (iptables), que conserva el origen. Es el mismo camino que ya usa RADIUS (`infra/wireguard/README.md`, «Ruteo»);
- en Caddy, el sitio del corte usa `{remote_host}` y no lee encabezados (fase 1, snippet `portal_corte`), así que la IP del cliente llega a Nitro y a la API sin cambios. No hace falta red host, ni otro DNAT, ni otro puerto.
- Si `ARGOSISP_BIND_IP` es una IP concreta, el puerto no escucha en la IP del túnel: `argosisp estado` lo avisa y el diagnóstico lo muestra como «el destino no responde».

**Ruta de vuelta.** `wg syncconf` no crea rutas. La respuesta del contenedor a `10.66.1.3` sale por el bridge hacia el host, y el host la mandaría por su ruta por defecto (Internet). Hay dos formas de traerla de vuelta:

| | Rutas de las redes de clientes en la tabla principal | Marca de conexión (elegida) |
| --- | --- | --- |
| Qué es | `ip route replace 10.66.0.0/16 dev wg-argos` por red | En `mangle`: las conexiones que entran por `wg-argos` llevan la marca `0x4172`, que se restaura en sus respuestas. `ip rule fwmark 0x4172/0xffff lookup 4172`, y en esa tabla `default dev wg-argos`. WireGuard elige el peer por AllowedIPs |
| Redes públicas de clientes | **Rompe**: un cliente con IP pública que entra al servidor por Internet (el portal HTTPS) recibiría la respuesta por el túnel, y el router la tiraría (el peer del servidor solo admite `10.255.0.1/32`) | Solo vuelve por el túnel lo que entró por el túnel |
| Red de clientes igual a la LAN del servidor | Secuestra la LAN del servidor | Sin efecto sobre el tráfico del servidor |
| Altas y bajas de redes | Hay que sincronizar rutas y quitar las viejas | Nada: una sola regla y una ruta fijas |
| `rp_filter` estricto (RHEL) | Pasa | Necesita `net.ipv4.conf.all.src_valid_mark=1`: el paquete de entrada también lleva la marca y la comprobación de la ruta de vuelta usa la tabla `4172`. Con `rp_filter` 0 o 2 (Debian, Ubuntu) no hace falta |

**Elegida: la marca de conexión.** `servidor.sh` la instala con el firewall (mismo backend que Docker) y la quita al detenerse. `instalar.sh` agrega `net.ipv4.conf.all.src_valid_mark = 1` a `/etc/sysctl.d/90-argosisp-wireguard.conf`, el archivo que ya escribe para `ip_nonlocal_bind`. Docker monta `/proc/sys` de solo lectura, así que el contenedor no puede ponerlo él. `servidor.sh` lee `rp_filter` y `src_valid_mark` y avisa en el log si la combinación tira los paquetes.

**Firewall del servidor** (`servidor.sh`, cadenas `ARGOSISP-IN/FWD-wg-argos`). Al abrir las redes de clientes en AllowedIPs, los clientes llegan a la `.1`, así que se cierra lo que antes cerraba el propio WireGuard:

- `FWD`: TCP nuevo con DNAT a `10.255.0.1:PORTAL_CORTE_PUERTO` → `RETURN`, desde cualquier origen del túnel. WireGuard ya garantiza que el origen está en los AllowedIPs del peer: un cliente de su router, o la IP del router en el túnel, que es el respaldo con masquerade y el diagnóstico.
- `FWD`: RADIUS (UDP 1812/1813 con DNAT a la `.1`) **solo desde la red del túnel** (`-s ARGOSISP_WG_RED`). Antes bastaba con «desde el túnel», porque solo entraban IPs del túnel.
- `IN`: ping a la `.1` solo desde la red del túnel.
- Todo lo demás se sigue descartando: un cliente no llega al SSH, a RADIUS ni a otro router.

### 5 ter.6 En el router

**Script (`infra/mikrotik/piezas/servicio-firewall.rsc`).** Variables nuevas `corte_tunel_ip` y `corte_tunel_puerto` (`variables.json`, grupo `servicio`). Las llena `valoresServicio` (`app/network/conexion/servicio.ts`) con `corteTunelDeRouter`, y van vacías si el router no usa el túnel. Con `corteTunelIp` (solo en modo `ip`):

```
/ip firewall address-list add list=argos-portal address=$corteTunelIp comment="argosisp: portal tunel"
/ip firewall nat add chain=argos-corte-nat protocol=tcp dst-port=80 action=dst-nat \
    to-addresses=$corteTunelIp to-ports=$corteTunelPuerto comment="argosisp: corte-nat HTTP a /corte"
/ip firewall nat add chain=srcnat src-address-list=argos-clientes dst-address=$corteTunelIp \
    action=accept place-before=0 comment="argosisp:top corte por tunel sin NAT"
/ip firewall nat add chain=srcnat connection-nat-state=dstnat dst-address=$corteTunelIp \
    action=masquerade comment="argosisp: corte por tunel NAT de lo demas"
```

- **`argos-portal`**: el filtro `argos-corte` ve el destino ya traducido (`10.255.0.1`), y sin esta entrada respondería `tcp-reset`. El segundo salto relativo (A′, sin URL pública) también va a esa IP sin NAT.
- **`srcnat accept` arriba** (antes del masquerade de Argos y de cualquiera del operador): los clientes de `argos-clientes` llegan al servidor con su IP. `argos-clientes` sale de las mismas redes que los AllowedIPs (§5 ter.4), así que lo que no se enmascara siempre está permitido del otro lado.
- **Masquerade de respaldo** (después del accept): lo que llegó por el dst-nat desde una IP fuera de `argos-clientes` sale con la IP del router en el túnel, que siempre está en AllowedIPs. Así ve la página (sin identificar, `ip_de_router`) en lugar de un timeout. `connection-nat-state=dstnat` hace que no toque el RADIUS ni el REST del propio router.
- El masquerade «del laboratorio» (`out-interface=$wanIf`) no aplica al túnel, porque la salida es `wg-argos`, y queda igual.
- IPv6: nada nuevo (§5 ter.4).

**Reconciliador (`app/network/routeros/corte_router.ts`).** `OpcionesCorte.tunel = { ip, puerto } | null`. Con túnel y modo `ip`:

- `reglasNat` escribe el dst-nat al túnel en lugar de `portal_v4`, más las dos reglas `srcnat` de arriba (comentarios administrados, en `comentariosPropios`: el reconciliador las borra al salir del túnel);
- `estadoCorteRouter` agrega `argosisp: portal tunel` a `argos-portal`.

Las opciones las arma una sola función, `opcionesCorteRouter` (`app/network/routeros/consultas.ts`). Así el reconciliador, el diagnóstico y `migrar_control_router` (que hoy no pasaba el modo `codigo` y lo deshacía hasta la siguiente pasada) piden lo mismo.

Un router sin API solo recibe esto con el script: «Generar script» lo trae, y el reconciliador no lo toca.

### 5 ter.7 Servidor en la LAN del ISP (P7) y nodo de portal (P7)

**Servidor en la LAN, sin túnel.** El dst-nat va a `portal_v4`, la IP del servidor en la LAN (Configuración → Portal de corte). El paquete llega con la IP del cliente si se cumplen tres cosas:

- el masquerade del router no aplica a esa salida (el de Argos es `out-interface=$wanIf`; el del operador puede ser más amplio);
- el servidor tiene ruta de vuelta a los pools: el router es su puerta de enlace, o tiene rutas estáticas;
- nada en medio hace NAT.

El primer salto identifica y emite el código, y el segundo va por `https://DOMINIO_PORTAL` con `?c=`. Es lo mismo que en el túnel, sin piezas nuevas en el router.

Lo que el diagnóstico debe detectar (`portal_ip_cliente`, §5 ter.9):

| Ve | Causa | Qué dice |
| --- | --- | --- |
| El gateway de la red de clientes | Sin NAT | Verde: la identificación por IP funciona en el primer salto |
| La IP del router en la LAN o la WAN | El masquerade del operador también aplica hacia el servidor | Rojo `portal_ve_otra_ip`: «agrega `srcnat … dst-address=<portal_v4> action=accept` antes de tu masquerade, o pasa el router a código» |
| `ip_de_proxy` / `ip_de_servidor` | Docker con userland-proxy, o un proxy delante del `:8088` | Rojo, con el runbook `detras-de-proxy.md` |
| Sin respuesta | No hay ruta, o el firewall del servidor no deja pasar | Sin dato (`ok: null`), con el comando para repetirlo |

**Nodo de portal aparte (`docker-compose.nodo-portal.yml`, `Caddyfile.nodo-portal`, `contratos/nodo-portal.md`).**

- **Nodo en la LAN, sin túnel.** `portal_v4` = la IP del nodo. Su Caddy `:8088` ve la IP del cliente (`{remote_host}`, el mismo snippet). Nitro la manda en `X-Argos-Cliente-Ip` con el token del nodo (contrato §2, regla 2), y la API identifica, emite el código y responde a `destino-corte`. Sin cambios en el nodo.
- **Routers por el túnel.** El túnel termina en el servidor central, que siempre corre `proxy` y `portal`: el primer salto lo atiende el central por `10.255.0.1:8088`, identifica, emite el código y redirige a `https://DOMINIO_PORTAL/corte?c=`, que es el nodo. El nodo no necesita WireGuard.
- **Nodo con su propio túnel** (que el central no tenga portal): fuera de alcance. Haría falta un segundo peer en cada router.

### 5 ter.8 Seguridad

- **Suplantar una IP desde fuera del túnel o de la LAN:**
    - por TCP, el origen no se falsifica;
    - por el túnel, cryptokey routing: solo el peer cuyos AllowedIPs contienen el origen puede mandarlo, y cada red está en un solo peer;
    - por encabezados: el sitio del corte nunca los lee (fase 1), y el sitio HTTPS solo cree a `ARGOSISP_PROXIES_CONFIABLES`;
    - un nodo de portal solo con su token (contrato del nodo, §2).
- **El código solo se entrega por IP de cliente.**
    - `destino-corte` lo emite si la identificación fue `por: 'ip'`: la IP no es de infraestructura (`clasificarIp`) y pasó la desambiguación (router, IP).
    - El servicio debe estar `suspendido`: el resto no recibe dst-nat, así que no hay primer salto.
    - Se usa el mismo código abierto de la suspensión, o uno nuevo con `portal.codigo_corte_emitido`, con auditoría solo cuando se crea.
    - La acción toma el candado del servicio que usa `routeros.aplicar_servicio` y relee el estado: un código no puede quedar abierto en un servicio reactivado. Si gana la carrera, el `servicio.estado_cambiado` siguiente lo cierra (`sincronizarCodigoCorte`).
    - El mismo flujo existe en la fase 1 para el modo `codigo` (P4 y P5): el router entrega el código a la misma IP.
- **Límite:** `destino-corte` ya cuenta por IP (`PORTAL_LIMITE_PETICIONES`). Con el túnel, la IP es la del cliente, no la del router: el día de corte masivo no se bloquean unos a otros (era el problema de §2.9).
- **Clientes que no están suspendidos** también llegan a la `.1` (el router enruta la `/32`): solo al puerto del corte, y se identifican por su propia IP.
- **IPs repetidas entre routers:** §5 ter.4.

### 5 ter.9 Diagnóstico

`portal_ip_cliente` (`app/network/routeros/diagnostico.ts`, `chequeoIpCliente`):

- En modo `ip` prueba **el primer salto**: `http://<destino del NAT>/api/v1/portal/eco-ip`. El destino es `<IP del túnel>:<PORTAL_CORTE_PUERTO>` con túnel, o `nat_url` sin él. Antes probaba `corte_url`, que es el segundo salto (por Internet) y salía rojo aunque el primero identificara.
- Con túnel, si la IP vista no es el gateway, el texto lo atribuye al túnel: «falta el `srcnat accept` o la red no está en el peer».
- En modo `codigo` no cambia.

### 5 ter.10 Evento nuevo y cambios por módulo

**`router.redes_cambiadas`** (`router_id`, `empresa_id` null). Significa: cambiaron las redes de clientes del router y hay que regenerar sus AllowedIPs.

- **A1:** emitirlo en `redes.crear`, `redes.editar`, `redes.migrar`, `ipv6.crear`, `ipv6.editar`, `ipv6.migrar` y `routers.unir` (pedido en `a6.md`; carpeta de A1). Ayuda lista: `emitirRedesCambiadas(t, routerIds)` en `app/network/conexion/tunel_corte.ts`.
- **Respaldo mientras A1 no lo emite:** `routeros.reconciliar` lo emite cuando corrige entradas de `argos-clientes` en un router con túnel. El servidor y el router convergen en la misma pasada.
- **Por qué este orden:** si las dos cosas llegan juntas, primero se amplían los AllowedIPs y después el router deja de enmascarar. Con A1 emitiendo el evento, el servidor siempre va adelante.

| Módulo | Cambio |
| --- | --- |
| `app/network/conexion` (A1, con permiso) | `tunel_corte.ts`: `corteTunelDeRouter`, `peersConRedes` (AllowedIPs con descarte de traslapes) y `emitirRedesCambiadas`. `consultas.ts`: `listarPeers` suma `allowed_ips` y `avisos`. `servicio.ts` y `actions/generar_script.ts`: `corte_tunel_ip` y `corte_tunel_puerto` |
| `app/network/routeros` (con permiso) | `corte_router.ts`: `OpcionesCorte.tunel`, NAT y `srcnat` del túnel, entrada en `argos-portal`. `consultas.ts`: `opcionesCorteRouter`. `reconciliar_router.ts`, `migrar_control_router.ts` y `diagnostico.ts` la usan. El reconciliador emite `router.redes_cambiadas` (respaldo). Diagnóstico del primer salto |
| `app/portal` (A5, con permiso) | `actions/emitir_codigo_corte_ip.ts` (`portal.codigo_corte.emitir`). `consultas.ts`/`leerDestinoCorte` devuelve `codigo`. `identificacion.ts`: desambiguación (router, IP). `esquemas.ts`: `DestinoCorte.codigo` (contracts regenerados) |
| `apps/portal` (A5) | `server/middleware/portal-cautivo.ts`: con `codigo`, el 302 va a `destino?c=<código>`. Con `url_corte` de la empresa, a esa URL, como hoy (P3) |
| `app/shared/eventos.ts` (líder) | `router.redes_cambiadas` en el catálogo. Contrato en `contratos/eventos.md` |
| `infra/wireguard` (A6) | Agente: `allowed_ips` y eventos nuevos. Servidor: marca de conexión, tabla 4172, firewall del puerto del corte, RADIUS y ping solo desde la red del túnel. `probar.sh`: cliente detrás del router que llega al `:8088` con su IP |
| `infra/mikrotik` (A6) | `servicio-firewall.rsc`, `servicio-limpieza.rsc`, `variables.json`, armados y `render.test.mjs` |
| `infra/produccion` (A6) | `PORTAL_CORTE_TUNEL`, `PORTAL_CORTE_PUERTO` (api) y `ARGOSISP_WG_REDES_EXCLUIDAS` (api). `wireguard` recibe `PORTAL_CORTE_PUERTO`. `instalar.sh` agrega `src_valid_mark`. `argosisp estado` avisa si `ARGOSISP_BIND_IP` es una IP concreta con el túnel de corte activo |
| A4 (panel) | Nada obligatorio. En el diagnóstico, mostrar el texto nuevo de `portal_ip_cliente`. En la ficha del router, «Corte por el túnel: sí/no» (si se expone; hoy no hay endpoint, ver `a6.md`) |
| A2 | Nada |

### 5 ter.11 Migración y qué hace el PM

1. **Actualizar** (`argosisp actualizar`): imágenes nuevas de `api`, `portal`, `wireguard` y `proxy`, y `instalar.sh` vuelve a escribir el sysctl. El agente reconcilia al arrancar. Los routers en modo `ip` registrados en el túnel reciben sus redes en AllowedIPs, y el servidor instala la marca y la tabla.
2. **Routers con API en modo `ip` y túnel:** el reconciliador cambia solo el dst-nat a `10.255.0.1:8088` y pone el `srcnat accept` en la siguiente pasada. «Reconciliar ahora» lo adelanta. Comprobar con **Diagnóstico de corte** que `portal_ip_cliente` sale en verde.
3. **Routers sin API:** «Generar script» y correrlo otra vez (la sección de servicio). Si no se corre, siguen como en la fase 1: dst-nat a `portal_v4`, «no identificado» con su motivo.
4. **Routers en modo `codigo`:** nada cambia. Pueden quedarse así.
5. **Servidor:**
    - si `ARGOSISP_BIND_IP` está fijada a una IP, quitarla (que el `:8088` escuche también en la IP del túnel) o poner `PORTAL_CORTE_TUNEL=0`. `argosisp estado` lo avisa;
    - con RHEL o `rp_filter=1`: `sudo sysctl --system` después de actualizar, o reiniciar.
6. **Servidor en la LAN:** nada en Argos. En el router, que el masquerade del operador no aplique hacia `portal_v4` (el diagnóstico lo dice).
7. **Volver atrás:** `PORTAL_CORTE_TUNEL=0` y `argosisp levantar`. El reconciliador vuelve al dst-nat de `portal_v4` y quita las reglas del túnel; el agente deja solo las `/32`.

### 5 ter.12 Pruebas, y lo que queda para el laboratorio

| Qué | Dónde |
| --- | --- |
| `corteTunelDeRouter`, `peersConRedes` (traslapes, red del túnel, excluidas, otro peer) | Japa `tests/network/corte_tunel.spec.ts` |
| `GET /internal/wireguard/peers` con `allowed_ips` | El mismo archivo |
| Estado deseado con túnel: dst-nat, `srcnat` accept y masquerade, `argos-portal`. Reconciliar con `RouterOSFalso` (crea y, al salir del túnel, borra). `migrar_control_router` conserva el modo | El mismo archivo |
| `router.redes_cambiadas` desde el reconciliador | El mismo archivo |
| Script con túnel y sin túnel, igual al estado deseado | `tests/network/conexion_render.spec.ts` y `infra/mikrotik/render.test.mjs` |
| `destino-corte` emite el código por IP (suspendido sí; activo no; idempotente; auditoría y evento solo al crear). Desambiguación (router, IP) | Japa `tests/portal/destino_corte.spec.ts` y `identificacion_corte.spec.ts` |
| Middleware con `codigo`: 302 a `destino?c=` | Vitest `apps/portal/tests/servidor/portal.test.ts` |
| Diagnóstico `portal_ip_cliente` del primer salto | Japa `tests/network/routeros_corte_diagnostico.spec.ts` |
| Agente con `allowed_ips`. Servidor: marca y tabla, cliente detrás de un «router» que llega al `:8088` con su IP, RADIUS desde una red de clientes rechazado, limpieza | `infra/wireguard/probar.sh` (CI, job `infra`) |

**Solo en el laboratorio físico** (`docs/laboratorio/portal-cautivo.md` §10):

1. CHR o RB con el script nuevo: un PPPoE suspendido abre `http://neverssl.com`, llega a `https://<portal>/corte?c=…` con su nombre parcial (con y sin `PORTAL_URL_PUBLICA`).
2. `connection-nat-state=dstnat` en `srcnat` (RouterOS 7.x).
3. Un masquerade del operador sin `out-interface` (el `accept` de arriba debe ganarle).
4. Servidor con `rp_filter=1` y `src_valid_mark` en 0 y en 1.
5. Túnel caído: el suspendido no ve la página. Comparte la falla con RADIUS (el vigía `aaa.caido` avisa).
6. Servidor en la LAN con y sin el masquerade del operador hacia `portal_v4`: lo que dice el diagnóstico.
7. Nodo de portal con routers por el túnel: el 302 del central al nodo con `?c=`.
8. Android, iOS (CNA) y Windows con el 302 con código.

**Fase 2b (IPv6 por el túnel), descrita y no implementada:**

- red ULA del túnel (`ARGOSISP_WG_RED6`, la `::1` para el servidor), `/128` por router en el IPAM del túnel y `allowed-address` del router con la ULA del servidor;
- dst-nat IPv6 del suspendido a esa ULA, y bloques IPv6 en AllowedIPs con la misma marca de conexión;
- solo hace falta si el servidor no tiene IPv6 nativo. Si lo tiene, `portal_v6` ya identifica sin NAT (§2.2).

## 6. Evidencia y fuentes

- Código de `main` (v1.12.0, `453b804`): archivos citados en cada sección.
- RouterOS 7, manual oficial:
    - `https://manual.mikrotik.com/docs/7.25/cli-reference/ip/proxy/access/`: `action=redirect` con 307, `action-data` sin variables, `local-port`, `src-address` IPv4 e IPv6;
    - `https://manual.mikrotik.com/docs/7.25/network-management/proxy/web-proxy/`: modo transparente con `dstnat action=redirect`, solo HTTP, advertencia de proxy abierto, escucha en IPv4 e IPv6.
- Hotspot, variables de `login.html`: `https://help.mikrotik.com/docs/spaces/ROS/pages/87162881/Hotspot+customisation`. Que no funcione sobre PPPoE **no está documentado**: queda para el laboratorio.
- Por verificar en el laboratorio:
    - todo lo marcado «probar» en §2.7 y §3 B;
    - `src-address` de `/tool/fetch` con masquerade (§4.2).
