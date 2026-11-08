# Runbook · Actualizar y revertir ArgosIsp

Para el operador de un servidor instalado con `instalar.sh` (`docs/runbooks/instalacion.md`). Cómo se publican las versiones: al final de este archivo.

## Versiones y canal

- Versionado semántico `MAYOR.MENOR.PARCHE` calculado de los Conventional Commits: `fix` → parche, `feat` → menor, `!` o `BREAKING CHANGE` → mayor.
- Canal `estable`: la última GitHub Release publicada (no borrador ni prerelease) cuyo paquete de instalación ya está subido. Las imágenes llevan la etiqueta de la versión y `estable` apunta a la última.
- Qué cambió: `CHANGELOG.md` del repositorio, las notas de cada GitHub Release y, en el panel, la sección de la versión instalada (`GET /api/v1/version`, campo `cambios`).

## Actualizar a mano

```sh
sudo argosisp estado          # instalada, última publicada y tipo de cambio
sudo argosisp actualizar      # a la última de estable
sudo argosisp actualizar --version 1.5.0
```

Pide confirmación (`s`); un cambio **mayor** pide escribir la versión y muestra el enlace a las notas: léelas antes. `--si` no pregunta (también para un mayor). Nunca baja de versión: para eso está `revertir`.

Qué hace, en orden, y qué pasa si falla cada paso:

| Paso | Si falla |
| --- | --- |
| 1. Descarga y verifica (sha256) el paquete de la versión nueva y `docker compose config` con el `.env` actual | No cambia nada. Si el compose nuevo pide una variable que el `.env` no tiene, el error la nombra: agrégala y repite |
| 2. Descarga las imágenes nuevas (`docker compose pull`), con todo arriba | No cambia nada |
| 3. Detiene la aplicación (Postgres y Redis siguen) y hace un **respaldo** en `respaldos/actualizaciones/` (sin cifrar y sin copia remota: es para revertir en este servidor). Si la red de compose ya no coincide con el `.env` (p. ej. `COMPOSE_SUBNET_V4` cambiado), antes la rehace con un down completo (`red-compose.md`) | Vuelve a levantar la versión instalada y termina con error |
| 4. Cambia `ARGOSISP_VERSION` y `actual`, levanta: `migrate` corre las migraciones, después todo lo demás | ↓ |
| 5. Espera a que cada servicio quede sano y que la API responda `/health` con la versión nueva | **Revierte solo**: detiene la versión nueva, vuelve a la anterior, **restaura el respaldo del paso 3** (base y comprobantes) y la levanta. Termina con error y el registro dice por qué falló |

La aplicación no atiende entre el paso 3 y el 5 (unos minutos, la mayor parte el respaldo). RADIUS también se detiene: las sesiones PPPoE ya establecidas siguen, pero los routers no autentican conexiones nuevas hasta que vuelve (usar una ventana de mantenimiento; con failover a secrets locales del MikroTik, ver `aaa-caido.md`).

Cada corrida deja su registro en `/opt/argosisp/registros/actualizar-<fecha>.log`. Solo una operación a la vez (bloqueo en `/opt/argosisp/.bloqueo`).

## API del portal y nodos portal

- `api-portal` (la misma API para el tráfico del portal) se actualiza, se vigila y se revierte junto con `api`: misma imagen, misma base. Si una instalación anterior no tiene `ARGOSISP_API_PORTAL` en el `.env`, `argosisp actualizar` lo escribe: `si`, o `no` con menos de 3 GB de RAM (lo avisa en el registro). Apagarlo: `ARGOSISP_API_PORTAL=no` y `sudo argosisp levantar`.
- **Nodos portal:** actualiza primero el servidor principal y después cada nodo con `sudo argosisp actualizar`. El nodo solo cambia su imagen del portal, toma como objetivo la versión de `GET /api/v1/version` del central y se niega a pasarla (ni con `--version`). Si no puede leer la versión del central (token revocado, central caído), no se actualiza. `argosisp estado` en el nodo avisa si no coincide. `argosisp revertir` en un nodo solo vuelve a la imagen anterior (no tiene base que restaurar).

## Portal de corte en el panel (desde la versión con «Configuración → Portal de corte»)

