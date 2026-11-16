---
orden: 2
pantallas:
    - /lealtad/premios
    - /lealtad/canjes#canjes
---

# Premios y canjes

El catálogo de premios es lo que el cliente puede obtener con sus puntos. Un canje cambia puntos por un premio: un descuento en la factura, un mes gratis, una mejora temporal del plan o boletos para un sorteo.

Menú: **Cobros → Premios** y **Cobros → Canjes**.

## Quién la usa

| Acción                 | Permiso                                                     | Roles base                                              |
| ---------------------- | ----------------------------------------------------------- | ------------------------------------------------------- |
| Ver premios y canjes   | `lealtad.ver`                                               | `admin`, `contabilidad`, `cajero`, `soporte`, `lectura` |
| Crear y editar premios | `lealtad.configurar`                                        | `admin`, `contabilidad`                                 |
| Canjear                | `lealtad.canjear` (y `clientes.ver` para buscar al cliente) | `admin`, `contabilidad`, `cajero`, `soporte`            |
| Revertir un canje      | `lealtad.revertir_canje`                                    | `admin`, `contabilidad`                                 |

## Premios

### Qué ves

Arriba, el programa y cuánto vale un punto, el mínimo para canjear y si el portal permite canjear. Luego, una fila por premio con su tipo, lo que entrega, su costo en puntos, si está «Activo» o «Inactivo» y si está «En el portal». Si la empresa no tiene programa, primero créalo en [Lealtad](./programa.md).

### Tipos de premio

| Tipo                 | Qué recibe el cliente                                                                                                     |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Descuento en factura | Un monto o un porcentaje (con tope opcional) de la próxima factura del servicio, o de una ya emitida con nota de crédito. |
| Mes gratis           | El próximo periodo del servicio queda bonificado.                                                                         |
| Mejora de plan       | Un plan mejor durante unos días; después vuelve solo a su plan.                                                           |
| Bien físico          | Un artículo que se entrega en oficina.                                                                                    |
| Boletos de sorteo    | Participaciones en un sorteo que admite canjes.                                                                           |

### Nuevo premio y editar

- **Permiso:** `lealtad.configurar`.
- **Campos:** tipo (no cambia después), nombre, costo en puntos (el formulario dice a cuántos quetzales equivale), existencias (vacío es sin límite) y, según el tipo:
    - Descuento: «Monto» o «Porcentaje» y, en porcentaje, un tope en quetzales.
    - Mejora de plan: el plan y los días.
    - Bien físico: el costo unitario para la empresa.
    - Boletos: el sorteo (debe admitir canjes y no haber cerrado su corte) y los boletos por canje.
- **Ofrecer en el portal del cliente:** el cliente lo puede canjear él mismo, si el programa permite canjear en el portal.
- **Activo:** apagado, nadie lo puede canjear. Los canjes ya hechos no cambian. Así se «retira» un premio; no se borra.

## Canjes

### Qué ves

Una fila por canje con el premio, el cliente, el canal («panel» o «portal»), la fecha, el descuento en quetzales si lo hay, los puntos y el estado. Filtro por estado.

| Estado    | Qué significa                                                                                                                      |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Reservado | Los puntos ya se descontaron; el descuento espera la próxima factura del servicio.                                                 |
| Aplicado  | El premio ya se dio: la factura llevó el descuento, se emitió la nota de crédito, empezó la mejora de plan o entraron los boletos. |
| Revertido | Se deshizo y los puntos volvieron al cliente.                                                                                      |
| Rechazado | No se aplicó.                                                                                                                      |

### Canjear

- **Permiso:** `lealtad.canjear` y `clientes.ver`.
- **Dónde:** botón «Canjear».
- **Pasos:**
    1. Busca al **Cliente**. Verás su saldo de puntos.
    2. Elige el **Servicio** al que va el premio.
    3. Elige el **Premio**.
    4. Solo en un descuento: si lo dejas vacío, se descuenta de la próxima factura. Si escribes el número de una factura ya emitida («Aplicar a una factura ya emitida»), se emite una nota de crédito sobre esa factura.
    5. Pulsa «Canjear».
- **Qué pasa según el premio:**
    - **Descuento o mes gratis para la próxima factura:** queda «Reservado» y la próxima factura del servicio lo aplica como una línea de descuento. El IVA se calcula sobre el total ya rebajado.
    - **Descuento sobre una factura emitida:** se emite la nota de crédito y queda «Aplicado». Solo se puede dentro de los meses que permite la factura electrónica (por defecto, 2 meses desde su emisión). Si la factura ya estaba pagada, lo que sobre queda a favor del cliente para su próxima factura.
    - **Mejora de plan:** el servicio pasa al plan mejor por los días del premio y vuelve solo a su plan al terminar. El router aplica la velocidad nueva sin que tengas que hacer nada. Mientras dure, la factura cobra el plan mejor con un descuento hasta el precio de su plan normal.
    - **Boletos:** entran al sorteo y el canje queda «Aplicado».
- Si las notificaciones están configuradas, el cliente recibe un aviso del canje.

::: warning Los bienes físicos todavía no se canjean
El canje de un premio de tipo «Bien físico» está bloqueado hasta que el contador decida cómo se trata su IVA. Al intentarlo, el sistema responde que falta esa decisión.
:::

### Revertir

- **Permiso:** `lealtad.revertir_canje`.
- **Dónde:** botón «Revertir» en un canje «Reservado». Pide motivo.
- **Qué pasa:** los puntos vuelven al cliente con su fecha de vencimiento original y se libera la existencia del premio. Un canje ya aplicado a una factura vigente no se revierte.

## Preguntas frecuentes y errores

- **«Saldo insuficiente».** El cliente no tiene los puntos del premio, no llega al mínimo para canjear o su saldo está en negativo.
- **El servicio no es válido.** El servicio es de otra empresa o está retirado.
- **Sin existencias.** El premio se agotó.
- **Ya hay un canje pendiente.** El servicio ya tiene un descuento reservado para su próxima factura; espera a que se aplique o reviértelo.
- **La nota está fuera de plazo.** La factura tiene más de los meses permitidos; deja el descuento para la próxima factura.
- **La mejora de plan no se aplica.** El servicio ya tiene un plan temporal, o el plan del premio no es compatible con el servicio (cambia su tipo de IP). Nada se descuenta.
- **El premio no aparece al canjear.** Está inactivo.
- **El sorteo no está abierto a boletos por canje.** Los boletos solo se canjean mientras la participación del sorteo está abierta.

## Relacionado

- [Programa de lealtad](./programa.md)
- [Sorteos](./sorteos.md)
- [Facturación](../facturacion/index.md)
