---
orden: 1
---

# Cerrar el mes

Al terminar, el mes queda cerrado: ningún asiento podrá tener fecha en él y su resumen queda guardado.

## Antes de empezar

- Permisos: `libro.cerrar_periodo` y `cierres.verificar` (rol **contabilidad**). Para supervisar una anomalía, `cierres.revisar_check`.
- El mes ya terminó (se cierra a partir del día 1 del mes siguiente, hora de Guatemala).
- Haz la revisión previa del [runbook de cierre mensual](../../runbooks/cierre-mensual.md) (sección «Antes de cerrar»): cajas cerradas, comprobantes del mes resueltos, egresos y compras registrados y reportes del mes guardados.

## Pasos

1. Abre **Contabilidad → Libro** y entra a la pestaña **Cierres**.
2. En **Lista de verificación**, elige el mes y pulsa «Verificar».
3. Revisa la tabla:
    - Los checks **En orden** (verdes) no piden nada.
    - Los de **Anomalía** (rojos) muestran el valor esperado y el obtenido. Corrige la causa (por ejemplo, cierra un turno de caja abierto o certifica un DTE pendiente) y vuelve a pulsar «Verificar».
    - Si la anomalía está justificada, pulsa «Supervisar» y escribe una nota que lo explique, por ejemplo «el depósito del 31/07 lo acreditó el banco el 03/08».
4. Cuando la etiqueta diga «El mes pasa la lista», pulsa «Cerrar un mes».
5. Elige el **Mes**, lee «Qué implica cerrar» y pulsa «Cerrar …».
6. El mes aparece en la lista como **Cerrado**, con tu nombre y la hora.

## Qué pasa después

- Facturas, pagos, egresos, compras y reversos ya no pueden llevar fecha de ese mes: se registran en el mes abierto.
- Los asientos del mes reciben su número de partida del Libro Diario.
- Ya puedes emitir los libros de ese mes con folio (ver [Emitir los libros con folio](./emitir-los-libros.md)), después de bloquear el libro.

## Si algo sale mal

| Mensaje                                  | Causa                                    | Qué hacer                                                                      |
| ---------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------ |
| El mes todavía no termina                | Intentas cerrar el mes en curso          | Espera al día 1 del mes siguiente                                              |
| Lista de checks pendientes en el diálogo | Hay anomalías sin resolver ni supervisar | Pulsa «Ver la lista de verificación» y resuélvelas                             |
| Notas de crédito sin certificar          | Hay NCRE del mes pendientes              | Pulsa «NCRE en la cola de DTE» y certifícalas                                  |
| La cadena del libro no verifica          | Los sellos del libro no cuadran          | No cierres. Pulsa «Ver integridad del libro» y avisa al administrador          |
| Ya estaba cerrado                        | Alguien lo cerró antes                   | Nada que hacer                                                                 |
| Después del cierre falta algo del mes    | Un documento llegó tarde                 | Regístralo en el mes abierto o pide a un admin reabrir el mes (ver el runbook) |
