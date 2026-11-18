---
orden: 2
pantallas:
    - /routers/[id]#ficha-del-router
---

# Ficha del router

Todo lo de un MikroTik en una pantalla: cómo limita la velocidad, qué tipo de conexión usan sus clientes, sus redes y pools, su conexión por WireGuard con ArgosIsp y su baja.

## Quién la usa

- Ver la ficha: `routers.ver` (`admin`, `soporte`, `tecnico`).
- Cada botón pide su propio permiso. Varios cambios del router son solo de `admin` porque afectan a todos sus clientes a la vez.

## Ficha del router

### Cabecera

Nombre, «Activo» o «Inactivo», el modo de seguridad («RADIUS» o «Sin RADIUS»), cómo identifica al cliente cortado («Corte por código» o «Corte por IP»), el estado del túnel y la versión de RouterOS. A la derecha, «Probar conexión» (`routers.probar_conexion`) y el menú «Acciones».

Si el router se unió a otro, verás «Este router se unió a otro» con el enlace «Ver el router que quedó».

### Franja de salud

Debajo de la cabecera, cada dato con su propia lectura: contacto, túnel y API, RADIUS (modo, NAS y secreto), sesiones abiertas (con `sesiones.ver`) y ocupación de los pools IPv4 e IPv6. Si un dato no se pudo leer, lo dice con «Reintentar» en vez de mostrar un número.

### Pestañas

Control de velocidad (abierta por defecto), Red de acceso, Pools e IPs, Servicios, Conexión y Avanzado.

## Control de velocidad

Cómo el router limita la velocidad de cada cliente. Es un solo modo por router.

- **Qué ves:** el modo actual como tarjetas: qué crea en el MikroTik, su costo de CPU («CPU baja», «CPU media», «CPU alta») y cuándo conviene. «Comparar con los otros modos» los muestra todos. Debajo, el rate-limit efectivo de cada plan en este router (con `planes.ver`).
- **Modos principales:** «Colas simples» (una cola por servicio bajo una cola padre por plan; bien hasta unos cientos de clientes por router) y «Árbol con PCQ» (un árbol de colas con un hijo por plan y reparto por cliente; recomendado para muchos clientes por router).

### Cambiar modo

- **Permiso:** `routers.cambiar_control_velocidad` (solo `admin`). Sin él, la ficha dice «Solo un administrador cambia el control de velocidad».
- **Pasos:**
    1. «Cambiar modo» abre el editor, con una pestaña por tipo de conexión y cuatro capas: cómo se aplica el límite a cada cliente (RADIUS por sesión, perfil PPP del plan, cola simple por API, PCQ por plan o árbol de colas con PCQ), cómo se agrupan (sin agrupar, por plan, techo del router o router → plan → cliente), el tipo de cola (por defecto, SFQ, fq_codel, CAKE o PCQ) y los extras (ráfaga, prioridad, velocidad garantizada, verificar FastTrack y prioridad por clases QoS). Lo que no combina aparece deshabilitado con el porqué.
    2. «Revisar cambios» muestra qué se crea, cambia y borra en el router. Nada se escribe todavía.
    3. Escribe el motivo y pulsa «Aplicar».
- **Qué pasa:** se aplica por lotes. Las sesiones PPPoE ya conectadas conservan lo anterior hasta que su equipo vuelva a conectarse; nadie se queda sin internet. En «Opciones avanzadas», «Reconectar ahora» desconecta esas sesiones por lotes para que entren ya con lo nuevo (cada cliente se queda sin internet unos segundos); pide confirmar con una casilla.

### Unificar excepciones por plan

Si el router trae planes con velocidad propia de antes (ahora el modo es uno por router), aparece un aviso con «Unificar» (`routers.unificar_control_velocidad`, solo `admin`). La vista previa dice qué planes cambian, qué se crea y se borra y cuántas sesiones toman el modo del router al reconectar. Pide motivo y, opcionalmente, «Reconectar ahora».

### Capacidad del enlace

Bajada y subida en kbps (vacía: sin techo). Con `routers.editar`, «Guardar capacidad» actualiza el techo de la cola padre en el router.

## Tipo de conexión

Junto al control de velocidad está el tipo de conexión del router: PPPoE, IP estática o DHCP con IP fija. Todos sus servicios lo usan.

