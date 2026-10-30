# Contrato: prioridad por protocolo (QoS por clases) en el árbol

Pedido del PM (30 oct): «que dentro del plan de cada cliente el tráfico interactivo (DNS, VoIP, juegos) y la web vayan antes que las descargas pesadas», con **clases configurables** desde el panel. Se monta sobre el control de velocidad por capas (`contratos/control-velocidad.md`) y solo en la familia árbol (`arbol_pcq`). Dueño: A2. Pantalla: A4.

## 1. Modelo

### `network.qos_perfiles`

Un **perfil** es un juego de clases. Un router usa un perfil (todas las conexiones de un router se clasifican igual: la marca de conexión es del router, no del plan).

| Columna | Tipo | Notas |
| --- | --- | --- |
| `id` | bigint | |
| `empresa_id` | bigint NULL → `core.empresas` | null = común a todas (regla multiempresa: solo lo crea o cambia quien tiene alcance global) |
| `nombre` | text | único por empresa (y entre los comunes), sin distinguir mayúsculas |
| `descripcion` | text NULL | |
| `predeterminado` | boolean | uno solo en toda la instalación (común): el que usan los routers sin `qos_perfil_id`. Lo crea la migración (§5) |
| `version`, `created_at`, `updated_at` | | control optimista |

### `network.qos_clases`

| Columna | Tipo | Notas |
| --- | --- | --- |
| `id` | bigint | |
| `perfil_id` | bigint → `qos_perfiles` | |
| `nombre` | text | único en el perfil |
| `orden` | int ≥ 1 | orden de **clasificación**: la primera clase cuyas reglas coinciden se queda con la conexión. Ignorado en `resto` y en las clases de descarga (`bytes_minimo`) |
| `prioridad` | smallint 1–8 | `priority` de la hoja del árbol (1 = primero) |
| `garantizado_pct` | smallint 0–100 | `limit-at` de la hoja = % de la capacidad del nodo del plan. Σ de las clases activas ≤ 100 |
| `tope_pct` | smallint 1–100 NULL | null = sin tope. Con tope: la clase nunca pasa de ese % del plan, **por cliente** (`pcq-rate` = MIR × %) **y en total** (`max-limit` de la hoja) |
| `es_resto` | boolean | exactamente una por perfil: lo que no coincide con nada. No tiene reglas, no se desactiva |
| `reglas` | jsonb | lista de reglas de coincidencia (OR entre reglas, AND dentro de una regla); ver abajo. Hasta 10 |
| `bytes_minimo` | bigint NULL | clase de **descargas pesadas**: reclasifica conexiones que ya pasaron N bytes (`connection-bytes=N-0`) |
| `reclasifica_de` | bigint[] | solo con `bytes_minimo`: de qué clases toma las conexiones (p. ej. web y resto). Obligatorio con `bytes_minimo` |
| `activa` | boolean | desactivar no borra (la auditoría la referencia) |
| `version`, `created_at`, `updated_at` | | |

Una **regla** (`reglas[]`):

```json
{ "protocolo": "udp", "puertos_destino": "5060-5061,10000-20000", "puertos_origen": null, "dscp": null, "lista_destino": null }
```

| Campo | RouterOS | Validación |
| --- | --- | --- |
| `protocolo` | `protocol` (`icmp` → `icmpv6` en `/ipv6`) | `tcp`, `udp`, `icmp` o null (cualquiera) |
| `puertos_destino` / `puertos_origen` | `dst-port` / `src-port` | lista `n` o `n-m` separada por comas, 1–65535, máx. 15 elementos; **exigen `tcp` o `udp`** |
| `dscp` | `dscp` | 0–63 |
| `lista_destino` | `dst-address-list` (IPv4 e IPv6, mismo nombre) | nombre de address-list que el admin mantiene en el router (p. ej. CDNs de streaming); ArgosIsp no la llena |

Al menos un campo por regla. Las reglas se evalúan sobre el **primer paquete** de la conexión (la dirección en que se abrió: cliente → Internet), por eso «destino» es el servidor.

### Reglas de un perfil (422)

| `rule` | Qué |
| --- | --- |
| `qos_resto` | Exactamente una clase `es_resto` activa por perfil |
| `qos_max_clases` | Máximo 8 clases activas por perfil, contando `resto` (8 niveles de `priority`) |
| `qos_garantizado` | Σ `garantizado_pct` de las activas ≤ 100 |
| `qos_reglas` | Una clase normal necesita al menos una regla; `resto` ninguna |
| `qos_puertos` | Puertos sin `tcp`/`udp`, o mal escritos |
| `qos_reclasifica` | `bytes_minimo` sin `reclasifica_de`, o al revés; origen inexistente, inactivo, de otro perfil, ella misma u otra clase de descarga; **una clase origen solo puede estar en una clase de descarga** (si no, el resultado dependería del orden) |
| `qos_costo` | Activar la clase haría pasar a un router del límite de §3.4 |
| `qos_empresa` | El perfil es de otra empresa que el router (el router solo usa perfiles comunes o de su `empresa_sugerida_id`) |

