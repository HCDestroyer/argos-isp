---
orden: 1
pantallas:
    - /libro
---

# Libro

El libro contable de la empresa: cada factura, pago, egreso, compra o cierre de caja deja aquí su asiento de doble partida. Desde esta pantalla consultas el diario y el mayor, ves el balance y el estado de resultados, cierras los meses y el ejercicio, y compruebas que nadie alteró el libro.

Está en **Contabilidad → Libro**.

::: tip El libro no se edita
Ningún asiento se modifica ni se borra. Todo error se corrige con un asiento nuevo (un reverso o la anulación del documento que lo generó), y el original queda como estaba.
:::

## Quién la usa

- Para verla necesitas `libro.ver`. Lo traen los roles **admin**, **contabilidad** y **lectura**.
- Revertir asientos (`libro.revertir_asiento`), cerrar meses (`libro.cerrar_periodo`), correr la lista de verificación (`cierres.verificar`) y supervisar anomalías (`cierres.revisar_check`): **contabilidad** y **admin**.
- Reabrir un mes (`libro.reabrir_periodo`): solo **admin**.
- Cerrar el ejercicio (`libro.cerrar_ejercicio`): **contabilidad** y **admin**. Reabrirlo (`libro.reabrir_ejercicio`): solo **admin**.

## Qué ves

La pantalla tiene ocho pestañas. Las fechas son fechas contables, en día de Guatemala.

| Pestaña        | Qué muestra                                                                |
| -------------- | -------------------------------------------------------------------------- |
| **Diario**     | Los asientos en orden, con sus movimientos y el total debe/haber           |
| **Mayor**      | Los movimientos de una cuenta con su saldo acumulado                       |
| **Balance**    | Balance de saldos de cada cuenta a una fecha                               |
| **Resultados** | Estado de resultados: ingresos, gastos y resultado de un rango             |
| **Cierres**    | La lista de verificación del mes y los meses cerrados                      |
| **Integridad** | La verificación de la cadena de sellos del libro                           |
| **Diarios**    | Los diarios de la empresa (ventas, compras, caja…) y su numeración por año |
| **Ejercicios** | Los cierres anuales                                                        |

### Diario

Filtros: **Periodo** (los últimos 12 meses, «Todo el libro» o «Fechas personalizadas»), **Desde**, **Hasta** y **Origen** (factura, pago, mora, nota de crédito, egreso, cierre de caja, ajuste, compra, pago a proveedor, depreciación y los demás tipos de asiento). «Limpiar filtros» los quita.

Cada asiento se ve como una tarjeta con:

- Número de asiento y fecha; el diario y su número en el año (por ejemplo `VEN 2026-000123`) y, si el mes ya se cerró, su número de partida.
- La descripción y una etiqueta con el origen. Si el origen tiene documento (una factura, un pago, una compra), la etiqueta es un enlace a él.
- Las etiquetas «Revertido por #…» o «Reverso del #…» cuando el asiento tiene reverso.
- Las líneas con cuenta, cliente (si aplica), debe y haber, y el total al pie. Si no cuadrara, verías la etiqueta roja «No cuadra».

Arriba de la lista ves los **Totales de la página** con la etiqueta **Cuadra** (verde) o **No cuadra** (roja).

### Mayor

1. Elige la cuenta en **Elige la cuenta** (solo aparecen las cuentas que reciben movimientos).
2. Ajusta el periodo o las fechas.
3. Si la cuenta lleva auxiliar por cliente (por ejemplo, cuentas por cobrar), puedes elegir un cliente en **Auxiliar de un cliente (opcional)** para ver solo sus movimientos.

Arriba ves la cuenta, el **Saldo inicial**, el debe y haber de la página y el **Saldo final**. La tabla trae fecha, concepto (con el número de asiento y el cliente), debe, haber y saldo.

### Balance y Resultados

- **Balance**: elige la fecha de **Saldos al**. Sin fecha, son los saldos a hoy. Cada empresa muestra sus cuentas con debe, haber y saldo, los totales de activo, pasivo, ingresos, gastos y resultado, y la etiqueta **Cuadra** o **No cuadra**.
- **Resultados**: elige **Desde** y **Hasta**. Sin fechas, muestra el mes en curso.
- Si ves varias empresas, arriba aparece el **Total del grupo**: es la suma de los libros de cada empresa, pero cada NIT declara solo el suyo.

### Diarios

La tabla muestra cada diario con su código, tipo, empresa, cuenta por defecto, numeración (año y último número) y si está activo. Pulsa el código para abrir el detalle con la numeración por año («último» y «siguiente»).

