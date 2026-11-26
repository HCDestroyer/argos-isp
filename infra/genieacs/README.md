# GenieACS en su propio servidor

GenieACS es el ACS (servidor TR-069) que usa Argos para configurar módems, routers y Wi-Fi de los
clientes. Va en **un servidor aparte** de Argos (decisión del PM: el sistema crece de forma
horizontal). Cada empresa puede tener su propio GenieACS: en Argos se configura por empresa.

```
Equipos de los clientes ──HTTP 7547──▶  GenieACS (CWMP)          abierto a internet
Argos                   ──HTTPS 7557──▶ Caddy ──▶ GenieACS (NBI)  usuario y clave + solo IP de Argos
Administrador           ──HTTPS 3443──▶ Caddy ──▶ GenieACS (UI)   usuario y clave + solo IP permitidas
MongoDB                 (sin puertos afuera)  ──▶ respaldo diario en ./respaldos
```

El NBI de GenieACS **no tiene autenticación propia**. Por eso nunca se publica directo: GenieACS lo
escucha solo dentro del servidor y la única entrada es Caddy, con HTTPS, usuario y clave, y la lista de
IP permitidas. La interfaz web va igual.

Archivos: `docker-compose.yml` (GenieACS, MongoDB, Caddy y respaldo), `.env.example` (lo que se llena),
`caddy/Caddyfile` (el proxy), `respaldo/` (respaldar y restaurar), `Dockerfile` (GenieACS 1.2.16 desde
npm, como dice su guía oficial).

## 1. Requisitos

- Un servidor Linux (Ubuntu 24.04 o Debian 12) con **IP pública fija**. Para empezar: 2 CPU, 4 GB de
  RAM y 40 GB de disco (crece con la cantidad de equipos; MongoDB es lo que más ocupa).
- Docker con el plugin de Compose: `curl -fsSL https://get.docker.com | sh` (como root).
- Acceso SSH al servidor y a la configuración del DNS del dominio del ISP.
- Saber las **IP públicas de los servidores de Argos** (de donde sale Argos a internet).

## 2. Nombre en el DNS

En el proveedor del dominio, crea un registro **A**:

| Nombre | Tipo | Valor |
| --- | --- | --- |
| `acs.tuisp.com.gt` (el que quieras) | A | la IP pública del servidor de GenieACS |

Comprueba desde tu computadora que ya responde: `ping acs.tuisp.com.gt` debe mostrar esa IP (puede
tardar unos minutos).

## 3. Copiar los archivos y llenar `.env`

En el servidor:

```bash
git clone <repositorio de Argos> argos && cd argos/infra/genieacs
cp .env.example .env
nano .env
```

Llena, uno por uno:

1. `ACS_DOMINIO`: el nombre del paso 2.
2. `GENIEACS_UI_JWT_SECRET`: pega lo que salga de `openssl rand -hex 64`.
3. `NBI_USUARIO` y `NBI_CLAVE_HASH` (paso 5) y `NBI_IPS_PERMITIDAS` con las IP de Argos, separadas por
   espacio y terminadas en `/32` (ej.: `203.0.113.10/32 203.0.113.11/32`).
4. `UI_USUARIO`, `UI_CLAVE_HASH` y `UI_IPS_PERMITIDAS` (la IP de la oficina, por ejemplo).
5. El certificado (paso 4).

## 4. Certificado HTTPS

Dos formas (variable `TLS_MODO`):