Advertencias (no bloquean; salen en la vista del perfil): `tope_por_cliente` (Σ de lo que un cliente puede usar a la vez en todas las clases > 100 %: con varias clases en paralelo un cliente puede pasar la velocidad de su plan; ver §3.5) y `orden_repetido`.

## 2. Cómo se activa

- **Extra nuevo `qos`** en la capa `extras` de la estrategia (`contratos/control-velocidad.md` §1), por defecto `false`. Se elige en el router (por tipo de conexión) y se sobrescribe por plan en ese router con la excepción de siempre (`planes_routers.estrategia_velocidad`, campo por campo). No hace falta una capa nueva: es un interruptor por plan, igual que `rafaga` o `garantizado`.
- **Perfil del router:** `network.routers.qos_perfil_id` (null = el predeterminado). Se cambia con `POST /routers/:id/qos-perfil`.
- Matriz (`validarEstrategias`, `GET /red/control-velocidad/matriz`):

| # | Regla | `rule` | Mensaje (ejemplo) |
| --- | --- | --- | --- |
| 9 | `qos` solo con `arbol_pcq` | `qos_familia` | «qos necesita el árbol (arbol_pcq): en colas simples cada cliente tiene una sola cola y no hay hojas por clase» |
| 10 | `qos` exige `excluir_fasttrack` | `qos_fasttrack` | «con FastTrack las conexiones aceleradas no pasan por mangle: no se clasifican ni se priorizan» |
| 11 | Costo del router dentro del límite (§3.4) | `qos_costo` | «el router 3 pasaría de 1024 hojas de QoS (planes con qos × 2 estados × 2 sentidos × clases)» |

| Advertencia | Cuándo |
| --- | --- |
| `qos_sin_cuello` | `qos` con `padre = ninguno`: sin nodo del plan ni global que se llene, las clases nunca compiten |

- La regla 6 (plan consistente) ya cubre `qos`: en el árbol todos los tipos de un plan comparten la rama, así que `qos` es el mismo en PPPoE, IP estática y DHCP fija del plan.
- `matriz.extras[]` publica `{ valor: "qos", por_defecto: false }`.
- **Esquema:** la API siempre devuelve `extras.qos`, pero el esquema de respuesta `EstrategiaVelocidad.extras` todavía no lo declara: agregarlo (aun opcional) rompe los `Record<Extra, …>` del panel. Se agrega en la misma PR en que A4 lo use (fila en `a2.md`). En las peticiones (`cambiar-estrategia-velocidad`, `vista-previa-estrategia`, excepción del plan) y en la excepción parcial (`PlanRouter`) sí está, opcional.

## 3. Qué se escribe en RouterOS 7

Nombres: clase `<k>` = id de la clase; nodo del plan `argosisp-plan-<id>[-limitado]-<sentido>` (el de hoy).

### 3.1 Clasificación de conexiones (una vez por router, IPv4 e IPv6)

Cadenas de mangle encadenadas **por posición** (`orden` 1, 2, …, sin contar resto ni descargas):

| comment | chain | Condición | Acción |
| --- | --- | --- | --- |
| `argosisp:qos:entrada` | `prerouting` | `connection-state=new`, `connection-mark=no-mark` | `jump argosisp-qos-1` (o `argosisp-qos-resto` sin clases) |
| `argosisp:qos:clase:<k>:<n>` | `argosisp-qos-<pos>` | la regla `n` de la clase | `mark-connection argosisp-qos-<k>`, `passthrough=yes` |
| `argosisp:qos:salto:<pos>` | `argosisp-qos-<pos>` | `connection-mark=no-mark` | `jump argosisp-qos-<pos+1>` (la última, a `argosisp-qos-resto`) |
| `argosisp:qos:clase:<resto>` | `argosisp-qos-resto` | — | `mark-connection argosisp-qos-<resto>` |
| `argosisp:qos:pesadas` | `prerouting` | — | `jump argosisp-qos-pesadas` |
| `argosisp:qos:pesada:<k>:<origen>:<n>` | `argosisp-qos-pesadas` | `connection-mark=argosisp-qos-<origen>`, `connection-bytes=<bytes_minimo>-0`, la regla `n` de la clase `k` (o ninguna) | `mark-connection argosisp-qos-<k>` |

