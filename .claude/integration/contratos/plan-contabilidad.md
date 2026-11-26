# Plan de contabilidad: análisis, propuesta y lotes

Estado: **propuesta, pendiente de aprobación del PM** (26 nov 2026). Rama `lider/plan-contabilidad`, sobre `main` en `d86d5602`.
Este documento no cambia código. Lo ejecutan A3 (backend), A4 (panel) y el auditor (`apps/api/tests/contabilidad/`).

- Tableros: `.claude/diseno/tableros/Plan*.dc.html` (generador `.claude/diseno/generadores/conta_plan.py`).
- Imágenes: `.claude/diseno/capturas/contabilidad/antes/` (panel de hoy, con fixtures) y `.../propuesta/` (tableros).
- Decisiones por aprobar: sección «Contabilidad (pendiente de aprobación del PM)» de `.claude/diseno/decisiones-pm.md`.

Pedido del PM: contabilidad con mejor lógica y un flujo más práctico; que se sepa por dónde empieza y por dónde termina; que no haya funciones escondidas; que la entienda alguien con poca noción contable; botones como «crear factura al cliente» a la vista; tomar ideas de un sistema contable de referencia (Zoho Books): tipo de cuenta, tipo de impuesto por cliente y conciliación.

## 0. Resumen

1. **El backend está muy completo; el panel lo esconde.** Hay 21 entradas bajo «Finanzas» sin orden de trabajo, y además 6 funciones cuya API ya existe pero el panel muestra «llega con la API…» o un botón apagado (§1.3).
2. **No hay una pantalla que diga qué toca hoy ni en qué paso del mes vamos.** El orden real (facturar → cobrar → compras → bancos → revisar → impuestos → cerrar) solo está en la cabeza del contador.
3. **«Nueva factura» existe, pero se llama «Cargo único»** y vive en el menú «Más» de la ficha del cliente. En Facturas no hay botón para crear.
4. **El cliente no tiene tipo de impuesto.** El proveedor sí (`regimen_isr`, `agente_retencion_iva`). Con un cliente agente retenedor, el cajero tiene que saber de memoria que debe pedir la constancia.
5. **La conciliación ya tiene dos columnas, reglas y «registrar pago recibido»**, pero exige que los montos sean idénticos; una comisión de Q 5 obliga a hacer antes un asiento a mano.
6. **Un error de lógica alto** (efectivo entregado al cerrar la caja, §4 E1) y varios medios y bajos.

## 1. Inventario real

Panel: `apps/web/app/pages` y menú en `apps/web/app/utils/navegacion.ts`. API: `apps/api/start/routes/{ledger,bancos,extractos_bancarios,compras,inventario_compras,activos,cierres,ejercicios,apertura,libros,billing,cobranza,fiscal,declaraciones,calendario,tablero,panel_financiero}.ts`.

### 1.1 Pantallas (ruta · permiso de la página · cómo se llega)

| Tema | Pantalla | Permiso | Menú hoy | Observación |
| --- | --- | --- | --- | --- |
| Panel | `/finanzas` | `reportes.ver` | Finanzas › Panel financiero | La API es `panel_financiero.ver`; 3 indicadores dicen «llega con la API» y la API ya existe |
| Libro | `/libro` (Diario, Mayor, Auxiliar de cliente, Plan de cuentas) | `libro.ver` | Finanzas › Libro contable | «Asiento de ajuste» apagado; falta la pestaña «Por aprobar» del tablero `ContaLibro` |
| Libro | `/libro/integridad` | `libro.ver` | no está | Solo por un enlace al pie del libro |
| Cierre | `/libro/cierres` (mes y ejercicio, lista de verificación) | `libro.ver` | Finanzas › Periodos y cierres | Bien, pero es el final del flujo y nada lleva hasta aquí |
| Cierre | `/libro/bloqueos` | `libro.ver` | Finanzas › Bloqueos del libro | Dos entradas de menú para el mismo tema (cierres y bloqueos) |
| Cartera | `/cartera` (antigüedad, provisión, castigos) | `reportes.ver` | Finanzas › Cartera | «Registrar gestión» apagado; la API existe |
| Impuestos | `/fiscal/tablero`, `/fiscal/calendario`, `/declaraciones`, `/declaraciones/[id]`, `/fiscal/comparador` | `fiscal.ver` / `declaraciones.ver` | Finanzas › Impuestos (6 entradas) | Tres puertas para lo mismo (resumen, calendario, declaraciones) |
| Impuestos | `/declaraciones/ajustes` | `declaraciones.ver` | no está | Solo desde una declaración |
| FEL | `/dte`, `/dte/[id]` | `fel.ver` | Finanzas › Impuestos › Facturación electrónica | Es operación de ventas, no de impuestos |
| Libros legales | `/libros`, `/libros/emisiones`, `/libros/habilitaciones` | `libros.ver` | Finanzas › Impuestos › Libros legales | Emisiones y habilitaciones solo desde dentro |
| Compras | `/compras`, `/compras/nueva`, `/compras/cargar`, `/compras/borradores/[id]`, `/compras/[id]` | `compras.*` | Finanzas › Compras › Compras y gastos | La pantalla ya tiene pestañas (Compras, Borradores, Proveedores, Pagos, Activos, Diferidos) **y** el menú repite 7 entradas |
| Compras | `/proveedores`, `/proveedores/[id]`, `/pagos-proveedores`, `/constancias`, `/activos`, `/activos/[id]`, `/diferimientos`, `/diferimientos/[id]` | `proveedores.ver`, `compras.ver`, `activos.ver`, `libro.ver` | Finanzas › Compras | Duplicadas con las pestañas de `/compras` |
| Gastos | `/egresos` | `egresos.ver` | Finanzas › Compras › Egresos | Segunda puerta para registrar un gasto (§4 E5) |
| Bancos | `/bancos/extractos`, `/bancos/extractos/[id]` (conciliar) | `bancos.ver` | Finanzas › Bancos › Conciliación bancaria | Es el flujo clave y está en el tercer nivel |
| Bancos | `/bancos/conciliacion` (reporte) | `reportes.ver` | no está | Permiso distinto al de sus hermanas |
| Bancos | `/bancos/reglas` | `bancos.ver` | no está | Solo desde la lista de extractos |
| Bancos | `/bancos/transito`, `/cobros/por-liquidar`, `/cobros/liquidaciones/[id]` | `bancos.ver` | Finanzas › Bancos | Nombres contables («fondos en tránsito», «por liquidar») |
| Cajas | `/caja` (cierres, depósitos, retiros e ingresos) | `cajas.ver` | Día a día › Caja | Fuera de Finanzas; el depósito está en el menú «Más» |
| Ventas | `/facturas`, `/facturas/[id]`, `/servicios/[id]/facturas-periodo` | `facturas.*` | Facturación › Facturas | Sin «Nueva factura»; «Emitir por periodo» solo aparece filtrando por servicio |
| Ventas | `/notas-credito`, `/bonificaciones` | `facturas.ver` | Facturación | La nota se crea solo desde el detalle de una factura |
| Cobros | `/cobro`, `/pagos`, `/pagos/[id]`, `/comprobantes`, `/cobros/pasarela` | `pagos.*`, `comprobantes.ver` | Día a día y Facturación | «Cerrar diferencia» solo dentro de un pago |
| Reportes | `/reportes`, `/reportes/[reporte]`, `/reportes/balance`, `/reportes/resultados`, `/reportes/envios` | `reportes.ver`, `libro.ver` | Reportes | Favoritos, PDF y «Programar envío» apagados en el visor |
| Configuración | `/configuracion/fiscal`, `/fel`, `/cuentas-bancarias`, `/bancos-origen`, `/proveedores-cobro`, `/reglas-cobro`, `/plantillas-conceptos` | varios | Configuración | El ajuste «los asientos requieren aprobación» está en reglas de cobro |