- **`auto` (recomendada).** Caddy pide y renueva solo un certificado de Let's Encrypt. Necesita el DNS
  del paso 2 funcionando, `ACME_EMAIL` con un correo real y el **puerto 80 abierto** (solo para que
  Let's Encrypt compruebe el dominio).
- **`archivos`.** Si el ISP ya tiene un certificado para ese nombre: copia `fullchain.pem` (con la
  cadena completa) y `privkey.pem` a la carpeta `CERTS_DIR` (por defecto `./certs`). Si el certificado
  es de una autoridad propia (no pública), en Argos pega el certificado raíz de esa autoridad en el
  campo «Certificado raíz del ACS».

Con un certificado vencido, autofirmado o de otro nombre, «Probar conexión» de Argos lo dice tal cual
(«El certificado HTTPS de GenieACS no es válido: …») y no manda el usuario ni la clave.

## 5. Usuario y clave del NBI (para Argos)

1. Inventa una clave larga (20 caracteres o más) y guárdala en el gestor de contraseñas del ISP.
2. Saca su hash (lo que va en `.env`; la clave en claro **no** va en el servidor):

   ```bash
   docker run --rm caddy:2.8.4 caddy hash-password --plaintext 'LA-CLAVE'
   ```

3. Pega el resultado en `NBI_CLAVE_HASH`, **entre comillas simples** (lleva signos `$`).
4. Repite con otra clave para la interfaz web (`UI_CLAVE_HASH`).

## 6. Abrir los puertos (firewall)

| Puerto | Desde | Para qué |
| --- | --- | --- |
| 7547/tcp | Internet (los equipos de los clientes) | TR-069 (CWMP) |
| 7557/tcp | Solo las IP de Argos | NBI con HTTPS (Caddy) |
| 3443/tcp | Solo la oficina o la VPN | Interfaz web con HTTPS (Caddy) |
| 80/tcp | Internet | Solo con `TLS_MODO=auto` (Let's Encrypt) |
| 7567/tcp | Los equipos | Solo si publicas firmware (`FS_INTERFAZ=0.0.0.0`) |
| 22/tcp | Tu IP | SSH |

Con `ufw` (ejemplo; cambia las IP):

```bash
ufw default deny incoming
ufw allow from <TU_IP> to any port 22 proto tcp
ufw allow 7547/tcp
ufw allow 80/tcp
ufw allow from 203.0.113.10 to any port 7557 proto tcp
ufw allow from <IP_OFICINA> to any port 3443 proto tcp
ufw enable
```

Ojo: Docker abre por su cuenta los puertos que publica (7547 y 7567) aunque `ufw` diga otra cosa. Los
de Caddy (7557, 3443, 80) sí los respeta `ufw`, porque Caddy usa la red del servidor. Por eso el NBI y
la UI tienen dos barreras: el firewall y la lista de IP de Caddy.

## 7. Arrancar y comprobar

```bash
docker compose up -d --build
docker compose ps            # mongo, genieacs, caddy y respaldo en "running"
docker compose logs -f caddy # con TLS_MODO=auto, espera "certificate obtained successfully"
```

Comprueba desde un servidor de Argos (debe responder `[]` o la lista de equipos):

```bash
curl -u argos:'LA-CLAVE' 'https://acs.tuisp.com.gt:7557/devices/?query=%7B%7D&projection=_id&limit=1'
```

Sin usuario y clave debe dar `401`; desde una IP no permitida, `403`.

Interfaz web: `https://acs.tuisp.com.gt:3443` (pide el usuario del proxy y después el de GenieACS; la
primera vez crea o cambia su administrador).

## 8. Conectar Argos

En Argos, con la empresa correcta elegida: **Configuración › Integraciones › ACS (GenieACS)** (un ACS por
empresa, aparte de SmartOLT):

- URL de GenieACS: `https://acs.tuisp.com.gt:7557`
- Usuario y clave: los del paso 5 (la clave en claro).
- Certificado raíz: solo si usaste un certificado de una autoridad propia.
- «Probar conexión» debe salir en verde. Desde ese momento Iris ve la capacidad `tr069` de esa empresa.

Por API: `PUT /api/v1/integraciones/acs` con `version`, `activo`, `url`, `usuario`, `clave` (y `ca` si
aplica), y después `POST /api/v1/integraciones/acs/probar` (`contratos/equipos-olt-acs.md`).

## 9. Apuntar los equipos a este ACS desde SmartOLT

Las ONT se enteran de qué ACS usar por el **perfil TR-069** de SmartOLT:

1. En el panel de SmartOLT, crea (o edita) un perfil TR-069 con:
   - **URL del ACS:** `http://acs.tuisp.com.gt:7547/`
   - Usuario y clave del ACS: vacíos (GenieACS acepta cualquier equipo de fábrica; ver «Seguridad» abajo).
   - Intervalo de informe periódico: 300 segundos.
2. Asígnalo al **perfil de autorización** (preset) que usa Argos para esa OLT y plan, para que cada ONT
   autorizada desde Argos salga ya con TR-069 (en la API de SmartOLT eso se ve como `sets_tr069: true`
   en `get_authorization_presets`). Para ONT ya instaladas, se activa por ONT (en la API,
   `POST /api/onu/enable_tr069/{onu_external_id}` con `tr069_profile`).
3. Espera unos minutos y revisa en la interfaz web de GenieACS que aparecen los equipos.

Los nombres exactos de los menús de SmartOLT pueden variar con su versión; lo que importa es la URL del
ACS. Routers y CPE que no pasan por SmartOLT se apuntan igual, en su página de administración
(«TR-069», «ACS URL»).

## 10. Respaldo de MongoDB

- El servicio `respaldo` hace un `mongodump` comprimido **todos los días** a la hora `RESPALDO_HORA_UTC`
  (08 UTC = 2:00 de Guatemala) en `RESPALDO_DIR` (`./respaldos`) y borra los de más de `RESPALDO_DIAS`.
- Respaldo inmediato: `docker compose exec respaldo bash /usr/local/bin/respaldar.sh --ahora`.
- **Cópialos fuera del servidor** (un respaldo en el mismo disco no sirve si el disco falla), por
  ejemplo cada noche con `rsync` al servidor de respaldos de Argos o con `rclone` a un almacenamiento
  externo:

  ```bash
  rsync -a --delete ./respaldos/ respaldos@backup.tuisp.com.gt:/respaldos/genieacs/
  ```

- Restaurar (reemplaza la base actual):

  ```bash
  docker compose exec respaldo bash /usr/local/bin/restaurar.sh genieacs-20261121T080000Z.archive.gz
  docker compose restart genieacs
  ```

Pruébalo una vez en otro servidor: restaura el respaldo de ayer y comprueba que los equipos aparecen en
la interfaz web.

## Seguridad

- Nunca publiques los puertos 17557 (NBI) ni 13000 (UI) ni MongoDB: solo escuchan en `127.0.0.1`.
- Si un día los equipos de los clientes tienen que autenticarse al ACS, GenieACS lo soporta (sección
  «CPE Authentication» de su documentación); se configura en el ACS y en el perfil TR-069 de SmartOLT.
- Para cambiar la clave del NBI: nuevo hash en `.env`, `docker compose up -d caddy`, y la clave nueva en
  Argos (y «Probar conexión»).

## Varios GenieACS

Un ISP con varias empresas (o un ACS por región) instala este mismo directorio en cada servidor, cada uno
con su `ACS_DOMINIO`, y en Argos guarda la URL de cada ACS en la empresa que le corresponde. Argos nunca
asume un ACS único: cada servicio usa el de su empresa.