- El destino del dst-nat de los suspendidos (IPv4, IPv6 y puerto del portal) y el modo de suspensión (`desconectar` o `coa`) pasan del `.env` al panel: **Configuración → Portal de corte**. Al actualizar no hay que hacer nada: mientras nadie guarde esa pantalla, ArgosIsp sigue usando los valores del `.env` de antes (`ROUTERS_SERVICIO_PORTAL_V4/_V6`, `PORTAL_CORTE_V4`, `PORTAL_CORTE_PUERTO` y `COA_SUSPENDER`), y la pantalla los muestra con origen «entorno».
- Desde la primera vez que se guarda, esas variables ya no se leen para el corte: cambiarlas en el `.env` no hace nada. Se cambia en el panel; ArgosIsp reconcilia todos los routers y `coa` lee el modo de la API (`GET /api/v1/internal/corte/configuracion`).
- `PORTAL_CORTE_PUERTO` sigue siendo, además, el puerto en que escucha Caddy para `/corte` (8088 por defecto): eso es del servidor y se cambia en el `.env` con `sudo argosisp levantar`. Si lo cambias, pon el mismo puerto en el panel.

## Identificación del cortado (desde la 1.13.0)

Contrato: `.claude/integration/contratos/corte-identificacion.md`. Cada router elige cómo sabe la página de corte qué cliente es:

- **Por IP** (`ip`, lo de siempre y el valor de los routers existentes): el router hace dst-nat del HTTP del suspendido al portal y el portal lo identifica por la IP de origen. Solo sirve si el portal ve la IP real del cliente (sin NAT ni proxy en medio).
- **Por código** (`codigo`, necesita la API del router): el HTTP del suspendido va al web proxy del propio router (puerto 3346, sin caché, cerrado desde la WAN) y `/ip proxy access` le responde **307** a `/corte?c=<código>`. El portal lo identifica por el código aunque haya NAT o proxies en medio.

### Después de actualizar

1. Agrega al `.env` `PORTAL_IPS_SERVIDOR=<IP pública>,<IP LAN>[,<IP del proxy de delante>]` (separadas por coma; una instalación nueva ya la trae) y `sudo argosisp levantar`. `sudo argosisp estado` avisa si falta, si el proxy de `ARGOSISP_PROXIES_CONFIABLES` no está en ella o si `PORTAL_PROXIES_CONFIABLES` quedó fijada sin la red de compose.
2. No hace falta tocar `PORTAL_PROXIES_CONFIABLES`: sin valor sigue a la red de compose.
3. Los routers siguen en `ip`. En cada router, **Probar conexión → Corte**: si `portal_ip_cliente` sale en rojo («el portal ve la IP X en vez de la del cliente»), ese router necesita el modo código.

### Pasar un router a modo código

1. Requisitos: el router conectado por API (la ficha muestra «API: conectada») y RouterOS 7. Sin API el panel responde «corte_codigo_sin_api»: primero conecta el router (`infra/mikrotik/README.md`, «Conectar un router»).
2. Si el operador ya usa `/ip proxy` en ese router (caché, filtros), no pasa nada: Argos solo agrega el puerto 3346 y sus reglas, y no toca lo demás. Anota igual lo que tiene: `/ip proxy print` y `/ip proxy access print`.
3. Panel → Routers → editar → **Identificación del cortado: Por código** → Guardar (por la API: `PUT /api/v1/routers/:id` con `corte_identificacion: "codigo"` y la `version` del router). Argos reconcilia ese router en el acto (`portal.config_cambiada` con `router_id`); «Reconciliar ahora» lo repite.
4. Verifica en el router:
   ```routeros
   /ip proxy print                                        # enabled=yes, port incluye 3346, max-cache-size=none si era solo de Argos
   /ip proxy access print                                 # primero argosisp:servicio:<id> de cada suspendido, luego "argosisp: corte proxy sin codigo"
   /ip firewall nat print where comment~"proxy de corte"  # redirect to-ports=3346 (IPv4); igual en /ipv6 firewall nat
   /ip firewall filter print where comment~"proxy de corte" # drop del 3346 con connection-nat-state=!dstnat y accept en argos-corte-in
   ```
5. **Probar conexión → Corte**: `proxy_corte` en verde. Desde un suspendido, `curl -sI http://example.com` responde `307` con `Location: …/corte?c=…`.
6. Desde fuera (la WAN del router): el 3346 no responde (`nc -vz <IP WAN> 3346` agota el tiempo).
7. Un router que se conecta de cero con «incluir configuración de servicio» ya sale con estas piezas si está en `codigo` (el script trae las mismas reglas que el reconciliador).

