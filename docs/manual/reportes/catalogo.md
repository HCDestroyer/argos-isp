---
orden: 1
pantallas:
    - /reportes
    - /reportes/[reporte]#como-se-usa-un-reporte
    - /reportes/balance
    - /reportes/resultados
---

# Reportes del panel

Los reportes de cartera, ingresos, cobranza, cajas, IVA, promesas, altas y bajas, egresos, bonificaciones y cuentas por pagar. Cada uno se filtra, muestra sus totales y se descarga en CSV o Excel con los mismos filtros.

Está en **Reportes → Reportes**. A la izquierda eliges la categoría (Cobranza y cartera, Ingresos y clientes, Caja y bancos, Contabilidad y Fiscal), en medio buscas el reporte («morosos», «IVA», «caja») y lo abres con un toque. **Contabilidad** trae además el **Balance general** y el **Estado de resultados**; **Lealtad** abre el reporte del programa de puntos. A la derecha verás los envíos programados y las descargas recientes cuando la API los dé.

## Quién la usa

Todos los reportes piden `reportes.ver` (**admin**, **contabilidad** y **lectura**). Algunos filtros piden además el permiso de su catálogo; sin él, el filtro no aparece:

| Filtro  | Permiso        |
| ------- | -------------- |
| Zona    | `zonas.ver`    |
| Router  | `routers.ver`  |
| Plan    | `planes.ver`   |
| Caja    | `cajas.ver`    |
| Cliente | `clientes.ver` |
| Motivo  | `facturas.ver` |

## Cómo se usa un reporte

1. Abre el reporte desde la lista.
2. Los filtros van arriba de la tarjeta (en el teléfono, en «Filtros», que muestra cuántos tienes puestos). Sin fechas, el reporte usa los últimos 12 meses; los reportes de antigüedad usan el corte de hoy. Arriba de la tabla se ve el rango que se aplicó.
3. La tabla se actualiza sola. La fila de abajo trae los totales.
4. «Excel» descarga el reporte con los mismos filtros; el CSV está en «⋯». «PDF» y «Programar envío» se activan cuando la API los dé.
5. «Limpiar» quita los filtros. Los filtros quedan en la dirección de la página: puedes guardarla o compartirla.

Las fechas son días de Guatemala. Si un reporte no trae filas verás «Sin datos en el periodo» o «Sin datos para estos filtros». Si la descarga falla, verás «No se pudo descargar el reporte»; si la consulta falla, el error con «Reintentar».

## Cartera vencida

Saldo pendiente de las facturas (servicio y mora) por antigüedad al corte: **Por vencer**, **0-30 días**, **31-60 días**, **61-90 días**, **Más de 90 días**, **Total vencido** y **Total pendiente**, con el número de facturas.

- **Filtros:** **Antigüedad al** (el corte; vacío, hoy), **Agrupar** por cliente, zona, router o plan, y cliente, zona, router y plan.

## Facturado vs cobrado

Por mes del periodo de la factura: **Facturas**, **Facturado** (IVA incluido), **Cobrado**, **Notas de crédito**, **Pendiente** y **% cobrado**. Pendiente = Facturado − Cobrado − Notas de crédito.

- **Filtros:** rango, **Origen** (registrado en ArgosIsp o importado), **Facturas** (solo servicio o solo recargos por mora), cliente, zona, router y plan.
- Las facturas importadas de otro sistema cuentan en el mes de su periodo de origen; «Facturado importado» y «Cobrado importado» separan esa parte.

## Ingresos

Pagos recibidos por periodo y método: **Pagos**, **Monto**, **Comisión** y **Neto**.

- **Filtros:** rango, **Origen**, **Agrupar** por mes o por día, **Método de pago**, cliente y zona.
- Incluye los pagos importados en su mes de origen; «Pagos importados» y «Monto importado» separan esa parte. No incluye pagos anulados ni pendientes de verificación.

## Cobranza diaria

Cobros de cada día por método y caja: **Pagos**, **Cobrado**, **Anulados** y **Monto anulado**. Los anulados van aparte y no suman en lo cobrado.

- **Filtros:** rango, **Método de pago** y **Caja**.

## Cierres de caja

Los turnos cerrados en el rango: turno, caja, cuándo se abrió y se cerró, quién, **Fondo inicial**, **Cobrado**, **Egresos**, **Esperado**, **Contado**, **Diferencia** y su **Motivo**.

- **Filtros:** rango y **Caja**.
- Ver también el [runbook de cierre de caja](../../runbooks/cierre-de-caja.md).

## IVA

Por mes contable: facturas emitidas, **Base gravable** e **IVA facturado**; facturas anuladas con su base e IVA; notas de crédito con su base e IVA acreditado; el **IVA débito neto** y el **Saldo del mes en 2.1.02**.

- **Filtros:** rango.
- IVA débito neto = IVA facturado − IVA anulado − IVA acreditado (en el mes de cada nota). Debe coincidir con el saldo del mes de la cuenta de IVA débito del libro.

## Promesas de pago

Por mes de creación y canal (operador, supervisor, portal del cliente, agente de IA): **Creadas**, **Rechazadas**, **Pendientes de aprobación**, **Activas**, **Cumplidas**, **Incumplidas**, **Canceladas**, **Monto prometido** (sin las rechazadas) y **% cumplimiento** (cumplidas entre cumplidas más incumplidas).

- **Filtros:** rango, **Canal**, cliente, zona, router y plan.

## Altas y bajas

Por mes: **Altas** (servicios por su primer día facturable), **Bajas (retiros)**, **Suspensiones**, **Limitaciones**, **Reactivaciones** y **Altas − bajas**. Los servicios pendientes de instalación no cuentan como alta.

- **Filtros:** rango, zona, router y plan.

## Egresos

Gastos vigentes por mes contable y categoría: categoría, nombre, **Cuenta**, número de **Egresos** y **Monto**.

- **Filtros:** rango, **Categoría** y **Pagado con**.

## Bonificaciones

Periodos regalados y cargos sin costo por mes, motivo y origen (mes gratis, descuento del 100 %, canje de lealtad, cargo sin costo): **Bonificaciones**, **Valor bruto** (lo que no se cobró, IVA incluido) y **Base sin IVA**.

- **Filtros:** rango, **Origen**, **Motivo** y cliente.
- Reemplaza al antiguo reporte de facturas sin costo: lo regalado ya no se factura, queda como bonificación.

## Cuentas por pagar

Lo que se debe a cada proveedor por antigüedad al corte: proveedor, NIT, **Documentos**, **Por vencer**, **1-30 días**, **31-60 días**, **61-90 días**, **Más de 90 días**, **Vencido** y **Total**.

- **Filtros:** **Antigüedad al** (el corte).

## Relacionado

- [Runbook de cierre mensual](../../runbooks/cierre-mensual.md): qué reportes guardar cada mes.
- [Cartera](../contabilidad/cartera.md)
- [Egresos](../contabilidad/egresos.md)
