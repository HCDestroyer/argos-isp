# ledger · Libro contable (A3)

Libro de doble partida inmutable, plan de cuentas, cajas, bancos y egresos. Todo lo que mueve dinero termina aquí.

## Libro por empresa (multiempresa)

- Catálogo de cuentas **común**; cada asiento es de **una** empresa (`ledger.asientos.empresa_id`) y sus saldos son de esa empresa. `registrarAsiento` recibe `empresa_id` (sin él, la empresa activa o la única activa) y rechaza movimientos en subcuentas de otra empresa (`ledger.cuentas.empresa_id`: cajas y cuentas bancarias; 422 rule `cuenta_de_otra_empresa`, también por trigger). Debe = Haber por asiento ⇒ por empresa. Un reverso va al libro del original.
- Periodos por empresa: `ledger.periodo_cerrado(fecha, empresa_id)`; `cerrarPeriodo`/`reabrirPeriodo` reciben `empresa_id` (por defecto la activa) y el resumen del cierre es del libro de esa empresa.
- Cajas por empresa: `POST /cajas` (`cajas.crear`) crea la caja y su subcuenta `1.1.01.NN` de la empresa; el cierre de caja va al libro de su empresa y `caja.cerrada` lleva `empresa_id`. Un cajero que cobra para varias empresas abre una caja en cada una.
- Egresos: la empresa de su caja, cuenta bancaria o banco del libro.
- Consultas: diario, mayor, periodos, bancos y cuentas filtran por las empresas de la petición; `GET /libro/balance` y `GET /libro/estado-resultados` (`estados_financieros.ts`) dan una sección por empresa y el total del grupo (`?empresas=todas`).
- `saldoCliente(cliente, trx?, empresaId?)`: con empresa, el auxiliar de esa empresa; sin ella, el consolidado. `saldoClientePorEmpresa(cliente)`.

## Plan de cuentas

`plan_cuentas.ts` define el plan base y lo siembra `database/seeders/plan_cuentas_seeder.ts` (idempotente). El código se refiere a las cuentas por **código** (`CUENTAS.CXC_CLIENTES`), nunca por id.

| Código        | Cuenta                                                  | Tipo    | Notas                                                               |
| ------------- | ------------------------------------------------------- | ------- | ------------------------------------------------------------------- |
| 1.1.01        | Cajas                                                   | activo  | agrupación; una cuenta hija por caja (`1.1.01.01 Caja principal`)   |
| 1.1.02        | Bancos                                                  | activo  | agrupación; una cuenta hija por banco (`1.1.02.01 Banco principal`) |
| 1.1.03        | Cuentas por cobrar clientes                             | activo  | auxiliar por cliente                                                |
| 2.1.01        | Anticipos de clientes                                   | pasivo  | auxiliar por cliente                                                |
| 2.1.02        | IVA débito fiscal                                       | pasivo  |                                                                     |
| 4.1.01        | Ingresos por servicios de internet                      | ingreso |                                                                     |
| 4.1.02        | Recargos por mora                                       | ingreso |                                                                     |
| 4.1.03        | Otros ingresos                                          | ingreso |                                                                     |
| 5.1.01        | Descuentos                                              | gasto   |                                                                     |
| 5.1.02        | Comisiones de pasarelas                                 | gasto   |                                                                     |
| 5.2.01–5.2.99 | Energía, tránsito, nómina, vehículos, alquileres, otros | gasto   | una por categoría de egreso (`egresos_categorias.cuenta_id`)        |

- `imputable = false`: cuenta de agrupación, no recibe movimientos.
- Localización fiscal (fase 2, `app/fiscal/README.md`): el paquete `gt-2026.1` agrega las cuentas GT (impuestos, activo fijo y depreciación, proveedores, **patrimonio** `3.x`, lealtad, no deducibles, ISR). Columnas nuevas: `pais` (el código es único por país; `cuentasPorCodigo` filtra `PAIS_PLAN = 'GT'`), `contracuenta`, `naturaleza` y `reinicia_anual` (generadas), `categoria_flujo`, `categoria_fiscal`, `auxiliar_proveedor`, `libro_inventario`. Los saldos (mayor, balance) usan la naturaleza: las contracuentas restan del total de su tipo y el balance cuadra con activo = pasivo + patrimonio + resultado.
- `ledger.movimientos.impuesto_codigo` + `cuadricula`: etiqueta de impuesto con signo (`+V_IVA`, de `CUADRICULAS_GT`) en la línea de la base y en la de la cuota (contrato §10.2). `registrarAsiento` la acepta por movimiento y la valida (van juntas; CHECK de formato en la base). Las acciones la irán poniendo en las fases de FEL y declaraciones.
- `auxiliar_cliente = true`: todo movimiento lleva `cliente_id`. **El saldo de un cliente es la suma de sus movimientos en CxC**; no existe columna `saldo`.

## Acciones

| Acción                    | Archivo                        | Qué hace                                                                                                                                 |
| ------------------------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `libro.registrar_asiento` | `actions/registrar_asiento.ts` | Única puerta de entrada al libro. Las demás acciones la llaman anidada: `new RegistrarAsiento().execute(entrada, t.ctx, { trx: t.trx })` |
| `libro.revertir_asiento`  | `actions/revertir_asiento.ts`  | Asiento espejo (debe ↔ haber) con `reversa_de`; única forma de corregir                                                                  |

`registrarAsiento` recibe `{ fecha?, descripcion, origen_tipo, origen_id, movimientos: [{ cuenta (código o id), debe | haber, cliente_id? }] }` con montos como string o `Decimal` (nunca `number`) y valida antes de escribir (422 legibles):

- al menos 2 movimientos, exactamente uno de debe/haber > 0, como máximo 2 decimales (el que llama redondea al final de su cálculo);
- Debe = Haber exacto con decimal.js (`asiento_descuadrado`);
- cuenta existente, activa, imputable; `cliente_id` obligatorio en cuentas con auxiliar;
- `origen_id` obligatorio salvo `ajuste`;
- fecha contable (por defecto hoy en Guatemala) fuera de un mes cerrado (`periodo_cerrado`).

