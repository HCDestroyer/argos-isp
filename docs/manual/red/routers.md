---
orden: 1
pantallas:
    - /routers
---

# Routers

La lista de los MikroTik donde se conectan tus clientes: si responden, cómo controlan la velocidad y qué capacidad tiene su enlace. Desde aquí registras un router nuevo y entras a su ficha.

## Quién la usa

- Ver la lista: `routers.ver` (`admin`, `soporte`, `tecnico`).
- Registrar un router: `routers.crear` (`admin`, `tecnico`).
- Cada acción del menú «Acciones» pide su propio permiso (abajo).

## Qué ves

Dos pestañas: **Activos** (por defecto) e **Inactivos** (routers desactivados o unidos a otro).

| Columna              | Qué muestra                                                                                                                                             |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Router               | Nombre (enlace a la ficha), «Inactivo», «Sin RADIUS» si el router funciona solo por su API y, si se unió a otro, a cuál.                                |
| NAS                  | La IP con la que el router habla con RADIUS.                                                                                                            |
| Contacto             | «En línea» (verde), «Fuera de línea» (rojo) o «Desconocido» (gris, todavía no hay medición), con el último contacto («hace 3 min» o «Nunca respondió»). |
| Control de velocidad | «Colas simples» o «Árbol con PCQ».                                                                                                                      |
| Capacidad            | El techo de bajada y subida del enlace, si se cargó.                                                                                                    |

Si dos registros parecen el mismo MikroTik, arriba aparece el aviso de duplicados con «Unir». Ver [Unir routers duplicados](ficha-del-router.md#unir-routers-duplicados).

El botón «Migración» abre la pantalla de [migración al nuevo RADIUS](migracion.md).

## Acciones

### Registrar un router

- **Permiso:** `routers.crear`
- **Dónde:** botón «Nuevo router».
- **Campos:**
    - **Modo de seguridad:** «RADIUS (recomendado)»: PPPoE autenticado por RADIUS, con corte y velocidad al instante; también admite IP estática y DHCP fija. «Sin RADIUS (todo por la API REST)»: ArgosIsp configura, limita y corta cada servicio por la API del MikroTik y los usuarios PPPoE quedan guardados en el router.
    - **Tipo de conexión:** PPPoE (por defecto), IP estática o DHCP con IP fija. Es uno por router: todos sus servicios lo usan.
    - **Nombre:** así aparece en el alta de servicios, la lista y los reportes.
    - **Host de la API:** IP o nombre con el que ArgosIsp llega al router.
    - **IP del NAS** y **Secreto RADIUS:** solo con RADIUS. La IP del NAS es con la que el router se presenta ante RADIUS.
    - **Usuario de la API** y **Contraseña de la API:** un usuario de RouterOS con lectura y escritura por la API REST. Sin RADIUS son necesarios para crear usuarios PPPoE.
    - **Colas:** Colas simples o Árbol con PCQ. Después del alta solo cambia desde el control de velocidad.
    - **Identificación del cliente cortado** (obligatorio): «Por código» (recomendado si el router tiene API: el router manda a cada suspendido a la página de corte con su propio código) o «Por IP» (la página de corte reconoce al cliente por la IP con la que llega; con un proxy o NAT en medio no lo reconoce). «Por código» solo se puede elegir si escribiste usuario y contraseña de la API.
    - **Activo.**
- **Qué pasa:** el router aparece en la lista con el aviso «… creado». Las contraseñas y el secreto se guardan cifrados y no se vuelven a mostrar. Después, en su ficha, agrega sus redes IPv4 y bloques IPv6 y conéctalo por WireGuard con el [script de conexión](ficha-del-router.md#conexion-wireguard).

### Menú «Acciones» de cada fila

| Opción                 | Permiso                                       | Qué hace                                                                                                                        |
| ---------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| «Editar»               | `routers.editar`                              | Nombre, host, IP del NAS, modo de seguridad, credenciales, zona, empresa sugerida, identificación del cortado y si está activo. |
| «Probar conexión»      | `routers.probar_conexion`                     | Comprueba el túnel, la API, el equipo, RADIUS y el corte. No cambia nada.                                                       |
| «Reconciliar ahora»    | `routers.reconciliar`                         | Muestra qué corregiría en el router y lo corrige al confirmar.                                                                  |
| «Conexión de la API»   | Ver: `routers.ver`; guardar: `routers.editar` | URL de la API, verificación TLS, CA propia, servidor DHCP e interfaz de clientes.                                               |
| «Control de velocidad» | Ver: `routers.ver`                            | Abre el control de velocidad en un panel lateral.                                                                               |
| «Script de conexión»   | `routers.generar_script`                      | Genera el script para conectar el MikroTik por WireGuard.                                                                       |

Todas se explican en la [ficha del router](ficha-del-router.md).

## Preguntas frecuentes y errores

**«Ese MikroTik ya está registrado».** Ya existe un router con la misma API o la misma IP del NAS. El aviso dice cuál es: úsalo en vez de crear otro. Si ya tienes dos registros del mismo equipo, únelos.

**«Por código» aparece deshabilitado.** Falta el usuario y la contraseña de la API: el modo código necesita escribir en el router la regla de cada suspendido.

**El router dice «Desconocido».** Todavía no hay medición de contacto. No significa que esté caído.

## Relacionado

- [Ficha del router](ficha-del-router.md)
- [Conceptos: routers y tipo de conexión](../../guia/conceptos.md#routers-y-tipo-de-conexion)
- [Planes](planes.md)