Para volver a `ip`: editar el router → **Por IP**. Argos quita el 3346 del proxy (y lo apaga si era solo suyo), borra sus reglas y vuelve a poner el dst-nat al portal.

### Corte por el túnel y servidor en la LAN (fase 2)

Contrato: `corte-identificacion.md` §5 ter. Con WireGuard activo (`ARGOSISP_WIREGUARD=1`), un router en modo **Por IP** registrado en el túnel ya no manda al suspendido a la IPv4 pública del portal. Lo manda a la IP del servidor en el túnel (`10.255.0.1:8088`, `PORTAL_CORTE_PUERTO`) sin masquerade. Así el portal ve la IP del cliente, lo identifica y lo redirige a `https://<portal>/corte?c=<código>` con el código de su suspensión. El resto de la visita ya no depende de la IP.

1. `sudo argosisp actualizar`. El instalador vuelve a escribir `/etc/sysctl.d/90-argosisp-wireguard.conf`, ahora con `net.ipv4.conf.all.src_valid_mark = 1`. Si tu servidor tiene `rp_filter=1` (RHEL y derivados), aplica con `sudo sysctl --system` o reinicia.
2. `sudo argosisp estado`: si avisa de `ARGOSISP_BIND_IP`, quítala del `.env` (el puerto del corte debe escuchar también en la IP del túnel) o pon `PORTAL_CORTE_TUNEL=0`, y luego `sudo argosisp levantar`.
3. **Routers con API en modo Por IP:** «Reconciliar ahora». En el router:
   ```routeros
   /ip firewall nat print where comment~"corte"   # dst-nat to-addresses=10.255.0.1 to-ports=8088; arriba "argosisp:top corte por tunel sin NAT"
   /ip firewall address-list print where comment="argosisp: portal tunel"
   ```
   **Probar conexión → Corte**: `portal_ip_cliente` debe salir en verde.
4. **Routers sin API:** «Generar script» con «incluir configuración de servicio» y córrelo otra vez. Si no lo haces, siguen como antes («no identificado», con su motivo).
5. **Routers en modo código:** no cambia nada.
6. **Servidor dentro de la LAN del ISP** (sin túnel): no hay nada que cambiar en Argos. En el router, tu masquerade no debe aplicar hacia la IPv4 del portal; el de Argos solo sale por la WAN. Si el diagnóstico dice que el portal ve la IP del router, agrega antes de tu masquerade:
   ```routeros
   /ip firewall nat add chain=srcnat src-address-list=argos-clientes dst-address=<IPv4 del portal> action=accept place-before=0 comment="sin NAT hacia el portal"
   ```
   El servidor necesita ruta de vuelta a las redes de clientes: el router es su puerta de enlace, o tiene rutas estáticas.

Para volver atrás: `PORTAL_CORTE_TUNEL=0` en el `.env` y `sudo argosisp levantar`. El reconciliador devuelve el dst-nat a la IPv4 del portal y el agente deja en cada peer solo su `/32`.

## Parches automáticos (opcional, apagado por defecto)

```sh
sudo argosisp auto activar      # timer diario 04:20 UTC (+ hasta 30 min al azar), después del respaldo
sudo argosisp auto desactivar
sudo argosisp auto estado
```

El timer corre `argosisp actualizar --auto`: aplica **solo parches** (misma MAYOR.MENOR) con el mismo respaldo y reversión de arriba. Un cambio menor o mayor queda anotado en el registro y espera a que alguien corra `argosisp actualizar`. Para que también aplique menores: `Environment=ARGOSISP_AUTO_NIVEL=menor` con `sudo systemctl edit argosisp-actualizar.service`. Cambiar la hora: `sudo systemctl edit argosisp-actualizar.timer`. Resultado de la última corrida: `journalctl -u argosisp-actualizar.service`.

## Revertir a mano

Cuando una actualización quedó sana pero después aparece un problema:

```sh
sudo argosisp revertir
```

