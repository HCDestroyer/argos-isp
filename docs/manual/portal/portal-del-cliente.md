---
orden: 2
pageClass: capturas-movil
---

# Portal del cliente

El portal del cliente es la página donde tus clientes ven su servicio, entran con un código y hacen sus trámites desde el teléfono: pagar, subir un comprobante, pedir una promesa de pago, ver facturas y sorteos. Esta guía te sirve para acompañar al cliente por teléfono paso a paso.

Hay una guía con más capturas para el piloto en [Portal del cliente (piloto)](../../piloto/portal-cliente.md).

## Las tres entradas

La página de inicio del portal ofrece:

- **Estado de mi servicio**: la [página de corte](./pagina-de-corte.md). Reconoce al cliente por su conexión, sin contraseña, y muestra solo su nombre parcial, el estado y los montos.
- **Mi cuenta**: facturas, pagos y datos. Se entra con un código.
- **Contacto**: teléfonos, WhatsApp, correo, horario y dirección de la empresa.

## Entrar con código

Para ver facturas, pagos y datos de contacto, el cliente siempre confirma que es el titular con un código de 6 dígitos.

![Entrar a mi cuenta con el código de 6 dígitos](/capturas/portal/07-entrar-codigo.png)

1. Desde la página de corte toca «Mis facturas y pagos» y luego «Enviarme el código». O, desde **Entrar**, escribe su **NIT, CUI o usuario de conexión** (aparece en su aviso de cobro) y toca «Enviarme un código».
2. El código llega al **correo o Telegram registrado** en su ficha: por Telegram si es su canal preferido y lo tiene vinculado; si no, por correo. Nunca se manda a otro destino.
3. Escribe los 6 dígitos y toca «Entrar».

Reglas que conviene saber:

- El código vence a los 10 minutos y admite 5 intentos. «Pedir otro código» manda uno nuevo y el anterior deja de servir.
- Máximo 5 códigos por cliente por hora.
- La sesión se cierra sola tras 30 minutos sin uso, y a las 4 horas aunque se use. «Salir» la cierra en el acto.
- Cuando entra con su NIT, el portal responde lo mismo exista o no el cliente («Si los datos corresponden a un cliente, lo enviamos…»), para no revelar si un NIT es de alguien.

::: tip «No me llega el código»
Revisa en la ficha del cliente que el correo esté bien escrito o que tenga Telegram vinculado. Si el cliente pidió muchos códigos seguidos, tiene que esperar a que pase la hora.
:::

## Mi cuenta

Con la sesión abierta el portal tiene una barra de secciones (abajo en el teléfono): **Inicio**, **Pagar**, **Facturas**, **Puntos** (solo si la empresa activó el programa de puntos en el portal) y **Cuenta**. Se actualiza al jalar la página hacia abajo.

- **Inicio**: resumen de sus servicios con su saldo, avisos (servicio suspendido o limitado, promesa aprobada o pendiente) y promociones.
- **Pagar**: pagar en línea (si tiene varios servicios, elige «¿Qué servicio quieres pagar en línea?»), ver datos de depósito, sus comprobantes, «Pagos registrados» y «Promesas de pago».
- **Facturas**: cada documento con su botón para verlo en PDF («Ver aviso de cobro (PDF)», o «Ver factura (PDF)» cuando ya está certificada en FEL, con «Descargar XML»). Abajo, sus notas de crédito y meses bonificados.
- **Cuenta**: vincular Telegram, aceptar o dejar los avisos por WhatsApp, cambiar **Correo**, **Teléfono**, **Celular** y «¿Por dónde prefieres recibir avisos?» (Correo, Telegram o WhatsApp), «Ayuda y contacto» y «Salir».

::: warning Cambiar el correo
El correo que el cliente guarda en **Cuenta** es al que llegan sus avisos de cobro y sus próximos códigos de acceso.
:::

### Vincular Telegram

![Vincular Telegram en la sección Cuenta](/capturas/portal/08-telegram.png)

1. En **Cuenta**, toca «Vincular Telegram» y luego «Abrir Telegram».
2. En Telegram, toca **Iniciar**. El portal cambia solo a «Vinculado».
3. Si el enlace no abre Telegram, el portal muestra el mensaje para enviar a mano. «Generar otro enlace» crea uno nuevo.

Para quitarlo: «Desvincular Telegram» y confirmar.

## Ver los datos de depósito

«Ver datos de depósito» muestra las cuentas de la empresa con un botón para copiar el número, y las instrucciones de pago. Se configuran en el panel en **Configuración → Contacto y pagos** y **Configuración → Cuentas bancarias**. Solo aparecen las cuentas activas en quetzales: las cuentas en dólares no se muestran al cliente.

![Datos para depósito con las cuentas de la empresa](/capturas/portal/02-datos-deposito.png)

## Subir un comprobante

Desde la página de corte («Subir comprobante») o desde **Pagar** en Mi cuenta.

![Formulario para subir el comprobante](/capturas/portal/05-comprobante.png)