- **Permiso:** `routers.cambiar_tipo_conexion` (solo `admin`).
- **Cambiar tipo:** elige el tipo nuevo y revisa la vista previa: cuántos servicios cambian, cuáles tienen datos faltantes (por ejemplo, DHCP fija exige la MAC de cada servicio) y qué se completa solo (se generan usuario y contraseña PPPoE, se asigna IPv4, la IPv6 por RADIUS pasa a «Sin IPv6», se quita el amarre IP-MAC). Si algo bloquea, lo dice en «No se puede aplicar». Escribe el motivo y pulsa «Cambiar a …».
- **Unificar:** si hay servicios antiguos que no usan el tipo del router, aparece el aviso «N servicios no usan el tipo del router» con «Unificar»: solo pasan esos servicios.
- **Qué pasa:** cada servicio cambia de tipo, uno por uno, y queda en su bitácora. Al pasar de PPPoE a otro tipo, el cliente necesita su equipo configurado con IP estática o DHCP.

::: warning Afecta a todos los clientes del router
Coordina el cambio con el equipo de campo: los equipos de los clientes tienen que usar el tipo nuevo para seguir navegando.
:::

Desde «Editar» también se puede cambiar el tipo, pero solo si ningún servicio tendría que cambiar.

## Red de acceso

El árbol del router: interfaz → VLAN (con su OLT y puerto PON) → servidor PPPoE → red IPv4 y pools IPv6, con los servicios de cada servidor. Se filtra por OLT y por puerto PON. Hace falta `red_acceso.ver`.

| Botón                   | Permiso                                      | Qué hace                                                                                                                               |
| ----------------------- | -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| «Detectar en el router» | `red_acceso.descubrir`                       | Lee del router sus VLAN, servidores PPPoE, perfiles y pools, sin escribir nada. Lo detectado se puede importar (`red_acceso.adoptar`). |
| «Tomar control»         | `red_acceso.tomar_control`                   | Pasa una VLAN o un servidor adoptado a administrado: desde ahí ArgosIsp lo escribe en el router.                                       |
| «Revisar deriva»        | `routers.reconciliar`                        | Muestra lo que no coincide entre ArgosIsp y el router.                                                                                 |
| «OLT y puertos PON»     | `olts.crear`, `olts.editar`, `olts.eliminar` | Registro de las OLT y sus puertos.                                                                                                     |
| «Nueva VLAN»            | `vlans.crear`                                | Crea una VLAN administrada. También editar y eliminar (`vlans.editar`, `vlans.eliminar`; solo sin servidor PPPoE).                     |
| «Nuevo servidor PPPoE»  | `servidores_pppoe.crear`                     | Crea un servidor PPPoE. También editar y eliminar (solo sin servicios).                                                                |

Lo adoptado se ve con candado: ArgosIsp no lo toca. Si hay servicios PPPoE sin servidor, el aviso lo dice; se asignan al editar cada servicio.

## Pools e IPs

Las redes IPv4 y los bloques IPv6 del router, cada uno con su barra de ocupación, lo que recibe un servicio nuevo de cada plan y sus avisos.

### Redes IPv4

- «Agregar red» (`redes.crear`) y editar (`redes.editar`): **Red (CIDR)**, **Nombre**, **Tipo** (Pool o Estático), **Gateway** (nunca se asigna a un servicio; vacío usa la primera IP utilizable), **Rango** (primera y última IP que se entregan; vacío es toda la red) y **DNS** primario y secundario.
- Al achicar una red, si alguna IP en uso queda fuera, ArgosIsp no lo permite y muestra cuáles.

### Bloques y pools IPv6

- «Agregar bloque» (`ipv6.crear`): **Prefijo (CIDR)** tal como te lo dio el proveedor (por ejemplo `2001:db8:100::/40`), **Proveedor** y **Nombre**. Mientras escribes, ArgosIsp sugiere cómo repartirlo: cuántos clientes caben, los dos pools y lo que recibe cada cliente. «Crear también estos dos pools» deja el bloque listo en un paso.
- «Agregar pool» (`ipv6.crear`) y editar (`ipv6.editar`): **Tipo** (Enlace, que siempre entrega /64, o Delegación, /56 lo habitual en hogares y /48 para empresas), **Prefijo del pool** (con «Sugerir»), **Nombre** y **Nombre en el router** si el router reparte por su cuenta. Con prefijos en uso, el tipo y el tamaño no se cambian.

### Mover una red o un bloque a otro router

- **Permisos:** `redes.migrar` o `ipv6.migrar`, y `servicios.editar` para mover también los servicios.
- **Pasos:** elige el **Router de destino**; marca «Mover también los servicios que usan estas direcciones» si la red tiene servicios (es obligatorio: un servicio nunca queda en otro router que sus direcciones) y, si quieres, «Mover también bloques IPv6» o «redes IPv4» para que conserven todas sus direcciones. «Revisar» muestra cada servicio con sus direcciones antes y después; «Confirmar y mover» lo aplica.
- Los servicios que se mueven toman el tipo de conexión del router de destino; si es otro, se avisa.