La base de datos lo verifica otra vez: constraint trigger diferido de cuadre (día 1), triggers `asientos_validar` y `movimientos_validar` (periodo cerrado, cuenta, auxiliar), `CHECK` de origen, índice único de reverso, triggers de inmutabilidad y `REVOKE UPDATE, DELETE, TRUNCATE` para `argosisp_app`. La acción ejecuta `SET CONSTRAINTS ledger.asientos_cuadre, ledger.movimientos_cuadre IMMEDIATE` tras insertar, así el descuadre falla **dentro** de la acción (también anidada) y no se pierde en un COMMIT silencioso de knex.

Dinero: `dinero.ts` (`dec`, `redondear`, `aTexto`) sobre decimal.js; fechas contables: `fechas.ts`.

### Reverso de asiento (`POST /libro/asientos/:id/revertir`, `libro.revertir_asiento`)

`{ motivo, fecha? }` + `Idempotency-Key` → 201 `Asiento` (el reverso). Crea el asiento espejo con `reversa_de = :id`; el original nunca se edita.

- Motivo obligatorio (422 por campo).
- Fecha: hoy (o la indicada); nunca anterior al original ni en un mes cerrado (`periodo_cerrado`). Un asiento de un mes cerrado se revierte con fecha de hoy.
- Una sola vez (422 `asiento_revertido`); un reverso no se revierte (422 `asiento_es_reverso`).
- Solo asientos sin documento: `cierre_caja` y `ajuste` manual (sin `origen_id`). Los de `factura`, `mora`, `pago`, `nota_credito`, `egreso` y `ajuste` de saldo inicial responden 422 `reverso_por_documento` con la acción a usar (`reversos.ts`): anular pago, anular factura, anular egreso… Esas acciones llaman `RevertirAsiento` anidada con `por_anulacion: true`.
- `GET /libro/diario` y `GET /libro/asientos/:id` traen `revertido_por`, `revertible` y `motivo_no_revertible` para que el panel muestre (o no) el botón.

## Consultas (`consultas.ts`)

- `saldoCliente(cliente_id)`: suma del auxiliar CxC (debe − haber). Positivo = el cliente debe.
- `libroDiario` (filtros `desde`, `hasta`, `origen_tipo`, `origen_id`; cada movimiento con `cliente_nombre`), `libroMayor` (saldo acumulado por línea, consistente entre páginas), `listarCuentas`.

## Diarios y numeración guardada (`diarios.ts`, contrato de localización fiscal §10.7)

- `ledger.diarios` por empresa: `VEN` ventas, `COB` cobros, `COM` compras y egresos, `IMP`, `CIE`, `VAR`, un `CAJ-<caja>` por caja y un `BAN-<cuenta>` por cuenta bancaria propia. Se crean en la migración para lo existente y, después, cuando un asiento los necesita por primera vez.
- Diario de cada asiento (`diarioDeAsiento`): factura, mora y nota de crédito → `VEN`; ajuste → `VAR`; si toca la cuenta de una caja → `CAJ-n`; la subcuenta de una cuenta bancaria → `BAN-n`; si no, pago → `COB`, egreso → `COM`. `RegistrarAsiento` acepta `diario` (código) para fijarlo; el reverso va al diario de su original.
- **Número** (`numerarAsiento`, en la transacción de `RegistrarAsiento`): `ledger.secuencias` (`diario_id`, `anio`, `ultimo`) con `SELECT … FOR UPDATE` y `ultimo + 1`; se guarda en `ledger.asientos_numeros` (único `diario_id, anio, numero`). Sin huecos ni repetidos: dos asientos simultáneos del mismo diario esperan su turno y un rollback deshace también la secuencia. Un trigger solo deja avanzar la secuencia de uno en uno. Un asiento con fecha anterior no cambia el número de nadie.
- **Partida** del Libro Diario: `ledger.asientos_partidas`, correlativo por empresa y año, se asigna en `cerrarPeriodo` a los asientos del mes que no la tienen, en orden `(fecha, numero, id)`, después de la última del año. Las partidas asignadas nunca cambian. El trigger rechaza una partida de un mes abierto.
- **Reabrir** (decisión del líder, 2026-10-17): solo si ningún mes posterior **cerrado** del mismo año tiene partidas (409 `reapertura_fuera_de_orden`: se reabre del más reciente hacia atrás). Al volver a cerrar, los asientos nuevos del mes reciben las partidas siguientes. Libros emitidos o bloqueo duro impiden reabrir (fase fiscal). **Confirmar con contador**: si las partidas de asientos agregados tras una reapertura pueden ir al final de la secuencia (con el mes posterior también reabierto, quedan después de las de ese mes).
- `GET /libro/diario` y `GET /libro/asientos/:id` traen `diario`, `numero` y `partida` (null con el mes abierto).
- `GET /libro/diarios` (`?empresas=todas`) y `GET /libro/diarios/:id` (`libro.ver`): cada diario con `secuencias[] { anio, ultimo }`. Solo lectura: la edición (`libro.configurar_diarios`, §11.1) no está en el catálogo de permisos todavía.
- Inmutables: `asientos_numeros` y `asientos_partidas` (trigger y `REVOKE`); `secuencias` solo admite `UPDATE (ultimo)`; `diarios` es configuración (`version`).

## Cadena de hash e integridad (`sellos.ts`, contrato de localización fiscal §10.10)

El libro ya es inmutable frente a la aplicación (triggers y `REVOKE`); la cadena prueba además que nadie con acceso a la base lo alteró.