1. «¿Cómo pagaste?»: Depósito en agencia, Transferencia, ACH o Remesa.
2. «Cuenta a la que pagaste». En transferencia y ACH también «Banco desde el que transferiste».
3. «Monto pagado» (el exacto del comprobante), «Fecha del pago» y «Número de referencia o boleta».
4. «Foto o PDF del comprobante»: «Tomar foto» o «Elegir archivo». JPG, PNG, WebP o PDF de hasta 5 MB.
5. Toca «Enviar comprobante».

![Comprobante recibido, en revisión](/capturas/portal/06-comprobante-recibido.png)

El comprobante queda **En revisión** y aparece en el panel en **Cobros → Comprobantes**. Cuando alguien lo aprueba, el pago se abona y, si el servicio estaba suspendido, se reactiva. Si se rechaza, el cliente ve «No pudimos aprobarlo» con el motivo en **Pagar** y puede subirlo de nuevo. Cómo se revisa: [Comprobantes](../cobros/comprobantes.md).

::: tip «Ya deposité y sigo cortado»
El depósito cuenta cuando se aprueba el comprobante. Si el cliente no puede subirlo, regístralo tú en caja.
:::

## Pedir una promesa de pago

El botón «Prometer pago» solo aparece si la plantilla del cliente le permite pedir una ahora (por ejemplo, no aparece si ya tiene una promesa abierta o no tiene facturas vencidas).

![Formulario de promesa de pago con fecha y monto](/capturas/portal/03-promesa.png)

1. El portal muestra antes los límites: hasta qué día puede prometer, las facturas que cubre y, si la plantilla lo pide, el abono previo («Antes de prometer debes pagar…») o si la revisa un asesor.
2. El cliente elige «¿Qué día vas a pagar?» y toca «Solicitar promesa».

La respuesta es inmediata:

- **Aprobada**: el servicio se reactiva en segundos y la página cambia a «Ya tienes servicio» con el recordatorio de la fecha. Si no paga a tiempo, el servicio se vuelve a suspender.
- **Pendiente de aprobación**: alguien tiene que aprobarla en **Promesas** del panel.
- **Rechazada** («No pudimos aprobar tu promesa»): el portal dice el motivo y ofrece «Cambiar fecha» o «Contactar a la oficina».

El portal no decide nada por su cuenta: las reglas (plazo, cantidad por mes, abono, aprobación) son las de la plantilla del cliente en el panel.

## Pagar en línea

Si la empresa tiene pasarela, el cliente toca «Pagar en línea» y paga con tarjeta en la página del proveedor. Al volver, la página muestra «Procesando tu pago…» hasta que llega la confirmación, y luego «Recibimos tu pago de Q …». Si el pago no se completó o el enlace venció, no se hizo ningún cobro y puede intentar de nuevo. Mientras hay un pago en curso, el portal no ofrece pagar otra vez.

## Contacto

La página **Contacto** muestra los teléfonos (con botón para llamar), WhatsApp, correo, horario y dirección que configuraste en **Configuración → Contacto y pagos**. Si no hay ninguno configurado, dice «No hay datos de contacto para mostrar».

## Sorteos

Cuando la empresa publica un sorteo, el cliente ve un aviso en el inicio de su cuenta (y en la página de corte) con el premio principal, las fechas y «Ver mis boletos». En la sección de sorteos ve:

- Cada sorteo con su estado, sus boletos y su seudónimo.
- «Ver las bases del sorteo» y, al terminar, «Bases, resultado y verificación», con los ganadores por seudónimo y «Descargar datos de verificación (JSON)».
- «¡Ganaste en este sorteo!» si salió premiado: la empresa lo contacta para entregar el premio.

Si no hay sorteos: «No hay sorteos por ahora».

## Qué nunca se muestra sin código

Desde la conexión (sin código de 6 dígitos) el cliente solo ve su primer nombre con una inicial, el estado y los montos. Facturas, pagos, promesas y datos de contacto piden siempre el código.

## Mensajes que el cliente puede ver

| Mensaje                                                            | Qué hacer                                                                                                                                            |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| «No pudimos consultar tu servicio» / «No pudimos cargar tu cuenta» | El sistema no respondió. Que toque «Reintentar». Si dura, avisa a soporte técnico                                                                    |
| «Demasiadas consultas»                                             | Que espere un minuto                                                                                                                                 |
| «No pudimos identificar tu servicio»                               | Ver [Página de corte](./pagina-de-corte.md#cliente-no-identificado)                                                                                  |
| «No hay cuentas para depósito disponibles»                         | La empresa no tiene cuentas configuradas para depósito; el cliente no puede subir comprobante. Configúralas en **Configuración → Cuentas bancarias** |
| «No necesitas una promesa de pago»                                 | No tiene facturas vencidas                                                                                                                           |

## Relacionado

- [Página de corte](./pagina-de-corte.md)
- [Comprobantes](../cobros/comprobantes.md)
- [Plantillas de documentos](./plantillas-de-documentos.md)
