---
orden: 4
---

# Registrar un pago por depósito o un comprobante

Al terminar, el pago que el cliente hizo en el banco queda registrado con su boleta o referencia y su servicio se reactiva si ya no debe nada vencido.

Hay dos casos:

- **El cliente te trae la boleta o te dice que transfirió:** lo registras tú en **Cobrar**.
- **El cliente subió su comprobante en el portal:** lo verificas en **Comprobantes** y lo apruebas o lo rechazas.

## Antes de empezar

- Para registrar: `pagos.registrar`. Para verificar: `comprobantes.ver`, `comprobantes.aprobar` y `comprobantes.rechazar`. El rol `cajero` los trae todos.
- Revisa en la banca en línea que el dinero sí entró antes de registrar o aprobar.
- No hace falta tener la caja abierta: el dinero no entra a la caja, entra a la cuenta del banco.

## Registrar un depósito o una transferencia en Cobrar

1. Abre **Cobrar**, busca al cliente y marca las facturas que paga.
2. Escribe el **Monto** que entró al banco.
3. En **Método** elige el que corresponde: «Depósito bancario», «Transferencia», «ACH» o «Remesa».
4. Llena lo que pide cada método:

    | Método            | Pide                                                                            |
    | ----------------- | ------------------------------------------------------------------------------- |
    | Depósito bancario | **Cuenta de destino** y **Número de boleta**                                    |
    | Transferencia     | **Banco de origen**, **Cuenta de destino** y **Referencia de la transferencia** |
    | ACH               | **Banco de origen**, **Cuenta de destino** y **Referencia ACH**                 |
    | Remesa            | **Cuenta de destino** y **Código de la remesa**                                 |

    La **Cuenta de destino** es la cuenta propia de la empresa donde entró el dinero. La referencia se escribe tal como aparece en el comprobante.

5. Toca «Registrar pago» e imprime el recibo si el cliente lo pide.

## Verificar un comprobante del portal

1. Abre **Cobros → Comprobantes**. El número junto a la sección dice cuántos esperan verificación.
2. Filtra si quieres por cliente, método, cuenta de destino, canal o fechas del depósito.
3. Toca un comprobante. Verás la foto o el PDF y los **Datos declarados** por el cliente.
4. Compáralos con el movimiento en la banca en línea.
5. Si cuadra, toca «Aprobar». La ventana dice el pago que se registrará y a qué facturas se aplica. Escribe una **Nota** si quieres (por ejemplo, «verificado en la banca en línea») y toca «Aprobar y registrar pago».
6. Si no cuadra, toca «Rechazar», elige la **Causa** y escribe el **Motivo**:

    | Causa                  | Cuándo                                                            |
    | ---------------------- | ----------------------------------------------------------------- |
    | No aparece en el banco | El depósito no está en el estado de cuenta                        |
    | Monto distinto         | El banco muestra otro monto                                       |
    | No se puede leer       | La foto o el PDF no se distinguen                                 |
    | Falta un dato          | El cliente lo vuelve a mandar completo; la referencia queda libre |
    | Duplicado              | Ya se aplicó con otro comprobante                                 |
    | Otra causa             | Explícala en el motivo                                            |

    Toca «Rechazar comprobante».

## Qué pasa después

- **Al registrar o aprobar:** queda un pago con su referencia en la cuenta del banco y en el libro. Si el cliente ya no debe facturas vencidas, su servicio se reactiva al momento y la pantalla lo muestra («Servicio _N_ reactivado»).
- **Al rechazar:** no se registra pago ni asiento. El cliente recibe el aviso con el motivo y puede subir el comprobante otra vez. Si el comprobante llegó por Iris, Iris se lo explica en la conversación.
- Si el servicio tenía una **reconexión temporal** por ese comprobante, rechazarlo lo vuelve a cortar a la hora de corte. La pantalla te lo avisa antes.

## Si algo sale mal

| Mensaje                                                           | Causa                                                                 | Qué hacer                                                  |
| ----------------------------------------------------------------- | --------------------------------------------------------------------- | ---------------------------------------------------------- |
| «Esa referencia ya se registró»                                   | La boleta o referencia ya está en otro pago del mismo método y cuenta | No se cobró dos veces: busca el pago anterior en **Pagos** |
| Error en **Cuenta de destino**: «Esta cuenta es de otra empresa…» | La cuenta es de otra empresa que las facturas marcadas                | Elige una cuenta de la misma empresa                       |
| Falta un dato del método                                          | Cada método pide sus datos                                            | Llena los campos marcados en rojo                          |

## Depositar al banco el efectivo de la caja

Es otra cosa: llevar al banco el efectivo de tu turno. Con la caja abierta, toca «Depositar al banco», escribe **Monto**, **Boleta**, **Cuenta que recibe** y **Fecha**, y toca «Depositar». Se resta del esperado de tu caja y queda en tránsito hasta que contabilidad lo concilie con el extracto. Pide `cajas.depositar` (rol `cajero`). No puedes depositar más efectivo del que tiene el turno.

## Relacionado

- [Cobrar una o varias facturas](./cobrar-facturas.md)
- [Cerrar la caja y cuadrar](./cerrar-caja.md)
- [Manual de cobros](../../manual/cobros/)
