---
orden: 1
pantallas:
    - /cobro
---

# Cobrar

Una sola pantalla para buscar al cliente, ver lo que debe, registrar el pago y entregar el recibo. Si el pago deja al servicio sin deuda vencida, **se reactiva en ese momento**, sin esperar a ningún proceso.

## Quién la usa

- **Permiso:** `pagos.registrar`. Lo traen `admin`, `cajero` y `contabilidad`.
- Para ver lo que debe el cliente: `clientes.estado_cuenta`. Para ver sus servicios: `servicios.ver`. Para elegir caja: `cajas.ver`. Para elegir la cuenta de destino de un depósito o transferencia: `cuentas_bancarias.ver`.

Se llega desde **Accesos directos → Cobrar**, o con el botón «Cobrar» de **Pagos** y de **Caja**.

::: tip Atajos de teclado
**Enter** registra el pago. **Esc** limpia la pantalla (o empieza otro cobro después del recibo).
:::

## Antes de cobrar en efectivo

Abre tu caja (ver [Caja](./caja.md)). Si no la abriste, al elegir «Efectivo en caja» verás «No tienes una caja abierta»: sin caja abierta el efectivo entra a la caja principal sin turno y **no aparece en ningún cierre**. Con el permiso `cajas.abrir`, el botón «Abrir caja» del aviso la abre sin salir del cobro.

## Qué ves

1. **Cliente:** busca por nombre, NIT, teléfono, usuario PPP o IP.
2. **Lo que debe:** dos tarjetas, **Vencido** (cuántos avisos vencidos y su total) y **Pendiente total**. Si tiene saldo a favor, lo dice: «Saldo a favor Q …: se aplica solo a los próximos avisos».
3. **Facturas pendientes:** la lista en orden de antigüedad, con casillas. **Las vencidas vienen marcadas.**
4. **Servicios:** cada servicio con su estado. Después de cobrar verás «Servicio reactivado» en el que volvió a activo.
5. **Registrar pago:** el formulario.

## Acciones

### Registrar un pago

1. Marca las facturas que paga. Se aplican en el orden de la pantalla.
2. **Monto:** se llena con la suma de lo marcado. Puedes cambiarlo. Debajo, el panel te dice qué pasará:
    - «No alcanza para las marcadas: el aviso #… quedará parcial».
    - «Pasa Q … de las marcadas: va a #… y Q … a saldo a favor».
    - «Paga Q … de más: queda como saldo a favor».
    - «Quedará debiendo Q …».
3. **Método:** «Efectivo en caja», «Depósito bancario», «Transferencia», «ACH», «Remesa», «Agente bancario» o «Débito / tarjeta».
4. Los datos que pide cada método:

    | Método                  | Pide                                                                   |
    | ----------------------- | ---------------------------------------------------------------------- |
    | Efectivo en caja        | **Caja** (opcional; sin elegir, la de tu turno abierto o la principal) |
    | Depósito bancario       | **Cuenta de destino** y **Número de boleta**                           |
    | Transferencia, ACH      | **Banco de origen**, **Cuenta de destino** y la referencia             |
    | Remesa                  | **Cuenta de destino** y **Código de la remesa**                        |
    | Agente bancario, Débito | Referencia o **Autorización** (opcional)                               |

    La cuenta de destino es una cuenta propia, activa y en quetzales (ver [Cuentas bancarias](../bancos/cuentas-bancarias.md)).

5. **Nota:** opcional.
6. «Registrar pago».

**Qué pasa:**

- El pago se aplica primero a las facturas marcadas; si sobra, a las demás del cliente, de la más antigua a la más nueva; lo que todavía sobra queda como **saldo a favor**, que se aplica solo a las próximas facturas.
- Se registra el asiento en el libro y el sistema vuelve a evaluar cada servicio. Si ya no debe lo suficiente para estar limitado o suspendido, **vuelve a activo al instante**. Si sigue cortado, el panel dice por qué («Sigue suspendido: …»).
- Si la reactivación tarda más de 30 segundos verás «El servicio no se ha reactivado»: puede que aún deba avisos vencidos; revisa la ficha del servicio.
- Si las notificaciones están configuradas, el cliente recibe el aviso del pago.
- Aparece el **recibo** con «Imprimir», «Recibo en PDF» y «Nuevo cobro».

### Imprimir el recibo en PDF (carta o impresora POS)

