---
orden: 3
pantallas:
    - /caja
---

# Caja

Aquí abres y cierras el turno de tu caja, ves los cobros en efectivo del turno, depositas el efectivo al banco y revisas los turnos anteriores. El paso a paso del día, con qué hacer si no cuadra, está en el [runbook de cierre de caja](../../runbooks/cierre-de-caja.md).

## Quién la usa

- **Ver:** `cajas.ver` (`admin`, `cajero`, `contabilidad`, `lectura`).
- **Abrir turno:** `cajas.abrir` (`admin`, `cajero`). **Cerrar turno:** `cajas.cerrar` (`admin`, `cajero`).
- **Depositar al banco:** `cajas.depositar` (`admin`, `cajero`, `contabilidad`).
- **Crear cajas:** `cajas.crear` (`admin`, `contabilidad`).

Un cajero con el rol acotado a su caja **solo ve y opera esa caja**: no puede abrir, cerrar ni cobrar en otra.

Se llega desde **Accesos directos → Caja**.

## Qué ves

- **Las cajas:** un botón por caja con su nombre, de quién es («Tu caja», el nombre del cajero o «Sin cajero asignado»), la empresa si hay varias, y «Turno abierto» o «Cerrada». Por defecto se elige tu caja.
- **Caja cerrada:** el mensaje «… está cerrada» y los tres pasos: abrir caja, cobrar y cerrar caja.
- **Turno abierto:** «… abierta», el número de turno y desde cuándo, y estos datos:
    - **Fondo inicial**
    - **Cobros en efectivo** y **Efectivo cobrado**
    - **Egresos en efectivo** (gastos pagados con el efectivo de la caja)
    - **Depositado al banco**, con cada depósito y su estado («En tránsito» o «Acreditado»)
    - **Esperado en caja**: fondo + efectivo cobrado − egresos − depósitos. Es **provisional**; el oficial lo calcula el sistema al cerrar.
- **Cobros del turno:** cada pago del turno con su cliente, monto y estado.
- **Turnos:** el historial de la caja con apertura y cierre, fondo, esperado, contado y la diferencia («Cuadra», «Faltante Q …» o «Sobrante Q …»), con el motivo si lo hubo.

Si no se pudieron leer los cobros, egresos o depósitos, no verás un esperado provisional: verás «Sin esperado provisional» con la razón. El sistema calcula el oficial al cerrar de todas formas.

## Acciones

### Crear una caja

- **Permiso:** `cajas.crear`.
- **Dónde:** botón «Nueva caja».
- **Qué pide:** **Nombre** (único dentro de la empresa, por ejemplo «Caja Sur»), **Empresa** y, opcional, **Cajero asignado**. Cada empresa (NIT) tiene sus propias cajas y cada caja cobra solo facturas de su empresa.

### Abrir caja

- **Permiso:** `cajas.abrir`.
- **Dónde:** botón «Abrir caja» (arriba o en el mensaje de la caja cerrada). También desde **Cobrar** si intentas cobrar en efectivo sin caja abierta.
- **Qué pide:** el **Fondo inicial**, el efectivo con el que empiezas para dar vuelto (por ejemplo `500.00`).
- **Qué pasa:** se abre el turno. Desde ese momento, cada cobro en efectivo en esta caja entra a este turno.

### Depositar al banco

- **Permiso:** `cajas.depositar`.
- **Dónde:** botón «Depositar al banco», con el turno abierto.
- **Qué pide:** **Monto**, **Boleta** (número del banco), **Cuenta que recibe** y **Fecha** (vacía = hoy; no puede ser futura).
- **Qué pasa:** el dinero sale de la caja y queda **en tránsito** hasta que el extracto del banco lo acredite (ver [Fondos en tránsito](../bancos/fondos-en-transito.md)). Baja el esperado del cierre igual que un egreso. No puede ser mayor que el efectivo del turno.

### Cerrar caja

- **Permiso:** `cajas.cerrar`.
- **Dónde:** botón «Cerrar caja».
- **Qué pide:**
    - **Efectivo contado:** todo el efectivo de la caja, fondo incluido. O activa «Contar por denominación» y escribe cuántos billetes y monedas hay de cada uno; el panel suma.
    - El panel muestra **Esperado**, **Contado** y **Diferencia** mientras escribes.
    - **Motivo de la diferencia:** obligatorio si lo contado no cuadra con lo esperado.
- **Qué pasa:** el sistema calcula el esperado oficial: fondo + cobros vigentes del turno − egresos en efectivo − depósitos del turno. Si hay diferencia, deja un asiento en el libro: el faltante va a gasto (faltantes de caja) y el sobrante a ingreso (sobrantes de caja). Se avisa a los responsables. El turno cerrado ya no se puede cambiar.

::: warning Un turno cerrado no se reabre
Si encuentras un error antes de cerrar, corrígelo primero (anulando el pago mal registrado). Un pago anulado después del cierre no cambia ese cierre: el reverso sale de la caja en el libro.
:::

## Preguntas frecuentes y errores

**El esperado provisional no coincide con el oficial.** El oficial es el que vale. Revisa los egresos y depósitos del turno. Más pasos en el [runbook de cierre de caja](../../runbooks/cierre-de-caja.md).

**Cobro para dos empresas.** Abre una caja en cada empresa. El cobro reparte el efectivo en la caja de cada una.

| Mensaje                                                          | Qué significa y qué hacer                                             |
| ---------------------------------------------------------------- | --------------------------------------------------------------------- |
| «La caja … ya tiene el turno … abierto»                          | Alguien ya abrió esta caja. No abras otro turno; avisa al supervisor. |
| «La caja … no tiene turno abierto»                               | Otra persona ya la cerró. Recarga la página.                          |
| Motivo de la diferencia en rojo                                  | Hay diferencia: recuenta y, si sigue, escribe el motivo.              |
| «Esta empresa ya tiene una caja con ese nombre.»                 | Usa otro nombre.                                                      |
| El depósito excede el efectivo del turno                         | Deposita como máximo lo que hay en la caja.                           |
| «El turno #… está abierto pero no aparece en la lista de turnos» | Pulsa «Reintentar».                                                   |
| 403 al abrir, cerrar o cobrar                                    | La caja no es tuya: pide al administrador que te asigne.              |

## Relacionado

- [Runbook: cierre de caja](../../runbooks/cierre-de-caja.md)
- [Cobrar](./cobrar.md)
- [Fondos en tránsito](../bancos/fondos-en-transito.md)