### 1.2 Acciones (API) por tema

Todas existen con su ruta y permiso; se listan para que el plan no las duplique.

- **Libro:** `libro.registrar_asiento` (manual, con borrador si se exige aprobación), `libro.aprobar_asiento`, `libro.rechazar_asiento`, `libro.revertir_asiento`, diario, mayor, balance, estado de resultados, comprobación, integridad, diarios.
- **Cierre:** `libro.cerrar_periodo`, `libro.reabrir_periodo`, `cierres.verificar`, `cierres.revisar_check`, `libro.bloquear`, `libro.bloquear_duro`, `libro.desbloquear`, `libro.excepcion_bloqueo`, `libro.cerrar_ejercicio`, `libro.reabrir_ejercicio`, `libro.cerrar_apertura`.
- **Bancos:** `bancos.importar_extracto` (y por archivo con mapeo), `bancos.conciliar` (conciliar, anular, aplicar reglas, registrar desde la línea, reglas), `bancos.trasladar`, `bancos.reatribuir_llegada`, `cobros.liquidar`, `cobros.configurar`.
- **Cajas:** `cajas.crear`, `cajas.abrir`, `cajas.cerrar`, `cajas.depositar`, `cajas.configurar_impresion`; `egresos.registrar`, `egresos.anular`.
- **Compras:** `compras.registrar` (también desde un egreso), `compras.anular`, `compras.pagar` (y anular el pago), borradores leídos de la foto, constancias emitidas, `proveedores.editar`, `activos.registrar`, `activos.dar_de_baja`, depreciar, diferimientos.
- **Cartera:** `cartera.provisionar`, `cartera.castigar`, `gestiones_cobro.registrar`, `pagos.cerrar_diferencia`.
- **Ventas y cobros:** `facturas.generar`, `facturas.emitir_periodos`, `facturas.emitir_cargo_unico`, `facturas.anular`, `facturas.sustituir`, `facturas.nota_credito`, `facturas.anular_nota_credito`, `pagos.registrar`, `pagos.anular`, comprobantes, pasarela.
- **Impuestos:** `declaraciones.calcular`, `.revisar`, `.presentar`, `.pagar`, `.anular_pago`, `.ajustar`; calendario de obligaciones; `fiscal.cambiar_regimen`; FEL (`fel.certificar`, `fel.anular`, `fel.contingencia`); `libros.habilitar`, `libros.emitir`.

### 1.3 API que existe y el panel no usa

| Función | API | Lo que ve el usuario hoy |
| --- | --- | --- |
| Asiento manual | `POST /libro/asientos` | Botón «Asiento de ajuste» apagado (`pages/libro/index.vue:326-335`) |
| Aprobar o rechazar asientos | `GET /libro/borradores`, `POST …/aprobar`, `…/rechazar` | No hay pantalla. Con el ajuste encendido, un borrador no se podría aprobar desde el panel |
| Gestiones de cobro | `POST /clientes/:id/gestiones-cobro` | «Registrar gestión» apagado (`pages/cartera/index.vue:625`) |
| Indicadores del panel | `GET /panel-financiero`, `/reportes/indicadores-financieros`, `/reportes/bajas` | «Sin datos todavía» en ingreso recurrente, bajas y por servicio (`pages/finanzas/index.vue:368,410,419`) |
| Favoritos y envío desde el visor | `PUT /reportes/favoritos/:reporte`, `POST /reportes/envios` | Apagados (`pages/reportes/index.vue:170`, `pages/reportes/[reporte].vue:396,406`) |
| Balance de comprobación | `GET /libro/comprobacion` | Sin pantalla |
| Cerrar la apertura | `GET /libro/apertura`, `POST /libro/apertura/cerrar` | Sin pantalla |

### 1.4 Pantallas escondidas o duplicadas

- Escondidas (no están en el menú): reglas de conciliación, reporte de conciliación, integridad del libro, emisiones y habilitaciones de libros, ajustes de declaraciones, liquidaciones.
- Duplicadas: las 7 entradas de «Compras» del menú contra las 6 pestañas de `/compras`; Egresos contra Compras; «Periodos y cierres» contra «Bloqueos del libro»; resumen fiscal, calendario y declaraciones.
- Fuera de lugar: Caja y Comprobantes (Día a día), Facturas y Pagos (Facturación), DTE (Impuestos). Cada una está bien para su usuario, pero el contador tiene que saltar entre tres grupos del menú.

### 1.5 Capturas del «antes» (fixtures, 1280×800 y 390×844)

