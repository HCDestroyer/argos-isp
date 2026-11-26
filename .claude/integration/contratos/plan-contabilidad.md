# Plan de contabilidad: análisis, propuesta y lotes

Estado: **propuesta con las respuestas del PM del 26 nov 2026** (§8.1); quedan por responder las preguntas de §8.2. Rama `lider/plan-contabilidad`, sobre `main` en `d86d5602`.
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
| **Tipo de impuesto por cliente** (gravado, exento, tasa por defecto) | No. Solo `tipo_documento_fiscal` (CF, NIT, CUI). El régimen es de la empresa (`billing/regimen.ts`) | Sí. Agentes de retención de IVA (contribuyentes especiales, Estado, exportadores), clientes que retienen ISR y entidades exentas. Con empresa pequeño contribuyente no hay IVA ni retención de IVA | **Construir** (lotes B4, P7 y B10): perfil fiscal del cliente que define la factura (frase de exención) y lo que el cobro espera (constancia) |
| **Tipo de impuesto por proveedor** | Sí: `regimen_isr` y `agente_retencion_iva` (`ledger/proveedores.ts:38-39`), con retenciones sugeridas en la compra | Sí | Mostrarlo igual que en el cliente (misma tarjeta «Impuestos») |
| **Tipo de cuenta** (cada cuenta tiene un tipo que decide en qué reporte sale y cómo se comporta) | A medias: `tipo`, `naturaleza`, `contracuenta`, `categoria_flujo`, `categoria_fiscal`, auxiliares. El plan de cuentas es de solo lectura en el panel | Sí, simplificado | Plan de cuentas con el tipo en palabras («Dinero», «Me deben», «Debo», «Ventas», «Gastos») y crear **subcuentas** de gasto e ingreso; nunca borrar (lote B7/P10) |
| **Coincidencia automática** con el banco | A medias: reglas y botón «Automático» por referencia y monto | Sí | Niveles «pareja segura / para decidir / sin pareja» y aceptar las seguras en lote (B3/P6) |
| **Reglas bancarias por texto** | Sí (`contiene` o `regex` → contrapartida o cliente) | Sí | Subirlas de nivel: «crear regla» desde la línea |
| **Varias partidas contra una línea** | Sí (`movimientos[]`, depósitos y traslados) | Sí | Mantener |
| **Conciliar con diferencia** (crear el ajuste en el mismo paso) | No: `conciliacion_descuadrada` (`conciliar_linea.ts:152-160`) | Sí: comisiones de banco y de agentes | **Construir** (B3, §5.8): motivos configurables con su cuenta, tope y aprobación |
| **Categorizar una línea sin pareja** (pago de cliente, gasto, traslado, ingreso) | A medias: «Registrar pago recibido» y contrapartida libre | Sí | Cuatro opciones en palabras y «no sé todavía» (por identificar) |
| **Conciliación por periodo con saldo final** y «deshacer» | A medias: reporte de conciliación y anular por línea | Sí | Paso «Revisar el saldo» y «Terminar» del flujo guiado |
| **Anticipos y saldo a favor del cliente** | Sí: `2.1.01`, se aplica solo a la siguiente factura | Sí | Falta **devolver** el saldo a favor (B5) y verlo en la ficha |
| **Anticipos y créditos de proveedor** | Créditos sí (NCRE); anticipos no (`pago_excede_saldo`) | Sí (tránsito de internet, postes) | Construir en B8, después de lo urgente |
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

### 5.7 Modelo de cajas (respuesta del PM, 26 nov 2026)

Pedido del PM: dos tipos de caja, una para cobros y una para gastos, con un flujo corto en el que el efectivo no se pueda perder ni quedar sin control. Resuelve E1.

**Cuatro lugares donde puede estar el efectivo, y solo cuatro.**

| Lugar | Qué es | Cuenta en el libro | Quién responde |
| --- | --- | --- | --- |
| Caja de cobros | Turno del cajero. Solo entra dinero de clientes; solo sale por «entrega» | Subcuenta de Cajas `1.1.01.NN` (ya existe) | El cajero del turno |
| Custodia | Efectivo que ya salió de una caja y aún no llega al banco | Cuenta nueva «Efectivo en custodia» (código por confirmar con el contador; una por empresa) | La persona que dijo «Recibí» |
| Caja chica | Caja de gastos con fondo fijo | Subcuenta de Cajas `1.1.01.NN`, con `tipo = gastos` | Su encargado |
| Banco | Depósito en camino y luego confirmado | Fondos en tránsito `1.1.11` y la cuenta del banco (ya existen) | — |