Cada asiento recibe el siguiente número de su diario en el año al registrarse, y ese número nunca cambia. El número de partida del Libro Diario se asigna al cerrar el mes.

## Acciones

### Revertir un asiento

- **Permiso:** `libro.revertir_asiento`
- **Dónde:** botón «Revertir» en la tarjeta del asiento (pestaña Diario).
- **Qué pasa:** se registra un asiento espejo (debe y haber invertidos) con la fecha de hoy. El original no cambia y queda marcado «Revertido por #…». Pide un motivo.
- **Cuándo no aparece:** solo se revierten aquí los asientos sin documento, como un cierre de caja o un ajuste. Los que vienen de una factura, un pago, un egreso, una compra o una nota de crédito muestran «No se revierte aquí: …» con el enlace «Ir al documento»: se corrigen anulando ese documento.
- **Se puede deshacer:** no. Un asiento se revierte una sola vez y un reverso no se revierte.

### Verificar la lista de cierre del mes

- **Permiso:** `cierres.verificar`
- **Dónde:** pestaña **Cierres**, sección «Lista de verificación»: elige el mes y pulsa «Verificar».
- **Qué pasa:** se corren los controles del mes y se muestra cada uno con su valor esperado, el obtenido y su estado: **En orden** (verde), **Anomalía** (rojo) o **Supervisado** (ámbar). Una etiqueta arriba dice «El mes pasa la lista» o cuántos quedan «por resolver». Los checks marcados «Aviso» nunca bloquean.

Algunos de los controles: antigüedad de cartera igual al saldo de cuentas por cobrar, ningún turno de caja abierto del periodo, depósitos y traslados en tránsito, líneas de extracto conciliadas, ningún DTE pendiente o en contingencia del periodo, compras sin mes del IVA, numeración de los diarios sin huecos, cadena de sellos verificada, cuotas de activos y diferidos contabilizadas.

### Supervisar una anomalía

- **Permiso:** `cierres.revisar_check`
- **Dónde:** botón «Supervisar» en el check con anomalía.
- **Qué pasa:** escribes una nota (por ejemplo, «el depósito del 31/07 lo acreditó el banco el 03/08») y el cierre puede pasar con esa anomalía mientras el cálculo no cambie. Si al verificar de nuevo el valor es otro, hay que supervisarla otra vez. La nota queda en el historial con tu nombre.
- **Deshacer:** «Retirar supervisión» devuelve el check a anomalía y vuelve a bloquear el cierre.

### Cerrar un mes

- **Permiso:** `libro.cerrar_periodo`
- **Dónde:** pestaña **Cierres**, botón «Cerrar un mes». Elige el **Mes** (solo meses terminados) y pulsa «Cerrar …».
- **Qué pasa:** desde ese momento ningún asiento puede tener fecha en ese mes: ni facturas, pagos, egresos, compras ni reversos. Lo que se corrija se registra en el mes abierto. Antes de cerrar se sellan los asientos pendientes, se verifica la cadena y se exige que la lista de verificación pase. Se guarda el resumen del mes (asientos, debe y haber) y se asignan los números de partida.
- **Se puede deshacer:** solo un admin, reabriendo el mes con motivo.

Si el cierre falla, el diálogo lo explica:

- Los checks pendientes aparecen en una lista, con el botón «Ver la lista de verificación».
- Si hay notas de crédito sin certificar, aparecen con su enlace y el botón «NCRE en la cola de DTE».
- Si la cadena del libro no verifica, el botón «Ver integridad del libro».

El paso a paso completo, con lo que revisar antes, está en el [runbook de cierre mensual](../../runbooks/cierre-mensual.md) y en el tutorial [Cerrar el mes](../../tutoriales/contabilidad/cerrar-el-mes.md).

### Reabrir un mes

- **Permiso:** `libro.reabrir_periodo` (solo admin)
- **Dónde:** botón «Reabrir» en la fila del mes cerrado, pestaña **Cierres**.
- **Qué pasa:** el mes vuelve a admitir asientos con fecha en él. El cierre anterior queda en el historial como **Reabierto**, con quién, cuándo y tu motivo. Las partidas ya asignadas no cambian.
- **Cuándo no se puede:** bajo el bloqueo duro, con el ejercicio del año cerrado, o si un mes posterior ya cerrado del mismo año tiene partidas (se reabren primero los más recientes).

### Verificar la integridad del libro