Carpeta `.claude/diseno/capturas/contabilidad/antes/`. Escritorio: `finanzas`, `menu-finanzas-expandido`, `menu-finanzas-subgrupos`, `libro`, `libro-cierres`, `libro-bloqueos`, `cartera`, `fiscal-tablero`, `fiscal-calendario`, `declaraciones`, `dte`, `libros`, `compras`, `compras-nueva`, `proveedores`, `pagos-proveedores`, `egresos`, `constancias`, `activos`, `diferimientos`, `cobros-por-liquidar`, `bancos-transito`, `bancos-extractos`, `bancos-extracto-detalle`, `bancos-conciliacion`, `bancos-reglas`, `facturas`, `pagos`, `notas-credito`, `caja`, `reportes`, `cobros-pasarela`, `cliente-ficha`, `cliente-ficha-menu-mas`, `inicio` (todas `-escritorio.png`). Teléfono: `finanzas`, `libro`, `libro-cierres`, `fiscal-tablero`, `declaraciones`, `compras`, `bancos-extractos`, `facturas`, `caja`, `cartera` (`-movil.png`).

## 2. Flujos de punta a punta (para alguien sin formación contable)

| Flujo | Dónde empieza | Pasos | Dónde termina | Dónde se pierde hoy |
| --- | --- | --- | --- | --- |
| **Facturar a un cliente** | Las mensualidades salen solas cada mes. Algo aparte: ficha del cliente › Más › «Cargo único» | Elegir qué se cobra del catálogo, cantidad y precio; guardar. Se certifica en FEL según la empresa | Factura emitida y en el saldo del cliente | No hay nada que diga «factura»: el botón se llama «Cargo único» y está en un menú. En Facturas solo hay «Generar las del mes» y «Correr corte» |
| **Cobrar** | Botón verde «Cobrar» (siempre arriba) | Buscar cliente, elegir facturas, método, recibido; confirmar | Recibo impreso y servicio reactivado | Si el cliente retiene IVA, nada lo avisa: hay que saber abrir «constancias». Si paga de más, el sobrante queda como saldo a favor y no hay forma de devolverlo |
| **Registrar una compra o un gasto** | Finanzas › Compras › «Cargar factura» (foto) o «Registrar a mano»; o Finanzas › Compras › Egresos; o Caja › Más › «Registrar retiro» | Proveedor, documento, líneas, contado o crédito; guardar | Compra con su crédito de IVA y, si es al crédito, deuda con el proveedor | Tres puertas. Un gasto con factura registrado como «egreso» pierde el crédito de IVA y no queda ligado al proveedor |
| **Pagar a un proveedor** | Compras › «Pagar a proveedor» | Proveedor, de dónde sale el dinero, monto; se aplica a lo más viejo | Deuda saldada y salida de banco o caja | No se puede pagar por adelantado (anticipo). La constancia de retención que la empresa entrega está en otra pantalla |
| **Conciliar el banco** | Finanzas › Bancos › Conciliación bancaria › «Importar estado de cuenta» | Subir el archivo del banco; emparejar cada línea con lo registrado; registrar lo que falte; ver el reporte | Todas las líneas con pareja y saldo «cuadra» | Tercer nivel del menú. Si el monto no es idéntico no deja conciliar y no dice qué hacer. No hay «terminé» |
| **Cerrar una caja y depositar** | Ícono de caja (arriba) › «Cerrar caja» | Contar por denominaciones, revisar por método, indicar fondo que queda y a quién se entrega el resto | Turno cerrado; depósito con boleta | El depósito se registra **desde un turno abierto** (Caja › Más). Lo entregado al cerrar no se puede depositar después (§4 E1) |
| **Cerrar el mes** | Finanzas › Periodos y cierres | «Verificar» la lista (más de 20 revisiones), resolver o supervisar cada aviso, «Cerrar un mes» | Mes cerrado; luego libros legales y bloqueo | La lista dice qué está mal pero no lleva a la pantalla que lo arregla en orden. Nadie sabe que antes van compras y bancos |
| **Declarar IVA e ISR** | Finanzas › Impuestos › Calendario fiscal (o Declaraciones) | Calcular, revisar el borrador, presentarla en la SAT por fuera, «Marcar presentada», «Registrar pago» | Declaración pagada con su asiento | Tres pantallas parecidas (resumen, calendario, declaraciones). No se ve que el mes debe estar cerrado primero |
| **Cerrar el año** | Finanzas › Periodos y cierres › pestaña «Cierre del ejercicio» | Los 12 meses cerrados, revisiones anuales, ISR anual, «Cerrar ejercicio» | Resultado trasladado y año bloqueado | Es una pestaña dentro de otra pantalla; no hay lista de «qué falta para cerrar el año» |

## 3. Comparación con el sistema de referencia (Zoho Books)

Solo ideas de función y de flujo. No se copia marca, nombres ni diseño.