**Cuatro movimientos, y solo cuatro.** Cada uno es un documento con número, quién entrega, quién recibe, monto y su asiento. Ninguno se edita: se anula con su reverso.

| Movimiento | De → a | Cuándo | Asiento |
| --- | --- | --- | --- |
| **Entrega** | Caja de cobros → custodia | Al cerrar el turno: todo lo contado menos el fondo fijo de cambio | Custodia / Caja, **cuando quien recibe confirma con su usuario**. Hasta entonces sigue a nombre del cajero («por recibir») |
| **Depósito** | Custodia → banco | Con boleta y foto, sin necesidad de turno abierto | Fondos en tránsito / Custodia (luego la conciliación lo confirma) |
| **Reposición** | Custodia o banco → caja chica | Por lo gastado desde la última reposición; nunca desde una caja de cobros | Caja chica / Custodia o Banco |
| **Gasto** | Caja chica → gasto | Con comprobante obligatorio (foto) y tope por gasto | Gasto / Caja chica. Con factura a nombre de la empresa se registra como compra pagada con caja chica, para no perder el IVA |

Reglas que evitan que se pierda el rastro:

- **Fondo fijo.** La caja de cobros abre siempre con su fondo de cambio configurado; ya no se escribe a mano. La caja chica siempre cumple «efectivo + comprobantes sin reponer = fondo fijo».
- **Dos personas en cada entrega.** Quien recibe cuenta y confirma. Si cuenta distinto, la diferencia queda como faltante o sobrante del turno, con el nombre de quien entregó.
- **«Lo deposito yo».** En un ISP de pocas personas el cajero puede entregarse a sí mismo: el efectivo pasa a custodia a su nombre y el camino es el mismo.
- **Plazo y tope de custodia** por persona, configurables. Pasarse avisa en el inicio de contabilidad y en el panel del dueño; no bloquea los cobros.
- **Conteo sorpresa** de la caja chica y de la custodia de una persona, con diferencia a su cargo.
- **Un indicador:** «Efectivo fuera del banco» = cajas de cobros + custodia + caja chica + en camino, con quién tiene cada parte y desde cuándo.
- **Revisión del cierre del mes nueva:** ninguna entrega «por recibir» ni custodia fuera de plazo.

Lo que cambia respecto a hoy:

- `ledger.cajas` gana `tipo` (`cobros` | `gastos`), `fondo_fijo`, `tope_gasto` y `encargado_id`.
- `cajas.cerrar` deja de guardar `entregado_a` como dato suelto: crea la entrega. `cajas.depositar` sale de la custodia de quien deposita, no de un turno.
- El «retiro» del cajero desde su caja de cobros desaparece: los gastos en efectivo salen de la caja chica (pregunta N2). El pago en efectivo a un proveedor sale de caja chica hasta su tope; por encima, del banco.
- Documentos nuevos: `ledger.entregas`, `ledger.reposiciones`, `ledger.conteos_caja`. Los gastos de caja chica reúsan `ledger.egresos` con `comprobante` obligatorio.