- **Permiso:** `libro.ver`
- **Dónde:** pestaña **Integridad**. Puedes acotar por fecha contable (**Desde**, **Hasta**) o por número de sello (**Desde el sello**, **Hasta el sello**) y pulsar «Verificar». «Todo el libro» quita el rango.
- **Qué pasa:** cada asiento confirmado recibe un sello con la huella del anterior; si alguien alterara el libro en la base de datos, la cadena dejaría de verificar. Por empresa ves **Cadena verificada** (verde) o **Cadena rota** (roja), los sellos de la cadena, los recalculados, los asientos aún sin sellar y la primera y última huella.
- Los asientos sin sellar reciben su sello en el próximo minuto; el cierre del mes los sella antes de cerrar.

::: danger Cadena rota
Si ves «Ruptura en el sello …», no cierres ni bloquees periodos. Pulsa «Ver asiento #…» para ver cuál es y avisa al administrador del sistema.
:::

### Cerrar el ejercicio

- **Permiso:** `libro.cerrar_ejercicio`
- **Dónde:** pestaña **Ejercicios**, botón «Cerrar ejercicio». Necesitas tener una empresa elegida en el selector de empresa (con «Todas» solo se ven).
- **Qué pasa:** con fecha 31 de diciembre se provisiona el ISR, se cancelan ingresos y gastos contra resultados, se traslada el resultado, se registra la reserva legal y se cierra diciembre.
- **El ISR:** si el año tiene declaración ISR anual revisada, el ISR y lo acreditado salen de ella y no se escriben a mano. Si la declaración existe pero no está revisada, el diálogo te pide revisarla primero. Si el año no tiene declaración en ArgosIsp, escribes el **ISR del ejercicio** (0.00 si no hay), los **Pagos trimestrales** y el **ISO acreditado**, con una nota de dónde salen.
- Marca «Entiendo que el cierre de … registra sus asientos con fecha 31/12 y cierra diciembre» y pulsa «Cerrar …».
- **Requisitos:** enero a noviembre cerrados, diciembre abierto, ningún DTE pendiente o en contingencia del año y ningún año anterior sin cerrar.

El tutorial [Cerrar el ejercicio](../../tutoriales/contabilidad/cerrar-el-ejercicio.md) lo explica paso a paso.

### Reabrir el ejercicio

- **Permiso:** `libro.reabrir_ejercicio` (solo admin)
- **Dónde:** botón «Reabrir» en la fila del ejercicio cerrado.
- **Qué pasa:** se revierten los asientos del cierre con fecha 31 de diciembre y diciembre vuelve a estar abierto. El cierre queda como **Reabierto**, con tu motivo. Si el año siguiente ya está cerrado, primero hay que reabrir ese.

## Preguntas frecuentes y errores

| Mensaje o situación                                         | Qué significa                                          | Qué hacer                                                        |
| ----------------------------------------------------------- | ------------------------------------------------------ | ---------------------------------------------------------------- |
| «Cerrar un mes» está gris                                   | No hay meses terminados por cerrar o la lista no cargó | Espera a que termine el mes o pulsa «Reintentar»                 |
| El mes todavía no termina                                   | Solo se cierran meses terminados (hora de Guatemala)   | Ciérralo a partir del día 1 del mes siguiente                    |
| Ya estaba cerrado                                           | Otro usuario lo cerró antes                            | Revisa la lista de cierres                                       |
| Checks pendientes al cerrar                                 | Algún control del mes está en anomalía                 | Corrige la causa o supervisa la anomalía con una nota            |
| La cadena del libro no verifica                             | La cadena de sellos está rota                          | No cierres; abre **Integridad** y avisa al administrador         |
| «No se revierte aquí»                                       | El asiento tiene un documento                          | Pulsa «Ir al documento» y anúlalo desde ahí                      |
| No veo el botón «Reabrir»                                   | Reabrir es solo de admin                               | Pide a un admin que lo haga, con el motivo                       |
| Cerrar ejercicio: «El ejercicio todavía no se puede cerrar» | Falta un requisito (meses abiertos, DTE pendientes…)   | El mensaje lista cada requisito; resuélvelos y vuelve a intentar |
| «La declaración ISR anual no está revisada»                 | El cierre toma el ISR de esa declaración               | Ábrela desde el aviso y revísala                                 |

## Relacionado

- [Bloqueos del libro](./bloqueos.md)
- [Libros legales](./libros-legales.md)
- [Egresos](./egresos.md)
- [Runbook de cierre mensual](../../runbooks/cierre-mensual.md)
- [Tutorial: cerrar el mes](../../tutoriales/contabilidad/cerrar-el-mes.md)
