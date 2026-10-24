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

Con esto el ISO y el comparador de regímenes dejan de tomar margen bruto 100 %: el costo de ventas sale de `5.6` (§15 #79). A3 lo ajusta en la misma PR.

## 4. Modelo de datos (schema `inventario`)

Todo con `empresa_id`, `created_at`, y `version` en lo editable.

- **`productos`**:
    - Identidad: `sku` (único por empresa), `nombre`, `unidad` (`unidad`, `metro`, `caja`…).
    - `tipo`: `equipo`, `material` u `otro`.
    - `seguimiento`: `cantidad` o `serie`. No cambia si el producto ya tiene movimientos.
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
    - `GET /inventario/movimientos?producto_id=&bodega_id=&desde=&hasta=&tipo=`: el kardex, con saldo corrido por producto.
- **Unidades:**
    - `GET /inventario/unidades?estado=&producto_id=&bodega_id=&servicio_id=&q=` (`q` busca por serie o MAC).
    - `GET /inventario/unidades/:id`: historial de la unidad.
- **Operaciones:**
    - `POST /inventario/consumos` (`inventario.consumir`).
    - `POST /inventario/traslados` (`inventario.trasladar`).
    - `POST /inventario/ajustes` (`inventario.ajustar`).
    - `POST /inventario/bajas` (`inventario.dar_de_baja`).
    - `POST /inventario/saldos-iniciales` (`inventario.cargar_saldo_inicial`).
- **Comodato:**
    - `POST /servicios/:id/equipos` (`inventario.asignar_comodato`).
    - `POST /servicios/:id/equipos/:unidad_id/devolver` (`inventario.devolver_comodato`).
    - `POST /servicios/:id/equipos/:unidad_id/perdida` (`inventario.declarar_perdida_comodato`).
    - `GET /servicios/:id/equipos` (también en la ficha del cliente).
- **Conteos:**
    - `GET /inventario/conteos`.
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
| `inventario.movimiento_registrado` | movimiento_id, empresa_id, tipo, producto_id, bodega_id, cantidad, costo_total, unidad_id (o null), servicio_id (o null), origen_tipo, origen_id |
| `inventario.comodato_asignado` / `inventario.comodato_devuelto` | unidad_id, empresa_id, servicio_id, cliente_id, producto_id, serie, mac; devuelto: condicion, bodega_id |
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