- **Permiso:** `pagos.ver`; para elegir la plantilla, `documentos.ver` (lo tienen `cajero`, `soporte`, `contabilidad`, `lectura` y `admin`).
- **Dónde:** botón «Recibo en PDF», debajo del recibo.
- **Qué pasa:** abre el recibo en PDF en otra pestaña, con la plantilla **predeterminada** del recibo de cobro; desde ahí lo imprimes. La flecha de al lado (**Imprimir con…**) muestra las otras plantillas activas, por ejemplo **«POS 80 mm»** para la impresora térmica de rollo: el PDF sale de 80 mm de ancho y del largo justo del recibo. Si el cobro fue de varias empresas, el recibo trae una sección por empresa.
- «Imprimir» sigue imprimiendo el recibo que ves en pantalla, como antes.
- Las plantillas se crean y se eligen en **Configuración → Plantillas de documentos** ([ver](../portal/plantillas-de-documentos.md)).

### Cobrar facturas de varios clientes (responsable de pago)

Cuando una persona paga por otros (por ejemplo, una empresa que paga los servicios de sus empleados, o un familiar):

- Si el cliente es **responsable de pago** de otros clientes, sus facturas aparecen solas en grupos plegados «Responsable de pago de: …». El responsable se asigna en la ficha del cliente.
- Para cualquier otro cliente, usa «Agregar facturas de otro cliente» y búscalo. Aparece como «Facturas de otro cliente: …».
- Marca las facturas de cada grupo (cada grupo tiene una casilla para marcar todas). Abajo verás cuántas son de otros clientes y cuánto suman.

Se registra **un solo pago** a nombre del que paga. Cada factura baja la deuda de su dueño y se reevalúan los servicios de todos. En el estado de cuenta del dueño, el pago dice «pagado por …». Si sobra dinero, el saldo a favor queda para quien pagó.

### Cobro de varias empresas

Si las facturas marcadas son de varias empresas (NIT), verás «Un pago por empresa» con el reparto. Se registra un pago por empresa, cada uno en la caja de su empresa, y un solo recibo con el total. Esto solo se puede con efectivo: tienes que tener una caja abierta en cada empresa. Si falta una, verás «No tienes caja abierta en …» con el botón «Abrir caja».

## Preguntas frecuentes y errores

**El cliente pagó unos centavos de menos.** Registra lo que pagó. La factura queda con un saldo pequeño. Contabilidad puede cerrarlo desde el detalle del pago con «Cerrar diferencia» (ver [Pagos](./pagos.md#cerrar-una-diferencia-pequena)).

**Me equivoqué de monto o de cliente.** No se edita. Pide a contabilidad que anule el pago (ver [Pagos](./pagos.md#anular-un-pago)) y regístralo bien.

**El cliente mandó la foto de su depósito.** Si llegó por el portal o por Iris, está en **Cobros → Comprobantes**, donde caja lo aprueba o rechaza. Aprobarlo registra el pago igual que aquí.

| Mensaje                                              | Qué significa y qué hacer                                                                                                            |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| «Esa referencia ya se registró»                      | Ya existe un pago con ese método, cuenta y referencia. **No se cobró de nuevo.** Revisa el comprobante o busca el pago en **Pagos**. |
| «… está cerrada» / «No tienes una caja abierta»      | Abre la caja antes de cobrar en efectivo.                                                                                            |
| «No tienes caja abierta en …»                        | Las facturas son de otra empresa: abre una caja de esa empresa.                                                                      |
| Campo en rojo                                        | Falta un dato del método (banco, cuenta, referencia) o el monto no es válido (mayor que 0, hasta 2 decimales).                       |
| «No hay cuentas bancarias activas en quetzales»      | Pide a contabilidad que cree o active una cuenta en [Cuentas bancarias](../bancos/cuentas-bancarias.md).                             |
| «Te falta el permiso para ver las cuentas bancarias» | Pide `cuentas_bancarias.ver` al administrador.                                                                                       |

Si se corta la red mientras registras, vuelve a pulsar «Registrar pago»: el sistema reconoce el intento y **no cobra dos veces**.

## Relacionado

- [Caja](./caja.md)
- [Pagos](./pagos.md)
- [Runbook: cierre de caja](../../runbooks/cierre-de-caja.md)
- [El ciclo de cobro](../../guia/ciclo-de-cobro.md)
