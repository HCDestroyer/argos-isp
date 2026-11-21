---
orden: 6
pantallas:
    - /comprobantes
    - /comprobantes/[id]#revisar-un-comprobante
---

# Comprobantes

Aquí revisas los comprobantes de depósito y transferencia que mandan los clientes: desde el portal, desde el panel o por chat o llamada atendida en Iris. Aprobar un comprobante registra el pago y, si el cliente ya no debe facturas vencidas, reactiva su servicio. Ningún comprobante se aplica solo: siempre lo aprueba una persona después de verlo en el banco.

## Quién la usa

- **Ver la lista y el detalle:** permiso `comprobantes.ver` (roles `admin`, `cajero`, `contabilidad` y `lectura`).
- **Aprobar:** `comprobantes.aprobar` (`admin`, `cajero`, `contabilidad`).
- **Rechazar:** `comprobantes.rechazar` (`admin`, `cajero`, `contabilidad`).

Está en **Comprobantes**. El menú muestra cuántos están pendientes.

## Lista de comprobantes

### Qué ves

- Pestañas por estado: **Pendientes** (reloj de arena, amarillo; con el número de pendientes), **Aprobados** (verde) y **Rechazados** (gris).
- Filtros: cliente (por nombre, NIT o teléfono), método (Depósito bancario, Transferencia, ACH, Remesa), cuenta de destino (si tienes `cuentas_bancarias.ver`), «Canal» (Portal del cliente, Panel, Iris (chat o llamada)) y las fechas «Depositado desde» y «Hasta». «Limpiar filtros» los quita todos.
- Arriba de la tabla, el total de comprobantes y el monto de lo filtrado (todas las páginas). En Aprobados o Rechazados también ves cuántos pendientes hay con esos filtros.
- Columnas:
    - **Comprobante:** número, fecha del depósito y, si llegó por Iris, la etiqueta «Llegó por Iris» con lo que Iris leyó (por ejemplo «Leído por IA · 92 % · WhatsApp»).
    - **Cliente** y el canal por el que llegó.
    - **Método y referencia**, con la cuenta de destino.
    - **Monto.**
    - **Recibido** (en Pendientes) o **Revisado** (en los demás): fecha, quién lo revisó y el motivo del rechazo o el enlace al pago.

Toca el número del comprobante para abrir su detalle.

## Revisar un comprobante

El detalle pone el archivo junto a los datos para que los compares con la banca en línea.

### Qué ves

- Arriba, el monto, el estado y, si aplica, «Llegó por Iris». Si es pendiente, los botones «Rechazar» y «Aprobar».
- **Archivo:** la foto o el PDF, con «Abrir en otra pestaña».
- **Datos declarados:** monto, fecha del depósito, método, número de referencia o boleta, cuenta de destino, banco de origen (transferencias y ACH), cliente, servicio, «Subido desde», «Recibido» y la nota del cliente.
- **Lectura de Iris** (solo si llegó por Iris): quién lo leyó (IA, una persona o dictado por el cliente), la confianza, el canal, quién atendió y el código de la conversación. El botón «Ver conversación en Iris» está deshabilitado por ahora: Iris todavía no permite abrir una conversación desde Argos, así que búscala en Iris con ese código.
- **Reconexión temporal activa:** si Iris reconectó el servicio mientras se revisa este comprobante, ves hasta cuándo dura y «Ver promesas».

### Aprobar

- **Permiso:** `comprobantes.aprobar`
- **Dónde:** botón «Aprobar» → «Aprobar y registrar pago».
- **Antes de confirmar:**
    - Si tienes `clientes.estado_cuenta`, eliges en «Facturas a pagar» a qué facturas va el pago y ves cómo se reparte, incluido el saldo a favor si sobra. Sin marcar ninguna, se aplica primero a las del servicio del comprobante y luego a la más antigua.
    - «Nota» opcional (hasta 400 caracteres); queda en el pago junto al número de comprobante.
- **Qué pasa:**
    - Se registra un pago con el método, el monto, la cuenta de destino y la referencia del comprobante, a tu nombre, con su asiento contable.
    - Si el cliente ya no debe facturas vencidas, su servicio se reactiva en segundos. La pantalla te dice qué servicios se reactivaron y cuáles siguen suspendidos o limitados, con el motivo.
    - Si había una reconexión temporal ligada y el pago cubrió lo vencido, se da por cumplida.
    - El cliente recibe el aviso de comprobante aprobado si esa notificación está activa. Si llegó por Iris, Iris le confirma en la conversación.
- **Deshacer:** el comprobante no vuelve a pendiente. Si te equivocaste, anula el pago desde su ficha (permiso `pagos.anular`).

### Rechazar

- **Permiso:** `comprobantes.rechazar`
- **Dónde:** botón «Rechazar» → «Rechazar comprobante».
- **Campos:**
    - «Causa»: No aparece en el banco, Monto distinto, No se puede leer, Falta un dato, Duplicado u Otra causa.
    - «Motivo» (de 3 a 500 caracteres): el cliente lo recibe en el aviso, o se lo dice Iris si llegó por ahí. Queda en la bitácora con tu usuario.
- **Qué pasa:** no se registra pago ni asiento. El cliente ve el motivo en su portal y puede subir el comprobante de nuevo con la misma referencia. Si el comprobante sostenía una reconexión temporal, esta se cancela y el servicio vuelve a cortarse a la hora de corte; el formulario te lo advierte antes.
- **Deshacer:** un comprobante rechazado no se puede aprobar. El cliente tiene que mandarlo otra vez.

::: warning Compara siempre con el banco
Antes de aprobar, confirma en la banca en línea que el depósito existe, con el mismo monto y la misma referencia. Lo que Iris leyó de una foto es una ayuda, no una confirmación.
:::

## Preguntas frecuentes y errores

- **«Comprobante ya revisado»:** otra persona lo aprobó o rechazó mientras lo veías. La pantalla se recarga con el estado actual.
- **Ya hay un pago con esa referencia:** alguien registró el pago con la misma referencia mientras tanto (por ejemplo, en caja). Revisa el pago existente y rechaza este comprobante con la causa «Duplicado».
- **«Comprobante no encontrado»:** el número no existe. Vuelve a la lista.
- **«Cuentas no disponibles»** en los filtros: no se pudieron leer las cuentas bancarias. Toca el botón para reintentar.
- **«No se pudo revisar la reconexión temporal»:** no se pudo saber si el servicio tiene una reconexión ligada (o no tienes `promesas.ver`). Si la tiene, rechazar lo vuelve a cortar a la hora de corte.
- **El cliente dice que ya subió el comprobante y no lo ves:** revisa la pestaña Rechazados y el filtro de canal. Si el cliente lo envió desde otra empresa (multiempresa), cambia la empresa activa.

## Relacionado

- [Portal del cliente: subir un comprobante](../portal/portal-del-cliente.md#subir-un-comprobante)
- [Página de corte](../portal/pagina-de-corte.md)