- `ledger.asientos_sellos` (`asiento_id` PK, `empresa_id`, `sello` correlativo por empresa, `version` `v1`, `hash_anterior`, `hash`, `sellado_en`): solo inserción (trigger y `REVOKE`). Un trigger exige que cada fila encadene con el último sello de su empresa (`sello = último + 1`, `hash_anterior = hash del último`, 64 ceros en el primero) y que el asiento sea de esa empresa: la cadena no se bifurca.
- `hash = SHA-256(hash_anterior ‖ json)`, JSON canónico v1 con claves ordenadas: `empresa_id`, `asiento_id`, `fecha`, `diario`, `numero`, `origen_tipo`, `origen_id`, `descripcion`, `reversa_de` y los movimientos en orden de id (`cuenta_codigo`, `debe`, `haber` con 2 decimales, `cliente_id`, `proveedor_id` (null hasta la fase 4), `impuesto_codigo`, `cuadricula`). Lo calcula la aplicación (`calcularHash`).
- **Sellador** `libro.sellar` (`actions/sellar_asientos.ts`): sella en orden de id los asientos confirmados sin sello, por empresa, con `pg_advisory_xact_lock(3006, empresa)`. Lo corre el cron `sellar` del `billing:worker` cada minuto (con el lock de los crons; si no hay asientos pendientes no llama la acción) y `cerrarPeriodo` (anidado). Antes de encadenar recalcula el último sello: si no coincide emite `libro.integridad_rota`. La cadena sigue el orden de sellado, no el de los ids.
- `libro.verificar_integridad` (`actions/verificar_integridad.ts`, cron `integridad` diario a las 02:15 de Guatemala): recalcula la cadena completa de cada empresa y emite `libro.integridad_rota` con la primera ruptura. El aviso sale una vez por (empresa, sello).
- `GET /libro/integridad?desde&hasta` (`libro.ver`, `?empresas=todas`): una sección `IntegridadLibro` por empresa con `verificado`, `sellos`, `verificados`, `sin_sellar`, primer y último sello y hash, y la primera `ruptura` (`hash_distinto`, `encadenamiento`, `sello_faltante`, `asiento_inexistente`, `cierre_distinto`). El encadenamiento se revisa siempre completo; el hash se recalcula para los asientos con fecha en el rango (sin rango, todos). Es una lectura: no emite.
- **Inserción en un mes cerrado** (hallazgo H10): un sello posterior al `ultimo_sello` del cierre vigente de un mes con un asiento de ese mes es la ruptura `asiento_en_mes_cerrado`; el sellador lo sella y emite `libro.integridad_rota`. `GET /libro/integridad` acepta también `desde_sello`/`hasta_sello`.
- **Cierre mensual**: sella lo pendiente de la empresa, recalcula la cadena y, si no verifica (o queda algo sin sellar), responde 409 `integridad_rota`. El cierre guarda `ultimo_sello` y `ultimo_hash` (columnas nuevas de `ledger.cierres_mensuales`, null en los anteriores) y la verificación comprueba que ese hash siga en la cadena.

## Cajas y turnos (tarea 9, `cajas.ts`)

| Acción         | Archivo                  | Qué hace                                                                                                                                                                                                                                                                                            |
| -------------- | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cajas.abrir`  | `actions/abrir_caja.ts`  | Abre un turno con `fondo_inicial` y `abierto_por`. Uno abierto por caja (409 `turno_abierto`). Sin asiento: el fondo ya está en la cuenta de la caja                                                                                                                                                |
| `cajas.cerrar` | `actions/cerrar_caja.ts` | `esperado = fondo_inicial + Σ pagos vigentes del turno − egresos − depósitos del turno`, `diferencia = contado − esperado`. Diferencia ≠ 0 exige `motivo` (422) y deja asiento `cierre_caja`: faltante `5.2.06 Faltantes de caja / Caja`, sobrante `Caja / 4.1.04 Sobrantes de caja`. Emite `caja.cerrada`. 409 `sin_turno_abierto` |

- Cada pago en efectivo guarda el turno abierto de su caja (`billing.pagos.turno_id`, con `FOR SHARE` frente al cierre). `POST /pagos` con `caja` sin `caja_id` usa la caja del turno abierto del cajero (`cajaDelCajero`: el que él abrió o una caja asignada a él, dentro de su alcance) y, si no tiene, la principal.
- Alcance ACL por caja (`exigirAlcance` / `filtrarPorAlcance` de `#core/acl`): un cajero con el rol acotado a su caja solo la lista, la abre, la cierra, ve sus turnos y cobra en ella (403 en otra).
- Nombres para el panel: `CajaTurno.abierto_por_nombre`/`cerrado_por_nombre`; `Caja.cajero_nombre`, `turno_abierto_por` y `turno_abierto_por_nombre`.
- Un pago anulado después de cerrar su turno no cambia ese cierre (el reverso sale de la caja en el libro).
- Un turno cerrado es inmutable (hallazgo H3): el trigger `cajas_turnos_inmutable` rechaza DELETE, cualquier UPDATE de un turno con `cerrado_en` y, en el abierto, todo UPDATE que no sea su cierre o que cambie los datos de apertura; TRUNCATE también se rechaza. `argosisp_app` no tiene DELETE ni TRUNCATE y su UPDATE se limita a las columnas del cierre.

## Cierre mensual (`cierres.ts`)

| Acción                  | Archivo                      | Permiso                 | Qué hace                                                                                                                                                                                  |
| ----------------------- | ---------------------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `libro.cerrar_periodo`  | `actions/cerrar_periodo.ts`  | `libro.cerrar_periodo`  | `cerrarPeriodo(anio, mes)`: solo meses terminados (422 `periodo_en_curso`), 409 `periodo_cerrado` si ya lo está. Antes verifica y exige la lista de verificación del mes (422 `checks_pendientes`, abajo). Guarda el resumen del mes (asientos, debe, haber, movimiento por cuenta) |
| `libro.reabrir_periodo` | `actions/reabrir_periodo.ts` | `libro.reabrir_periodo` | Con motivo obligatorio; agrega `ledger.reaperturas_mensuales` (no borra el cierre). 409 `periodo_abierto`. Se puede volver a cerrar (cierre nuevo)                                        |