**Caja sin factura (`fiscal = false`, PR #331).** Es una marca independiente del tipo: puede haber caja de cobros sin factura (recibos internos) y caja chica sin factura (gastos internos sin comprobante fiscal). El efectivo sigue el mismo camino; lo que no se mezcla son las cuentas de ingreso y gasto, que ya separa ese PR. Choque a resolver: ese PR describe una sola caja sin factura que «mueve entradas y salidas»; con este modelo serían dos (pregunta N1). B1 se integra después del PR #331.

**Permisos y visibilidad.** Se mantiene el alcance por caja que ya existe: el cajero ve su caja y sus entregas; el encargado, su caja chica; cada persona, su custodia; contabilidad y el dueño, todo. Permisos nuevos (se piden a A1 para `core/permisos.ts`): `cajas.recibir_entrega`, `cajas.ver_custodia`, `cajas.configurar`, `caja_chica.registrar_gasto`, `caja_chica.reponer`, `caja_chica.contar`. `cajas.depositar` ya existe.

**Multiempresa.** Cada caja, cada custodia y cada caja chica son de una empresa. Una entrega, un depósito o una reposición nunca cruzan de empresa; quien cobra para dos empresas hace dos entregas.

**Eventos nuevos** (a `contratos/eventos.md` y al catálogo de `CLAUDE.md` en la PR de B1 y B9): `caja.entregada`, `caja.entrega_recibida`, `caja_chica.repuesta`, `caja.contada`, `custodia.fuera_de_plazo`. `caja.cerrada` y `caja.depositada` no cambian de nombre.

Tableros: `PlanCajas` (camino del efectivo, caja chica, custodia y depósitos; cerrar y entregar, recibir, depositar, gasto, reponer, contar) y `PlanCajasMovil`.

### 5.8 Diferencias y retenciones al conciliar (respuesta del PM, 26 nov 2026)

Pedido del PM: que la diferencia aceptable se configure, con tope; que la conciliación tome en cuenta el tipo de cliente (retención de IVA) y otras diferencias conocidas.

**Configuración por empresa** (Configuración › Finanzas › «Diferencias al conciliar», tablero `PlanConciliarConfig`):

1. **Tope de quien concilia:** por línea y por día. Con Q 0.00 toda diferencia pide aprobación.
2. **Quién aprueba por encima del tope:** quien tenga `bancos.aprobar_diferencia`. Quien la pidió no puede aprobarla. Mientras espera, no hay asiento (queda como borrador, igual que los asientos manuales) y la línea no bloquea el resto.
3. **Motivos de diferencia**, cada uno con: nombre, cuándo se ofrece (de más o de menos, cuenta, método o proveedor de cobro, texto), cuánto se permite (monto fijo, porcentaje o sin límite), a qué cuenta va, si cuenta contra el tope y si siempre pide aprobación.

Motivos de fábrica:

| Motivo | A dónde va | Límite de fábrica | Contra el tope |
| --- | --- | --- | --- |
| Retención de IVA del cliente | IVA retenido por clientes (1.1.05) | El de su impuesto | No. Fija: no se apaga |
| Retención de ISR del cliente | ISR retenido por clientes (1.1.06) | El de su impuesto | No. Fija |
| Comisión del banco | Gastos bancarios (5.3.07) | Q 10.00 por línea | Sí |
| Comisión de pasarela o agente | Comisiones de pasarelas (5.1.02) | 4.5 % del cobro | No |
| Redondeo | Diferencias de cobro (5.3.05) | Q 0.05 | No |
| Faltó efectivo en el depósito | Faltantes de caja (5.2.06), a nombre de quien lo llevó | Sin límite propio | Sí |
| Otra razón | La cuenta que elija quien concilia (nunca caja, banco ni puente) | — | Siempre pide aprobación |

**Cómo entiende las retenciones.** Para cada factura pendiente de un cliente con perfil fiscal (lote B4), el monto esperado en el banco es `total − retención de IVA − retención de ISR`. Si una línea del banco coincide con ese monto, la sugerencia es «Pareja con retención»: muestra la cuenta (total, retención, lo que debe llegar) y al aceptar registra el pago con su retención, deja la factura pagada completa y anota la constancia en «Constancias por recibir». No usa el tope ni la cuenta de diferencias. Con empresa pequeño contribuyente no hay retención de IVA y esta sugerencia no aparece.

**Cómo se ve en la conciliación** (tablero `PlanContaConciliar`): el estado de la línea dice «Pareja con retención», «Diferencia Q 5.00» o «Sobre el tope». Al abrirla, los motivos que aplican aparecen con su cuenta y su límite; los que no aplican se ven apagados con la razón. Abajo, «Dentro de lo que puedes aceptar tú: Q 5.00 de Q 25.00». Si pasa del tope, el botón cambia a «Pedir aprobación» y pide explicación.

API nueva: `GET/PUT /bancos/ajustes-conciliacion` (`bancos.configurar_diferencias`), `GET/POST/PUT /bancos/motivos-diferencia`, `diferencias[] { motivo_id, monto, nota }` en `POST /bancos/conciliaciones`, `GET /bancos/diferencias-pendientes`, `POST /bancos/diferencias/:id/aprobar` y `/rechazar` (`bancos.aprobar_diferencia`). Eventos: `banco.diferencia_pendiente`, `banco.diferencia_aprobada`, `banco.diferencias_config_cambiada`. Reemplaza el `ajustes[]` simple de la primera versión de B3.

## 6. Tableros

Generador `generadores/conta_plan.py` (base `pend_base.py`, claro y oscuro). Página «Contabilidad: propuesta (pendiente de aprobación)» de `canvas.json`.

| Tablero | Qué muestra | Imágenes en `capturas/contabilidad/propuesta/` |
| --- | --- | --- |
| `PlanContaInicio`, `PlanContaInicioMovil` | Inicio con tareas, pasos, crear e indicadores | `inicio-escritorio`, `inicio-ayuda-escritorio`, `inicio-oscuro-escritorio`, `inicio-movil`, `inicio-pasos-movil` |
| `PlanContaConciliar`, `PlanContaConciliarMovil` | Conciliación guiada: 4 pasos, parejas, retención del cliente, diferencia con motivo, sobre el tope, regla, sin pareja | `conciliar-diferencia-escritorio`, `conciliar-retencion-escritorio`, `conciliar-sobre-tope-escritorio`, `conciliar-sin-pareja-escritorio`, `conciliar-oscuro-escritorio`, `conciliar-movil`, `conciliar-decision-movil` |
| `PlanConciliarConfig` | Configuración de diferencias: tope, quién aprueba, motivos con su cuenta | `conciliar-config-escritorio`, `conciliar-config-ayuda-escritorio` |
| `PlanCajas`, `PlanCajasMovil` | Cajas y efectivo: camino del efectivo, caja chica, custodia; cerrar y entregar, recibir, depositar, gasto, reponer | `cajas-camino-escritorio`, `cajas-chica-escritorio`, `cajas-custodia-escritorio`, `cajas-cerrar-entregar-escritorio`, `cajas-recibir-escritorio`, `cajas-depositar-escritorio`, `cajas-gasto-escritorio`, `cajas-reponer-escritorio`, `cajas-oscuro-escritorio`, `cajas-movil`, `cajas-chica-movil`, `cajas-recibir-movil` |
| `PlanClienteFiscal`, `PlanClienteFiscalMovil` | Ficha con «Nueva factura», tipo de impuesto y retención | `cliente-escritorio`, `cliente-nueva-factura-escritorio`, `cliente-tipo-impuesto-escritorio`, `cliente-movil`, `cliente-nueva-factura-movil`, `cliente-tipo-impuesto-movil` |
| `PlanIndicadorAyuda`, `PlanIndicadorAyudaMovil` | Patrón de indicador, estados, ayuda y palabras | `indicador-escritorio`, `indicador-movil`, `indicador-oscuro-movil` |

Diferencia conocida con el diseño aprobado: «Nueva factura» va en un panel lateral (formulario largo, no ventana), como pide el sistema visual.

## 7. Lotes y olas

Actualizado con las respuestas del PM (26 nov 2026). Complejidad: **alta** = toca asientos o varias acciones; **media** = una pantalla o una lectura; **baja** = menú, textos o permisos. Cada lote es una PR. Los de A3 regeneran `packages/contracts`; por eso dentro de una ola se mergean de uno en uno con `scripts/integrar.sh`. Los permisos nuevos se piden a A1 en `integration/a3.md`.

### Ola 1 (en paralelo)

| Lote | Dueño | Qué | Depende | Archivos | Pruebas | Complejidad |
| --- | --- | --- | --- | --- | --- | --- |
| AU1 | Auditor | Pruebas que fijan lo de hoy: E1, E3, E5 y E8 (saldo por libro = saldo por facturas tras cada operación del escenario generativo) | — | `apps/api/tests/contabilidad/plan_contabilidad.spec.ts`, `escenario_generativo.ts` | Las de E8 deben pasar ya; las de E1, E3 y E5 se escriben como comportamiento esperado y quedan marcadas hasta B1, B5 y B6 | Media |
| B1 | A3 | **Cajas I (§5.7):** `tipo` y `fondo_fijo` en la caja; custodia con su cuenta; entrega al cerrar con recepción («Recibí») y su asiento; depósito desde la custodia sin turno; apertura con el fondo fijo; plazo y tope de custodia; revisión nueva del cierre del mes | PR #331 integrado | `ledger/actions/cerrar_caja.ts`, `abrir_caja.ts`, `depositar_caja.ts`, `crear_caja.ts`, nuevas `entregar_caja.ts`, `recibir_entrega.ts`; `ledger/cajas.ts`, `resumen_turno.ts`, `transitos.ts`, `checks.ts`, `fiscal/l10n/gt/cuentas.ts`, migraciones (`node ace make:migration`), `start/routes/ledger.ts` y `bancos.ts`, `ledger/README.md`, `contratos/eventos.md`, `CLAUDE.md` (catálogo) | `tests/ledger/` cajas: entrega, recepción con diferencia, «lo deposito yo», depósito al día siguiente, multiempresa, idempotencia | Alta |
| B2 | A3 | `GET /contabilidad/inicio`: tareas con conteo y pasos del mes, por empresa activa y por permiso | — | `ledger/inicio_contabilidad.ts` (nuevo), `start/routes/ledger.ts`, `ledger/esquemas.ts`, permiso `contabilidad.ver_inicio` | `tests/ledger/inicio_contabilidad.spec.ts`: multiempresa, alcance, sin datos | Media |
| P1 | A4 | Menú «Finanzas» en 7 entradas (aprobado); pestañas dentro de cada pantalla; nombres en simple; permisos de página iguales a su API (E10) | — | `app/utils/navegacion.ts`, `components/ContaPestanas.vue`, `ContaComprasPestanas.vue`, `LibrosNavegacion.vue`, páginas de bancos, fiscal y libro; `tests/e2e/menu.spec.ts`, `permisos.spec.ts`; `pnpm verificar:permisos` | e2e de menú en escritorio y teléfono | Media |
| P2 | A4 | Conectar lo apagado: asiento manual y pestaña «Por aprobar», registrar gestión, indicadores del panel, favoritos y programar envío desde el visor, balance de comprobación | — | `pages/libro/index.vue`, `components/Libro*.vue`, `composables/useLibro.ts`, `pages/cartera/index.vue`, `pages/finanzas/index.vue`, `pages/reportes/index.vue`, `pages/reportes/[reporte].vue`, fixtures | Vitest por composable; e2e `libro`, `cartera`, `reportes` | Media |
| P3 | A4 | `ContaIndicador` con ayuda (reemplaza `ContaKpi`), `utils/ayudaIndicadores.ts`, aplicado en Panel, Cartera, Cajas y resumen fiscal | Después de P2 (`finanzas/index.vue`) | `components/ContaIndicador.vue`, `ContaKpi.vue`, `utils/ayudaIndicadores.ts`, `pages/cartera`, `pages/fiscal/tablero.vue` | Vitest del componente (5 estados, teclado), `accesibilidad.spec.ts` | Media |
| P4 | A4 | «Nueva factura» (aprobado): renombrar y sacar a la vista en ficha del cliente, Facturas y ficha del servicio; panel lateral; nota de crédito desde la lista | — | `components/CargoUnicoModal.vue` → `FacturaNuevaPanel.vue`, `pages/clientes/[id]/index.vue`, `pages/facturas/index.vue`, `pages/servicios/[id]/index.vue` | e2e escritorio y teléfono | Media |

### Ola 2 (depende de la ola 1)

| Lote | Dueño | Qué | Depende | Archivos | Pruebas | Complejidad |
| --- | --- | --- | --- | --- | --- | --- |
| B9 | A3 | **Cajas II, caja chica (§5.7):** gasto con comprobante obligatorio y tope; gasto con factura como compra pagada con caja chica; reposición desde custodia o banco; conteo; los gastos dejan de salir de la caja de cobros; caja chica sin factura | B1; preguntas N1 y N2 | `ledger/actions/registrar_egreso.ts`, `registrar_compra.ts`, `registrar_pago_proveedor.ts`, nuevas `reponer_caja_chica.ts`, `contar_caja.ts`; `ledger/egresos.ts`, `validators.ts`, migración, rutas, eventos | `tests/ledger/caja_chica.spec.ts`: efectivo + comprobantes = fondo en cada paso; tope; reposición sellada | Alta |
| B3 | A3 | **Conciliación I (§5.8):** ajustes de diferencias por empresa (tope por línea y por día), motivos con su cuenta y límite, `diferencias[]` al conciliar, aprobación por encima del tope sin asiento hasta aprobar, sugerencias con nivel, aceptar en lote, «por identificar» | — | `ledger/conciliacion.ts`, `ledger/actions/conciliar_linea.ts`, `aplicar_reglas_conciliacion.ts`, nuevas `configurar_diferencias.ts`, `crear_motivo_diferencia.ts`, `editar_motivo_diferencia.ts`, `aprobar_diferencia.ts`, `rechazar_diferencia.ts`; `validators_bancos.ts`, `start/routes/bancos.ts`, migración, `contratos/localizacion-fiscal.md` §10.4, eventos | `tests/ledger/` conciliación: motivo dentro y fuera de su límite, tope por línea y por día, aprobación por otro usuario, lote, idempotencia, multiempresa | Alta |
| B4 | A3 | Perfil fiscal del cliente (aprobado): Normal, Agente retenedor de IVA, Exento (apagado hasta tener la frase) y casilla «me retiene ISR»; la factura lo guarda en su instantánea; el estado de cuenta devuelve las retenciones esperadas; evento `cliente.perfil_fiscal_cambiado` | — | `billing/perfil_fiscal.ts` (nuevo), `billing/actions/asignar_perfil_fiscal.ts`, `emitir_factura.ts`, `emitir_cargo_unico.ts`, `registrar_pago.ts`, `estado_cuenta.ts`, migración, permiso `clientes.asignar_perfil_fiscal`, `contratos/eventos.md`, `CLAUDE.md` | `tests/billing/perfil_fiscal.spec.ts`: general y pequeño contribuyente, FEL falso, exento rechazado mientras esté apagado | Alta |
| P5 | A4 | Inicio de contabilidad (tablero `PlanContaInicio`) | B2, P3 | `pages/contabilidad/index.vue`, `composables/useInicioContabilidad.ts`, `navegacion.ts`, fixtures | Vitest y e2e en 1280 y 390; error con Reintentar | Media |
| P8 | A4 | **Cajas y efectivo (tablero `PlanCajas`):** camino del efectivo, cerrar y entregar, recibir, custodia y depósitos; teléfono con «Recibir» | B1 | `pages/caja/index.vue`, `components/Caja*.vue`, `CajaDepositoSlideover.vue`, `composables/useCajas.ts`, nuevo `useCustodia.ts`, fixtures | `tests/e2e/cierre-caja.spec.ts` ampliada; teléfono | Alta |
| AU2 | Auditor | Invariantes de efectivo: caja de cobros cerrada = fondo fijo + entregas por recibir; custodia en libro = entregas recibidas − depósitos − reposiciones, por persona; nada sale de una caja de cobros que no sea entrega; activa las pruebas de E1 | B1 | `tests/contabilidad/plan_contabilidad.spec.ts`, `cajas_bancos.spec.ts`, `escenario_generativo.ts` | — | Media |

### Ola 3

| Lote | Dueño | Qué | Depende | Archivos | Pruebas | Complejidad |
| --- | --- | --- | --- | --- | --- | --- |
| B10 | A3 | **Conciliación II, retenciones (§5.8):** monto esperado por factura según el perfil fiscal, sugerencia «pareja con retención», pago con retención y «constancia por recibir», revisión del cierre «constancias pendientes» | B3, B4; pregunta N6 | `ledger/conciliacion.ts`, `ledger/retenciones.ts`, `billing/actions/registrar_pago.ts`, `ledger/checks.ts`, `ledger/constancias.ts` | `tests/ledger/conciliacion_retenciones.spec.ts`: IVA, ISR, las dos, pequeño contribuyente | Alta |
| B5 | A3 | Anular depósito (vuelve a la custodia); devolver saldo a favor (`pagos.devolver_saldo`) | B1 | `ledger/actions/anular_deposito.ts`, `billing/actions/devolver_saldo_favor.ts`, `ledger/reversos.ts` | `tests/ledger`, `tests/billing` | Alta |
| B6 | A3 | Cartera a una fecha con saldo histórico (desde el auxiliar del libro) | — | `billing/reportes/reportes.ts`, `contratos/reportes.md` | `tests/billing/reportes*` | Media |
| P6 | A4 | **Conciliación guiada y su configuración (tableros `PlanContaConciliar` y `PlanConciliarConfig`):** pasos, parejas, motivos con su límite, tope, pedir y dar aprobación | B3 | `pages/bancos/extractos/[id].vue`, `components/Conciliar*.vue`, nueva `pages/configuracion/diferencias-conciliacion.vue`, `composables/useExtractos.ts`, `useConciliaciones.ts`, `utils/configuracionSecciones.ts` | `tests/e2e/fase4-bancos.spec.ts` ampliada; teléfono | Alta |
| P7 | A4 | Ficha del cliente: tarjeta «Impuestos de este cliente», tipo de impuesto, retención en «Nueva factura» y en Cobrar; misma tarjeta en el proveedor | B4, P4 | `pages/clientes/[id]/index.vue`, `components/ClienteFiscal*.vue`, `FacturaNuevaPanel.vue`, `pages/cobro/index.vue`, `pages/proveedores/[id].vue` | e2e cobro con retención; Vitest | Alta |
| P12 | A4 | Caja chica en el panel (pestaña de `PlanCajas`): gasto con foto, reponer, contar; teléfono | B9, P8 | `pages/caja/index.vue`, `components/CajaChica*.vue`, `composables/useCajaChica.ts` | e2e en 1280 y 390 | Media |
| AU3 | Auditor | Diferencias: cada motivo cae en su cuenta y nunca en caja, banco ni puente; lo aprobado y lo pendiente cuadran con el reporte de conciliación; caja chica: efectivo + comprobantes = fondo tras cada operación generada | B3, B9 | `tests/contabilidad/hallazgos_plan.spec.ts` | — | Media |

### Ola 4

| Lote | Dueño | Qué | Depende | Archivos | Pruebas | Complejidad |
| --- | --- | --- | --- | --- | --- | --- |
| B7 | A3 | Subcuentas de gasto e ingreso desde el panel (`libro.crear_cuenta`, `libro.desactivar_cuenta`); tipo de cuenta en palabras | — | `ledger/actions/crear_cuenta.ts`, `ledger/plan_cuentas.ts`, rutas | `tests/ledger/cuentas.spec.ts` | Media |
| B8 | A3 | Permisos propios para deshacer (E9) con migración de roles; anticipo a proveedor | A1 (`core/permisos.ts`) | `start/routes/{bancos,compras,activos,billing}.ts`, `ledger/actions/registrar_pago_proveedor.ts`, seed de roles | `tests/core/acl`, `pnpm verificar:permisos` | Media |
| P9 | A4 | Asistente «Cerrar el mes»: cada revisión con su botón «Arreglar», en el orden de los pasos; «Cerrar el año» con lo que falta | P5 | `pages/libro/cierres.vue`, `components/LibroCierres.vue`, `composables/useChecksCierre.ts` | `tests/e2e/checks-cierre.spec.ts` | Media |
| P10 | A4 | Gasto unificado («con factura / sin factura») y plan de cuentas con subcuentas | B7, B9 | `pages/compras/nueva.vue`, `pages/egresos/index.vue`, `pages/libro/index.vue` | e2e compras | Media |
| P11 | A4 | Devolver saldo a favor, anular depósito, anticipo a proveedor | B5, B8 | `pages/clientes/[id]`, `pages/caja`, `pages/pagos-proveedores.vue` | e2e | Media |
| P13 | A4 | Retenciones en la conciliación («pareja con retención») y lista «Constancias por recibir» | B10, P6, P7 | `components/Conciliar*.vue`, `pages/constancias.vue` | e2e | Media |
| AU4 | Auditor | Retenciones: lo esperado = lo retenido = constancias; recorrido completo de un mes con el escenario generativo siguiendo los 7 pasos | todo | `tests/contabilidad/generativo.spec.ts` | — | Media |

Qué no se pisa: en cada ola A3 trabaja en archivos distintos (cajas, lectura nueva, conciliación, facturación) y A4 separa menú (P1), libro y reportes (P2), componente (P3), facturas (P4), cajas (P8, P12) y conciliación (P6, P13). `pages/caja/index.vue` lo tocan P3, P8 y P12 en olas distintas. `registrar_pago.ts` lo tocan B4 y B10 en olas distintas.

## 8. Preguntas para el PM

### 8.1 Respondidas (26 nov 2026)

| # | Pregunta | Respuesta |
| --- | --- | --- |
| 1 | Finanzas en 7 entradas con «Inicio» primero | **Aprobado** |
| 2 | «Cargo único» pasa a «Nueva factura» y queda a la vista | **Aprobado** |
| 3 | Tipos de impuesto del cliente | **Aprobado:** Normal, Agente retenedor de IVA, Exento y la casilla «me retiene ISR» |
| 4 | «Exento» apagado hasta tener la frase del contador | **Aprobado** |
| 5 | Efectivo entregado al cerrar la caja | Reemplazada por el modelo de cajas (§5.7) |
| 6 | Tope de diferencia al conciliar | Configurable por empresa, con retenciones y motivos (§5.8) |
| 7 | Una sola puerta para gastos | Aprobado como se propuso; el gasto en efectivo sale de la caja chica |
| 8 | Anular depósito, devolver saldo a favor, anticipo a proveedor | Aprobado como se propuso |
| 9 | Gastos que se repiten cada mes | Después de este plan |
| 10 | Aprobación de compras y pagos a proveedores | No por ahora |
| 11 | Subcuentas creadas por contabilidad | Sí; se desactivan, no se borran |
| 12 | Conciliación en el teléfono | Aceptar y decidir; subir estado de cuenta, reglas y configuración, solo en escritorio |
| 13 | Textos de ayuda revisados por el contador | Sí |
| 14 | Pasos del mes automáticos | Sí |

### 8.2 Nuevas (con recomendación)

- **N1. Caja sin factura y los dos tipos.** El PR #331 describe una caja sin factura que cobra y también paga. Con dos tipos serían una caja de cobros sin factura y una caja chica sin factura. Recomendación: sí, dos; lo que ya se pagó desde una caja sin factura se queda como está y lo nuevo sale de su caja chica.
- **N2. ¿Se quita el «retiro» del cajero desde la caja de cobros?** Hoy puede sacar para un gasto hasta un tope. Recomendación: sí, se quita; los gastos en efectivo salen solo de la caja chica. En un ISP de una persona, esa persona es cajera y encargada de la caja chica.
- **N3. Plazo y tope de la custodia.** Recomendación: 1 día hábil y Q 5,000.00 por persona de fábrica, configurables por empresa; pasarse avisa al dueño y a contabilidad, no bloquea cobros.
- **N4. ¿Quién puede recibir una entrega?** Recomendación: permiso propio; de fábrica admin y contabilidad. «Lo deposito yo» permitido de fábrica y se puede apagar por empresa.
- **N5. ¿La caja chica se puede reponer con efectivo de la custodia?** Recomendación: sí, además del banco; es lo práctico y queda documentado. Nunca directo desde una caja de cobros.
- **N6. Cliente que retiene y aún no entrega la constancia.** Recomendación: la factura queda pagada, la constancia queda «por recibir» con aviso en el cierre del mes, y la retención no se usa en la declaración hasta tenerla (confirmar con el contador).
- **N7. Tope de diferencias de fábrica.** Recomendación: Q 10.00 por línea y Q 50.00 por día; cada empresa lo cambia. Los tableros muestran Q 25.00 y Q 100.00 como ejemplo de una empresa que ya lo subió.
- **N8. Diferencia al recibir una entrega.** Recomendación: queda como faltante o sobrante del turno con el nombre de quien entregó; Argos no descuenta nada de planilla.
- **N9. Fondo fijo de fábrica.** Recomendación: Q 200.00 de cambio por caja de cobros y Q 2,000.00 de caja chica con tope de Q 300.00 por gasto, configurables por caja.