**Sin `move`:** el resultado no depende del orden de las reglas dentro de una cadena. En la cadena de la posición `p`, si la regla de la clase va antes que el salto, marca y el salto ya no entra; si el salto va antes, la clase de menor prioridad marca primero y al volver la clase `p` la sobrescribe. En los dos casos gana la clase de menor `orden` que coincide. En `pesadas` cada origen está en una sola clase de descarga (regla `qos_reclasifica`). Reordenar clases cambia la `chain` de sus reglas (PATCH), nunca crea un ciclo de saltos (la cadena `p` solo salta a `p+1`).

Solo se clasifican conexiones **nuevas y sin marca**: no se tocan las `connection-mark` que ponga el admin; las conexiones abiertas antes de activar QoS van a `resto` (§3.2).

### 3.2 Marca de paquete por plan (IPv4 e IPv6, por plan con `qos`, estado y sentido)

| comment | chain | Condición | Acción |
| --- | --- | --- | --- |
| `argosisp:plan:<id>[:limitado]:<sentido>:qos` | `forward` | `dst-address-list` (bajada) / `src-address-list` (subida) = lista del plan | `jump argosisp-qos-plan-<id>[-limitado]-<sentido>` |
| `argosisp:plan:<id>[:limitado]:<sentido>:qos:<resto>` | esa cadena | — | `mark-packet <nodo>-q<resto>`, `passthrough=yes` |
| `argosisp:plan:<id>[:limitado]:<sentido>:qos:<k>` | esa cadena | `connection-mark=argosisp-qos-<k>` | `mark-packet <nodo>-q<k>`, `passthrough=no` |

También sin `move`: la de resto marca y sigue (`passthrough=yes`); la de la clase sobrescribe y termina. Un paquete con una marca de conexión ajena cae en resto: **nunca queda sin marca** (sin marca no lo limitaría el árbol). El salto lleva un comment nuevo (`…:qos`): la regla `mark-packet` de hoy (`argosisp:plan:<id>…:<sentido>`) se borra en la limpieza, después de crear lo nuevo.

### 3.3 Árbol: plan → clase → PCQ

- El nodo del plan queda igual (padre, `max-limit`, `limit-at`, `priority`) pero pasa a ser **interno**: `packet-mark` vacío.
- Una hoja por clase activa, hija del nodo del plan: `name = <nodo>-q<k>`, `comment = argosisp:plan:<id>[:limitado]:<sentido>:qos:<k>`, `packet-mark = name`, `priority = prioridad`, `limit-at = garantizado_pct × max-limit del plan` (0 si el plan no tiene clientes en ese estado o el extra `garantizado` está apagado), `max-limit = tope_pct × max-limit del plan` (0 sin tope).
- `queue`: sin tope, el **mismo PCQ del plan** (`pcq-rate` = MIR; no se crea un tipo más); con tope, un PCQ propio `<nodo>-q<k>` con `pcq-rate` = MIR × tope y sin ráfaga.
- Orden de escritura: tipos → globales → nodos del plan → hojas → mangle de clasificación → cadenas del plan → saltos en `forward`. La limpieza borra hojas antes que nodos (el falso exige ese orden).

### 3.4 Costo y límite

Por router, con **P** planes con `qos` y **M** clases activas (con resto):

| Objeto | Cantidad |
| --- | --- |
| Hojas `/queue/tree` | `4 · P · M` (2 estados × 2 sentidos) |
| Mangle por familia (IPv4 e IPv6, cada uno) | clasificación `Σ reglas + (M − 1 − descargas) + 3 + Σ reglas_descarga × orígenes` + por plan `4 · (1 + M)` |
| `/queue/type` extra | `4 · P · (clases con tope)` |

Costo por paquete: en `forward`, igual que hoy (una regla por plan, ahora `jump`) **más M** como máximo dentro de la cadena del plan; en `prerouting`, la clasificación corre solo para el primer paquete de cada conexión (`connection-state=new`); `pesadas`, `Σ orígenes × reglas` por paquete. No es `P × M` por paquete.

**Límite: 1024 hojas por router** (`QOS_MAX_HOJAS`; con M = 5 son 51 planes con QoS). Se revisa al cambiar la estrategia (422 `qos_costo`), al crear o activar una clase y al asignar el perfil a un router; en el reconciliador, si aun así se pasa (planes nuevos), es una regla de oro (`qos_costo`): el árbol del router queda como está y sale `routeros.fallido`. **Cómo agrupar** cuando no alcanza: apagar `qos` por excepción en los planes dedicados o empresariales (con reuso 1 casi nunca hay cuello), y bajar a 4–5 clases. Agrupar planes de igual velocidad en una sola rama queda para después (§7).