- Un mes está cerrado si tiene un cierre sin reapertura: `ledger.periodo_cerrado(fecha)`, la misma función en la acción (`registrarAsiento`) y en los triggers de asientos y movimientos. Después del cierre ningún asiento puede tener fecha en el mes, **ni siquiera un reverso**: `RevertirAsiento` usa la fecha de hoy (periodo abierto) y con una fecha del mes cerrado responde 422.
- `cierres_mensuales` y `reaperturas_mensuales` son inmutables (trigger de UPDATE/DELETE/TRUNCATE y `REVOKE`); un trigger impide cerrar un mes ya cerrado.
- `cerrar_periodo` está en `contabilidad`; `reabrir_periodo` solo en `admin`. Bajo el bloqueo duro ningún mes se reabre (409 `bloqueo_duro`).

## Bloqueos por tipo y excepciones (fase 6, `bloqueos.ts`, contrato de localización fiscal §9.2 y §10.4)

| Acción | Archivo | Permiso | Qué hace |
| --- | --- | --- | --- |
| `libro.bloquear` | `actions/bloquear_libro.ts` | `libro.bloquear` | `POST /libro/bloqueos { tipo, hasta, motivo }`: `global`, `ventas`, `compras` o `impuestos`. Solo avanza (422 `bloqueo_regresivo`), no futuro (422 `bloqueo_futuro`), nunca antes del duro (422 `bloqueo_bajo_duro`) |
| `libro.desbloquear` | `actions/desbloquear_libro.ts` | `libro.desbloquear` | `POST /libro/bloqueos/desbloquear { tipo?, hasta?, motivo }`: mueve atrás o quita (`hasta` null) el `global` (por defecto), `ventas` o `compras`. Impuestos no retrocede (422, se usa una excepción); duro nunca (409). 409 `sin_bloqueo` |
| `libro.bloquear_duro` | `actions/bloquear_duro.ts` | `libro.bloquear_duro` (solo `admin`) | `POST /libro/bloqueos/duro { hasta, motivo, confirmacion }`: `confirmacion` = «BLOQUEO DURO hasta AAAA-MM-DD» (422 `confirmacion_invalida`); solo avanza; requisitos (422 `bloqueo_duro_requisitos`, `rule` = `meses_abiertos`, `dte_pendientes`, `extractos_sin_conciliar`) y la lista de verificación (422 `checks_pendientes`, abajo) |
| `libro.excepcion_bloqueo` | `actions/crear_excepcion_bloqueo.ts`, `actions/revocar_excepcion_bloqueo.ts` | `libro.excepcion_bloqueo` (solo `admin`) | `POST /libro/bloqueos/excepciones { tipo, usuario_id?, motivo, hasta_en }` (sin fin o sobre el duro: 422 `excepcion_sin_fin`) y `POST .../:id/revocar { motivo }` (409 `excepcion_revocada`) |

- Tablas (solo inserción, trigger y `REVOKE`): `ledger.bloqueos` (el vigente de cada tipo es la última fila; `anterior` lo escribe el trigger), `ledger.bloqueos_excepciones`, `ledger.bloqueos_excepciones_revocaciones` (la lista `ledger.cuentas_con_impuesto` de la fase 6 se eliminó en la fase 7 PR B: el bloqueo de impuestos va por las etiquetas de §10.2).
- **A qué asiento aplica cada tipo** (`ledger.bloqueo_de(fecha, empresa, diario, origen, con_impuesto, usuario, excepcion)`, la misma función en la acción y en los triggers): `duro` y `global` a todo; `ventas` al diario de ventas; `compras` al diario de compras y a las compras y pagos a proveedores aunque vayan a una caja o banco; `impuestos` a todo asiento con alguna partida etiquetada (fase 7 PR B; las ventas llevan `V_IVA` en su `2.1.02`, las compras `C_*`, los pagos con constancia `RET_*`; un reverso copia la etiqueta con el signo contrario). El mes cerrado se sigue informando como `cerrado`.
- **`RegistrarAsiento`**: mes cerrado → 422 `periodo_cerrado`; duro → 409 `bloqueo_duro`; otro tipo → la excepción vigente del usuario (o para todos) de ese tipo, que queda en `ledger.asientos.excepcion_id`, o 422 `periodo_bloqueado` con `errors[0].rule` = el tipo. Una excepción cubre solo su tipo.
- **Asientos automáticos** (`trasladar_si_bloqueado`): no fallan; van al primer día abierto (`ledger.primer_dia_abierto`) y guardan su fecha real en `ledger.asientos.fecha_documento`. Los usan la reclasificación de `2.1.11` y la confirmación de una factura `por_certificar`, la liquidación de cobros, la llegada de un tránsito al conciliar, la partida desde el extracto, la depreciación, los diferidos y su asiento inicial. Las facturas y la mora del cron no se trasladan: ver `app/billing/README.md` (quedan pendientes y se avisa con `libro.proceso_bloqueado`).
- **Triggers en dos niveles**: inmediato en `asientos` y `movimientos` (duro, mes cerrado, global, compras por origen) y diferido (`asientos_bloqueo`, constraint trigger `INITIALLY DEFERRED`) con el diario y los movimientos ya escritos. `RegistrarAsiento` lo dispara al terminar (`SET CONSTRAINTS ... IMMEDIATE`), así el error sale de la acción; una inserción directa falla en el `COMMIT`.
- El periodo del IVA de una compra que cae en un mes cerrado o bloqueado pasa al mes actual; un parámetro fiscal con `vigente_desde` bajo un bloqueo `global`, `impuestos` o `duro` responde 422 `vigencia_en_periodo_bloqueado`.
- Lecturas (`libro.ver`): `GET /libro/bloqueos` (vigentes por tipo de cada empresa), `/libro/bloqueos/historial`, `/libro/bloqueos/excepciones?estado=vigente|vencida|revocada`.
- Emite `libro.bloqueo_cambiado { empresa_id, tipo, hasta, anterior }`.

## Lista de verificación de cierre (fase 6 · PR B, `checks.ts`, contrato de localización fiscal §10.5)