| Idea | Argos hoy | ¿Aplica a un ISP en Guatemala? | Propuesta |
| --- | --- | --- | --- |
| **Tipo de impuesto por cliente** (gravado, exento, tasa por defecto) | No. Solo `tipo_documento_fiscal` (CF, NIT, CUI). El régimen es de la empresa (`billing/regimen.ts`) | Sí. Agentes de retención de IVA (contribuyentes especiales, Estado, exportadores), clientes que retienen ISR y entidades exentas. Con empresa pequeño contribuyente no hay IVA ni retención de IVA | **Construir** (lote B4/P7): perfil fiscal del cliente que define la factura (frase de exención) y lo que el cobro espera (constancia) |
| **Tipo de impuesto por proveedor** | Sí: `regimen_isr` y `agente_retencion_iva` (`ledger/proveedores.ts:38-39`), con retenciones sugeridas en la compra | Sí | Mostrarlo igual que en el cliente (misma tarjeta «Impuestos») |
| **Tipo de cuenta** (cada cuenta tiene un tipo que decide en qué reporte sale y cómo se comporta) | A medias: `tipo`, `naturaleza`, `contracuenta`, `categoria_flujo`, `categoria_fiscal`, auxiliares. El plan de cuentas es de solo lectura en el panel | Sí, simplificado | Plan de cuentas con el tipo en palabras («Dinero», «Me deben», «Debo», «Ventas», «Gastos») y crear **subcuentas** de gasto e ingreso; nunca borrar (lote B7/P10) |
| **Coincidencia automática** con el banco | A medias: reglas y botón «Automático» por referencia y monto | Sí | Niveles «pareja segura / para decidir / sin pareja» y aceptar las seguras en lote (B3/P6) |
| **Reglas bancarias por texto** | Sí (`contiene` o `regex` → contrapartida o cliente) | Sí | Subirlas de nivel: «crear regla» desde la línea |
| **Varias partidas contra una línea** | Sí (`movimientos[]`, depósitos y traslados) | Sí | Mantener |
| **Conciliar con diferencia** (crear el ajuste en el mismo paso) | No: `conciliacion_descuadrada` (`conciliar_linea.ts:152-160`) | Sí: comisiones de banco y de agentes | **Construir** (B3) con tope y motivo |
| **Categorizar una línea sin pareja** (pago de cliente, gasto, traslado, ingreso) | A medias: «Registrar pago recibido» y contrapartida libre | Sí | Cuatro opciones en palabras y «no sé todavía» (por identificar) |
| **Conciliación por periodo con saldo final** y «deshacer» | A medias: reporte de conciliación y anular por línea | Sí | Paso «Revisar el saldo» y «Terminar» del flujo guiado |
| **Anticipos y saldo a favor del cliente** | Sí: `2.1.01`, se aplica solo a la siguiente factura | Sí | Falta **devolver** el saldo a favor (B6) y verlo en la ficha |
| **Anticipos y créditos de proveedor** | Créditos sí (NCRE); anticipos no (`pago_excede_saldo`) | Sí (tránsito de internet, postes) | Construir en B6, después de lo urgente |
| **Factura de anticipo (retainer)** | No | Poco. En Guatemala el anticipo se factura al recibirlo; hoy basta el saldo a favor | No construir; anotar para el contador |
| **Recurrencia de facturas** | Sí, nativa: plantillas y generación por periodo | Sí | Nada |
| **Gastos recurrentes** (alquiler, enlaces) | No | Sí | Más adelante: «repetir cada mes» como borrador de compra (pregunta 9) |
| **Notas de crédito** | Sí, con FEL | Sí | Botón también en la ficha y en la lista |
| **Retenciones** | Sí en compras; en ventas por constancia al cobrar | Sí | Que el perfil fiscal las proponga |
| **Aprobaciones** | Asientos manuales, promesas, comprobantes, correos externos | Parcial | No ampliar por ahora (pregunta 10) |
| **Informes** | Catálogo, favoritos, envíos programados, libros legales | Sí | Conectar lo apagado (P2) |
| **Panel** con por cobrar, por pagar, flujo y bancos | Panel financiero del dueño | Sí | Inicio de contabilidad: tareas, pasos e indicadores con ayuda |
| **Recordatorios de pago** | Sí (notify) | Sí | Nada |
| **Portal del cliente** | Sí | Sí | Nada |
| **Varias monedas** | No | No por ahora | No construir |
| **Cotizaciones y órdenes de venta** | En Iris | No en Argos | Nada |

## 4. Errores y huecos de lógica contable

| # | Gravedad | Qué pasa | Dónde |
| --- | --- | --- | --- |
| E1 | **Alta** | Al cerrar la caja se guarda cuánto se entrega y a quién (`entregado_monto`, `entregado_a`, `fondo_siguiente`), pero **sin asiento**. Ese efectivo sigue en la cuenta de la caja. El depósito exige un turno abierto y no puede pasar del efectivo de **ese** turno, así que lo entregado ayer no se puede depositar hoy; y si se logra, el turno nuevo aparece con faltante. El fondo con el que se abre es libre y no se compara con el fondo que quedó | `ledger/actions/cerrar_caja.ts:97-116`, `ledger/actions/depositar_caja.ts:73-112`, `ledger/actions/abrir_caja.ts:27-66` |
| E2 | Media | La conciliación exige suma exacta. Un depósito de Q 900 que el banco acredita en Q 895 no se puede conciliar sin un asiento manual previo (que además hoy no se puede crear desde el panel, §1.3) | `ledger/actions/conciliar_linea.ts:152-160` |
| E3 | Media | Documentos que no se pueden anular: depósito de caja, liquidación, provisión, castigo, depreciación, diferido, bonificación. La salida prevista es «un asiento de ajuste», que corrige el libro pero deja viva la fila del documento: un depósito mal digitado sigue restando en el esperado del turno y sigue «en tránsito» | `ledger/reversos.ts:38-49,56-65,82-85`; `ledger/actions/depositar_caja.ts:128-161` |
| E4 | Media | El egreso manda todo el monto a gasto: sin IVA, sin proveedor y sin tipo de documento. Además una compra al contado inserta su fila en `ledger.egresos`, así que el mismo pago sale en Compras y en Egresos | `ledger/actions/registrar_egreso.ts:159-176`, `ledger/actions/registrar_compra.ts:142-161` |
| E5 | Media | «Cartera vencida» con fecha de corte pasada usa el **saldo de hoy** con la antigüedad de esa fecha. No reproduce la cartera de un cierre anterior | `billing/reportes/reportes.ts:142-185` |
| E6 | Media (hueco) | El cliente no tiene perfil fiscal. La retención recibida depende de que el cajero la escriba; un concepto exento con FEL se rechaza (`concepto_exento_con_fel`) | `billing/actions/registrar_pago.ts:186-188,619-627`, `billing/actions/emitir_cargo_unico.ts:53-54` |
| E7 | Media (hueco) | No se puede devolver un saldo a favor ni pagar por adelantado a un proveedor (`pago_excede_saldo`) | `billing/actions/registrar_pago.ts:650-656`, `ledger/actions/registrar_pago_proveedor.ts:109-118` |
| E8 | Baja | El saldo del cliente sale de dos fuentes: el libro (`saldoCliente`) y las facturas (`total − pagado`). Las revisiones del cierre las comparan una vez al mes; no hay prueba que lo exija en cada operación | `ledger/consultas.ts:302-320`, `billing/estado_cuenta.ts:206-208`, `billing/facturas.ts:529`, `billing/actions/aprobar_comprobante.ts:217`, `billing/promesas.ts:754` |
| E9 | Baja | Permisos que no siguen «permiso = acción» (regla 2): anular conciliación y reglas con `bancos.conciliar`; anular pago a proveedor con `compras.pagar`; diferimientos con `libro.registrar_asiento`; depreciar con `activos.registrar`; vencer, corte y conciliar pasarela con `facturas.generar`. Quien puede hacer puede deshacer | `start/routes/bancos.ts:357,408,419`, `compras.ts:304`, `activos.ts:85,133,147`, `billing.ts:494,508,1492` |
| E10 | Baja | Permiso de página distinto al de su API: `/finanzas` pide `reportes.ver` y su API `panel_financiero.ver`; `/bancos/conciliacion` pide `reportes.ver` y sus hermanas `bancos.ver` | `apps/web/app/pages/finanzas/index.vue:5`, `pages/bancos/conciliacion.vue` |
| E11 | Baja | Anular una conciliación que acreditó un depósito en tránsito no deshace la «llegada»: el depósito queda como llegado y hay que saber usar «reatribuir llegada» | `ledger/actions/anular_conciliacion.ts:57-66`, `ledger/actions/conciliar_linea.ts:162-197` |

