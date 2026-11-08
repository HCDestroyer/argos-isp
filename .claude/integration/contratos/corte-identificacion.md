# Contrato (borrador): identificar al cliente cortado en la página de corte

> **Estado:** borrador para que el PM decida. No hay código en esta rama todavía. Dueño: A5 (portal). Afecta a A1 (núcleo/IPAM, script de conexión), A2 (aaa/coa), A4 (panel), A6 (infra: WireGuard, Caddy, instalador) y routeros (reconciliador).
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
| Retirado, o su IP reasignada a otro servicio | **Peligro:** si el nuevo dueño de la IP es suspendido y la regla vieja sigue, el router lo manda con el código **del cliente anterior** | Al escribir la regla de una IP se borra cualquier otra `argosisp:corte:*` con la misma `src-address`. El código solo resuelve mientras el servicio está suspendido o en la ventana de gracia. La regla se reescribe con `asignacion.cambiada` y `sesion.iniciada` |
| Router reiniciado | Las reglas de `/ip proxy access` son configuración persistente: sobreviven al reinicio | — |
| Router sin contacto al suspender | RADIUS suspende igual, pero la regla COD no se escribe. El cliente cae en la regla final sin código → IP → «no identificado» con la salida manual | Reintentos (BullMQ) y reconciliación al volver el router (`reconciliar_router.ts`). `routeros.fallido` |
| Huérfanos | Reglas `argosisp:corte:<id>` de servicios no suspendidos, o con otra IP | Las borra el reconciliador (como `argosisp:servicio:*`) |

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
  add chain=argos-corte-nat protocol=tcp dst-port=80 action=redirect to-ports=3346 comment="argosisp: corte-nat HTTP al proxy del router"
/ip firewall filter (argos-corte-in, antes del tcp-reset)
  add chain=argos-corte-in protocol=tcp dst-port=3346 action=accept comment="argosisp: corte-in proxy de corte"
/ip firewall filter (input, arriba)
  add chain=input protocol=tcp dst-port=3346 src-address-list=!suspendidos action=drop comment="argosisp:top proxy de corte solo suspendidos"
/ip proxy access (por servicio suspendido, en orden, antes de la final)
  add local-port=3346 src-address=10.66.1.3 action=redirect action-data="https://portal.isp.gt/corte?c=K7M2QX9TB4RZA" comment="argosisp:corte:1234"
  add local-port=3346 src-address=2803:xxxx:10:300::/56 action=redirect action-data="…?c=K7M2QX9TB4RZA" comment="argosisp:corte:1234"
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
- Reglas `/ip/proxy/access` por servicio en el estado deseado del servicio: `argosisp:corte:<id>`, IPv4 de la asignación o sesión y prefijos IPv6.
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
2. **Fase 2:** A (túnel con AllowedIPs de clientes y A′) para routers sin API.
3. **Fase 3:** `url_corte` con código (según P3) y desambiguación (router, IP) para pools repetidos.

---

## 5. Preguntas abiertas (decisión del PM)

- **P1. Modo por defecto.** ¿Código (B) por defecto en todos los routers con API, o elegible por router en «Portal de corte» (`codigo` | `ip`)? Propuesta: B por defecto en routers con API; `ip` solo si el operador garantiza que no hay NAT.
- **P2. Web proxy del router.** ¿Aceptas que Argos active `/ip proxy` (sin caché, puerto propio 3346, bloqueado desde fuera)? Si algún router ya usa el proxy, ¿Argos agrega su puerto o se excluye ese router?
- **P3. `url_corte` externa.** Opciones:
    - a) la regla del router lleva a la `/corte` de Argos y la `url_corte` se usa solo sin código (como hoy);
    - b) la regla lleva a la `url_corte` con `?c=`, y la página externa consulta `GET /portal/quien-soy?c=`, que es público;
    - c) la `url_corte` admite `{codigo}` en la plantilla.

   Propuesta: a) ahora y c) después.
- **P4. Qué permite el código sin verificación.** Hoy la IP permite ver nombre parcial, estado y montos, pedir promesa y subir comprobante. ¿El código da lo mismo (propuesta) o menos (solo ver, y la promesa con verificación)?
- **P5. Vigencia del código.** ¿Uno por suspensión, que caduca al reactivar más 30 min (propuesta), o fijo por servicio y rotable a mano desde el panel?
- **P6. Routers sin API.** ¿Vale la pena la fase 2 (túnel con redes de clientes) o basta con la salida manual (código por teléfono o correo) para esos routers?
- **P7. Servidor en la LAN del ISP o nodo de portal.** ¿Hay instalaciones así? Si sí, A′ (mantener los dos saltos por HTTP en el destino del NAT) entra en la fase 2.

## 6. Evidencia y fuentes

- Código de `main` (v1.12.0, `453b804`): archivos citados en cada sección.
- RouterOS 7, manual oficial:
    - `https://manual.mikrotik.com/docs/7.25/cli-reference/ip/proxy/access/`: `action=redirect` con 307, `action-data` sin variables, `local-port`, `src-address` IPv4 e IPv6;
    - `https://manual.mikrotik.com/docs/7.25/network-management/proxy/web-proxy/`: modo transparente con `dstnat action=redirect`, solo HTTP, advertencia de proxy abierto, escucha en IPv4 e IPv6.
- Hotspot, variables de `login.html`: `https://help.mikrotik.com/docs/spaces/ROS/pages/87162881/Hotspot+customisation`. Que no funcione sobre PPPoE **no está documentado**: queda para el laboratorio.
- Por verificar en el laboratorio:
    - todo lo marcado «probar» en §2.7 y §3 B;
    - `src-address` de `/tool/fetch` con masquerade (§4.2).