| Acción | Archivo | Permiso | Qué hace |
| --- | --- | --- | --- |
| `cierres.verificar` | `actions/verificar_cierre.ts` | `cierres.verificar` (`admin`, `contabilidad`) | `POST /libro/cierres/:tipo/:periodo/verificar { empresa_id }` (`tipo` `mensual` con `AAAA-MM`, `anual` con `AAAA`; otro tipo: 404). Toma el candado de cierres, sella los asientos pendientes y corre los checks automáticos del tipo. Escribe una fila nueva solo si `esperado`, `obtenido` o `resultado` cambió respecto de la última automática de esa clave. Devuelve `{ checks, anomalias }` y emite `libro.checks_verificados` |
| `cierres.revisar_check` | `actions/revisar_check.ts` | `cierres.revisar_check` (`admin`, `contabilidad`) | `POST /libro/cierres/checks/:id/revisar { estado, nota }` (201): `supervisado` deja pasar el cierre con esa anomalía (nota obligatoria, queda `revisado_por`); `anomalia` retira la supervisión. 409 `check_desactualizado` si la fila ya no es la vigente de su clave, 422 `check_en_orden` si el check está ok, 409 `check_sin_cambio` |

- Lectura (`libro.ver`): `GET /libro/cierres/:tipo/:periodo/checks?empresa_id=&historial=` → `{ checks (vigente por clave, en el orden del catálogo), sin_verificar[], pasan, historial? }`.
- **Checks mensuales**: `cxc_antiguedad`, `cxc_auxiliar`, `cxp_antiguedad`, `apertura_cero`, `iva_por_certificar`, `turnos_cerrados`, `fondos_transito`, `cobros_por_liquidar`, `extractos_conciliados`, `dte_pendientes`, `por_certificar` (aviso: nunca bloquea), `compras_sin_periodo`, `secuencias_sin_huecos`, `hash_verificado` y `depreciacion_al_dia`. **Anuales**: `incobrables` (estimación de `1.1.12` ≤ base × `reserva_incobrables_max`; sin localización instalada solo pasa con estimación cero), `resultados_cero` (ingresos, gastos, `3.3.03` y `3.3.02` en cero al 31-dic: pasa con el ejercicio cerrado) y `comprobacion_cuadra` (balance de comprobación del año cuadrado antes y después del cierre). **De impuestos** (fase 7 PR B, con las declaraciones de `app/fiscal`): `iva_cuadrado` e `iva_liquidado`; `declaraciones.revisar` los exige. Los orígenes `liquidacion_impuesto` y `pago_impuesto` van al diario `IMP` (o al del banco).
- Los checks que comparan saldos con documentos (cartera, proveedores, `2.1.11`, tránsito, cobros por liquidar) miran el estado al verificar, igual que los reportes que comparan; los demás miran el periodo.
- **Exigencia** (`exigirChecks`, 422 `checks_pendientes`, un `errors[]` por check con `field` = clave y `rule` = `checks_pendientes`): `cerrarPeriodo` verifica y exige los mensuales del mes. El bloqueo duro exige los del mes de `hasta` y, si el duro cruza un fin de año nuevo, también los anuales de ese año. Un check pasa si está `revisado` o `supervisado`.
- Tabla `ledger.cierres_checks` (solo inserción, trigger y `REVOKE`; la vigente de cada clave es la última fila; `valor_esperado` y `valor_obtenido` son texto y la API los da como `esperado` y `obtenido`). `turnos_cerrados` cuenta los turnos abiertos en el periodo. Restricciones: `supervisado` exige nota; `ok` solo con `revisado`; `anomalia` con `anomalia` o `supervisado`.
- Trigger inmediato de `movimientos` (observación del auditor a la PR A): también aplica `ledger.bloqueo_de` con el diario del asiento y si el movimiento lleva impuesto, así que una línea insertada a mano bajo un bloqueo de ventas, compras o impuestos se rechaza al instante.

## Cierre anual y balance de comprobación (fase 6 · PR C, `ejercicios.ts`, `comprobacion.ts`, contrato §9.1 y §10.8)

| Acción | Archivo | Permiso | Qué hace |
| --- | --- | --- | --- |
| `libro.cerrar_ejercicio` | `actions/cerrar_ejercicio.ts` | `libro.cerrar_ejercicio` | `POST /libro/ejercicios/cerrar { anio, empresa_id?, isr { monto, acreditado_trimestral?, acreditado_iso?, nota? } }` (201). El ISR lo escribe el usuario (obligatorio, `0.00` si no hay; acreditados ≤ saldo de `1.1.07`/`1.1.08` al 31-dic y ≤ ISR, 422 `isr_acreditable`). Requisitos (422 `ejercicio_requisitos`, `rule` = `meses_abiertos`, `diciembre_cerrado`, `dte_pendientes`, `ejercicio_anterior_abierto`); 409 `ejercicio_cerrado` |
| `libro.reabrir_ejercicio` | `actions/reabrir_ejercicio.ts` | `libro.reabrir_ejercicio` (solo `admin`) | `POST /libro/ejercicios/reabrir { anio, motivo }`: agrega la reapertura, reabre diciembre y revierte los asientos del cierre con fecha 31-dic. 409 `ejercicio_abierto`, `bloqueo_duro`, `reapertura_fuera_de_orden` (año siguiente cerrado) |