No verificado con pruebas en esta rama: E1 y E3 salen de leer el código. El lote AU1 los fija con pruebas antes de corregir.

Lo que se revisó y está bien: partida doble con restricción en la base, anticipos antes que deuda nueva, recuperación de castigados, comisión y retención en el pago, depósito por fondos en tránsito, reverso por documento, numeración sin huecos.

## 5. Propuesta

### 5.1 Estructura nueva: «Contabilidad» con un inicio

El grupo «Finanzas» pasa a tener 7 entradas en lugar de 21. Cada entrada es una pantalla con pestañas dentro de la misma tarjeta (patrón ya aprobado).

| Entrada | Qué reúne | Permiso que la muestra |
| --- | --- | --- |
| **Inicio** (`/contabilidad`) | Qué toca hoy, pasos del mes, crear, 4 indicadores | cualquiera de `libro.ver`, `bancos.ver`, `compras.ver`, `declaraciones.ver` |
| **Ventas y cobros** | Facturas, notas de crédito, pagos, comprobantes, pasarela, FEL, cartera | `facturas.ver`, `pagos.ver`, `fel.ver`, `reportes.ver` |
| **Compras y pagos** | Compras, por revisar, proveedores, pagos, constancias, activos, diferidos (los egresos entran aquí) | `compras.ver`, `proveedores.ver`, `activos.ver` |
| **Bancos y cajas** | Conciliar, depósitos en camino, cobros de agentes y pasarela, cajas, reglas | `bancos.ver`, `cajas.ver` |
| **Impuestos** | Calendario con sus declaraciones, libros legales, comparador | `declaraciones.ver`, `fiscal.ver`, `libros.ver` |
| **Cierre y libro** | Cerrar el mes (asistente), cerrar el año, bloqueos, libro, por aprobar, integridad | `libro.ver` |
| **Panel del dueño** | El panel financiero actual | `panel_financiero.ver` |

«Día a día» y «Facturación» no se quitan: Cobrar, Caja, Comprobantes, Facturas y Pagos siguen donde el cajero los busca. La entrada nueva solo les da un segundo camino al contador.

### 5.2 Inicio de contabilidad (tablero `PlanContaInicio`)

- **Qué toca hoy:** lista con contador y un botón por tarea. Solo aparecen las tareas del rol. Orden por urgencia. Fuente: una lectura nueva `GET /contabilidad/inicio` que cuenta, por empresa activa: comprobantes pendientes, líneas de banco sin pareja, depósitos en camino, borradores de compra, facturas por certificar, asientos por aprobar, compras por vencer, obligaciones fiscales próximas, turnos abiertos de días anteriores.
- **Pasos del mes:** 7 pasos fijos (facturar, cobrar y cerrar cajas, compras y gastos, conciliar, revisar, declarar, cerrar). El estado de cada paso se calcula con datos (corridas de facturación, turnos, borradores, extractos, lista de verificación, declaraciones, cierre), nunca con casillas a mano.
- **Crear:** Nueva factura, Registrar un cobro, Registrar compra o gasto, Pagar a un proveedor, Depositar la caja, Asiento manual. Cada uno con su permiso exacto.
- **Indicadores:** Te deben, Debes a proveedores, Dinero disponible, Impuestos del mes; todos con «?».
- Si la lectura falla: error con «Reintentar», sin números (regla 12).

### 5.3 Botones donde hacen falta

| Botón | Dónde | Permiso | API |
| --- | --- | --- | --- |
| **Nueva factura** (hoy «Cargo único») | Ficha del cliente (junto a Cobrar y en la pestaña Facturación), lista de Facturas, ficha del servicio, inicio | `facturas.emitir_cargo_unico` | `POST /facturas/cargo-unico` (ya existe) |
| Emitir por periodo | Lista de Facturas sin tener que filtrar por servicio (pide el servicio) | `facturas.emitir_periodos` | existe |
| Nota de crédito | Menú de cada fila de Facturas y pestaña Facturación de la ficha | `facturas.nota_credito` | existe |
| Asiento manual y «Por aprobar» | Libro | `libro.registrar_asiento`, `libro.aprobar_asiento`, `libro.rechazar_asiento` | existe |
| Registrar gestión | Cartera y ficha del cliente | `gestiones_cobro.registrar` | existe |
| Depositar la caja | Visible en Cajas y en el cierre (paso final) | `cajas.depositar` | existe; cambia con E1 |
| Reglas | Encabezado de Conciliar | `bancos.conciliar` | existe |
| Devolver saldo a favor | Ficha del cliente, solo si hay saldo a favor | permiso nuevo `pagos.devolver_saldo` | nueva |

### 5.4 Indicadores con explicación (tablero `PlanIndicadorAyuda`)

Un componente único (`ContaIndicador`) para todo número de Finanzas, Cartera, Cajas y Reportes. Cinco estados: bien, atención, urgente, sin datos, error con «Reintentar». La ayuda «¿Qué es esto?» tiene siempre cuatro partes: qué es, cómo se calcula, qué hacer y nombre contable (decisión 11). Los textos viven en un solo archivo y los revisa el contador.

