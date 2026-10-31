# Contrato: inventario interno

Decisión del PM, 24 de octubre: alcance completo. ArgosIsp lleva el inventario del ISP. Cubre productos y bodegas, existencias con kardex a costo promedio, compras que entran a inventario, ventas y consumos con su costo, equipos por número de serie o MAC prestados en comodato al servicio y devueltos al retiro, traslados, conteos físicos y bajas. Todo con su asiento contable.

- Dueños:
    - A3: módulo nuevo `apps/api/app/inventario`, schema `inventario`, con sus asientos en `ledger` y sus ganchos en compras (`ledger`) y en cargos únicos y facturas (`billing`).
    - A4: pantallas del panel.
    - Auditor: revisa lo contable antes de fusionar y agrega los checks del libro.
- A1 no cambia nada: el inventario consume `servicio.estado_cambiado` y lee el servicio por `#core`.
- Depende de `contratos/localizacion-fiscal.md`: compras (§3.4), activos (§19), cargos únicos (§15 #92–#94), bloqueos de periodo (§10.4) y el plan de cuentas.
- Cambia en la misma PR que el código que lo cumple.

## 1. Objetivos

1. Saber en todo momento qué hay, dónde está y cuánto vale: por bodega, por técnico y por cliente.
2. Que el saldo contable de inventarios cuadre siempre con el kardex valorizado. Un check del libro lo verifica.
3. Que cada equipo en casa de un cliente esté identificado por serie o MAC, ligado a su servicio. Al retirar el servicio, el equipo aparece como «por recuperar».
4. Que comprar, vender, consumir, prestar, devolver, ajustar o dar de baja deje su movimiento de kardex, su asiento y su auditoría en la misma transacción.
5. Todo por empresa. Con el inventario sin usar (sin productos), compras y facturas se comportan igual que hoy: ninguna prueba ni pantalla existente cambia.

## 2. Decisiones de diseño

| Tema | Decisión | Por qué |
| --- | --- | --- |
| Kardex | `inventario.movimientos` es solo inserción, como el libro. Una corrección es un movimiento de reverso | Regla 4 |
| Existencias | Suma del kardex. `inventario.saldos` (producto × bodega: cantidad y valor) es una proyección que se actualiza en la misma transacción y que un check compara con el kardex | Leer existencias sin sumar todo el kardex; la verdad sigue en el kardex |
| Costo | **Promedio ponderado móvil por producto y bodega** para lo que se lleva por cantidad (cada bodega lleva su cantidad y su valor; el traslado lleva el promedio de origen al destino). **Costo específico de la unidad** para lo que se lleva por serie | LISR art. 35 admite ambos (§15 #95, confirmar con contador). Por bodega para que el valor de cada bodega sea la suma de su kardex (§8.2) sin quedar negativo (decisión del líder, fase A) |
| Seguimiento | Cada producto es `cantidad` (cable, conectores, grapas) o `serie` (router, ONU, antena). Lo de serie tiene una fila por unidad en `inventario.unidades` con serie, MAC y estado | Lo de serie se presta y se recupera de uno en uno |
| Comodato | Prestar un equipo lo pasa de inventario a activo fijo de la clase del producto (por defecto `equipo_red`), con depreciación desde el mes siguiente. Devolverlo da de baja el activo y lo reingresa como usado a su valor en libros | §15 #54 (el CPE en comodato es activo). La devolución no crea ganancia ni pérdida |
| Venta | Un cargo único o una línea de factura con `producto_id` saca la unidad o la cantidad y asienta el costo de ventas en la misma transacción de la factura | El costo nace con la venta |
| Bodegas | Una bodega es un lugar (`bodega`) o un técnico (`tecnico`, con `usuario_id`). Alcance ACL opcional por bodega | El técnico lleva equipo en su vehículo y responde por él |
| Multiempresa | Productos, bodegas, kardex y unidades llevan `empresa_id`. Un traslado entre empresas no existe: es una venta de una y una compra de la otra | Regla 13 |
| Periodos | Todo movimiento con asiento respeta el bloqueo de compras (entradas), de ventas (ventas) o el global (lo demás), como hoy | §10.4 |
| Dinero | Costos en `numeric(14,2)`; cantidades en `numeric(14,3)`; costo promedio unitario en `numeric(18,6)` para no perder centavos al repartir; `decimal.js` | Regla 4 |

## 3. Plan de cuentas

Lo agrega el paquete de localización (`gt-2026.4`; el contrato decía `gt-2026.1`, con su migración de datos para empresas instaladas) y el plan base:

| Código | Nombre | Tipo | Uso |
| --- | --- | --- | --- |
| `1.1.14` | Inventarios | activo | Valor del kardex de la empresa |
| `5.6` | Costo de ventas | grupo de gasto | |
| `5.6.01` | Costo de equipo y materiales vendidos | gasto | Venta |
| `5.6.02` | Mermas y faltantes de inventario | gasto | Conteo con faltante, baja por daño o pérdida |
| `5.2.07` | Materiales de instalación y mantenimiento | gasto | Consumo interno |
| `4.2.04` | Sobrantes de inventario | ingreso no operativo | Conteo con sobrante |

Las cuentas de cada movimiento salen de estos códigos. Cada producto puede cambiar su cuenta de costo o de consumo (`cuenta_costo`, `cuenta_consumo`); la de inventario no se cambia por producto (una sola `1.1.14`, para que el check cuadre).

Con esto el ISO y el comparador de regímenes dejan de tomar margen bruto 100 %: el costo de ventas sale de `5.6.01` (§15 #79; las mermas `5.6.02` son gasto, #103). A3 lo ajusta en la misma PR.

## 4. Modelo de datos (schema `inventario`)

Todo con `empresa_id`, `created_at`, y `version` en lo editable.

- **`productos`**:
    - Identidad: `sku` (único por empresa), `nombre`, `unidad` (`unidad`, `metro`, `caja`…).
    - `tipo`: `equipo`, `material` u `otro`.
    - `seguimiento`: `cantidad` o `serie`. No cambia si el producto ya tiene movimientos.
    - `precio_venta` (pedido de A4): numeric(14,2), opcional (null = sin precio), precio de venta sugerido para el cargo único con IVA incluido, como el de los planes y los cargos. Se edita con `productos.editar` (`version`, `audit.cambios`); `null` lo quita; negativo o con más de 2 decimales, 422 en `precio_venta`. El cargo único lo propone y se puede cambiar.
    - `clase_activo`: clase de activo al prestarlo en comodato; por defecto `equipo_red`, solo para seguimiento `serie`.
    - `concepto_cargo_id`: concepto de cargo único con que se vende; opcional.
    - Cuentas y límites: `cuenta_costo`, `cuenta_consumo`, `existencia_minima` (opcional).
    - `activo`. Se desactiva; no se borra.
- **`bodegas`**: `nombre`, `tipo` (`bodega` | `tecnico`), `usuario_id` (solo `tecnico`), `zona` o `router_id` opcionales para el alcance, `activo`.
- **`unidades`** (solo seguimiento `serie`):
    - Identidad: `producto_id`, `serie` y `mac`, cada una única por empresa cuando no es nula. Al menos una de las dos.
    - `estado`: `disponible`, `en_comodato`, `por_recuperar`, `en_reparacion`, `vendida` o `dada_de_baja`.
    - `condicion`: `nuevo` | `usado`.
    - Ubicación y costo: `bodega_id` (nula fuera de bodega), `costo` (`numeric(14,2)`), `servicio_id`, `activo_id` (mientras está en comodato).
    - Es la única tabla del módulo que se actualiza. Cada cambio de estado pasa por una acción y deja su movimiento.
- **`movimientos`** (solo inserción):
    - Origen: `tipo` (§5), `fecha` (de documento), `producto_id`, `bodega_id`.
    - Cantidad y costo: `cantidad` (con signo: + entra, − sale), `costo_unitario`, `costo_total` (con signo).
    - Referencias: `unidad_id`, `servicio_id`, `asiento_id`, y `origen_tipo` + `origen_id` (compra, factura, conteo, traslado…).
    - `reverso_de` (cuando corrige otro movimiento), `motivo`, `actor`.
    - Un traslado son dos movimientos con el mismo `traslado_id`.
- **`saldos`**: proyección de `movimientos` (§2), con `producto_id`, `bodega_id`, `cantidad`, `valor` y `costo_promedio` por producto. Restricción: `cantidad >= 0` (no hay existencias negativas: 409 `existencia_insuficiente`).
- **`conteos`** y **`conteo_lineas`**:
    - Conteo: `bodega_id`, `estado` (`abierto` → `cerrado` | `cancelado`), `fecha_corte`.
    - Línea: `producto_id`, `esperado`, `contado`, y las series contadas para seguimiento `serie`.

## 5. Movimientos y asientos

| Tipo | Acción (permiso) | Kardex | Asiento |
| --- | --- | --- | --- |
| `entrada_compra` | `compras.registrar` (ya existe): línea `bien` con `producto_id`, `bodega_id`, `cantidad` y, si es de serie, `unidades[]` (serie/mac) | + cantidad al costo de la línea (base, + IVA si no hay crédito fiscal) | La línea va a `1.1.14` en lugar de gasto. Lo demás del asiento de compra, igual |
| `reverso_compra` | `compras.anular` | − lo que entró | Reverso de la compra (igual que hoy). 409 `unidades_en_uso` si alguna unidad ya no está `disponible` en su bodega, o 409 `existencia_insuficiente` |
| `venta` | `cargos_unicos.crear` y facturas con línea de `producto_id` (y `unidad_id` si es de serie) | − cantidad al costo promedio (o al costo de la unidad) | `5.6.01 / 1.1.14` por el costo, en la transacción de la factura. El ingreso y el IVA, como hoy |
| `reverso_venta` | `facturas.anular` y NCRE total de esa línea | + lo que salió, al mismo costo | Reverso del costo |
| `consumo` | `inventario.consumir` (materiales en una instalación o reparación; `servicio_id` opcional) | − al costo promedio | `cuenta_consumo` (`5.2.07`) / `1.1.14` |
| `traslado` | `inventario.trasladar` (bodega → bodega o técnico; unidades o cantidad) | − en origen, + en destino, mismo costo | Sin asiento (misma cuenta) |
| `asignacion_comodato` | `inventario.asignar_comodato` (unidad disponible → servicio vigente del mismo `empresa_id`) | − la unidad de su bodega | `1.2.01.<clase> / 1.1.14` por el costo; da de alta el activo (`registrar_activo` con origen `inventario`, fecha de alta = la del movimiento) |
| `devolucion_comodato` | `inventario.devolver_comodato` (servicio → bodega; `condicion`; `en_reparacion` opcional) | + la unidad a su valor en libros (costo − depreciación acumulada) | Baja del activo sin resultado: `1.1.14` (valor en libros) + `1.2.02` (depreciación acumulada) / `1.2.01.<clase>` (costo) |
| `perdida_comodato` | `inventario.declarar_perdida_comodato` (el cliente no devuelve) | Ninguno (la unidad ya no está en inventario) | Baja del activo a pérdida (`5.3.06 Pérdida en baja de activos`, igual que `activos.dar_de_baja`). Cobrarlo al cliente es aparte: un cargo único con concepto «equipo no devuelto» |
| `ajuste_conteo` | `inventario.cerrar_conteo` | ± la diferencia al costo promedio (o al de la unidad) | Faltante `5.6.02 / 1.1.14`; sobrante `1.1.14 / 4.2.04` (al último costo promedio) |
| `ajuste` | `inventario.ajustar` (manual, con motivo obligatorio) | ± | Igual que el conteo |
| `baja` | `inventario.dar_de_baja` (dañado, robado, obsoleto) | − | `5.6.02 / 1.1.14` |
| `saldo_inicial` | `inventario.cargar_saldo_inicial` (al empezar, una vez por producto y bodega, o desde el importador) | + | `1.1.14 / 2.9.01 Saldos de apertura` |
| `premio` | `sorteos.entregar` con `contrapartida: inventario` (decisión del líder, fase C): la única forma de que un premio en especie salga del inventario | − al costo promedio (o al costo de la unidad, que queda `entregada`) | `5.1.03 Premios y promociones / 1.1.14` por el costo |
| `reverso_premio` | `sorteos.anular_entrega` | + lo que salió, al mismo costo y bodega | `1.1.14 / 5.1.03` |

Reglas:

- **Costo promedio.**
    - En cada entrada: `nuevo_promedio = (valor_actual + costo_entrada) / (cantidad_actual + cantidad_entrada)`.
    - Las salidas valen `cantidad × promedio`, redondeado a centavos. El residuo de redondeo se queda en el valor del saldo.
    - Cuando la existencia llega a 0, el valor también debe quedar en 0: la última salida lleva el valor que queda.
- **Reversos.** Un reverso usa el mismo costo del movimiento que corrige, no el promedio del día. Nunca se edita un movimiento.
- **Series.** Una serie o MAC repetida en la empresa responde 422 `serie_duplicada`.
- **Límites de una unidad.**
    - Una unidad `en_comodato` no se vende, no se traslada y no se da de baja sin antes devolverla o declararla perdida (409 `unidad_en_comodato`).
    - Un servicio `retirado` no recibe comodatos (409 `servicio_retirado`).
    - `POST /servicios/:id/equipos` acepta `{ unidad_id }` o `{ serie }` (exactamente uno; 422 `unidad_o_serie`). La serie se busca sin distinguir mayúsculas entre las unidades vivas de la empresa del servicio (404 si no existe o es de otra empresa). Un servicio `pendiente_instalacion` sí recibe comodatos (contrato Iris §3).
- **Consumidor del evento de estado.** El inventario consume `servicio.estado_cambiado`. Con `a = retirado`, cada unidad `en_comodato` de ese servicio pasa a `por_recuperar`, sin asiento. Se emite `inventario.equipo_por_recuperar`. Es idempotente por `servicio_id`.
    - Si el servicio vuelve a otro estado, sus unidades `por_recuperar` vuelven a `en_comodato`.
- **Tope por técnico.** Una bodega `tecnico` solo la ve y la mueve su `usuario_id` o quien tenga el permiso con alcance global.

## 6. API (bajo `/api/v1`, por empresa activa)

Acciones explícitas, una por permiso. Listas con cursor; errores RFC 9457; `Idempotency-Key` en todo lo que mueve inventario o dinero; `version` en las ediciones.

- **Productos:**
    - `GET /productos`, `GET /productos/:id`.
    - `POST /productos` (`productos.crear`), `POST /productos/:id/editar` (`productos.editar`).
    - `POST /productos/:id/desactivar` (`productos.desactivar`).
- **Bodegas:**
    - `GET /bodegas`.
    - `POST /bodegas` (`bodegas.crear`), `POST /bodegas/:id/editar` (`bodegas.editar`), `POST /bodegas/:id/desactivar` (`bodegas.desactivar`).
- **Existencias y kardex:**
    - `GET /inventario/existencias?bodega_id=&producto_id=&bajo_minimo=`: cantidad y valor por producto × bodega.
    - `GET /inventario/movimientos?producto_id=&bodega_id=&desde=&hasta=&tipo=&origen_externo_id=`: el kardex, con saldo corrido por producto (`origen_externo_id`: los movimientos de una orden de Iris, ver «Origen Iris»).
- **Unidades:**
    - `GET /inventario/unidades?estado=&producto_id=&bodega_id=&servicio_id=&q=` (`q` busca por serie o MAC).
    - `GET /inventario/unidades/:id`: historial de la unidad.
- **Operaciones:**
    - `POST /inventario/consumos` (`inventario.consumir`).
    - `POST /inventario/traslados` (`inventario.trasladar`).
    - `POST /inventario/ajustes` (`inventario.ajustar`).
    - `POST /inventario/bajas` (`inventario.dar_de_baja`).
    - `POST /inventario/saldos-iniciales` (`inventario.cargar_saldo_inicial`).
    - `POST /inventario/unidades/:id/marcar-reparada` (`inventario.marcar_reparada`, fase C).
- **Comodato:**
    - `POST /servicios/:id/equipos` (`inventario.asignar_comodato`).
    - `POST /servicios/:id/equipos/:unidad_id/devolver` (`inventario.devolver_comodato`).
    - `POST /servicios/:id/equipos/:unidad_id/perdida` (`inventario.declarar_perdida_comodato`).
    - `GET /servicios/:id/equipos` (también en la ficha del cliente).
- **Conteos:**
    - `GET /inventario/conteos`, `GET /inventario/conteos/:id` (líneas con la diferencia valorizada).
    - `POST /inventario/conteos` (`inventario.abrir_conteo`), `POST /inventario/conteos/:id/lineas` (`inventario.contar`).
    - `POST /inventario/conteos/:id/cerrar` (`inventario.cerrar_conteo`), `POST /inventario/conteos/:id/cancelar` (`inventario.cancelar_conteo`).
- **Reportes:**
    - `GET /reportes/inventario-valorizado?fecha=`: existencias y valor a una fecha, reconstruidos del kardex.
    - `GET /reportes/equipos-por-recuperar`.
- Lecturas con el permiso `inventario.ver`.

Roles base:
- `admin`: todo.
- `contabilidad`: ver, ajustar, conteos, saldo inicial, productos, bodegas y bajas.
- `tecnico`: ver, consumir, trasladar desde su bodega, asignar y devolver comodato.
- `soporte`: ver.
- `cajero`: ver (vende por cargos únicos, como hoy).
- `lectura`: ver.

Compras y cargos únicos: sus validadores aceptan los campos nuevos (`producto_id`, `bodega_id`, `cantidad`, `unidades[]`, `unidad_id`). Sin esos campos, todo funciona exactamente igual que hoy.

## 7. Eventos (outbox, misma transacción)

| Evento | Payload |
| --- | --- |
| `inventario.movimiento_registrado` | movimiento_id, empresa_id, tipo, producto_id, bodega_id, cantidad, costo_total, unidad_id (o null), servicio_id (o null), origen_tipo, origen_id, origen_externo_tipo, origen_externo_id (o null; orden de Iris) |
| `inventario.comodato_asignado` / `inventario.comodato_devuelto` | unidad_id, empresa_id, servicio_id, cliente_id, producto_id, serie, mac, origen_externo_tipo, origen_externo_id (o null); devuelto: condicion, bodega_id |
| `inventario.equipo_por_recuperar` | unidad_id, empresa_id, servicio_id, cliente_id, producto_id, serie, mac |
| `inventario.existencia_minima` | empresa_id, producto_id, bodega_id (o null = total), cantidad, minimo. Se emite al cruzar el mínimo hacia abajo, no en cada salida |
| `inventario.conteo_cerrado` | conteo_id, empresa_id, bodega_id, faltante, sobrante, lineas |

Consumidores:
- Notify (A6, posterior y opcional): `inventario.existencia_minima` y `inventario.equipo_por_recuperar` como aviso interno.
- Portal (posterior): mostrar al cliente sus equipos.

## 8. Checks del libro (auditor)

El auditor los agrega en `verificar_libro.ts` y en `apps/api/tests/contabilidad/`:

1. Saldo de `1.1.14` a cualquier fecha = suma de `costo_total` del kardex hasta esa fecha, por empresa.
2. `inventario.saldos` = suma del kardex por producto y bodega (cantidad y valor).
3. Cada unidad `en_comodato` o `por_recuperar` tiene un activo vigente, con costo igual al de la unidad; cada activo de origen `inventario` vigente tiene su unidad en uno de esos dos estados.
4. Ninguna existencia negativa en ninguna fecha del kardex.
5. Todo movimiento con efecto contable tiene `asiento_id`, y su asiento mueve `1.1.14` exactamente por `costo_total`.

## 9. Pantallas (A4)

- Menú «Inventario», con permiso `inventario.ver`:
    - Productos.
    - Bodegas.
    - Existencias, con filtro «bajo mínimo».
    - Kardex por producto.
    - Unidades: búsqueda por serie o MAC e historial.
    - Conteos: abrir, capturar y cerrar, con la diferencia valorizada antes de confirmar.
    - Equipos por recuperar.
- Ficha del servicio: pestaña «Equipos», con asignar (buscador de unidades disponibles por serie o MAC), devolver y declarar pérdida.
- Compras: en la línea `bien`, selector de producto y bodega; con seguimiento por serie, captura de series y MAC (pegar una lista o escanear).
- Cargo único: elegir un producto (y la unidad si es de serie) llena el concepto y el precio sugerido.
- Reportes: inventario valorizado a una fecha.
- Reglas de siempre: Nuxt UI, 390 y 1280 px, claro y oscuro, permisos con su nombre exacto, errores visibles con «Reintentar».

## 10. Pruebas mínimas (Japa, contra Postgres)

1. Compra de 10 cables a Q5 y 10 a Q7: promedio Q6; consumo de 5 = Q30 a `5.2.07`; el saldo de `1.1.14` cuadra con el kardex.
2. Compra de 3 ONU con serie, asignación en comodato: activo en `1.2.01` por su costo, unidad `en_comodato`, depreciación el mes siguiente. Devolución: activo dado de baja, unidad `disponible` y `usado` a su valor en libros, sin resultado.
3. Retiro del servicio: sus unidades pasan a `por_recuperar` (evento procesado dos veces, mismo resultado).
4. Venta por cargo único de un router de serie: costo de ventas por su costo específico; anular la factura lo reingresa al mismo costo.
5. Conteo con faltante y sobrante: asientos `5.6.02` y `4.2.04`; un conteo cerrado no se vuelve a cerrar.
6. Anular una compra cuyas unidades ya se asignaron: 409 `unidades_en_uso`.
7. Salida mayor que la existencia: 409 `existencia_insuficiente`, sin asiento ni movimiento.
8. Serie repetida: 422 `serie_duplicada`. Traslado entre empresas: imposible (bodega de otra empresa = 404).
9. Movimiento en un mes bloqueado: el bloqueo de siempre (409 del bloqueo).
10. Empresa sin productos: las pruebas de compras, facturas y cargos únicos existentes pasan sin cambios.

## 11. Fases

| Fase | Contenido | Dueño |
| --- | --- | --- |
| A | Modelo, cuentas, productos, bodegas, saldo inicial, compras que entran a inventario, consumo, traslado, ajustes, bajas, kardex y existencias | A3 |
| B | Unidades por serie, comodato (asignar, devolver, perder), consumidor de `servicio.estado_cambiado`, equipos por recuperar | A3 |
| C | Venta por cargo único y factura con costo de ventas; conteos; reporte valorizado; costo de ventas en ISO y comparador | A3 |
| Pantallas | Las de §9, sobre los contratos de A, B y C | A4 |
| Auditoría | Checks de §8 y revisión contable de cada fase antes de fusionar | Auditor |

Cada fase es una PR con CI en verde. Lo contable se fusiona solo con la aprobación del auditor.

## 12. Confirmar con contador

Se agregan a la tabla de `localizacion-fiscal.md` §15 y al documento para el contador:

- **#95. Método de valuación.** Promedio ponderado para lo que se lleva por cantidad y costo específico para lo que se lleva por serie. ¿Se aceptan los dos a la vez (LISR art. 35)? ¿El cambio de método requiere autorización?
- **#96. Equipo en comodato.** ¿Activo fijo con depreciación (como hoy, #54) o inventario sin depreciar? ¿El equipo devuelto reingresa a su valor en libros?
- **#97. Materiales de instalación.** ¿Son gasto del periodo (`5.2.07`) o se capitalizan como parte del activo de red?
- **#98. Libro de inventarios.** ¿Basta con el reporte valorizado al cierre para el libro de inventarios (Código de Comercio, art. 368), o se exige otro formato?
- **#99. Faltantes de inventario.** ¿Son deducibles sin acta o denuncia? ¿Qué documentación se exige?

## Desvíos de la fase A

Rama `a3/inventario-a` (A3). Lo que el contrato no decía o no cuadraba con el código, resuelto con lo más simple que respeta sus reglas. Los marcados **(pregunta)** esperan decisión del líder.

1. **Costo promedio por producto y bodega** (aceptado por el líder; ya está en §2), no por producto y empresa. Con un promedio único por producto, el valor de cada bodega no puede ser a la vez la suma de su kardex (§8.2) y salir al promedio: comprar a otro precio en la central y consumir en la bodega de un técnico deja al técnico con valor negativo. Cada bodega lleva su `cantidad` y su `valor`; una salida vale `cantidad × valor / existencia` y la que vacía la bodega lleva todo su valor; el traslado lleva el promedio de origen al destino. El total de la empresa sigue cuadrando con `1.1.14`. El cálculo vive en `costoSalida` (`#inventario/kardex`).
2. **Cuentas en `gt-2026.4`** (sobre la `gt-2026.3` del tope de egresos del cajero), no en `gt-2026.1`: una versión publicada no cambia (su checksum), como `gt-2026.2` para `4.2.03`. `PLAN_CUENTAS` tampoco cambia (forma parte del checksum de 2026.1 y 2026.2); los códigos van en `CUENTAS_GT` (`INVENTARIOS`, `MATERIALES_INSTALACION`, `SOBRANTES_INVENTARIO`, `COSTO_VENTAS`, `COSTO_EQUIPO_VENDIDO`, `MERMAS_INVENTARIO`). La migración instala 2026.4 en cada empresa ya instalada; las nuevas la reciben al crearse. `1.1.14` lleva `libro_inventario`.
3. **Cantidad de una compra**: es el campo `cantidad` que ya existe en la línea (entero ≥ 1, el de los premios de sorteo). Las cantidades con decimales entran por saldo inicial o ajuste y salen por consumo, traslado, ajuste y baja.
4. **Fechas**: consumo, traslado, ajuste y baja llevan la fecha de hoy (sin fecha en la entrada). Así ninguna salida queda antes de su entrada y no hay existencia negativa en ninguna fecha (§8.4). El saldo inicial acepta una fecha pasada; las compras usan su fecha contable y el reverso la del asiento de reverso.
5. **Bloqueo**: el error de siempre de `RegistrarAsiento` (422 `periodo_cerrado` o `periodo_bloqueado`, 409 `bloqueo_duro`), no un 409 genérico. Los movimientos propios son del bloqueo global (origen `inventario`, diario `VAR`); los de compras, del bloqueo de compras por su asiento. El traslado no tiene asiento y no mira el bloqueo.
6. **Anular una compra cuyo costo ya salió al promedio** (decisión del líder: se queda el 409; el camino correcto es la devolución al proveedor con NCRE, fase B): el reverso saca lo que entró al mismo costo (su asiento es el espejo del de la compra). Si eso dejara la bodega con valor negativo, o sin existencia y con valor, responde 409 `valor_insuficiente` y no anula. Alternativa posible: un ajuste automático del residuo (5.6.02 o 4.2.04).
7. **Tope por técnico**: una bodega `tecnico` la mueve su `usuario_id` o quien tenga el permiso sin alcance de rol ni restricciones de token. Como el rol `tecnico` se asigna sin alcance por defecto, para que un técnico solo opere su bodega se le asigna el rol con alcance (zona o router). El destino de un traslado solo revisa el alcance (se le puede entregar al técnico). Una bodega con `zona_id` o `router_id` se filtra por el alcance de rol y de token; una sin ninguno no se restringe. La revisión la hacen las rutas (como el resto del alcance ACL).
8. **Productos de serie** se crean ya (con `clase_activo`, por defecto `equipo_red`), pero no se mueven hasta la fase B: 422 `requiere_unidades`. **NCRE** y **compra desde un egreso** con `producto_id`: 422 `no_aplica` (la devolución al proveedor queda para después). Una línea con cuenta `1.1.14` sin producto: 422 `cuenta_inventario`; una línea de inventario que no es `bien`, sin bodega o con cuenta o categoría: 422 `linea_inventario`.
9. **`costo_promedio`** no se guarda: se lee como `valor / cantidad` de cada saldo (6 decimales); `costo_unitario` del movimiento sí se guarda (`numeric(18,6)`).
10. **Columnas**: `productos.cuenta_costo` y `cuenta_consumo` son códigos (como `billing.conceptos_cargo`; null = la del plan); `bodegas.zona_id`; `movimientos` agrega `causa` (baja: `danado`, `robado`, `obsoleto`, `otro`), `actor_tipo`, `actor_id`, `request_id`; `ledger.compras_lineas` agrega `producto_id` y `bodega_id` (`ALTER ADD COLUMN`), que salen en la vista de la compra.
11. **Desactivar** un producto o una bodega exige existencia 0 (409 `producto_con_existencias`, `bodega_con_existencias`), y cambiar el técnico de una bodega con existencias también (409). La acción lleva `version`.
12. **Sobrante sin existencia**: entra al costo del último movimiento con costo del producto, o al `costo_unitario` dado; sin ninguno, 422 `costo_requerido`.
13. **Saldo inicial**: una vez por producto y bodega y antes de cualquier otro movimiento allí (409 `saldo_inicial_registrado`, `saldo_inicial_con_movimientos`). Sin reverso en la fase A: se corrige con un ajuste.
14. **Roles** (decisión del líder, fase B): `contabilidad` recibe además `productos.*`, `bodegas.*` e `inventario.dar_de_baja`.
15. **Origen `inventario`** en `ledger.asientos`: el auditor lo suma a `9.origen_de_asiento_desconocido`; mientras, `tests/inventario` descarta solo ese caso.
16. Rutas extra: `GET /bodegas/:id`. Lecturas para el auditor (§8): `valorKardex(empresa, hasta?)` y `existenciasDelKardex(empresa, hasta?)` en `#inventario/kardex`.

## Desvíos de la fase B

Rama `a3/inventario-b` (sale de `a3/inventario-a` 0506d58). Incluye las decisiones del líder sobre la fase A: costo por producto y bodega en §2; 409 `valor_insuficiente` con su camino (NCRE del proveedor o ajuste); `contabilidad` con `productos.*`, `bodegas.*` e `inventario.dar_de_baja`; y la ruta de compras que revisa el alcance de la bodega que recibe (como el destino de un traslado) y, en una NCRE, el de la bodega de la que sale (con el tope por técnico).

1. **Estados extra de una unidad**: `anulada` (su compra se anuló) y `devuelta_proveedor` (NCRE). La serie y la MAC son únicas solo entre las unidades vivas, así el mismo equipo se puede volver a registrar en la compra corregida o cuando el proveedor lo repone. Si la NCRE se anula y ese equipo ya se volvió a registrar: 409 `serie_duplicada`.
2. **MAC normalizada** `AA:BB:CC:DD:EE:FF` (acepta guiones, puntos o sin separador); la serie en mayúsculas. `GET /inventario/unidades?q=` busca la serie por «contiene» y la MAC con o sin separadores.
3. **Operaciones de serie, una unidad por petición** (`unidad_id` o `unidad` nueva): saldo inicial, ajuste y baja. Así la respuesta sigue siendo un `MovimientoInventario`. Lo que va en lote: la compra (`unidades[]`, una por `cantidad`, el costo repartido con el residuo en la última), la NCRE (`unidad_ids[]`) y el traslado (`unidad_ids[]`). `TrasladoInventario` agrega `movimientos[]` (un par por unidad); `salida` y `entrada` quedan como el primer par. Un producto de serie no se consume (422 `requiere_unidades`): se presta en comodato o se da de baja. El saldo inicial de serie no es único por producto y bodega: una petición por equipo, antes de otro movimiento allí.
4. **Comodato con fecha**: asignar, devolver y declarar pérdida aceptan `fecha` (no futura y no anterior al último movimiento de la unidad). Con una unidad de serie eso nunca deja existencia negativa. El alta del activo usa esa fecha (depreciación desde el mes siguiente por `depreciacion_inicio`). Una devolución con fecha anterior a una cuota ya registrada: 422 `cuotas_posteriores`.
5. **Devolución de comodato**: baja `devolucion_comodato` (tipo nuevo en `ledger.activos_bajas`). Su asiento es el del movimiento, con origen `inventario` (no `baja_activo`): `1.1.14 (valor en libros) + 1.2.02.NN / 1.2.01.NN`. Emite también `activo.dado_de_baja`. El alta en comodato es una fila de `ledger.activos` con `unidad_id` (columna nueva) y su asiento `1.2.01.NN / 1.1.14` también es el del movimiento. **Pérdida**: llama a `activos.dar_de_baja` tipo `retiro` (origen `baja_activo`, `5.3.06`), sin kardex; la unidad queda `dada_de_baja` con su `servicio_id` para la historia.
6. **Devolución al proveedor (NCRE)**: la línea `bien` con `producto_id` de una NCRE saca del kardex (`devolucion_proveedor`, con el asiento de la NCRE) lo devuelto al costo de la compra que corrige. Por cantidad es el promedio de lo que entró con esa compra en esa bodega, y lo último que queda por devolver lleva su costo exacto; por serie, el costo de cada unidad de esa compra. **La línea de la NCRE debe valer ese costo** (base con crédito fiscal, total sin él): si no, 422 `devolucion_distinta_del_costo`, y otra diferencia del proveedor va en otra línea, a su gasto. Más de lo que entró con la compra: 422 `devolucion_excede_compra`. Anular la NCRE reingresa al mismo costo (`reverso_compra`).
7. **Equipos por recuperar**: el consumidor de `servicio.estado_cambiado` (grupo `inventario`, en `billing:worker`) llama a `inventario.revisar_comodatos`, que decide con el estado actual del servicio. Solo procesa los eventos que entran o salen de `retirado`. Es idempotente y solo deja auditoría si cambió algo. `GET /reportes/equipos-por-recuperar` (`inventario.ver`).
8. **Reparación**: una unidad devuelta `en_reparacion` está en su bodega (cuenta en sus existencias) y se puede trasladar o dar de baja, pero no prestar. La acción para marcarla reparada no está en el contrato: queda pendiente (pregunta).
9. **Permisos**: `inventario.asignar_comodato`, `inventario.devolver_comodato` (`tecnico` y `admin`) e `inventario.declarar_perdida_comodato` (solo `admin`, como lo literal de §6).
10. **Fechas de consumo y ajuste en la fase C** (pedido del líder): se evaluará aceptar una fecha pasada dentro de un periodo abierto si no deja existencia negativa en ninguna fecha posterior; el costo de esa salida seguiría siendo el promedio al momento de registrarla.
11. **Hallazgos del auditor de la fase B (H42, H43 y observaciones):**
    - Anular una compra solo es posible si cada unidad que entró sigue tal como entró: `disponible` en su bodega, a su costo de compra y sin más movimientos que traslados. Si no, 409 `unidades_en_uso`; un equipo que volvió de comodato se devuelve al proveedor con una NCRE por serie a su costo actual.
    - El activo de un comodato (`ledger.activos.unidad_id`) no se da de baja con `activos.dar_de_baja`: 409 `activo_en_comodato`. Sale con devolver o declarar pérdida.
    - Un equipo que vuelve totalmente depreciado vale Q0 y se puede volver a prestar: su activo nace en Q0, sin depreciación ni asientos de alta ni de baja. `ledger.activos.costo` admite 0 solo con `unidad_id`, y la baja de un activo en Q0 va sin asiento.
    - Locks: todas las operaciones toman primero el lock del producto y después la fila de la unidad.
    - En una NCRE, `devolucion_excede_compra` sale antes que `ncre_excede_saldo`.

## Desvíos de la fase C

Rama `a3/inventario-c` (sale de `a3/inventario-b` c15a016). Incluye las decisiones del líder: NCRE de devolución al costo exacto, `marcar_reparada`, fechas pasadas en consumos y ajustes y la salida «premio».

1. **Venta solo por cargo único.** Las facturas recurrentes no llevan productos: la «factura con línea de `producto_id`» de §5 es la del cargo único (`POST /cargos-unicos`, cada línea con `producto_id`, `bodega_id` y, si es de serie, `unidad_id`). Las columnas nuevas de `billing.facturas_lineas` (`producto_id`, `bodega_id`, `unidad_id`) guardan lo vendido. El costo se calcula con los locks de los productos **antes** de emitir la factura y el movimiento `venta` se registra en la misma transacción, con `factura_linea_id` y `origen` = la factura. La unidad vendida queda `vendida`. Un cargo sin costo (Q0, con motivo sin costo) que lleva producto: 422 `producto_sin_costo` (el regalo de un bien no es una venta; va por premio o baja).
2. **Asiento de la venta.** Origen `inventario` (`origen_id` = el movimiento), diario `VEN`: respeta el bloqueo de ventas. Cuenta de costo: `cuenta_costo` del producto o `5.6.01`.
3. **Reverso de la venta** (`reverso_venta`): anular la factura, o una nota de crédito que acredita **toda** la línea (lo acreditado ≥ total − descuento de la línea, o notas que cubren la factura entera), reingresa lo que sigue vendido de la línea al mismo costo, con su **asiento propio** `1.1.14 / cuenta de costo` (origen `inventario` = el reverso; no un `RevertirAsiento` del de la venta, para que cada asiento de inventario cite su movimiento). Una nota parcial no reingresa nada. Anular la nota (rechazo definitivo de la SAT) vuelve a sacar lo que ella reingresó, al mismo costo: 409 `existencia_insuficiente` o `unidad_no_disponible` si ya no está. Sustituir la factura revierte la venta de la sustituida y vende otra vez en la nueva.
4. **Conteos.** Uno abierto por bodega (409 `conteo_abierto`); la bodega sigue operando mientras se cuenta. Lo esperado se toma **al capturar cada línea** (H56, decisión del líder): cantidad y valor de la bodega o, por serie, sus unidades, y el último movimiento; al cerrar, la diferencia es contado − esperado al capturar, así lo movido después (ventas, consumos) no es faltante ni sobrante. `GET /inventario/conteos/:id` muestra `esperado_captura`, `valor_captura`, `capturado_en` y `movimientos_desde_captura`. Capturar otra vez la línea vuelve a tomar lo esperado. Por serie faltan las unidades capturadas no contadas que siguen en la bodega, y sobran las series contadas que no eran de la bodega ni al capturar ni ahora. Una línea por producto (capturarla otra vez la reemplaza); por serie se capturan las series o MAC encontradas. Solo se ajustan los productos contados. Faltante al promedio (por serie, cada unidad no contada a su costo; queda `dada_de_baja`); sobrante con la regla del ajuste (H41: con existencia al promedio, sin ella al `costo_unitario` de la línea o al último costo; 422 `costo_requerido`). Una serie contada que no es de la bodega entra como unidad nueva `usado`; si es una unidad viva en otra parte, 422 `serie_duplicada` (se traslada antes). Los movimientos son `ajuste_conteo` con `origen` `conteo`; la fecha es la del cierre. `cancelar_conteo` con motivo, sin ajustes. Permisos: `abrir_conteo`, `cerrar_conteo` y `cancelar_conteo` para `contabilidad` (y `admin`); `contar` también para `tecnico`.
5. **Reporte valorizado** (`GET /reportes/inventario-valorizado?fecha=&bodega_id=&producto_id=&con_ceros=`): cantidad, valor y costo promedio por producto × bodega reconstruidos del kardex (movimientos con fecha ≤ la pedida), y `cuadre` por empresa: kardex completo contra el saldo de `1.1.14` a la misma fecha (sin el filtro de bodega o producto). JSON; la exportación XLSX/CSV queda para los reportes generales.
6. **Costo de ventas en el ISO y el comparador** (§15 #79): el costo de ventas es solo `5.6.01` (costo del equipo vendido); las mermas y faltantes (`5.6.02`) son gasto, no costo de lo vendido (decisión del líder; pregunta al contador en §15 #103). ISO trimestral: margen bruto = (ingresos − costo de ventas) / ingresos del año anterior; la nota lo dice. Comparador: el ISO como piso solo se aplica si ese margen (con los ingresos del mayor de los meses leídos) pasa de `iso_umbral_margen`; si no, `iso_anual = 0`. El bloque trae `costo_ventas`, `margen_bruto`, `umbral_margen` y `aplica`. Un producto con `cuenta_costo` fuera de `5.6.01` no entra al costo de ventas.
7. **`inventario.marcar_reparada`** (`admin`, `tecnico`, `contabilidad`): de `en_reparacion` a `disponible` en la misma bodega, con motivo. La unidad en reparación ya contaba en las existencias: sin movimiento ni asiento, solo `audit.cambios`. Desde `en_reparacion` también se da de baja.
8. **Fechas pasadas** en `inventario.consumir` e `inventario.ajustar` (`fecha` opcional): no futura (422 `futuro`); una pasada solo en un periodo abierto (422 `periodo_cerrado`; los bloqueos los aplica el asiento). **H55 (decisión del líder):** por cantidad, solo si el producto en esa bodega no tiene después de esa fecha ningún movimiento que cambie el promedio (una entrada de cualquier tipo, o una anulación de compra o devolución al proveedor, que salen a su costo); entonces se valúa al promedio vigente en esa fecha, que es el de hoy. Si no, 409 `fecha_con_movimientos_posteriores`, con un mensaje que pide registrarlo con la fecha de hoy. Nunca deja existencia ni valor negativos en ninguna fecha desde la suya (409 `existencia_insuficiente_en_fecha`); el faltante de una unidad no queda antes de su último movimiento (422 `fecha_anterior`). Traslado, baja, venta y premio siguen con la fecha de hoy.
9. **Salida «premio»** (decisión del líder): `sorteos.entregar` con `contrapartida: inventario` y `producto_id`, `bodega_id` y `unidad_id` (serie) o `cantidad` (1 por defecto). El bien sale con el movimiento `premio` a su costo y su asiento propio `5.1.03 / 1.1.14` (origen `inventario`); el movimiento cita al ganador (`origen` `sorteo_ganador`) y el ganador guarda `movimiento_inventario_id`. El gasto es el **costo**, no el valor declarado del premio (decisión del líder, NIIF: el gasto es lo que el bien le costó a la empresa; el valor declarado solo sirve para el ISR del ganador); el ISR (sobre el valor) lo asume la empresa en el asiento `sorteo` (`5.1.03 / 2.1.05`), como en los demás premios en especie. Sin ISR no hay asiento `sorteo`. `anular_entrega` lo reingresa (`reverso_premio`, `1.1.14 / 5.1.03`, la unidad vuelve `disponible`). Una línea de compra que entró al inventario sigue con 422 `linea_de_inventario` (su mensaje apunta a `contrapartida: inventario`). La unidad entregada queda en el estado nuevo `entregada`. **Canje en especie**: el canje de un premio `bien` sigue bloqueado por `premio_bien_iva` (contador); cuando se habilite usará la misma salida (`salidaPorPremio` de `#inventario/premios`).
10. **Migración del rollback de la fase B**: el `down` de unidades ya no falla cuando hay varios saldos iniciales de serie del mismo producto y bodega (no recrea el índice único de antes si los datos lo impiden).
11. **H54** (auditor, fase B): el conteo de «movimientos después de entrar» de H42 usa `IS DISTINCT FROM` (los movimientos sin origen, como el comodato, también cuentan): una unidad prestada y devuelta el mismo mes ya no deja anular su compra (409 `unidades_en_uso`). Se relajó lo demás solo donde es seguro: una NCRE de devolución **anulada** (su `devolucion_proveedor` y su `reverso_compra`, al mismo costo) no cuenta, así la compra se puede anular si la unidad volvió tal como entró.

## Pedidos del panel (A4, rama `a3/inventario-pedidos`)

1. **`Producto.precio_venta`** (§4): opcional, IVA incluido; sale en `Producto` (OpenAPI) y se envía en `POST /productos` y `POST /productos/:id/editar`. Migración `1792862639792`.
2. **Compra de serie con menos series que su cantidad**: 422 `validacion` (`type` `…:validacion`), `errors[]` = `{ field: 'lineas.N.unidades', rule: 'requiere_unidades' }`, igual que sin ninguna serie. En una NCRE de serie con menos equipos devueltos que la cantidad: `lineas.N.unidad_ids`, `requiere_unidades`. Con más series que la cantidad: `{ field: 'lineas.N.cantidad', rule: 'cantidad' }`. El `type` no es `requiere_unidades`: la regla va en `errors[].rule`, como en el consumo (`cantidad`, `requiere_unidades`).

## Origen Iris (pedidos A3 y A4 de `contratos/iris.md` §5.1, rama `a3/origen-iris`)

1. **Cuerpo.** `POST /inventario/consumos`, `POST /servicios/:id/equipos`, `…/devolver`, `…/perdida` y `POST /facturas/cargo-unico` aceptan `origen_tipo` y `origen_id` (los nombres del contrato con Iris). `origen_tipo` solo admite `iris_orden`: los orígenes internos del kardex (`compra`, `factura`, `conteo`, `nota_credito`, `sorteo_ganador`…) los pone el sistema y no se aceptan del cliente. `origen_id` es texto de 1 a 100 caracteres `[A-Za-z0-9._:-]` (el UUID de la orden). Con `origen_tipo`, `origen_id` es obligatorio, y al revés: 422 `validacion` con `errors[].field` = el que falta. Sin los dos, todo igual que antes.
2. **Dónde se guarda.** Columnas nuevas `origen_externo_tipo` + `origen_externo_id` (texto, CHECK `iris_orden`, en pareja) en `inventario.movimientos`, `billing.facturas` y `billing.bonificaciones` (migración `1793210540992_origen_externo_iris`). **No** en `origen_tipo`/`origen_id` del movimiento: ese par es interno, su id es `bigint` y el auditor lo cruza con compras, notas y ganadores.
3. **Dónde sale.**
    - `MovimientoInventario` (kardex y respuesta del consumo) y el `historial` de `GET /inventario/unidades/:id`: `origen_externo_tipo`, `origen_externo_id`. Filtro `GET /inventario/movimientos?origen_externo_id=` (el saldo corrido sigue siendo el de toda la historia).
    - Eventos `inventario.movimiento_registrado`, `inventario.comodato_asignado` e `inventario.comodato_devuelto`: los dos campos (null sin orden).
    - Cargo único: `Factura`/`FacturaDetalle` (respuesta, `GET /facturas`, `GET /facturas/:id`) y `Bonificacion` (cargo en Q0).
    - Auditoría: `audit.acciones.entrada` de cada acción lleva `origen_tipo`/`origen_id` tal como llegaron.
4. **Pérdida de comodato.** No tiene kardex ni evento propio: la orden queda solo en la auditoría de `inventario.declarar_perdida_comodato`. El motivo de la baja y su asiento no cambian.
5. **Contabilidad.** Solo trazabilidad: ningún asiento, costo, saldo ni descripción de asiento cambia (las pruebas comparan las partidas de un cargo con y sin origen y verifican el libro).
6. **Idempotencia.** Todas estas rutas ya eran idempotentes por `Idempotency-Key`; Iris manda `iris:<operacion>:<orden_id>[:…]` (§3 de `contratos/iris.md`), probado con `iris:cargo:<orden_id>` y `iris:consumo:<orden_id>`.
7. **OpenAPI.** En las respuestas los dos campos están siempre (null sin orden), pero se declaran opcionales en `MovimientoInventario`, `Factura` y `Bonificacion` para no romper los fixtures del panel; A4 los agrega y se vuelven requeridos.

## Fase D: pedidos del PM 31 oct

Rama `a3/inventario-v2` (sale de `main` 10078a6). Decisiones del PM: **recibe quien recibe** (orden de traslado en tránsito), **la modalidad la define cada producto**, la factura de compra en PDF o imagen la lee una **IA con proveedor configurable**, y la orden de traslado se recibe con **firma digital**, con **firma en papel** (PDF imprimible) o, si la empresa lo permite, con **aceptación sin firma**. Una sección por pedido; lo contable al final (D.8) para el auditor.

### D.1 Orden de traslado

**Modelo.**

- `inventario.ordenes_traslado`: `empresa_id`, `numero` (correlativo por empresa, único, sin huecos: `max + 1` con lock por empresa), `bodega_origen_id`, `bodega_destino_id`, `estado` (`en_transito` → `recibida` | `recibida_con_diferencias` | `cancelada`), `motivo` (del envío), `enviado_por`, `enviado_en`, recepción (`recibido_por` = usuario técnico o encargado que recibió, `registrado_por` = el usuario que hizo la llamada, `metodo_recepcion`, `recibido_en`, `observaciones`), firma (`firma_ruta`, `firma_sha256`, `firma_ip`, `firma_en`), documento firmado en papel (`documento_ruta`, `documento_sha256`, `documento_tipo`, `documento_tamano`), cancelación (`cancelado_por`, `cancelado_en`, `motivo_cancelacion`) y `version`. Se actualiza solo por sus tres acciones (y el adjunto), con `audit.cambios`.
- `inventario.ordenes_traslado_lineas`: `producto_id`, `cantidad` enviada y `costo_total` enviado (lo que salió del origen), `cantidad_recibida` y `costo_recibido` (null en tránsito). Una línea por producto en la orden.
- `inventario.ordenes_traslado_unidades` (líneas de serie): `unidad_id`, `costo` (el de la unidad al enviarla), `recibida` (null en tránsito, true/false al recibir).

**Dónde está lo enviado: bodega virtual «en tránsito» por empresa.** Una bodega `tipo = 'transito'` (una por empresa, índice único; nace la primera vez que se envía una orden). Por qué una bodega y no una reserva:

- El kardex sigue siendo la única verdad: lo que salió del origen está en el kardex de la bodega de tránsito, con su costo. Los checks §8.1 y §8.2 no cambian (todo sigue en `1.1.14`) y la existencia del origen y del destino no lo cuentan, sin tocar ninguna lectura de existencias ni la regla «salida ≤ existencia».
- Una reserva habría obligado a restar «reservado» en cada salida (consumo, venta, baja, conteo, premio…) y a llevar una segunda verdad fuera del kardex.

La bodega de tránsito no se opera a mano: `bodegaMovible` la rechaza en toda operación (422 `bodega_transito`), no se edita, no se desactiva, no se cuenta y no se elige como origen o destino. Sale en el kardex y en el reporte valorizado. Para no romper al panel (transición, como los campos opcionales de «Origen Iris»), `GET /bodegas` la muestra solo con `?tipo=transito` y `GET /inventario/existencias` solo con su `bodega_id` o `?incluir_transito=true`; en el OpenAPI `Bodega.tipo` y `ExistenciaInventario.bodega_tipo` siguen con `bodega`/`tecnico` hasta que A4 adopte `transito`. Lo que viaja se ve en `GET /inventario/traslados`.

**Movimientos.** Todos `tipo = 'traslado'` con `origen_tipo = 'orden_traslado'`, `origen_id` = la orden, sin asiento (misma cuenta `1.1.14`). Cada tramo es un par con su propio `traslado_id` que suma 0 en cantidad y en valor (check D.8.c):

| Paso | Par de movimientos | Unidad de serie |
| --- | --- | --- |
| Enviar (`inventario.crear_traslado`) | origen − / tránsito +, al costo promedio del origen (o el de la unidad) | `bodega_id` = tránsito |
| Recibir lo recibido (`inventario.recibir_traslado`) | tránsito − / destino +, al costo de la línea | `bodega_id` = destino |
| Faltante al recibir | tránsito − / **origen** +, al costo de la línea | `bodega_id` = origen |
| Cancelar (`inventario.cancelar_traslado`) | tránsito − / origen +, todo, al costo de la línea | `bodega_id` = origen |

**La unidad conserva su estado** (`disponible` o `en_reparacion`) mientras viaja; lo que dice que viaja es su bodega (la de tránsito). Así los checks de unidades del auditor (24.unidad_distinta_de_su_kardex, 24.saldo_de_serie_distinto_de_sus_unidades) siguen valiendo sin cambios. Ninguna operación la toca: `unidadesDeBodega` responde 409 `unidad_en_transito` para una unidad en la bodega de tránsito (salvo las órdenes).

Costo de lo recibido por cantidad: `costo_recibido = redondear(cantidad_recibida × costo_total / cantidad)`; el faltante lleva el resto (`costo_total − costo_recibido`), así la línea sale de tránsito exactamente por lo que entró y el valor de la bodega de tránsito es siempre la suma de las líneas en tránsito (check D.8.b). Una unidad de serie se mueve a su costo.

**Faltantes (decisión de A3): vuelven al origen.** Lo que el destino no recibió regresa al kardex del origen al mismo costo, sin asiento, y la orden queda `recibida_con_diferencias` con el faltante por línea y por serie. Por qué:

- Quien recibe (a menudo un técnico) no debe poder crear un gasto: declarar una pérdida es de contabilidad. Una baja automática pondría en `5.6.02` lo que tal vez aparece mañana en la camioneta.
- Responde quien lo tenía y lo envió. La pérdida, si se confirma, se registra después con `inventario.dar_de_baja` (5.6.02, con motivo que cite la orden) o la saca un conteo; si aparece, se envía otra orden.
- Una bodega de tránsito con existencias «a investigar» sin dueño ni fecha de cierre rompería D.8.b.

`GET /inventario/traslados?estado=recibida_con_diferencias` es la lista de diferencias por investigar.

**Acciones y permisos.**

- `inventario.crear_traslado` (`POST /inventario/traslados/enviar`; `admin`, `contabilidad`, `tecnico`): `{ bodega_origen_id, bodega_destino_id, motivo?, lineas: [{ producto_id, cantidad } | { producto_id, unidad_ids[] }] }`. Origen ≠ destino, misma empresa, un producto una sola vez (422 `lineas.N.producto_id` `repetido`), todo o nada (409 `existencia_insuficiente` o `unidad_*` de la primera que falle). El origen exige poder operarlo (tope por técnico); el destino solo el alcance, como el traslado inmediato. Fecha de hoy. Emite `inventario.traslado_enviado`. Idempotente por `Idempotency-Key`.
- `inventario.recibir_traslado` (`POST /inventario/traslados/:id/recibir`; `admin`, `contabilidad`, `tecnico`; contrato Iris 0.5.0 §3.3): solo `en_transito`. Una orden ya recibida responde 409 `traslado_ya_recibido` con la recepción guardada en `recepcion` (un 2xx es definitivo: otra recepción, con cualquier clave, recibe ese 409; con la misma clave y el mismo cuerpo, la respuesta original); una cancelada, 409 `traslado_cancelado`; una que no existe, 404 `traslado_no_encontrado`. `version` opcional (409 si difiere).
    - Cuerpo: `{ recibido_por?: tecnico, metodo_recepcion?, firma?: { png_base64, sha256 }, recibido_en? (RFC 3339), observaciones?, lineas?: [{ linea_id, cantidad_recibida?, series_faltantes?[], unidad_ids_faltantes?[] }], version? }`. Sin `lineas` (o sin una línea) se recibe todo lo de esa línea. Por cantidad, `cantidad_recibida` entre 0 y lo enviado; por serie, `series_faltantes` (serie o MAC, como Iris) o `unidad_ids_faltantes` (el panel), y `cantidad_recibida`, si viene, debe ser lo enviado menos lo faltante. Cualquier error de líneas: 422 `lineas_invalidas` con `errors[]`.
    - `recibido_en` (hora del teléfono): no anterior al envío ni futuro, con 5 min de tolerancia (422 `recibido_en`); se guarda como la fecha de recepción. Por defecto, ahora.
    - **Quién recibe.** Si la destino es una bodega `tecnico`: su técnico (el actor es su `usuario_id`) o un usuario con el permiso de alcance global (encargado, o el usuario técnico «Iris») que registra en nombre del técnico. Si la destino es una bodega `bodega`: quien pueda operarla. Si no: 403. `recibido_por` = el técnico de la bodega destino (o, en una bodega `bodega`, el actor); `registrado_por` = el actor.
    - **Métodos** (`metodo_recepcion`; por defecto `firma_digital` si llega `firma` y `aceptacion_sistema` si no):
        - `firma_digital`: `firma` obligatoria (422 `firma` `requerida`). La pone el técnico en su dispositivo (Argos o Iris) o un encargado en el dispositivo con el técnico presente.
        - `firma_papel`: solo un usuario con alcance global que registra el papel firmado (403 si es el propio técnico sin alcance global); `firma` no aplica (422 `no_aplica`). El escaneo o la foto se adjunta con `POST /inventario/traslados/:id/documento` (abajo).
        - `aceptacion_sistema`: sin firma, solo si `inventario.configuracion.traslado_firma_obligatoria = false` para la empresa (si no, 422 `firma` `requerida`). Por defecto la firma es obligatoria.
    - **Firma** (`firma`): `{ png_base64, sha256 }` en JSON (base64 con o sin `data:image/png;base64,`; `sha256` = el del PNG decodificado), o el archivo `firma` en `multipart/form-data` para el panel (los demás campos como texto; `lineas` y `recibido_por` como JSON). PNG por su contenido, hasta 200 KB decodificado y de 50×20 a 1000×400 px; si no, o si el `sha256` no coincide: 422 `firma_invalida` con `errors[]`. Se guarda en el almacén de archivos (el de los comprobantes, `inventario/firmas/AAAA/MM/<uuid>.png`) con SHA-256, quién firmó (`recibido_por`), la fecha (`recibido_en`) y la IP de la petición. En la auditoría va `{ bytes, sha256 }`, nunca el binario ni el base64.
    - Quien recibe: si `recibido_por` no es el técnico de la bodega destino, 422 `traslado_de_otro_tecnico`. Un técnico sin alcance global que no es el de la bodega: 403.
    - Emite `inventario.traslado_recibido`. Deja `audit.acciones` con método, quién recibió y quién registró.
- `inventario.cancelar_traslado` (`POST /inventario/traslados/:id/cancelar`; `admin`, `contabilidad`, `tecnico`): solo `en_transito`, `motivo` obligatorio; quien pueda operar el origen o con alcance global. Todo vuelve al origen. Emite `inventario.traslado_cancelado`.
- `inventario.adjuntar_documento_traslado` (`POST /inventario/traslados/:id/documento`, multipart `archivo`; permiso con el mismo nombre, `admin` y `contabilidad`): la foto o el escaneo del papel firmado, solo en una orden recibida con `firma_papel` y una sola vez (409 `documento_registrado`). JPG, PNG, WebP o PDF por contenido, hasta 5 MB, con SHA-256 (como los comprobantes). `GET /inventario/traslados/:id/documento` y `GET /inventario/traslados/:id/firma` lo devuelven (`inventario.ver` y poder ver la orden).
- `inventario.configurar` (`POST /inventario/configuracion`; `admin`): `{ traslado_firma_obligatoria, version }` por empresa (`inventario.configuracion`, una fila por empresa; sin fila = valores por defecto). `GET /inventario/configuracion` (`inventario.ver`).

**Lecturas.** `GET /inventario/traslados?estado=&bodega_id=&numero=` (orígenes o destinos visibles por el tope del técnico) y `GET /inventario/traslados/:id` (líneas, unidades con serie y MAC, recepción, hash corto de la firma; nunca rutas del almacén).

**PDF imprimible** `GET /inventario/traslados/:id/pdf` (`inventario.ver`), con `pdfkit` (el motor del acta de sorteos y los libros): encabezado de la empresa (nombre, NIT, logo si hay); «Orden de traslado N.º», fecha, origen y destino (con el técnico); una fila por producto (SKU, nombre, unidad, cantidad, series o MAC) con una casilla por línea; totales (líneas, unidades, cantidad); estado («En tránsito», «Recibida por X el …», «Recibida con diferencias…» con los faltantes, o «Cancelada»). Firmas: «Entrega» (nombre de quien envió y fecha) y «Recibe»: con firma digital, la imagen en el espacio «Recibe» con nombre, fecha y los 12 primeros caracteres del SHA-256; con firma en papel o en tránsito, los espacios en blanco (nombre, firma y fecha) para imprimir. El PDF no muestra costos (lo firma el técnico); el valor está en la orden.

**Eventos** (outbox; payload de `contratos/iris.md` §2.3, 0.5.0): `inventario.traslado_enviado`, `inventario.traslado_recibido` e `inventario.traslado_cancelado` llevan `traslado_id`, `empresa_id`, `numero`, `bodega_destino_id`, `tecnico` (`{ id_externo, correo }` del técnico de la bodega destino, o null), `estado`, `lineas[]` (`{ producto_id, cantidad, series[] }`, lo enviado) y `enviado_en`. Recibido agrega `recibido_en`, `recibido_por` (`{ id_externo, correo }`), `registrado_por` (usuario), `metodo_recepcion`, `origen` (`iris` si lo registró el usuario técnico «Iris», si no `panel`) y `faltantes[]` (`{ producto_id, cantidad, unidad_ids[] }`). Cancelado agrega `cancelado_en` y `motivo`. El envío al webhook de Iris (solo a conectores con contrato ≥ 0.5.0) es de A6. Cada movimiento emite además su `inventario.movimiento_registrado`.

**Traslado inmediato.** `POST /inventario/traslados` (`inventario.trasladar`) queda igual. No toca la bodega de tránsito.

### D.2 Tipos de producto editables

- `inventario.tipos_producto`: `empresa_id` (null = global), `codigo` (`[a-z0-9_]`, único por empresa y entre los globales; uno de empresa no puede repetir el código de uno global), `nombre`, `seguimiento_defecto` (`cantidad` | `serie`), `modalidad_defecto` (D.3), `activo`, `version`. Semillas globales: `equipo` (serie, comodato), `material` (cantidad, consumible_gasto), `otro` (cantidad, consumible_gasto).
- `productos.tipo` sigue siendo el **código** (la API no cambia): se quita el CHECK fijo y se agrega `productos.tipo_id` (FK). Transición del OpenAPI: `Producto.tipo` sigue declarado con el enum de las semillas y `tipo_id`, `tipo_nombre` y `modalidad` como opcionales (siempre vienen) hasta que el panel los adopte; luego `tipo` pasa a texto y los tres a requeridos. Se resuelve primero en la empresa y luego en los globales; inexistente o inactivo: 422 `tipo`. Las filas existentes apuntan a la semilla global de su código.
- Al crear un producto, `seguimiento` y `modalidad` son opcionales y toman los del tipo. `Producto` agrega `tipo_id`, `tipo_nombre` y `modalidad`.
- API: `GET /inventario/tipos-producto?activo=` (`inventario.ver`), `POST /inventario/tipos-producto` (`tipos_producto.crear`), `POST /inventario/tipos-producto/:id/editar` (`tipos_producto.editar`, con `version`, `audit.cambios`; el código no cambia), `POST /inventario/tipos-producto/:id/desactivar` (`tipos_producto.desactivar`, con `version`; los productos que ya lo usan siguen igual, los nuevos no lo aceptan). Un tipo global se crea, edita o desactiva solo con alcance global (403). Roles: `admin` y `contabilidad`.
- Un tipo con `modalidad_defecto` incompatible con su `seguimiento_defecto` (D.3): 422 `modalidad_defecto`.

### D.3 Modalidad por producto (consumibles)

`productos.modalidad`: `comodato` | `consumible_gasto` | `consumible_cobro`. Compatibilidad: `comodato` solo con seguimiento `serie`; `consumible_gasto` solo con `cantidad` (un equipo de serie que se queda en la red es un activo fijo, no un gasto); `consumible_cobro` con los dos (por serie es la **venta de un equipo**). Si no, 422 `modalidad`. Migración: los productos de serie quedan `comodato` y los de cantidad `consumible_gasto` (lo de hoy). Se edita con `productos.editar` (afecta solo lo que se registre después).

`POST /inventario/consumos` con `servicio_id` aplica la modalidad del producto:

| Modalidad | Qué hace | Kardex y asiento |
| --- | --- | --- |
| `consumible_gasto` | Lo de hoy | `consumo`: `cuenta_consumo` (5.2.07) / 1.1.14 |
| `consumible_cobro` | **Cargo único inmediato** al cliente del servicio por `facturas.emitir_cargo_unico` (la acción que ya existe), una factura por petición con una línea por producto cobrado | `venta` (fase C): `5.6.01 / 1.1.14` al costo, diario VEN; la factura: `CxC / ingreso del concepto + IVA` como todo cargo único |
| `comodato` | **No va por consumos** (contrato Iris 0.5.0): 422 `producto_es_comodato`; el equipo va por `POST /servicios/:id/equipos` (`inventario.asignar_comodato`) | — |

- **Por qué cargo único y no la siguiente factura.** El cargo único ya resuelve todo lo de una venta de inventario: costo en la misma transacción, IVA, FEL, reverso al anularla o con una NCRE (fase C), bloqueo de ventas y la auditoría del auditor. Diferirlo a la mensualidad obligaría a llevar «cargos pendientes» con su costo ya salido del kardex sin ingreso, que el libro no puede cuadrar por periodo. El cargo vence según los días de gracia del servicio (regla del cargo único), así que en la práctica se cobra con la siguiente mensualidad.
- **Precio y concepto.** `precio_unitario` de la línea o, si falta, `productos.precio_venta` (IVA incluido); sin ninguno: 422 `lineas.N.precio_unitario` `precio_requerido`. Concepto: `concepto_id` de la línea o `productos.concepto_cargo_id`; sin ninguno: 422 `concepto_requerido`. Sin `servicio_id`: 422 `servicio_requerido` (cobro y comodato). La factura lleva el `origen_tipo`/`origen_id` de Iris si vienen.
- **Permiso.** Basta `inventario.consumir`: el cargo es consecuencia de la modalidad que fijó quien tiene `productos.editar`. La auditoría deja las dos acciones (`inventario.consumir` y la anidada `facturas.emitir_cargo_unico`) con el mismo `request_id`.
- **Varias líneas** (contrato Iris 0.5.0 §3.3): `POST /inventario/consumos` acepta una línea (`producto_id` arriba, lo de siempre) o `lineas: [{ producto_id?, cantidad?, unidad_id?, serie?, precio_unitario?, concepto_id? }]`, con `bodega_id?`, `tecnico?`, `servicio_id`, `origen_tipo?`, `origen_id?`, `fecha?`, `motivo?`. **Atómico**: si una línea falla no se aplica ninguna (errores `lineas.N.*`). Responde `ConsumoInventario`: el `MovimientoInventario` de la primera línea (lo que el panel ya lee) más `movimientos[]` (uno por línea), `factura_id` y `cargos[] { id (la factura), producto_id, monto }` (montos como texto). Los cobros de la petición van en un solo cargo único con el `origen_tipo`/`origen_id` de la orden; un reintento con la misma `Idempotency-Key` devuelve la misma respuesta y no cobra dos veces. La venta lleva en el kardex el `origen_externo_*` de la orden, igual que la factura. (La ruta `/inventario/consumos/lote` del primer diseño se quitó.)
- **`cargo_duplicado`:** un `POST /facturas/cargo-unico` con `origen_id` de una orden y una línea con un `producto_id` que esa orden ya cobró por modalidad (factura vigente con `reglas_snapshot.cobro_por_modalidad`) responde 409 `cargo_duplicado`. Un cargo de la misma orden sin ese producto (la visita) se cobra normal.
- Fecha: un cobro o un comodato van con la fecha de hoy (422 `fecha` `no_aplica` con una pasada); el gasto acepta la fecha pasada de siempre.
- Un consumo `consumible_gasto` no lleva `precio_unitario` (422 `no_aplica`). Sin `servicio_id`, un producto `consumible_cobro` (o un equipo por serie) responde 422 `cobro_sin_cliente` (un consumo interno sin cliente va por `consumible_gasto` o `dar_de_baja`).

### D.4 Alta de productos por lotes

`POST /productos/lote` (`productos.crear_lote`; `admin`, `contabilidad`) — **desvío de ruta**: el pedido decía `/inventario/productos/lote`; los productos viven en `/productos` y el lote va a su lado. Cuerpo `{ productos: [ <lo de POST /productos> + entrada? ] }`, hasta 500 filas, `Idempotency-Key` obligatoria (422 sin ella).

- **Todo o nada.** Primero se valida todo (formato, SKU repetido en el lote o en la empresa, tipo, modalidad, bodega, series) y se responde 422 con todos los `errors[]` (`productos.<i>.campo`); después se crea en una transacción y el primer error de negocio (409) se devuelve con su `productos.<i>` en `detail` y nada queda.
- **Entrada opcional por fila:** `entrada: { bodega_id, cantidad, costo_unitario, fecha? }` (cantidad) o `entrada: { bodega_id, unidades: [{ serie?, mac?, costo }], fecha? }` (serie). **Vía contable: saldo inicial** (`inventario.cargar_saldo_inicial`, `1.1.14 / 2.9.01 Saldos de apertura`). Por qué: el producto es nuevo y no tiene movimientos, que es exactamente el caso del saldo inicial (existencias que la empresa ya tenía al empezar a usar el sistema). Un ajuste pondría el valor en `4.2.04 Sobrantes` (un ingreso) como si un conteo hubiera encontrado mercadería de más, y lo comprado a un proveedor entra por una compra (D.5) con su IVA y su cuenta por pagar. La entrada exige además `inventario.cargar_saldo_inicial` (403 si falta).
- Responde `ProductosLote { data: Producto[], movimientos: MovimientoInventario[] }` (201). Sin `Idempotency-Key`: 400 `idempotency_key_requerida`. La validación previa no ve las series que ya existen en la empresa: esas fallan al crear (422 `serie_duplicada` con `productos.<i>.unidad…`) y deshacen todo igual.

### D.5 Factura de compra desde un archivo (borrador)

**Flujo.** Subir el archivo → `borrador` con sus datos y una propuesta → el usuario corrige → confirmar crea la compra con `compras.registrar` (la de siempre, con su asiento y su entrada al kardex) en la misma transacción. Nunca se crea una compra sin la confirmación explícita.

- `inventario.compras_borradores`: `empresa_id`, `estado` (`borrador` → `confirmado` | `descartado`), `fuente` (`xml_fel` | `ia` | `manual`), archivo (`archivo_ruta`, `archivo_sha256`, `archivo_tipo`, `archivo_tamano`), `extraccion` (jsonb, lo que leyó el parser o la IA, inmutable), `datos` (jsonb, lo que el usuario corrige), `propuesta` (jsonb: proveedor y productos), `confianza` (jsonb, solo IA), `error_extraccion` (texto), `compra_id`, `version`, `creado_por`. Índice único `(empresa_id, archivo_sha256)` entre los vivos: el mismo archivo dos veces responde 409 `archivo_duplicado` con el borrador.
- **Acciones** (permisos con su nombre; `admin` y `contabilidad`):
    - `compras.cargar_borrador` (`POST /compras/borradores`, multipart `archivo`): XML, PDF, JPG, PNG o WebP por contenido, hasta 10 MB (422 `archivo`). XML → parser FEL; PDF o imagen → IA. Si la IA falla o no está configurada, el borrador se crea igual, vacío, con `error_extraccion` visible (`ia_no_configurada`, `ia_fallo: <detalle>`) para capturar a mano. Sin archivo: `{ fuente: manual }`.
    - `compras.editar_borrador` (`POST /compras/borradores/:id/editar`, `version`): reemplaza `datos` (mismo esquema que la extracción) y recalcula la propuesta.
    - `compras.confirmar_borrador` (`POST /compras/borradores/:id/confirmar`, `version`, `Idempotency-Key`): `{ proveedor: { id } | { crear: <POST /proveedores> }, condicion, metodo?, caja_id?…, lineas: [{ indice, producto: { id } | { crear: <POST /productos> } | null, bodega_id?, unidades?, cuenta?, categoria? }] }`. Crea lo que se pidió crear (proveedor con la acción `proveedores.crear`, productos con `productos.crear`; la ruta exige además `compras.registrar` y, si pide crearlos, `proveedores.editar` (el permiso de `POST /proveedores`) o `productos.crear`), arma la entrada de `compras.registrar` (serie y número, fecha, líneas con su total con IVA, cantidad, producto y bodega) y la registra. El borrador queda `confirmado` con `compra_id`.
    - `compras.descartar_borrador` (`POST /compras/borradores/:id/descartar`, motivo).
    - Lecturas: `GET /compras/borradores`, `GET /compras/borradores/:id`, `GET /compras/borradores/:id/archivo` (`compras.ver`).
- **Duplicados.** La misma factura (NIT del emisor, serie y número, sin distinguir mayúsculas) ya registrada en `ledger.compras` de la empresa o en otro borrador confirmado: 409 `compra_duplicada` al cargar (si el archivo los trae) y al confirmar (el mismo 409 de `compras.registrar`).
- **Esquema común** (`ExtraccionCompra`, el del parser XML y el de la IA): `emisor { nit, nombre }`, `receptor { nit, nombre }` (para avisar si la factura no es de la empresa: 422 al confirmar `receptor_distinto`, con `forzar_receptor: true` para seguir), `tipo_documento` (FACT, FCAM, FPEQ, NCRE…), `serie`, `numero`, `autorizacion` (UUID FEL), `fecha` (YYYY-MM-DD), `moneda`, `lineas: [{ codigo?, descripcion, cantidad, unidad?, precio_unitario, descuento, total, iva, bien_o_servicio }]`, `totales { total, iva }`. Montos como texto con 2 decimales (cantidad hasta 3). La IA agrega `confianza` (0 a 1) por campo y por línea. La salida de la IA se valida con el mismo esquema VineJS; si no valida: `ia_fallo: respuesta_invalida`.
- **Parser XML FEL (SAT)**: determinístico, con `htmlparser2` (ya es dependencia; modo XML), sin dependencias nuevas. Lee `dte:GTDocumento/dte:SAT/dte:DTE/dte:DatosEmision`: `DatosGenerales` (Tipo, FechaHoraEmision, CodigoMoneda), `Emisor` (NITEmisor, NombreEmisor o NombreComercial), `Receptor` (IDReceptor, NombreReceptor), `Items/Item` (BienOServicio, Cantidad, UnidadMedida, Descripcion, PrecioUnitario, Precio, Descuento, Impuestos/Impuesto[NombreCorto=IVA]/MontoImpuesto, Total), `Totales` (GranTotal, TotalImpuestos) y `Certificacion/NumeroAutorizacion` (`Serie`, `Numero`, UUID). Un XML que no es un DTE: 422 `archivo` `xml_no_fel`.
- **Coincidencia de productos** (por línea, en la propuesta): 1) `codigo` del proveedor contra `inventario.productos_codigos_proveedor` (`proveedor_id`, `codigo`, `producto_id`; se aprende al confirmar), 2) `codigo` contra el SKU, 3) nombre normalizado (minúsculas, sin tildes ni signos, espacios simples) igual al del producto. Sin coincidencia: propone crear el producto con SKU sugerido (el código del proveedor o uno derivado del nombre), `tipo` `material` (el usuario lo cambia) y la modalidad y el seguimiento de ese tipo. Una línea de servicio (`S`) no propone producto: va a gasto.
- **Proveedor**: por NIT (normalizado) en `ledger.proveedores` de la empresa; si no existe, propone crearlo con NIT y nombre del emisor.
- **Cantidad con decimales**: `compras.registrar` acepta solo cantidades enteras (desvío A.3). Una línea con decimales que va a un producto: 422 al confirmar `lineas.N.cantidad` `cantidad_entera` (se corrige la unidad del producto, o la línea va a gasto).

**IA configurable.**

- `inventario.ia_configuracion`: `empresa_id` (null = global), `proveedor` (`privada` | `anthropic` | `deepseek` | `openai`), `modelo`, `url_base` (obligatoria en `privada`, endpoint compatible con OpenAI: Ollama, vLLM…), `clave_cifrada` (AES-256-GCM `v1` de `#shared/cifrado`), `activo`, `version`. Se usa la de la empresa y, si no hay, la global.
- `inventario.configurar_ia` (`POST /inventario/ia/configuracion`; `admin`; global solo con alcance global): `{ empresa_id?, proveedor, modelo, url_base?, clave_api?, activo, version? }`. `clave_api` se escribe y nunca se lee: `GET /inventario/ia/configuracion` devuelve `clave_configurada: true|false`. En `audit.cambios` la clave va como `***`. Emite `inventario.ia_config_cambiada` (configuracion_id, empresa_id, campos[]; sin valores).
- Interfaz única `ExtractorFactura.extraer({ contenido, tipo }) → { datos: ExtraccionCompra, confianza }` con un adaptador por proveedor, llamados con `fetch` directo (sin SDK): `anthropic` (`/v1/messages`, imagen o documento PDF en base64), `openai`, `deepseek` y `privada` (`/chat/completions` compatible con OpenAI, imagen en `image_url` data URL). El PDF va como documento a Anthropic; para los compatibles con OpenAI se extrae su texto con un lector mínimo propio (flujos `FlateDecode` con `zlib` de Node, operadores `Tj`/`TJ`), sin dependencias; un PDF escaneado sin texto: `ia_fallo: pdf_sin_texto` (subir la imagen). Tiempo máximo 60 s; un error del proveedor no copia su cuerpo (podría repetir la factura o la clave). En pruebas, un extractor falso (`registrarExtractorDePrueba`, solo con `NODE_ENV=test`) y, para el adaptador compatible con OpenAI, un servidor HTTP local de la prueba: CI nunca llama a una API real. El lector de PDF entiende cadenas literales y hexadecimales (las de `pdfkit`). La IA se llama dentro de la transacción de `compras.cargar_borrador` (sin locks tomados todavía); si tarda, la petición tarda.
- El archivo se guarda en el almacén de los comprobantes (`inventario/compras/AAAA/MM/<uuid>.<ext>`) con SHA-256 y tamaño máximo.

### D.6 El técnico, su bodega e Iris

- **Técnico** (contrato Iris 0.5.0 §3.3). `tecnico` es `{ id_externo }` (el id del usuario de Argos; Iris lo toma de `GET /inventario/tecnicos` y guarda su propio vínculo) o `{ correo }` (sin distinguir mayúsculas, solo si coincide con un único usuario activo: si no, 422 `tecnico_ambiguo`; hoy `core.usuarios.email` es único, así que no sale). Si llegan los dos, manda `id_externo`. Sin usuario activo: 422 `tecnico_no_encontrado`. La bodega es la bodega `tecnico` activa del usuario **en la empresa de la operación**: la del servicio; sin servicio, la activa (`X-Empresa-Id`); sin ninguna y con bodegas en varias empresas, 422 `empresa_requerida`; sin bodega en esa empresa, 422 `tecnico_sin_bodega`. Los errores llevan su código en `type` y en `errors[].rule`.
- **`GET /inventario/tecnicos?cursor=&limit=`** (`inventario.ver`): `{ data: [{ id_externo, correo, nombre, bodegas: [{ id, empresa_id, activa }] }], nextCursor }`, solo usuarios con al menos una bodega `tecnico` en las empresas visibles.
- **`GET /inventario/mi-bodega`** (`inventario.ver`): la bodega del actor (o, con `usuario_id`, `id_externo` o `correo`, la de otro técnico, solo con alcance global; si no, 403) en la empresa `empresa_id` o la activa (`X-Empresa-Id`): `{ bodega, existencias[], unidades[] (disponibles y en reparación), traslados_pendientes[] (órdenes en tránsito hacia ella), kardex[] }`. Existencias, unidades y traslados vienen completos; `kardex[]` trae los últimos 50 movimientos, el más reciente primero (el resto con `GET /inventario/movimientos?bodega_id=` y cursor). Sin empresa y con bodegas en varias empresas: `{ bodegas: [...] }` (una por empresa). Sin bodega: 404 `tecnico_sin_bodega`. Cada existencia lleva `modalidad`, igual que `GET /productos` y las líneas de `GET /inventario/traslados/:id`.
- **Consumo, comodato y devolución de una orden de Iris usan la bodega del técnico.** En `POST /inventario/consumos`, `POST /servicios/:id/equipos` y `POST /servicios/:id/equipos/:unidad_id/devolver`, sin `bodega_id` y con `tecnico`, la bodega es la del técnico (la explícita manda y sigue válida en todo 0.x). `tecnico` sin `bodega_id` solo lo manda un usuario con alcance global (Iris); un técnico con alcance acotado responde 403. En el comodato la unidad debe estar en la bodega del técnico (409 `unidad_en_otra_bodega`); el panel puede mandar `bodega_id` opcional con el mismo efecto. La devolución va a la bodega activa del técnico en la empresa del servicio.
- **Recibir traslados desde Iris.** Iris lista con `GET /inventario/traslados?bodega_id=<la del técnico>&estado=en_transito` o en `traslados_pendientes` de `mi-bodega`, confirma con `GET /inventario/traslados/:id` y recibe con `POST /inventario/traslados/:id/recibir` con `{ recibido_por: { id_externo } | { correo }, metodo_recepcion: 'firma_digital', firma: { png_base64, sha256 }, recibido_en, lineas? }` e `Idempotency-Key: iris:recepcion:<traslado_id>` (D.1). El usuario técnico «Iris» necesita `inventario.recibir_traslado` (ya en el contrato 0.5.0 §1.1) y su alcance global de empresas le da el registro en nombre del técnico. Le llegan por webhook `inventario.traslado_enviado`, `_recibido` y `_cancelado` (A6).
- Pedidos (`a3.md`): A1/A2 agregan `inventario.recibir_traslado` a `PERMISOS_IRIS_CONTRATO`; A6 envía los tres eventos de traslado al webhook de Iris (contrato ≥ 0.5.0).

### D.7 Permisos y eventos nuevos

- Permisos: `inventario.crear_traslado`, `inventario.recibir_traslado`, `inventario.cancelar_traslado`, `inventario.adjuntar_documento_traslado`, `inventario.configurar`, `inventario.configurar_ia`, `tipos_producto.crear`, `tipos_producto.editar`, `tipos_producto.desactivar`, `productos.crear_lote`, `compras.cargar_borrador`, `compras.editar_borrador`, `compras.confirmar_borrador`, `compras.descartar_borrador`. Roles: `admin` todo; `contabilidad` todo salvo `inventario.configurar` e `inventario.configurar_ia`; `tecnico` `crear_traslado`, `recibir_traslado`, `cancelar_traslado`. El usuario técnico «Iris» necesita `inventario.recibir_traslado` (pedido en `a3.md`).
- Eventos: `inventario.traslado_enviado`, `inventario.traslado_recibido`, `inventario.traslado_cancelado`, `inventario.ia_config_cambiada` (en `contratos/eventos.md` y el catálogo de `CLAUDE.md`).

### D.8 Lo contable (para el auditor)

Asientos nuevos: **ninguno con cuentas nuevas**.

| Operación | Kardex | Asiento |
| --- | --- | --- |
| Enviar, recibir, devolver faltante, cancelar una orden | pares `traslado` con `origen_tipo = orden_traslado` | Ninguno (todo en `1.1.14`) |
| Consumo `consumible_gasto` | `consumo` | `cuenta_consumo` (5.2.07) / 1.1.14 (igual que hoy) |
| Consumo `consumible_cobro` | `venta` (fase C, `factura_linea_id`) | Costo: `5.6.01 / 1.1.14`, diario VEN. Ingreso: el de todo cargo único `CxC (1.1.03) / ingreso del concepto + IVA débito` |
| Consumo `comodato` | `asignacion_comodato` | `1.2.01.NN / 1.1.14` + alta del activo (igual que hoy) |
| Lote con entrada | `saldo_inicial` | `1.1.14 / 2.9.01` |
| Confirmar borrador | `entrada_compra` | El de `compras.registrar` (línea `bien` con producto a `1.1.14`) |

Checks nuevos propuestos para `verificar_libro.ts`:

- **a.** Todo `traslado_id` suma 0 en cantidad y en `costo_total`, y no tiene `asiento_id`.
- **b.** Por empresa y producto, el saldo de la bodega de tránsito (cantidad y valor) = la suma de las líneas de las órdenes `en_transito` (`cantidad`, `costo_total`); la bodega de tránsito queda en 0 cuando no hay órdenes en tránsito.
- **c.** Cada unidad en la bodega de tránsito está en una línea de una orden `en_transito` con `recibida IS NULL`, y al revés.
- **d.** Cada movimiento con `origen_tipo = orden_traslado` cita una orden de su empresa cuyos origen o destino (o tránsito) son su bodega.
- **e.** Cada borrador `confirmado` tiene su `compra_id`, y cada consumo `consumible_cobro` (movimiento `venta` con `origen_externo` o sin él) tiene su factura vigente o su reverso (ya cubierto por los checks de la fase C).

Lo demás (§8.1 a §8.5) no cambia y sigue verificándose igual.