- Asientos (fecha 31-dic, diario `CIE`, origen `cierre_anual`, `origen_id` = el cierre): provisión del ISR `5.5.01 / 1.1.07 + 1.1.08 + 2.1.07`; cancelación de cada ingreso y gasto del año contra `3.3.03`; `3.3.03 → 3.3.02`; `3.3.02 → 3.3.01`; reserva legal `3.3.01 / 3.2.01` (`reserva_legal_pct` × la base de `reserva_legal_base`, solo con utilidad). Después cierra diciembre (`cerrar_periodo` anidada, con sus checks mensuales) y verifica y exige los checks anuales (422 `checks_pendientes`; una anomalía revierte todo el cierre). Emite `ejercicio.cerrado` y `ejercicio.reabierto`.
- Tablas (solo inserción, trigger y `REVOKE`): `ledger.cierres_anuales` (ISR, `resultado_antes_isr`, `resultado`, `reserva_legal`, `resumen`) y `ledger.reaperturas_anuales`. `ledger.ejercicio_cerrado(fecha, empresa)` = cierre sin reapertura; un trigger impide dos vigentes. Con el ejercicio cerrado ningún mes del año se reabre (409 `ejercicio_cerrado`) y sus asientos no se revierten directo.
- Lecturas (`libro.ver`): `GET /libro/ejercicios` (consolidable, `estado`, `anio`), `GET /libro/ejercicios/:id` (con `asientos[]`) y `GET /libro/comprobacion?desde&hasta&sin_cierre_anual` (por cuenta y grupo; `cuadra`). El estado de resultados excluye la partida de cierre (los asientos del cierre que tocan `3.3.03`) y su reverso; el balance separa `resultado_ejercicios_sin_cerrar` de `resultado_ejercicio`.

## Libros legales con folio (fase 6 · PR D)

Viven en `app/fiscal` (`libros_legales.ts`, `libros_pdf.ts`, `libros_emisiones.ts`; ver su README): leen `ledger.asientos`, `movimientos`, `asientos_partidas`, `asientos_numeros`, `ledger.compras` y `ledger.cierres_mensuales` (último sello y hash del mes) y exigen meses cerrados con bloqueo `global` o `duro`. No escriben en `ledger`.

## Egresos (`egresos.ts`)

| Acción              | Archivo                       | Qué hace                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `egresos.registrar` | `actions/registrar_egreso.ts` | Gasto con categoría (`energia`, `transito`, `nomina`, `vehiculos`, `alquileres`, `otros` → su cuenta `5.2.xx`), monto, fecha (hoy por defecto, no futura), proveedor, descripción y `comprobante` opcional (número del documento). Método: `caja` (`caja_id`; sin ella, la del turno abierto del usuario o la principal), `banco` (`banco_id` del libro; por defecto el principal) o `cuenta_bancaria` (propia, activa y GTQ). Asiento `Gasto / Caja \| Banco \| subcuenta` con origen `egreso` |
| `egresos.anular`    | `actions/anular_egreso.ts`    | Motivo obligatorio; `RevertirAsiento` con fecha de hoy y fila en `ledger.egresos_anulaciones`. 409 `egreso_anulado`                                                                                                                                                                                                                                                                                                                                                                             |

- Inmutable como el libro: `ledger.egresos` y `ledger.egresos_anulaciones` rechazan UPDATE/DELETE (trigger y `REVOKE`). El estado (`registrado`/`anulado`) y el asiento se derivan (por origen), no se escriben en la fila.
- Efectivo: el egreso queda en el turno abierto de la caja (`turno_id`) y `cerrarCaja` lo resta del esperado (`fondo + cobros − egresos vigentes del turno`).
- Alcance por caja: un usuario con rol acotado a una caja solo ve y registra egresos de esa caja.

## Endpoints

| Método | Ruta                                                                  | Permiso        |
| ------ | --------------------------------------------------------------------- | -------------- |
| GET    | `/api/v1/libro/cuentas`                                               | `libro.ver`    |
| GET    | `/api/v1/libro/diarios`, `/api/v1/libro/diarios/:id`                  | `libro.ver`    |
| GET    | `/api/v1/libro/diario?desde&hasta&origen_tipo&origen_id&cursor&limit` | `libro.ver`    |
| GET    | `/api/v1/libro/mayor?cuenta_id&cliente_id&desde&hasta&cursor&limit`   | `libro.ver`    |
| GET    | `/api/v1/libro/bancos` (origen `banco_id` de los egresos)             | `egresos.ver`  |
| GET    | `/api/v1/cajas`                                                       | `cajas.ver`    |
| POST   | `/api/v1/cajas`                                                       | `cajas.crear`  |
| GET    | `/api/v1/libro/balance?hasta`, `/api/v1/libro/estado-resultados`      | `libro.ver`    |
| POST   | `/api/v1/cajas/:id/abrir`                                             | `cajas.abrir`  |
| POST   | `/api/v1/cajas/:id/cerrar`                                            | `cajas.cerrar` |
| GET    | `/api/v1/cajas/:id/turnos?cursor&limit`                               | `cajas.ver`    |

## Cobros y bancos (fase 4, contrato de localización fiscal §10.3 y §10.9)

Detalle y desvíos en §18 del contrato. Todo de solo inserción (trigger y `REVOKE`) salvo la configuración (`proveedores_cobro`, `reglas_conciliacion`: `version` y `audit.cambios`). Las cuentas bancarias se piden como `cuenta_bancaria_id`, `banco_id` o `cuenta_id` (`cuentas_banco.ts`); el libro guarda la subcuenta `1.1.02.NN`.