Indicadores iniciales y su frase:

| Indicador | En simple | Nombre contable |
| --- | --- | --- |
| Te deben | Lo que tus clientes no han pagado | Cuentas por cobrar (1.1.03) |
| Debes a proveedores | Compras al crédito sin pagar | Cuentas por pagar (2.1.03) |
| Dinero disponible | Bancos más cajas, sin lo que va en camino | Cajas y bancos (1.1.01, 1.1.02) |
| Dinero en camino al banco | Depósitos que el banco aún no muestra | Fondos en tránsito (1.1.11) |
| Saldo a favor de clientes | Pagos de más que se usarán en la próxima factura | Anticipos de clientes (2.1.01) |
| Impuestos del mes | Lo que estimamos pagar a la SAT | IVA por pagar |
| Ganancia del mes | Ventas menos gastos | Resultado del periodo |
| Cobrado del mes | Cuánto de lo facturado ya entró | Cobranza |
| Lo que no se va a cobrar | Deudas que se dieron por perdidas | Castigo de cartera |

### 5.5 Qué esconder o juntar

- Juntar: las 7 entradas de Compras en la pantalla con pestañas; Egresos dentro de «Registrar compra o gasto» (con factura / sin factura); Periodos y cierres con Bloqueos; resumen fiscal, calendario y declaraciones en una sola con pestañas.
- Esconder tras «Avanzado» o permiso: bloqueo duro, excepciones de bloqueo, integridad, diarios y numeración, habilitaciones de libros, reatribuir llegada, comparador de regímenes.
- Renombrar: «Fondos en tránsito» → «Dinero en camino al banco»; «Cobros por liquidar» → «Cobros de agentes y pasarela por recibir»; «Diferidos» → «Gastos pagados por adelantado»; «Cargo único» → «Nueva factura»; «Egreso» → «Gasto sin factura». El nombre contable queda en la ayuda y en la exportación.

### 5.6 Qué hace falta construir

Backend (A3):
1. Efectivo entregado al cerrar la caja con su asiento y depósito posterior (E1).
2. Lectura del inicio de contabilidad.
3. Conciliación: sugerencias con nivel, aceptar en lote, diferencia en el mismo paso, «por identificar».
4. Perfil fiscal del cliente y su efecto en factura y cobro.
5. Anular depósito de caja; devolver saldo a favor; anticipo a proveedor.
6. Cartera a una fecha (saldo histórico).
7. Subcuentas de gasto e ingreso desde el panel.
8. Permisos propios para deshacer (E9).

Panel (A4): menú nuevo, inicio, indicador con ayuda, conectar lo apagado, nueva factura, conciliación guiada, ficha con impuestos, cierre de caja con entrega, asistente de cierre del mes, gasto unificado.

Reglas que se respetan: libro inmutable (todo lo nuevo es asiento o reverso), acciones explícitas con su permiso de `apps/api/app/core/permisos.ts`, todo con `empresa_id` y filtrado por la empresa activa, lecturas sin estado en memoria (el inicio se calcula por consulta o por proyección refrescada por evento, nunca con TTL).

## 6. Tableros

Generador `generadores/conta_plan.py` (base `pend_base.py`, claro y oscuro). Página «Contabilidad: propuesta (pendiente de aprobación)» de `canvas.json`.

| Tablero | Qué muestra | Imágenes en `capturas/contabilidad/propuesta/` |
| --- | --- | --- |
| `PlanContaInicio`, `PlanContaInicioMovil` | Inicio con tareas, pasos, crear e indicadores | `inicio-escritorio`, `inicio-ayuda-escritorio`, `inicio-oscuro-escritorio`, `inicio-movil`, `inicio-pasos-movil` |
| `PlanContaConciliar`, `PlanContaConciliarMovil` | Conciliación guiada: 4 pasos, parejas, diferencia, regla, sin pareja | `conciliar-diferencia-escritorio`, `conciliar-sin-pareja-escritorio`, `conciliar-oscuro-escritorio`, `conciliar-movil`, `conciliar-decision-movil` |
| `PlanClienteFiscal`, `PlanClienteFiscalMovil` | Ficha con «Nueva factura», tipo de impuesto y retención | `cliente-escritorio`, `cliente-nueva-factura-escritorio`, `cliente-tipo-impuesto-escritorio`, `cliente-movil`, `cliente-nueva-factura-movil`, `cliente-tipo-impuesto-movil` |
| `PlanIndicadorAyuda`, `PlanIndicadorAyudaMovil` | Patrón de indicador, estados, ayuda y palabras | `indicador-escritorio`, `indicador-movil`, `indicador-oscuro-movil` |

Diferencia conocida con el diseño aprobado: «Nueva factura» va en un panel lateral (formulario largo, no ventana), como pide el sistema visual.

## 7. Lotes y olas

Complejidad: **alta** = toca asientos o varias acciones; **media** = una pantalla o una lectura; **baja** = menú, textos o permisos. Cada lote es una PR. Los de A3 regeneran `packages/contracts`; por eso dentro de una ola se mergean de uno en uno con `scripts/integrar.sh`.

### Ola 1 (en paralelo; nada depende de una decisión nueva salvo lo marcado)

