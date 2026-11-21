---
orden: 1
pantallas:
    - /lealtad
---

# Programa de lealtad

Cada empresa puede tener un programa de puntos: sus clientes ganan puntos por pagar a tiempo, por su antigüedad, por referir a otros clientes y por pagar por adelantado, y los cambian por premios. Aquí lo creas, lo activas y defines las reglas para ganar puntos.

Menú: **Clientes y lealtad → Lealtad**.

## Quién la usa

- Ver: `lealtad.ver` (`admin`, `contabilidad`, `cajero`, `soporte` y `lectura`).
- Crear, editar, activar y desactivar el programa y sus reglas: `lealtad.configurar` (`admin` y `contabilidad`).

## Qué ves

Si la empresa no tiene programa verás «Esta empresa no tiene programa de lealtad» y, con permiso, el botón «Crear programa».

Con programa, una tarjeta con su nombre, si está «Activo» o «Inactivo», desde y hasta cuándo es vigente, y sus datos:

| Dato                   | Qué significa                                                                                                                  |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Valor del punto        | Cuánto vale un punto en quetzales al canjearlo.                                                                                |
| Diferimiento (NIIF 15) | «No: solo indicador» si los puntos no se contabilizan; «Sí» si se llevan como pasivo, con lo que vale cada punto en el pasivo. |
| Canje esperado         | Qué porcentaje de los puntos se espera que se canjee (solo importa con diferimiento).                                          |
| Vencimiento            | A cuántos meses vencen los puntos y con cuántos días de anticipación se avisa, o «No vencen».                                  |
| Mínimo para canjear    | Puntos mínimos que debe tener el cliente para canjear.                                                                         |
| Portal del cliente     | «Oculto», «Ve sus puntos (sin canjear)» o «Ve sus puntos y canjea».                                                            |
| Términos               | El texto que se publica al cliente.                                                                                            |

Debajo está la tabla **Reglas para ganar puntos**, con el tipo de regla y sus condiciones, los puntos que da y lo que valen en quetzales, su vigencia, su tope y si está activa.

El botón «Referidos» de arriba abre la lista de [referidos](./referidos.md).

## Acciones

### Crear o editar el programa

- **Permiso:** `lealtad.configurar`.
- **Campos:**
    - **Nombre** y **Valor del punto** (Q por punto, por ejemplo 0.10).
    - **Diferir el ingreso de los puntos:** enciéndelo solo si tu contador decide llevar los puntos como un pasivo (NIIF 15). Entonces cada punto ganado, canjeado o vencido lleva su registro contable. Apagado, los puntos son solo un indicador.
    - **Canje esperado:** porcentaje de 0 a 100. Con diferimiento, el pasivo por punto es valor del punto × canje esperado.
    - **Los puntos vencen:** si lo dejas encendido, eliges a cuántos meses (por defecto 12) y con cuántos días de anticipación se avisa al cliente (por defecto 30).
    - **Mínimo para canjear**, en puntos.
    - **Vigente desde** (vacío es hoy; nada es retroactivo) y **Vigente hasta** (vacío es sin fin).
    - **Términos:** se publican en el portal del cliente. Si los puntos vencen y el texto no dice cuándo, verás un aviso: la ley pide decir el plazo.
    - Al **editar** aparecen además «Mostrar los puntos en el portal del cliente» y «Permitir canjear desde el portal». Para canjear en el portal, los puntos deben verse ahí.
- **Qué pasa:** un programa nuevo queda **inactivo** hasta que lo actives. Cambiar el valor del punto o el vencimiento solo afecta a los puntos que se ganen después; los ya ganados conservan su valor y su fecha.

### Activar

- **Permiso:** `lealtad.configurar`.
- **Qué pasa:** los clientes empiezan a ganar puntos desde hoy. Solo puede haber un programa activo por empresa.

### Desactivar

- **Permiso:** `lealtad.configurar`. Pide motivo.
- **Qué pasa:** los clientes dejan de ganar puntos desde hoy. Los puntos ganados se conservan y los reversos siguen aplicándose (por ejemplo, si se anula un pago que dio puntos).

### Nueva regla y editar

- **Permiso:** `lealtad.configurar`.
- **Comunes a todas:** puntos que da, tope de otorgamientos por cliente (veces por mes o por año), vigencia y el interruptor «Activa». El tipo no se cambia después de crearla: crea otra regla.
- **Tipos:**

| Tipo            | Cuándo da puntos                                         | Condiciones que configuras                                                                                                                                                                                                    |
| --------------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pago a tiempo   | Cada factura de servicio pagada antes de su vencimiento. | Días antes del vencimiento (0 = a más tardar el día que vence), monto mínimo de la factura, «Solo facturas de servicio (no la mora)», «Sin promesa de pago», y un bono por racha (facturas seguidas a tiempo y puntos extra). |
| Antigüedad      | Cada tantos meses de servicio sin cortes.                | Cada cuántos meses, estados del servicio que cuentan y, si quieres, que no tenga facturas vencidas de más de tantos días.                                                                                                     |
| Referido        | Cuando el cliente referido paga sus primeras facturas.   | Facturas pagadas del referido, plazo en días desde el alta, bono al cliente referido y tope de referidos por cliente.                                                                                                         |
| Pago adelantado | Cuando un pago deja meses pagados por adelantado.        | Meses adelantados mínimos y puntos por mes adelantado.                                                                                                                                                                        |

- El formulario muestra cuánto valen esos puntos en quetzales con el valor del punto del programa.
- Una regla no se borra: se desactiva con el interruptor «Activa».

::: tip Sin reglas nadie gana puntos
Aunque el programa esté activo, si no hay reglas activas nadie gana puntos.
:::

## Cómo funcionan los puntos

- Los puntos se ganan solos cuando ocurre el hecho (el pago, el aniversario, la calificación del referido). Un mismo hecho nunca da puntos dos veces.
- Si se anula el pago o la factura que dio puntos, esos puntos se quitan. Si el cliente ya los había canjeado, su saldo puede quedar negativo y no podrá canjear hasta que vuelva a positivo.
- Cada grupo de puntos ganados vence a los meses del programa. Al canjear se usan primero los que vencen antes. Cada madrugada el sistema vence lo que ya cumplió su plazo.
- Los puntos son por empresa: un cliente con servicios en dos empresas tiene dos saldos.
- El saldo y los movimientos de un cliente se ven en la pestaña **Puntos** de su ficha. Ahí, con `lealtad.ajustar`, está «Ajustar puntos» para sumar o restar a mano con motivo.

Si las notificaciones están configuradas, el cliente recibe un aviso cuando gana puntos, cuando están por vencer y cuando un referido suyo califica.

## Preguntas frecuentes y errores

- **«Ya hay un programa activo».** Solo uno por empresa. Desactiva el otro primero.
- **Pide cuentas contables al activar.** Con diferimiento, la empresa necesita las cuentas del programa en su plan de cuentas. Habla con contabilidad.
- **«Para canjear en el portal, los puntos deben verse en él».** Enciende también «Mostrar los puntos en el portal del cliente».
- **Un cliente pagó a tiempo y no ganó puntos.** Revisa que el programa y la regla estuvieran vigentes y activos el día del pago, y que la factura cumpla las condiciones (por ejemplo, sin promesa de pago).

## Relacionado

- [Premios y canjes](./premios-y-canjes.md)
- [Referidos](./referidos.md)
- [Sorteos](./sorteos.md)
- [Reporte de lealtad](./pasivo-de-puntos.md)