Así se pasa un servicio de un router a otro.

## Servicios

«Ver servicios del router» abre la [lista de servicios](../clientes-y-servicios/servicios.md) filtrada por este router.

## Conexión (WireGuard)

ArgosIsp habla con el router por un túnel WireGuard: por dentro van RADIUS, los cambios de velocidad y corte, y la API del router.

**Estado del túnel:** «Sin configurar» (todavía no se generó el script), «Pendiente» (el script está generado, pero el servidor no ve al router en los últimos 3 minutos) o «Conectado». También se ven la IP del túnel, el último contacto y la versión de RouterOS.

### Conectar un MikroTik

1. Pulsa «Script de conexión» (`routers.generar_script`, roles `admin` y `tecnico`).
2. En **IPs de administración** escribe las IP fijas desde las que entras por Winbox o SSH (tu oficina), separadas por coma. Vacío: solo se entra por el túnel, y la sesión de Winbox abierta puede cortarse al final del script.
3. Marca «Incluir configuración de servicio» solo en un router nuevo que ArgosIsp configura completo (suma PPPoE, perfiles y corte).
4. Pulsa «Generar script». Descárgalo («Descargar .rsc») o cópialo («Copiar») en ese momento: al cerrar la ventana se borra.
5. Abre Winbox y entra al router como administrador.
6. En **New Terminal** pega el script, o sube el archivo en **Files** e impórtalo con `/import`.
7. Espera el mensaje «argosisp: listo». El router se registra solo con ArgosIsp.
8. En menos de un minuto la ficha muestra «Conectado».

::: warning El script lleva claves
Trae la clave de la API y, con RADIUS, el secreto RADIUS. ArgosIsp no lo guarda. No lo mandes por chat. Vale 24 horas y para un solo registro, y cada script nuevo invalida el anterior.
:::

Un router sin RADIUS recibe la variante del script sin RADIUS.

### Si el script terminó con «FALTA un paso»

El router no pudo registrarse solo (por ejemplo, sin salida a internet). Copia la clave pública que mostró el router, pulsa «Pegar clave pública» (`routers.conexion_clave`), pégala y «Guardar clave». En menos de un minuto debería verse «Conectado».

### Rotar la conexión

«Rotar conexión» (`routers.rotar_conexion`, solo `admin`) invalida el túnel actual y genera un script nuevo. Hasta que ejecutes el script nuevo, ArgosIsp no llega al router (ni RADIUS ni la API): los clientes que se conecten en ese rato no se autentican.

### Probar conexión

«Probar conexión» comprueba el túnel, la API del router, el equipo, RADIUS y el corte de suspendidos. Cada chequeo dice «Bien», «Falla» o «No se pudo comprobar», con el tiempo, los datos del equipo (versión, modelo, encendido, CPU) y, si falla, qué revisar. No cambia nada.

### Conexión de la API

En «Acciones → Conexión de la API» (`routers.editar` para guardar): **URL de la API** (vacía usa `https://` más el host), «Verificar el certificado TLS» (apágalo solo con un certificado autofirmado y sin CA cargada), **CA propia (PEM)**, **Servidor DHCP** (para los servicios con DHCP fija) e **Interfaz de clientes** (para el ARP del amarre IP-MAC). Se usan desde el próximo comando al router.

### Reconciliar ahora

«Reconciliar ahora» (`routers.reconciliar`) lee el router y muestra lo que crearía, cambiaría, movería o borraría para dejar colas, perfiles, árbol y reglas de corte como deben estar. Nada se escribe hasta confirmar.

Al confirmar, el trabajo se encola y el worker de Argos lo aplica por la API del router. Mientras el modal esté abierto, Argos pregunta cada 2 segundos en qué va y lo muestra:

| Estado | Qué ves | Qué hacer |
| --- | --- | --- |
| En cola | «En cola…» | Esperar. Si pasan más de 30 segundos, aparece el aviso «El worker no ha tomado el trabajo»: revisa que el servicio worker de Argos esté corriendo. |
| En curso | «Aplicando en el router…» | Esperar. |
| Terminó | «Listo: N cambios aplicados en el router», o «El router ya estaba como debe» si no hizo falta cambiar nada | Nada. La ficha se actualiza sola. |
| Terminó con errores | Aviso amarillo con cada operación que falló («operación — mensaje») | Lo demás sí se aplicó. Corrige la causa en el router y vuelve a reconciliar. |
| Falló | Aviso rojo con el motivo (por ejemplo, el router no respondió) y «Reintentar» | «Reintentar» vuelve a leer el router y muestra otra vez la vista previa. |
| Resultado desconocido | «No se pudo saber el resultado» | Revisa los eventos de red del router: ahí queda cada comando con la respuesta del equipo. |