| Lote | Dueño | Qué | Depende | Archivos | Pruebas | Complejidad |
| --- | --- | --- | --- | --- | --- | --- |
| AU1 | Auditor | Pruebas que fijan lo de hoy: E1 (entrega sin asiento, depósito al día siguiente), E3 (depósito corregido con ajuste), E5, E8 (saldo por libro = saldo por facturas tras cada operación del escenario generativo) | — | `apps/api/tests/contabilidad/plan_contabilidad.spec.ts`, `escenario_generativo.ts` | Las de E8 deben pasar ya; las de E1, E3 y E5 se escriben como comportamiento esperado y quedan marcadas hasta B1, B5 y B6 | Media |
| B1 | A3 | Caja: asiento de la entrega al cerrar (cuenta nueva «Efectivo por depositar», con quién lo tiene), depositar desde una entrega sin turno abierto, aviso si el fondo de apertura no es el que quedó | Pregunta 5 | `ledger/actions/cerrar_caja.ts`, `depositar_caja.ts`, `abrir_caja.ts`, `ledger/resumen_turno.ts`, `ledger/transitos.ts`, `fiscal/l10n/gt/cuentas.ts`, migración, `ledger/README.md`, `contratos/eventos.md` (`caja.cerrada` con `entregado`) | `tests/ledger/` cajas y depósitos; AU1 | Alta |
| B2 | A3 | `GET /contabilidad/inicio`: tareas con conteo y pasos del mes, por empresa activa y por permiso | — | `ledger/inicio_contabilidad.ts` (nuevo), `start/routes/ledger.ts`, `ledger/esquemas.ts`, permiso `contabilidad.ver_inicio` en `core/permisos.ts` (pedirlo a A1 en `integration/a3.md`) | `tests/ledger/inicio_contabilidad.spec.ts`: multiempresa, alcance, sin datos | Media |
| P1 | A4 | Menú «Finanzas» en 7 entradas; pestañas dentro de cada pantalla; nombres en simple; permisos de página iguales a su API (E10) | Pregunta 1 | `app/utils/navegacion.ts`, `components/ContaPestanas.vue`, `ContaComprasPestanas.vue`, `LibrosNavegacion.vue`, páginas de bancos, fiscal y libro; `tests/e2e/menu.spec.ts`, `permisos.spec.ts`; `pnpm verificar:permisos` | e2e de menú en escritorio y teléfono | Media |
| P2 | A4 | Conectar lo apagado: asiento manual y pestaña «Por aprobar», registrar gestión, indicadores del panel, favoritos y programar envío desde el visor, balance de comprobación | — | `pages/libro/index.vue`, `components/Libro*.vue`, `composables/useLibro.ts`, `pages/cartera/index.vue`, `pages/finanzas/index.vue`, `pages/reportes/index.vue`, `pages/reportes/[reporte].vue`, fixtures | Vitest por composable; e2e `libro`, `cartera`, `reportes` | Media |
| P3 | A4 | `ContaIndicador` con ayuda (reemplaza `ContaKpi`), `utils/ayudaIndicadores.ts`, aplicado en Panel, Cartera, Cajas y resumen fiscal | — (no toca las páginas de P1 ni P2 salvo `finanzas/index.vue`: va después de P2) | `components/ContaIndicador.vue`, `ContaKpi.vue`, `utils/ayudaIndicadores.ts`, `pages/cartera`, `pages/caja`, `pages/fiscal/tablero.vue` | Vitest del componente (5 estados, teclado), accesibilidad (`accesibilidad.spec.ts`) | Media |
| P4 | A4 | «Nueva factura»: renombrar y sacar a la vista en ficha del cliente, Facturas, ficha del servicio; panel lateral; nota de crédito desde la lista | Pregunta 2 | `components/CargoUnicoModal.vue` → `FacturaNuevaPanel.vue`, `pages/clientes/[id]/index.vue`, `pages/facturas/index.vue`, `pages/servicios/[id]/index.vue`, pruebas e2e de la ficha y de facturas | e2e escritorio y teléfono | Media |

### Ola 2 (depende de la ola 1)

| Lote | Dueño | Qué | Depende | Archivos | Pruebas | Complejidad |
| --- | --- | --- | --- | --- | --- | --- |
| B3 | A3 | Conciliación: `GET /bancos/extractos/:id/sugerencias` (segura, posible, regla, sin pareja), `POST /bancos/conciliaciones/lote`, `ajustes[]` en conciliar (cuenta, monto, motivo, con tope), «por identificar» | Pregunta 6 | `ledger/conciliacion.ts`, `ledger/actions/conciliar_linea.ts`, `aplicar_reglas_conciliacion.ts`, `validators_bancos.ts`, `start/routes/bancos.ts`, `contratos/localizacion-fiscal.md` §10.4 | `tests/ledger/` conciliación: diferencia, tope, lote, idempotencia | Alta |
| B4 | A3 | Perfil fiscal del cliente (`billing.clientes_fiscal`: tipo, retiene IVA, retiene ISR, exento con su documento, vigencia); la factura lo guarda en su instantánea; el estado de cuenta devuelve las retenciones esperadas; evento `cliente.perfil_fiscal_cambiado` | Preguntas 3 y 4 | `billing/perfil_fiscal.ts` (nuevo), `billing/actions/asignar_perfil_fiscal.ts`, `emitir_factura.ts`, `emitir_cargo_unico.ts`, `registrar_pago.ts`, `estado_cuenta.ts`, `fiscal/fel/xml_gt.ts`, migración, permiso `clientes.asignar_perfil_fiscal`, `contratos/eventos.md`, `CLAUDE.md` (catálogo) | `tests/billing/perfil_fiscal.spec.ts`: general y pequeño contribuyente, FEL falso | Alta |
| P5 | A4 | Inicio de contabilidad (tablero `PlanContaInicio`) | B2, P3 | `pages/contabilidad/index.vue`, `composables/useInicioContabilidad.ts`, `navegacion.ts`, fixtures | Vitest y e2e en 1280 y 390; error con Reintentar | Media |
| P8 | A4 | Cierre de caja: entrega con su recibo, «Depositar lo entregado», depósito a la vista | B1 | `pages/caja/index.vue`, `components/CajaDepositoSlideover.vue`, `components/CajaCierre*.vue`, `composables/useCajas.ts` | `tests/e2e/cierre-caja.spec.ts` | Media |
| AU2 | Auditor | Activar las pruebas de E1; invariantes nuevas: caja en libro = efectivo de turnos + entregas sin depositar | B1 | `tests/contabilidad/plan_contabilidad.spec.ts`, `cajas_bancos.spec.ts` | — | Media |

### Ola 3