| Acción (permiso) | Ruta | Asiento |
| --- | --- | --- |
| `cobros.crear_proveedor`, `cobros.editar_proveedor` (`cobros.configurar`) | `GET/POST /cobros/proveedores`, `PUT /cobros/proveedores/:id` | Crea la subcuenta `1.1.10.NN`; `desde` = fecha de corte. Se activa por empresa; con pagos, `desde` y la desactivación responden 409 `proveedor_con_pagos` |
| `cobros.liquidar` | `POST /cobros/liquidaciones` | `Banco (neto) + 5.1.02 (comisión) / 1.1.10.NN (bruto)`; bruto = Σ pagos − contracargos; con solo contracargos (bruto ≤ 0) el proveedor debita el banco |
| `cajas.depositar` | `POST /cajas/:id/depositar` | `1.1.11 / Caja`; baja el esperado del turno |
| `bancos.trasladar` | `POST /bancos/trasladar` | `1.1.11 / Banco A` (misma empresa) |
| `bancos.importar_extracto` | `POST /bancos/extractos` | Ninguno (neutral al origen; huella única por cuenta) |
| `bancos.conciliar` | `POST /bancos/conciliaciones` | Ninguno sobre lo existente; la llegada de un depósito o traslado es un asiento nuevo `Banco / 1.1.11` |
| `bancos.anular_conciliacion` (`bancos.conciliar`) | `POST /bancos/conciliaciones/:id/anular` | Ninguno (fila de anulación por fila del grupo) |
| `bancos.reatribuir_llegada` | `POST /bancos/llegadas/reatribuir` | Reverso de la llegada equivocada y llegada nueva del documento correcto (`ledger.transitos_reatribuciones`) |
| `bancos.registrar_desde_extracto` (`bancos.conciliar`) | `POST /bancos/extractos/lineas/:id/registrar` | Nuevo, origen `banco`: `5.3.07 / Banco` (cargo) o `Banco / contrapartida` (abono) |
| `bancos.crear_regla`, `bancos.editar_regla`, `bancos.aplicar_reglas` (`bancos.conciliar`) | `GET/POST/PUT /bancos/reglas`, `POST /bancos/extractos/:id/aplicar-reglas` | El de `registrar_desde_extracto` (acción contrapartida) |
| `cartera.provisionar` | `POST /cartera/provisionar` | `5.3.02 / 1.1.12` hasta el tope (`reserva_incobrables_max` de los saldos deudores); la reserva se mide al corte y un corte anterior al último responde 422 `provision_fuera_de_orden` |
| `cartera.castigar` | `POST /cartera/castigos` | `2.1.11 (IVA de avisos sin DTE) + 1.1.12 (o 5.3.02) / CxC`; la factura queda `castigada` (pagado intacto). Lo cobrado después es recuperación: `Caja/Banco / 4.2.03` hasta lo castigado |

- `registrarPago`: pasarela, agente o débito de un proveedor activo (desde su fecha de corte) → su `1.1.10.NN` por el bruto, sin comisión (`pagos.proveedor_cobro_id`); sin proveedor, al banco como antes.
- Lecturas (`bancos.ver`): `GET /cobros/por-liquidar` (puente = pagos sin liquidar − contracargos, antigüedad sobre `cobros_liquidar_dias`), `/cobros/liquidaciones[/:id]`, `/bancos/depositos`, `/bancos/traslados`, `/bancos/fondos-en-transito` (`1.1.11` = sin acreditar), `/bancos/extractos[/:id][/lineas]`, `/bancos/movimientos-sin-conciliar`, `/bancos/reglas`. `reportes.ver`: `GET /reportes/conciliacion-bancaria`, `/cartera/provisiones`, `/cartera/castigos`.
- Errores: 409 `proveedor_cobro_duplicado`, `pago_ya_liquidado`, `liquidacion_duplicada`, `deposito_duplicado`, `traslado_duplicado`, `extracto_duplicado`, `linea_conciliada`, `movimiento_conciliado`, `conciliacion_anulada`, `linea_registrada`, `sin_turno_abierto`; 422 `liquidacion_descuadrada`, `deposito_excede_efectivo`, `extracto_descuadrado`, `extracto_no_encadena`, `conciliacion_descuadrada`, `castigo_sin_evidencia`, `cuenta_de_otra_empresa` (por campo).
- Eventos: `cobros.liquidados`, `caja.depositada`, `banco.extracto_importado`, `banco.conciliado`, `cartera.castigada`.
- Diarios: `liquidacion_cobro` → `COB` (o `BAN-n` si va a una cuenta propia), depósito → `CAJ-n`, el resto `BAN-n` o `VAR`. Los asientos de estos orígenes no se revierten directo (`reversos.ts`).
- Pruebas: `tests/ledger/cobros_liquidar.spec.ts`, `depositos_traslados.spec.ts`, `conciliacion_bancaria.spec.ts`, `cartera.spec.ts`, `rutas_bancos.spec.ts`; cada una termina en `afirmarLibro` (el auditor completo, con los invariantes de la fase 4 que agregó el auditor).

## Compras, proveedores, retenciones, activos y diferidos (fase 5, contrato §3.4, §3.5 y §10.10)

Detalle y desvíos en §19 del contrato. Todo de solo inserción (trigger y `REVOKE`) salvo `ledger.proveedores` (`version` y `audit.cambios`). `ledger.movimientos.proveedor_id` es el auxiliar de `2.1.03 Proveedores` (obligatorio por trigger, de la empresa del asiento); el saldo de un proveedor es la suma de su auxiliar.

| Acción (permiso) | Ruta | Asiento |
| --- | --- | --- |
| `proveedores.crear`, `proveedores.editar` (`proveedores.editar`) | `GET/POST /proveedores`, `GET/PUT /proveedores/:id` | Ninguno (NIT con el validador del núcleo; documento de solo lectura) |
| `compras.registrar` | `POST /compras` | Origen `compra`: `Gasto/Activo (+IVA sin crédito) + 1.1.04 / Caja·Banco (contado, crea su egreso) o 2.1.03 (crédito) + 2.1.04 + 2.1.05`; NCRE al revés |
| `compras.registrar_desde_egreso` (`compras.registrar`) | `POST /compras/desde-egreso/:egresoId` | Origen `compra` (reclasificación): `líneas + 1.1.04 / cuenta del egreso + retenciones`; el asiento del egreso no se toca |
| `compras.anular` | `POST /compras/:id/anular` | Reverso con etiquetas en signo contrario; al contado anula su egreso con el mismo reverso |
| `compras.registrar_constancia` (`compras.registrar`) | `POST /compras/:id/constancias` | Ninguno (la retención ya está en 2.1.04/2.1.05) |
| `compras.pagar` / `compras.anular_pago` (`compras.pagar`) | `POST /pagos-proveedores`, `POST /pagos-proveedores/:id/anular` | Origen `pago_proveedor`: `2.1.03 / Caja·Banco`; la compra más antigua primero |
| `activos.registrar` | `POST /activos` | Origen `alta_activo`: `1.2.01.NN / 1.2.02.NN (inicial) + 2.9.01·3.1.01·3.3.01` |
| `activos.depreciar` (`activos.registrar`; cron `depreciar`) | `POST /activos/depreciar` | Origen `depreciacion`: `5.3.01 / 1.2.02.NN`, una cuota por activo y mes |
| `activos.dar_de_baja` | `POST /activos/:id/dar-de-baja` | Origen `baja_activo`: `1.2.02 + Banco (precio) + 5.3.06 / 1.2.01 + 4.2.02` |
| `libro.registrar_diferimiento` (`libro.registrar_asiento`) | `POST /diferimientos` | Origen `diferido`: `Ingreso / 2.1.12` (factura) o `1.1.13 / Gasto` (compra) |
| `libro.amortizar_diferidos` (`libro.registrar_asiento`; cron `diferir`) | `POST /diferimientos/amortizar` | Origen `diferido`: `Gasto / 1.1.13` o `2.1.12 / Ingreso`, una cuota por diferimiento y mes |