### 3.5 Límites del diseño (el panel los muestra)

- **La prioridad actúa cuando hay cuello en el nodo del plan (reuso) o en el global (capacidad del enlace).** El PCQ reparte por cliente dentro de cada hoja y cada cola de cliente es FIFO: sin un HTB por cliente (N clientes × M clases colas) no se puede ordenar el tráfico de un cliente dentro de su propio MIR. En un ISP con sobreventa el cuello real es el del plan o el enlace, que es donde esto ayuda.
- **Por cliente**, cada clase tiene su propio PCQ con `pcq-rate` = MIR × tope: un cliente que usa varias clases a la vez puede pasar el MIR de su plan (hasta Σ topes). Con los topes sugeridos el exceso solo viene de interactivo (poco tráfico) y streaming. Si el admin necesita el tope estricto, pone topes que sumen ≤ 100 % (advertencia `tope_por_cliente`); el nodo del plan sigue limitando el total del plan.
- `connection-bytes` cuenta los dos sentidos. Una conexión que pasa a `descargas` no vuelve.
- La clasificación por puerto no ve dentro de TLS ni de QUIC: «web» y «streaming» se separan por `lista_destino` (address-list que mantiene el admin, p. ej. con `/ip firewall address-list add list=argosisp-qos-streaming address=<fqdn>`).
- **Verificar en el laboratorio** (A6): `packet-mark` vacío en un nodo interno del árbol, `connection-bytes` en `/ipv6/firewall/mangle` y que el salto de `forward` + `passthrough` se comporta como arriba en 7.24.

### 3.6 FastTrack, IPv6 y `limitado`

- FastTrack: `qos` exige `excluir_fasttrack` (regla 10); el reconciliador ya pone y verifica `argosisp:top sin fasttrack`.
- IPv6: todo lo de §3.1 y §3.2 se escribe también en `/ipv6/firewall/mangle` con los mismos comments; `icmp` → `icmpv6`. Las listas del plan ya tienen las direcciones IPv6 (prefijo delegado o los de la sesión).
- `limitado`: el nodo `-limitado` lleva las mismas clases (a velocidad reducida la prioridad importa más). Suspendido no pasa por el árbol.

### 3.7 PPPoE sin RADIUS (frente siguiente)

QoS solo depende de que la IP del cliente esté en `argosisp-plan-<id>[-limitado]`. Hoy la pone el dispatcher (WISP) o la sesión (PPPoE vía RADIUS → accounting → address-list). Con `/ppp secret` locales, la pondrá el `address-list=` del perfil PPP del plan: nada de este contrato cambia.

## 4. API

| Método y ruta | Permiso | Acción | Respuesta |
| --- | --- | --- | --- |
| `GET /qos/perfiles?cursor=&limit=` | `qos.ver` | — | `{ data: PerfilQos[], nextCursor }` (comunes y de la empresa activa) |
| `GET /qos/perfiles/:id` | `qos.ver` | — | `PerfilQos` con `clases[]`, `advertencias[]` y `routers[]` (`router_id`, `nombre`, `planes_qos`, `hojas`, `reglas_mangle`, `limite_hojas`) |
| `POST /qos/perfiles` | `qos.gestionar` | `CrearPerfilQos` | 201 `PerfilQos`. `{ nombre, descripcion?, empresa_id?, copiar_de? }`: copia las clases activas de `copiar_de` (por defecto, del predeterminado). 409 `qos_nombre_duplicado` |
| `POST /qos/perfiles/:id/clases` | `qos.gestionar` | `CrearClaseQos` | 201 `ClaseQos`. 409 `qos_nombre_duplicado` |
| `PUT /qos/clases/:id` | `qos.gestionar` | `EditarClaseQos` | `ClaseQos`; `version` obligatoria (409); lo ausente queda igual |
| `POST /qos/clases/:id/desactivar` | `qos.gestionar` | `DesactivarClaseQos` | `ClaseQos`; `{ version, motivo? }`. `resto` no se desactiva (422 `qos_resto`). Ya inactiva: 200 sin cambios |
| `POST /qos/clases/:id/activar` | `qos.gestionar` | `ActivarClaseQos` | `ClaseQos`; revisa §1 y el costo |
| `POST /routers/:id/qos-perfil` | `qos.gestionar` | `AsignarPerfilQos` | `Router` (con `qos_perfil_id`); `{ version, qos_perfil_id: id \| null, motivo? }` |

