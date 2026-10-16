# Runbook · Cierre de caja

Para el cajero y el supervisor de caja. Cómo abrir y cerrar un turno, qué hacer si el efectivo no cuadra y cómo se corrige un error. Verificado contra el panel (`/caja`, `/pagos`) y la API (`POST /cajas/:id/abrir`, `POST /cajas/:id/cerrar`) de la semana 3.

## Antes de empezar

- Necesitas el rol **cajero** (o admin). Un cajero solo ve y opera **su** caja; si no la ves en `/caja`, pide al administrador que te asigne.
- El sistema calcula el efectivo esperado. Tú solo cuentas y escribes lo que hay.
- Nada se borra ni se edita. Un error se corrige con una anulación o un asiento de reverso, nunca cambiando un dato (ver "Corregir errores").

## 1. Abrir el turno

1. Menú **Caja**. Elige tu caja en los botones de arriba; dice "Cerrada" si no tiene turno.
2. Botón **Abrir turno**. Escribe el **Fondo inicial**: el efectivo con el que empiezas (p. ej. `500.00`).
3. **Abrir turno**. Aparece "Turno #N abierto" con la hora.

Si dice que ya hay un turno abierto (409 `turno_abierto`), alguien no cerró el anterior: no abras otro y avisa al supervisor.

## 2. Durante el día

- Cobra desde **Cobrar** (`/cobro`) con el método **Efectivo en caja**. Cada cobro entra al turno abierto de tu caja.
- La tarjeta del turno muestra **Fondo inicial**, **Cobros en efectivo**, **Efectivo cobrado** y **Esperado en caja**. Este esperado es **provisional**: suma el fondo y los cobros en efectivo de la página, pero **no resta los egresos pagados en efectivo** de la caja. El oficial lo calcula el sistema al cerrar.
- Los gastos pagados con el efectivo de la caja los registra contabilidad o un administrador en **Egresos** con método caja. Bajan el esperado oficial.

## 3. Cerrar el turno

1. Cuenta **todo** el efectivo de la caja, **fondo incluido**.
2. En **Caja**, botón **Cerrar turno**.
3. Escribe el **Efectivo contado**, o activa **Contar por denominación** y escribe cuántos billetes y monedas hay de cada uno: el sistema suma.
4. Si lo contado no es igual a lo esperado, escribe el **Motivo de la diferencia** (obligatorio). Ejemplo: "faltaron Q 5.00, vuelto mal entregado".
5. **Cerrar turno**. El aviso y la tarjeta "Turno cerrado" muestran **Esperado**, **contado** y la diferencia.

Qué calcula el sistema:

```
esperado   = fondo inicial + cobros vigentes del turno − egresos en efectivo vigentes del turno
diferencia = contado − esperado      (negativa = faltante, positiva = sobrante)
```

- Los cobros **anulados** no cuentan.
- Con diferencia, el sistema deja un asiento contable: faltante a `5.2.06 Faltantes de caja`, sobrante a `4.1.04 Sobrantes de caja`. Se avisa a los responsables (evento `caja.cerrada`).

| Mensaje                                                | Qué significa                         | Qué hacer                                   |
| ------------------------------------------------------ | ------------------------------------- | ------------------------------------------- |
| 422 en "Motivo de la diferencia" (muestra el esperado) | Hay diferencia y no escribiste motivo | Recuenta. Si sigue igual, escribe el motivo |
| 409 `sin_turno_abierto`                                | La caja ya estaba cerrada             | Recarga la página: otro usuario la cerró    |
| 403                                                    | La caja no es tuya                    | Pide al administrador que te asigne         |

## 4. Si no cuadra

Antes de cerrar, en este orden:

1. **Recuenta** el efectivo, fondo incluido.
2. **Revisa los cobros del turno** en la tabla de la página (o en **Pagos** con el filtro de caja). Busca un cobro registrado con monto equivocado o un cobro en efectivo que se registró con otro método.
3. **Revisa los egresos** del turno en **Egresos** (filtro **Pagado con** = caja y las fechas del turno). Si el panel muestra un esperado mayor que el que te dio el cierre, casi siempre es un egreso en efectivo: el provisional no lo resta.
4. **Revisa vueltos** y billetes falsos detectados después del cobro.
5. Si encontraste un cobro mal registrado, **no cierres todavía**: pide al supervisor que lo anule (ver abajo) y que se registre bien. Después cierra.
6. Si no encuentras la causa, cierra con el motivo real ("faltante sin causa identificada") y avisa al supervisor. El faltante queda en el libro; no se "arregla" cambiando el contado.

## 5. Corregir errores (nunca con UPDATE)

El libro es inmutable: no se edita ni se borra nada, ni en el panel ni en la base de datos. Cada corrección deja su propio registro.

| Error                                        | Cómo se corrige                                                                                                                                                                | Quién                                                    |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------- |
| Cobro con monto, cliente o método equivocado | **Pagos** → el pago → **Anular pago** con motivo. El sistema crea el asiento de reverso y re-evalúa el servicio (puede volver a cortarse). Luego se registra el cobro correcto | Contabilidad o admin (el cajero no tiene `pagos.anular`) |
| Egreso en efectivo equivocado                | **Egresos** → **Anular** con motivo (reverso) y registrarlo bien                                                                                                               | Contabilidad o admin                                     |
| Turno cerrado con el contado mal digitado    | No se reabre el turno. El ajuste es un asiento de reverso del asiento `cierre_caja` o un asiento de ajuste: **hoy no hay pantalla para eso**                                   | Escalar a contabilidad                                   |
| Factura cobrada de más o descuento olvidado  | Nota de crédito: **todavía no existe en el sistema**                                                                                                                           | Escalar a contabilidad                                   |

Un reverso lleva la fecha de hoy. Si el mes del error ya está cerrado, el reverso cae en el mes abierto; no se reabre el mes por una corrección de caja.

## 6. Revisión del supervisor

- **Reportes → Cierres de caja**: cada turno con esperado, contado, diferencia y motivo.
- **Reportes → Cobranza diaria**: lo cobrado por día y método.
- **Libro → Diario** con origen **Cierre de caja**: los asientos de faltantes y sobrantes.

## Escalar

| Situación                                                                                                                                                               | A quién                                                                                    |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Faltante sin causa, turno que quedó abierto de otro día, cobro que hay que anular                                                                                       | Supervisor de caja (rol admin)                                                             |
| Ajuste del libro, nota de crédito, diferencia repetida en varios turnos                                                                                                 | Contabilidad (rol contabilidad)                                                            |
| Error del sistema: el cierre no responde, el esperado oficial no coincide con los cobros y egresos que ves, una pantalla muestra un error con "Reintentar" que no se va | Equipo de sistemas (backend de facturación). Incluye caja, turno, hora y el mensaje exacto |