- Una línea `activo_fijo` de una compra da de alta su activo y una con `diferir_meses` va a `1.1.13` con su diferimiento, en la misma transacción (`altas_compra.ts`).
- Crédito fiscal por `periodo_iva` dentro de `credito_fiscal_ventana_meses` (422 `credito_fiscal_extemporaneo`); FPEQ, FCAP y RECIBO sin IVA ni crédito. Fecha contable = max(fecha del documento, inicio de `periodo_iva`): el libro de compras de cada mes cuadra con `1.1.04` (`GET /libros/compras`, `GET /libros/compras/cuadre`, `#fiscal/libros`).
- Retenciones emitidas sugeridas (`retenciones.ts`): agente de IVA → `RET_IVA_ESP_C` desde `ret_iva_minimo` o `RET_IVA_PEQ_C`; régimen opcional → `RET_ISR_OPC_C`; las demás, pedidas. Recibidas: `POST /pagos` con `retenciones[]` (constancias del cliente a `1.1.05`/`1.1.06`; `billing.pagos.retenido`).
- Lecturas: `GET /compras[/:id]`, `/constancias`, `/pagos-proveedores[/:id]`, `/proveedores/:id/estado-cuenta` (`proveedores.ver`), `/reportes/cuentas-por-pagar` (`reportes.ver`, cuadra con 2.1.03), `/activos[/:id]` (`activos.ver`), `/diferimientos[/:id]` (`libro.ver`).
- El esperado del turno de caja resta los pagos a proveedores en efectivo y cuenta solo el efectivo de los pagos con constancias.
- Errores: 409 `proveedor_duplicado`, `compra_duplicada`, `compra_anulada`, `compra_con_notas`, `compra_con_pagos`, `compra_con_constancia`, `egreso_de_compra`, `egreso_con_compra`, `egreso_anulado`, `pago_anulado`, `constancia_duplicada`, `constancia_registrada`, `activo_dado_de_baja`, `activo_con_cuotas`, `diferido_con_cuotas`, `linea_diferida`, `factura_diferida`, `factura_no_emitida`; 422 `credito_fiscal_extemporaneo`, `ncre_excede_saldo`, `compra_distinta_del_egreso`, `pago_excede_saldo`, `tasa_sobre_tope`, `retencion_en_cobro_repartido`, `retencion_con_proveedor_cobro`, `retencion_sin_documento_fiscal` (H19), `pago_anterior_a_compra`, `periodo_cerrado` (baja retroactiva con una cuota en un mes cerrado, H20) y por campo (`documento_no_permitido`, `credito_no_permitido`, `cuenta_compra`, `retencion`, `mes_terminado`).
- Pruebas: `tests/ledger/compras.spec.ts`, `retenciones.spec.ts`, `pagos_proveedores.spec.ts`, `activos.spec.ts`, `diferidos.spec.ts`; `hallazgos_fase5.spec.ts` (H19, H20 y las observaciones del auditor); cada una termina en `afirmarLibro` (el auditor completo, con los invariantes `15.*` de la fase 5).
- Baja retroactiva (H20): revierte las cuotas vigentes del mes de la baja en adelante, cada una en su mes (422 `periodo_cerrado` si alguno está cerrado). Locks: `LOCK_ACTIVO` (depreciación, baja y anulación de la compra), `LOCK_DIFERIDO` (amortización y anulación de la compra), `LOCK_COMPRA` (pagos, constancias y anulación).

## Eventos

Emite: `ejercicio.cerrado`, `ejercicio.reabierto`, `libro.checks_verificados { empresa_id, tipo, periodo, anomalias }` y `libro.bloqueo_cambiado` (fase 6, arriba); `compra.registrada`, `compra.anulada`, `activo.dado_de_baja` (fase 5, arriba); `cobros.liquidados`, `caja.depositada`, `banco.extracto_importado`, `banco.conciliado` y `cartera.castigada` (fase 4, arriba); `caja.cerrada` (`caja_id`, `empresa_id`, `cajero_id` = cajero asignado o quien abrió, `esperado`, `contado`, `diferencia`) y `libro.integridad_rota` (`empresa_id`, `sello`, `asiento_id`, `esperado`, `obtenido`; sellador y verificación diaria, una vez por empresa y sello). Consume: ninguno.
- `GET /bancos/depositos?caja_id=&turno_id=` (permiso `bancos.ver` **o** `cajas.ver`, `autorizarLecturaDeCaja` de `lectura_caja.ts`): con `bancos.ver`, todos; con solo `cajas.ver` (el cajero), `caja_id` o `turno_id` obligatorio y la caja en su alcance (403; sin filtro 422); sin ninguno, 403.
- `GET /egresos?caja_id=&turno_id=` (permiso `egresos.ver` **o** `cajas.ver`, mismo patrón): con solo `cajas.ver` el cajero lee los egresos de su caja o turno para el esperado provisional de /caja.
