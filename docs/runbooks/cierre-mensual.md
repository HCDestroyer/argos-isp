# Runbook · Cierre mensual del libro

Para contabilidad. Qué revisar antes de cerrar un mes, cómo cerrarlo en el panel, qué hacer si algo no cuadra y cómo se corrige después. Verificado contra el panel (`/libro`, pestaña **Cierres**) y la API (`POST /libro/periodos/cerrar`, `POST /libro/periodos/reabrir`, `GET /libro/periodos`) de la semana 3.

## Qué hace el cierre

- Después de cerrar un mes, **ningún asiento puede tener fecha en ese mes**: facturas, pagos, egresos, cierres de caja y reversos se registran en el mes abierto. Lo impide la acción y también la base de datos.
- Guarda un resumen del mes: asientos, debe, haber y el movimiento de cada cuenta.
- Solo se cierran **meses terminados** (hora de Guatemala).
- Permisos: cerrar = `libro.cerrar_periodo` (contabilidad y admin). Reabrir = `libro.reabrir_periodo` (solo admin), siempre con motivo.

## 1. Antes de cerrar (primeros días del mes siguiente)

Haz la lista en orden. Si algo falla, no cierres hasta resolverlo.

1. **Cajas cerradas.** Menú **Caja**: cada caja debe decir "Cerrada". Un turno abierto desde el mes anterior registrará su cierre (y su faltante o sobrante) con la fecha del día en que se cierre, ya en el mes nuevo. Pide al cajero que lo cierre y revisa **Reportes → Cierres de caja** del mes.
2. **Comprobantes pendientes.** Menú **Comprobantes**: revisa los pendientes y su fecha de depósito; aprueba o rechaza los del mes. (La API ya filtra por `desde`/`hasta` de depósito y da el total de pendientes; el panel los mostrará cuando A4 lo adopte.) Un comprobante aprobado después del cierre registra el pago con la fecha de hoy (mes nuevo).
3. **Egresos del mes.** Menú **Egresos**, **Desde** y **Hasta** = el mes. Registra las facturas de proveedores que faltan (energía, tránsito, nómina…) con su fecha del mes. Después del cierre ya no se puede.
4. **Pagos en línea.** La conciliación diaria con la pasarela corre sola a las 06:30. Si hay diferencias (`GET /pasarela/conciliaciones`; hoy no hay pantalla), resuélvelas antes de cerrar.
5. **El libro cuadra.** **Libro → Diario**, periodo = el mes. Arriba debe decir **Cuadra** (debe = haber). Si dice **No cuadra**, no cierres: escala a sistemas (no debería pasar; hay una restricción en la base de datos).
6. **Reportes del mes** (Reportes, con el mes como filtro), descárgalos en Excel para el archivo:
    - **Facturado vs cobrado**
    - **IVA**
    - **Ingresos** por método
    - **Cartera vencida** al último día del mes
    - **Egresos** por categoría

## 2. Cerrar el mes

1. Menú **Libro** → pestaña **Cierres**.
2. **Cerrar un mes** → elige el **Mes** → lee "Qué implica cerrar".
3. Botón **Cerrar <mes>**. Aparece en la lista con estado cerrado, quién y cuándo.

| Mensaje                | Qué significa                    | Qué hacer                              |
| ---------------------- | -------------------------------- | -------------------------------------- |
| 422 `periodo_en_curso` | El mes no ha terminado           | Espera al primer día del mes siguiente |
| 409 `periodo_cerrado`  | Ya estaba cerrado                | Nada; revisa la lista                  |
| 403                    | No tienes `libro.cerrar_periodo` | Pide el rol contabilidad               |

## 3. Si después del cierre aparece un error del mes cerrado

Regla: **nunca se corrige con UPDATE ni DELETE** sobre la base de datos (las tablas del libro lo rechazan y además se pierde la auditoría). Toda corrección es un registro nuevo.

| Error                                                                                                   | Corrección                                                                                          | Dónde                 |
| ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | --------------------- |
| Pago mal registrado                                                                                     | **Anular pago** con motivo: el reverso va con fecha de hoy (mes abierto) y el servicio se re-evalúa | Pagos → el pago       |
| Factura emitida por error, sin pagos                                                                    | **Anular** con motivo (reverso con fecha de hoy). Si tiene pagos, anula primero los pagos           | Facturas → la factura |
| Egreso equivocado                                                                                       | **Anular** con motivo y registrarlo bien (con fecha de un mes abierto)                              | Egresos               |
| Cobro de más, descuento o devolución al cliente                                                         | Nota de crédito: **todavía no existe en el sistema**                                                | Escalar               |
| Asiento que hay que revertir y no es un pago, factura ni egreso (p. ej. un cierre de caja mal digitado) | Asiento de reverso: **hoy no hay pantalla**                                                         | Escalar               |

El reverso queda en el mes en que se hace, no en el mes del error: el resumen del mes cerrado no cambia, y el mes siguiente muestra la corrección. Es lo esperado.

## 4. Reabrir un mes (excepcional)

Solo si hace falta registrar algo **con fecha del mes cerrado** (p. ej. una factura de proveedor que llegó tarde y contabilidad la quiere en ese mes) y una corrección en el mes abierto no sirve.

1. Admin: **Libro → Cierres** → **Reabrir** en el mes → escribe el motivo (ej.: "falta registrar la factura de energía de septiembre").
2. Registra lo que faltaba.
3. Repite la lista del paso 1 y vuelve a **cerrar** el mes.

La reapertura no borra el cierre anterior: queda en la lista y en la bitácora con quién, cuándo y por qué.

## Importación desde Mikrowisp

Los saldos y pagos históricos importados no pueden tener fecha en un mes cerrado (el importador recibe 422 `periodo_cerrado`). Importa antes de cerrar el primer mes en ArgosIsp. Si ya está cerrado, reabre ese mes con motivo "importación", importa y vuelve a cerrarlo.

## Escalar

| Situación                                                                                | A quién                                                                                      |
| ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Reabrir un mes                                                                           | Administrador (rol admin)                                                                    |
| Nota de crédito, asiento de ajuste o de reverso sin pantalla, diferencia en el IVA       | Contabilidad, con el equipo de sistemas                                                      |
| El diario dice "No cuadra", un reporte no coincide con el libro, el cierre falla con 500 | Equipo de sistemas (backend de facturación). Incluye el mes, la pantalla y el mensaje exacto |