| Lote | Dueño | Qué | Depende | Archivos | Pruebas | Complejidad |
| --- | --- | --- | --- | --- | --- | --- |
| B5 | A3 | Anular depósito de caja (reverso y vuelve al efectivo); devolver saldo a favor (`pagos.devolver_saldo`); anticipo a proveedor | B1; pregunta 8 | `ledger/actions/anular_deposito.ts`, `billing/actions/devolver_saldo_favor.ts`, `ledger/actions/registrar_pago_proveedor.ts`, `ledger/reversos.ts`, `core/permisos.ts` (pedir a A1) | `tests/ledger`, `tests/billing` | Alta |
| B6 | A3 | Cartera a una fecha con saldo histórico (desde el auxiliar del libro) | — | `billing/reportes/reportes.ts`, `contratos/reportes.md` | `tests/billing/reportes*` | Media |
| P6 | A4 | Conciliación guiada (tablero `PlanContaConciliar`) | B3 | `pages/bancos/extractos/[id].vue`, `components/Conciliar*.vue`, `composables/useExtractos.ts`, `useConciliaciones.ts` | `tests/e2e/fase4-bancos.spec.ts` ampliada; teléfono | Alta |
| P7 | A4 | Ficha del cliente: tarjeta «Impuestos de este cliente», tipo de impuesto, retención en «Nueva factura» y en Cobrar (constancia propuesta); misma tarjeta en el proveedor | B4, P4 | `pages/clientes/[id]/index.vue`, `components/ClienteFiscal*.vue`, `FacturaNuevaPanel.vue`, `pages/cobro/index.vue`, `pages/proveedores/[id].vue` | e2e cobro con retención; Vitest | Alta |
| AU3 | Auditor | Perfil fiscal: retención esperada = constancias; exento sin IVA en libro, libros de ventas y declaración; diferencia de conciliación cuadra con el reporte | B3, B4 | `tests/contabilidad/hallazgos_plan.spec.ts` | — | Media |

### Ola 4

| Lote | Dueño | Qué | Depende | Archivos | Pruebas | Complejidad |
| --- | --- | --- | --- | --- | --- | --- |
| B7 | A3 | Subcuentas de gasto e ingreso desde el panel (`libro.crear_cuenta`, `libro.desactivar_cuenta`); tipo de cuenta en palabras | Pregunta 11 | `ledger/actions/crear_cuenta.ts`, `ledger/plan_cuentas.ts`, rutas | `tests/ledger/cuentas.spec.ts` | Media |
| B8 | A3 | Permisos propios para deshacer (E9) con migración de roles | A1 (`core/permisos.ts`) | `start/routes/{bancos,compras,activos,billing}.ts`, seed de roles | `tests/core/acl`, `pnpm verificar:permisos` | Baja |
| P9 | A4 | Asistente «Cerrar el mes»: cada revisión con su botón «Arreglar» que lleva a la pantalla, en el orden de los pasos; «Cerrar el año» con lo que falta | P5 | `pages/libro/cierres.vue`, `components/LibroCierres.vue`, `composables/useChecksCierre.ts` | `tests/e2e/checks-cierre.spec.ts` | Media |
| P10 | A4 | Gasto unificado («con factura / sin factura») y plan de cuentas con subcuentas | B7; pregunta 7 | `pages/compras/nueva.vue`, `pages/egresos/index.vue`, `pages/libro/index.vue` | e2e compras | Media |
| P11 | A4 | Devolver saldo a favor, anular depósito, anticipo a proveedor | B5 | `pages/clientes/[id]`, `pages/caja`, `pages/pagos-proveedores.vue` | e2e | Media |
| AU4 | Auditor | Recorrido completo de un mes con el escenario generativo siguiendo los 7 pasos | todo | `tests/contabilidad/generativo.spec.ts` | — | Media |

Qué no se pisa: en cada ola, A3 trabaja en archivos distintos (cajas, lectura nueva, conciliación, facturación); A4 separa menú (P1), libro y reportes (P2), componente (P3) y facturas (P4). `finanzas/index.vue` lo tocan P2 y P3: P3 va después. `navegacion.ts` lo tocan P1 y P5: P5 es de la ola 2.

## 8. Preguntas para el PM (con recomendación)

1. **¿El grupo «Finanzas» pasa a 7 entradas con «Inicio» primero?** Cambia la decisión 1 (8 entradas sueltas). Recomendación: sí.
2. **¿«Cargo único» se llama «Nueva factura» y va a la vista?** Recomendación: sí; el nombre técnico queda en la bitácora.
3. **¿Qué tipos de impuesto tiene un cliente?** Recomendación: Normal, Agente retenedor de IVA, Exento, y aparte la casilla «me retiene ISR» (un cliente puede retener las dos cosas).
4. **Exento con factura electrónica:** hace falta la frase de exención que confirme el contador. Recomendación: construir primero «retenedor» y dejar «exento» apagado hasta tener la frase.
5. **Efectivo que se entrega al cerrar la caja:** ¿queda a nombre de quien lo recibe hasta que lo deposita? Recomendación: sí, en una cuenta «Efectivo por depositar», y el depósito se registra contra esa entrega.
6. **Diferencia al conciliar:** ¿hasta cuánto puede aceptar quien concilia? Recomendación: el mismo tope de «cerrar diferencia» de la empresa; arriba de eso, solo contabilidad con motivo.
7. **¿Una sola puerta para gastos?** Recomendación: sí, «Registrar compra o gasto» con dos caminos (con factura, sin factura). El retiro de caja del cajero se queda en Caja.
8. **¿Se construye anular depósito, devolver saldo a favor y anticipo a proveedor?** Recomendación: los dos primeros sí; el anticipo a proveedor en la última ola.
9. **Gastos que se repiten cada mes (alquiler, enlaces):** Recomendación: después de este plan, como borrador mensual que alguien confirma.
10. **¿Aprobación de compras o pagos a proveedores sobre un monto?** Recomendación: no por ahora; ya hay aprobación de asientos manuales.
11. **¿El usuario puede crear subcuentas de gasto e ingreso?** Recomendación: sí, solo contabilidad, y nunca borrar: se desactivan.
12. **Conciliación en el teléfono:** la decisión 9 dice consulta y aprobar. Recomendación: en teléfono aceptar parejas y decidir una por una; subir el estado de cuenta y las reglas, solo en escritorio.
13. **Textos de ayuda:** ¿los revisa el contador antes de publicarlos? Recomendación: sí, una sola pasada sobre el archivo de textos.
14. **Pasos del mes:** ¿automáticos o con casillas? Recomendación: automáticos; un paso está «listo» cuando los datos lo dicen.