- Permisos nuevos en `apps/api/app/core/permisos.ts`: **`qos.ver`** (admin, técnico y lectura) y **`qos.gestionar`** (admin y técnico). Todas las acciones de escritura se llaman `qos.gestionar` en `audit.acciones` (permiso = nombre de la acción, como las dos de `routers.cambiar_control_velocidad`); la entidad (`qos_perfil`, `qos_clase`, `router`) dice qué se cambió.
- Cada acción audita con diff en `audit.cambios` (`qos_perfil`, `qos_clase`, `router`) y, si cambia algo que llega al router (clases, perfil de un router), emite **`qos.config_cambiada`** por outbox. Crear un perfil no emite (ningún router lo usa todavía). Sin cambios: 200 sin evento.
- `extras.qos` en `POST /routers/:id/cambiar-estrategia-velocidad` y en la vista previa es **opcional**: si no viene, se conserva el valor actual del router (un cliente que todavía no conoce `qos` no lo apaga al cambiar otra capa).
- Perfiles comunes (`empresa_id` null) y el predeterminado: solo con alcance global (403 `empresa_no_permitida`).
- La vista previa del cambio de estrategia (`POST /routers/:id/vista-previa-estrategia`) ya incluye lo de QoS (crear/actualizar/borrar en `/ip/firewall/mangle`, `/ipv6/firewall/mangle`, `/queue/tree`, `/queue/type`) cuando la propuesta prende o apaga `qos`, y la matriz da el 422 `qos_*`.

### Evento `qos.config_cambiada`

| Campo | |
| --- | --- |
| `perfil_id` | perfil afectado |
| `empresa_id` | del perfil (null = común) |
| `clase_id` | o null (perfil de un router) |
| `router_id` | solo en `qos.asignar_perfil`; si no, null |
| `campos[]` | lo que cambió (`nombre`, `orden`, `prioridad`, `garantizado_pct`, `tope_pct`, `reglas`, `bytes_minimo`, `reclasifica_de`, `activa`, `qos_perfil_id`) |
| `routers[]` | routers activos que usan el perfil y tienen algún plan con `qos` (los que hay que reconciliar) |

Consumidor `routeros`: reconcilia cada router de `routers[]` (`routeros.reconciliar`, motivo `qos`). Con eso alcanza: no hace falta CoA (nada de esto pasa por RADIUS). Un evento repetido reconcilia otra vez (idempotente).

## 5. Semillas (migración, perfil común «Predeterminado»)

| orden | Clase | prioridad | garantizado | tope | Reglas |
| --- | --- | --- | --- | --- | --- |
| 1 | Interactivo | 1 | 10 % | 30 % | DNS (`udp 53`, `tcp 53`), NTP (`udp 123`), VoIP SIP/RTP (`udp 5060-5061,10000-20000`), juegos (`udp 3074,3478-3480,27000-27050`), `icmp`, `dscp 46` (EF) |
| 2 | Streaming | 4 | 20 % | — | `tcp 443` y `udp 443` hacia `lista_destino = argosisp-qos-streaming` (vacía hasta que el admin la llene) |
| 3 | Web | 3 | 30 % | — | `tcp 80,443`, `udp 443` (QUIC) |
| — | Descargas | 7 | 0 % | — | `bytes_minimo = 10 000 000` desde Web y Resto (cualquier protocolo) |
| — | Resto | 6 | 10 % | — | (todo lo demás) |

Σ garantizado = 70 %. El admin las edita o crea su propio perfil copiando este.

## 6. Verificación (`audit.red`)

Después de escribir, el reconciliador vuelve a leer mangle y árbol y compara los objetos de QoS con lo deseado. Fila en `audit.red` con `comando.operacion = "verificar_qos"`, `ok` y en la respuesta `faltan[]` / `distintos[]`: cuando esa pasada tocó algo de QoS o cuando la verificación falla (en ese caso además `routeros.fallido`, `operacion: "verificar qos"`). Una pasada sin cambios y correcta no deja fila (misma regla que `routeros.reconciliar`).

## 7. Fuera de este contrato

- HTB por cliente (prioridad dentro del MIR de cada cliente) y «doble HTB» (global + interfaz) para el tope estricto por cliente.
- Agrupar planes de igual velocidad en una rama compartida para bajar el costo.
- QoS en la familia de colas simples (`queue=` por clase en la cola de un cliente) y en PPPoE con `radius_rate_limit`.
- Llenar las address-lists de destino desde ArgosIsp (FQDN de CDNs por clase).