Vuelve a la versión anterior a la **última** actualización y restaura el respaldo que se tomó justo antes de ella. **Todo lo registrado después (pagos, facturas, cambios de servicios) se pierde**: pide escribir `revertir`. Si hay que conservar movimientos, respáldalos primero (`sudo argosisp respaldar`) y anota qué se registró para volver a cargarlo.

- Solo revierte una vez y solo la última actualización (`estado/ultima-actualizacion`); si la instalada no coincide con la registrada, se niega.
- El respaldo previo sigue la retención de `BACKUP_RETENCION_DIAS`: pasado ese plazo ya no se puede revertir.
- Sin perder datos (solo imágenes) no se puede: las migraciones de la versión nueva ya cambiaron la base.

## Si la reversión automática también falla

El comando termina con `NO SE PUDO RESTAURAR …` o `LA VERSIÓN … NO QUEDÓ SANA`. ArgosIsp queda en la versión anterior (`.env` y `actual`), con la aplicación detenida.

1. `sudo argosisp logs migrate api backup` y el registro de `/opt/argosisp/registros/`. Si el error habla de la red (`has active endpoints`, `network … not found`), `sudo argosisp reparar-red` y seguir con `red-compose.md`.
2. Restaurar a mano el respaldo previo (nombre en el registro, o el más nuevo de `respaldos/actualizaciones/`):
   ```sh
   sudo argosisp compose run --rm backup restaurar.sh /backups/actualizaciones/argosisp-<marca>.dump \
     --base argosisp --reemplazar --comprobantes-dir /comprobantes
   sudo argosisp levantar
   ```
3. Si el respaldo previo no sirve, el último respaldo diario: `docs/runbooks/restaurar-backup.md`.

## Cómo se publica una versión (equipo)

1. Cada push a `main` actualiza la rama de la PR **"chore: publicar versión X.Y.Z"** de release-please (`.github/workflows/release.yml`) con la versión y el `CHANGELOG.md` en español (secciones en `release-please-config.json`; `docs`, `test`, `ci`, `chore` y `refactor` no aparecen). Los commits deben seguir Conventional Commits; los que no (por ejemplo `merge: …`) no entran.
2. Actions no tiene permiso para abrir PRs: el job `release-please` actualiza la rama `release-please--branches--main--components--argosisp` y termina en rojo al intentar abrir la PR. Una persona abre la PR desde esa rama hacia `main`, con el título que trae su commit y la etiqueta `autorelease: pending` (sin la etiqueta, el merge no publica). Se arregla de raíz activando en Settings → Actions → General «Allow GitHub Actions to create and approve pull requests». Como la abre una persona, el CI corre solo; se mergea con squash y CI en verde.
3. Al mergear: etiqueta `vX.Y.Z`, GitHub Release con las notas, y `imagenes.yml` construye las ocho imágenes (`ghcr.io/hcdestroyer/argosisp-{api,web,portal,aaa,coa,backup,freeradius,wireguard}`) para amd64 y arm64, mueve `estable` cuando están todas y sube a la Release `argosisp-X.Y.Z.tar.gz`, su `.sha256` e `instalar.sh`. Recién entonces los servidores ven la versión.
4. Para forzar un número de versión: un commit en `main` con el pie `Release-As: X.Y.Z` (sin commits nuevos de `feat` o `fix`, release-please dice «No user facing commits» y no prepara nada). La 1.0.0 salió así; `release-please-config.json` ya no lleva `release-as`.
5. Las etiquetas no se suben a mano: la protección del repositorio rechaza el push de `v*`. Volver a publicar una versión ya etiquetada: `workflow_dispatch` de `imagenes.yml`. `estable` nunca retrocede.
6. Los paquetes `argosisp-*` de GHCR ya son públicos (comprobado con la 1.0.0: las siete imágenes se descargan sin credenciales). Un paquete nuevo nace privado: hay que hacerlo público en GitHub → Packages.

Prueba en CI (job `distribucion`, `infra/ci/probar-distribucion.sh`): con las imágenes del commit, instala `0.0.1`, actualiza a `0.0.2` (los datos siguen), intenta `0.0.3` con una API que no arranca y cuyas migraciones dejan una marca en la base (debe revertir sola: versión `0.0.2`, sin la marca, con los datos y comprobantes del respaldo), comprueba que `--auto` no aplica un cambio mayor y corre `argosisp revertir` (vuelve a `0.0.1` con los datos de antes de la primera actualización).