Si ya había una reconciliación pedida, no se encola otra: el modal lo dice y muestra en qué va esa. Puedes cerrar el modal en cualquier momento: el trabajo sigue en el worker, solo deja de mostrarse su avance. El resultado de cada comando queda siempre en los eventos de red del router.

## Avanzado

### Prioridad por clases (QoS)

El perfil de QoS del router (sin elegir, el predeterminado), su costo en el router y, con `qos.gestionar`, el selector «Perfil de QoS». Solo se ofrecen perfiles comunes o de la empresa sugerida del router. Si ningún tipo de conexión tiene el extra de QoS prendido en el control de velocidad, el perfil no se usa. Ver [QoS](qos.md).

### Datos del equipo

Host, API, serial, servidor DHCP, interfaz de clientes y último contacto.

### Baja del router

- **Eliminar** (`routers.eliminar`, solo `admin`): solo si el router **nunca se usó**: sin servicios (ni siquiera retirados), sesiones, historial de asignaciones, comandos enviados que escribieron en él, bodegas, roles o tokens con alcance en él ni filas de una importación. La ficha dice «Nunca se usó: se puede borrar del todo», o los motivos por los que no.
- **Desactivar** y **Activar** (`routers.editar`): ArgosIsp deja de enviarle comandos. Su historial se conserva y pasa a «Inactivos» en la lista. Se vuelve a activar igual.

::: danger Eliminar no se puede deshacer
Se borran sus redes y pools (las direcciones quedan libres) y su conexión WireGuard. Los planes se conservan. Si el router tiene historia, desactívalo.
:::

## Unir routers duplicados

Si el mismo MikroTik quedó registrado dos veces (misma API o misma IP del NAS), la lista y la ficha muestran «… parecen el mismo MikroTik» con la clave que comparten.

- **Permiso:** `routers.unir` (solo `admin`).
- **Pasos:**
    1. Pulsa «Unir».
    2. Elige el **Router que queda**. Conviene conservar el registro cuya IP de NAS y secreto RADIUS usa el equipo.
    3. Elige el **Router que se absorbe**. Se unen de dos en dos; repite con el resto del grupo.
    4. Revisa la vista previa: cuántos servicios y sesiones pasan, redes, bloques y planes, y los bloqueos o avisos.
    5. Marca «Confirmo que es el mismo MikroTik…» y pulsa «Unir routers».
- **Qué pasa:** servicios, sesiones, redes, pools y planes pasan al que queda. Nadie se desconecta: los servicios conservan sus direcciones. El absorbido queda desactivado con su historial.

::: danger La unión no se deshace
Revisa bien cuál queda antes de confirmar.
:::

## Editar el router

«Editar» (`routers.editar`): nombre, host, IP del NAS, modo de seguridad, credenciales, zona, empresa sugerida, identificación del cliente cortado y si está activo. Las contraseñas y el secreto guardados no se muestran: déjalos vacíos para no cambiarlos, o marca «Borrar la clave guardada» o «Borrar el secreto guardado».

- Si el router está conectado por el túnel, un aviso te advierte antes de cambiar el host o la IP del NAS.
- Pasar de RADIUS a «Sin RADIUS» no se puede si tiene servicios PPPoE sin retirar que autentican por RADIUS: muévelos a un router sin RADIUS, pásalos a IP estática o DHCP fija, o retíralos. La lista sale en el aviso.
- Volver de «Sin RADIUS» a RADIUS borra del router los usuarios PPPoE que creó ArgosIsp.
- Al guardar, ArgosIsp reconcilia el router.

## Preguntas frecuentes y errores

**El túnel sigue en «Pendiente».** El router no se registró. Revisa que el script terminó con «argosisp: listo»; si dijo «FALTA un paso», pega la clave pública. Si sigue, usa «Probar conexión».

**«El router cambió mientras revisabas».** Otra persona cambió el router con la vista previa abierta. No se aplicó nada: pulsa «Recargar» y revisa otra vez.

**«Alguien más cambió este router».** Tus cambios de «Editar» no se guardaron. Pulsa «Recargar» y vuelve a aplicarlos.

**«Ese MikroTik ya está registrado».** El host o la IP del NAS ya es de otro router. Únelos en vez de duplicar.

**«Router no encontrado».** El número de router no existe.

## Relacionado

- [Routers](routers.md)
- [Planes](planes.md)
- [QoS](qos.md)
- [Migración al nuevo RADIUS](migracion.md)
