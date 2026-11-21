---
orden: 3
pantallas:
    - /dte
    - /dte/[id]#detalle-de-un-dte
---

# Cola de DTE

Los documentos tributarios electrónicos (DTE) de cada factura, mora (nota de débito, NDEB) y nota de crédito (NCRE): cuáles están en cola, cuáles se certificaron, cuáles rechazó el certificador y cuáles están en contingencia.

Está en **Finanzas → Impuestos → Facturación electrónica**, en la pestaña **Documentos**.

## Quién la usa

- Ver: `fel.ver` (**admin**, **contabilidad**, **cajero** y **lectura**).
- Certificar en lote y reintentar: `fel.certificar` (**contabilidad** y **admin**).

## Qué ves

Atajos arriba: **Por atender** (pendientes, enviando y con error temporal), **Rechazados**, **En contingencia** y **Anulación pendiente**. También filtras por estado, por documento (factura, nota de crédito, nota de débito) y por fechas de emisión. «Limpiar filtros» los quita.

Cada fila muestra el DTE, el receptor, el total, los intentos y el estado:

| Estado                  | Qué significa                                                |
| ----------------------- | ------------------------------------------------------------ |
| **Pendiente**           | En cola: se enviará al certificador                          |
| **Enviando**            | Se está enviando                                             |
| **Certificado**         | La SAT lo autorizó                                           |
| **Error temporal**      | El certificador no respondió; se reintenta solo              |
| **Rechazado**           | Rechazo definitivo: corrige el dato y reintenta              |
| **En contingencia**     | Emitido en contingencia; se transmite al levantarla          |
| **Anulación pendiente** | Se pidió la anulación; falta que el certificador la confirme |
| **Anulado**             | La SAT confirmó la anulación                                 |

## Acciones

### Certificar en lote

- **Permiso:** `fel.certificar`
- **Dónde:** botón «Certificar en lote».
- **Campos:** **Empresa**, **Desde** y **Hasta**.
- **Qué pasa:** pide la certificación de las facturas emitidas en ese rango. El resultado dice cuántas se enviaron y cuáles no se pudieron pedir. Quedan en la cola.

## Detalle de un DTE

Al abrir un DTE ves su estado («Emitido en contingencia» si aplica), la **Autorización (UUID SAT)**, la **Serie y número**, cuándo se certificó, el **Receptor**, el **Total del DTE**, los intentos, la emisión, el certificador, el documento de origen, la referencia, la anulación y el identificador ante el certificador. Si hubo error, un aviso muestra el último mensaje del certificador.

Abajo están los **Intentos ante el certificador**; «Respuesta» abre lo que contestó en cada intento (sin credenciales).

### Reintentar

- **Permiso:** `fel.certificar`
- **Dónde:** botón «Reintentar» (solo en rechazados o con error temporal).
- **Qué pasa:** el DTE vuelve a la cola. Si hace falta releer el receptor, se crea un DTE nuevo y el rechazado queda como historia.

### Ver XML y PDF

«Ver XML» muestra el XML certificado con el botón «Descargar XML» (existe desde que la SAT lo certificó, también después de anularlo). «PDF» descarga la representación impresa, si está disponible.

::: tip Anular un DTE
La anulación de un DTE se pide desde la factura o la nota de crédito que lo originó, con los permisos `facturas.anular` y `fel.anular`.
:::

## Preguntas frecuentes y errores

| Mensaje                                  | Qué hacer                                                      |
| ---------------------------------------- | -------------------------------------------------------------- |
| El cliente necesita NIT, CUI o pasaporte | Completa los datos fiscales del cliente y reintenta            |
| Este DTE no se puede reintentar          | Solo se reintentan los rechazados o con error temporal         |
| El DTE está en proceso                   | Espera a que el certificador responda                          |
| Venció el plazo para anular el DTE       | Ya no se anula; consulta con el contador cómo corregirlo       |
| «PDF no disponible»                      | El certificador aún no lo entrega; vuelve a intentar más tarde |

## Relacionado

- [FEL](./fel.md)
- [Libro: cerrar un mes](../contabilidad/libro.md#cerrar-un-mes): el cierre exige las NCRE certificadas.
