---
orden: 1
pantallas:
    - /configuracion/notificaciones
---

# Configuración de notificaciones

Aquí conectas los canales por los que ArgosIsp avisa a tus clientes y a tu equipo: el servidor de correo, el bot de Telegram y WhatsApp (por Iris). También decides qué tipos de aviso se mandan. Lo que configures aquí rige desde que guardas, sin reiniciar nada.

Los textos de cada aviso no se cambian aquí, sino en [Plantillas de avisos](./plantillas-y-envios.md).

## Quién la usa

- **Ver la pantalla:** permiso `notificaciones.ver`. Lo traen los roles `admin`, `soporte` y `lectura`.
- **Cambiar y guardar:** permiso `notificaciones.configurar`. Solo lo trae `admin`.
- **Enviar una prueba:** permiso `notificaciones.probar`. Solo lo trae `admin`.

Sin `notificaciones.configurar` ves todo, pero los campos están bloqueados y no aparece «Guardar». Sin `notificaciones.probar` no aparecen los botones «Enviar prueba».

Menú: **Configuración → Notificaciones e integraciones → Notificaciones**.

## Qué ves

### Configuración global o de una empresa

Arriba, el selector **«Configuración de»** elige qué configuración miras:

- **Global (todas las empresas):** la que usan todas las empresas que no tienen una propia.
- **Una empresa:** si manejas varias empresas (varios NIT), cada una puede usar la global o tener su propio servidor de correo, su bot y sus avisos.

Junto al selector, una etiqueta dice de dónde sale lo que ves:

| Etiqueta                          | Qué quiere decir                                                                                                            |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| «Guardada» (verde)                | La configuración se guardó desde el panel y es la que rige                                                                  |
| «Hereda la global» (gris)         | La empresa usa la configuración global                                                                                      |
| «Del entorno, sin guardar» (azul) | Nunca se guardó desde el panel: rigen los valores que el servidor trae de su instalación. En cuanto guardas, manda el panel |
| «Sin configurar» (gris)           | No hay nada configurado todavía                                                                                             |

### Usar la configuración global (solo en una empresa)

Con una empresa elegida aparece el interruptor **«Usar la configuración global»**. Encendido, la empresa usa la global y el resto del formulario queda bloqueado. Apágalo para darle a esa empresa su propio correo, su bot y sus interruptores de avisos.

### Correo (SMTP)

| Campo                    | Qué es                                                                                                                                                            |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| «Enviar correos»         | Interruptor del canal. Apagado, ningún aviso sale por correo                                                                                                      |
| «Servidor»               | Nombre o IP de tu servidor de correo saliente (`smtp.tu-dominio.gt`)                                                                                              |
| «Puerto»                 | Normalmente `587` (STARTTLS) o `465` (TLS)                                                                                                                        |
| «Cifrado»                | «Automático (STARTTLS si el servidor lo ofrece)», «STARTTLS obligatorio», «TLS desde el inicio (465)» o «Sin cifrar»                                              |
| «Usuario» y «Contraseña» | La cuenta con que ArgosIsp entra a tu servidor de correo                                                                                                          |
| «Remitente»              | La dirección que ve el cliente (`no-responder@tu-dominio.gt`)                                                                                                     |
| «Correo de contabilidad» | Una o varias direcciones separadas por coma. Reciben los avisos fiscales: integridad del libro, documento tributario rechazado, contingencia FEL y notas anuladas |
| «Nombre visible»         | El nombre que acompaña al remitente. Si manejas varias empresas, el correo sale con el nombre comercial de la empresa del aviso                                   |

### Telegram

| Campo                                   | Qué es                                                                                                                                                                  |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| «Avisos a clientes»                     | Interruptor: avisos por Telegram a los clientes que vincularon su cuenta                                                                                                |
| «Alertas al equipo» (solo en la global) | Interruptor de las alertas internas al chat del equipo: caídas del servidor RADIUS, cambios de velocidad fallidos, cajas con diferencia, procesos automáticos atrasados |
| «Token del bot»                         | El token que te da @BotFather al crear el bot (`123456:ABC…`)                                                                                                           |
| «Nombre del bot»                        | El usuario del bot (`@MiIspBot`). Con él se arman los enlaces que el cliente toca para vincularse                                                                       |
| «Chat del equipo»                       | El chat o grupo del equipo donde llegan las alertas (un número como `-1001234567890`). El bot tiene que ser miembro del grupo                                           |
| «Secreto del webhook»                   | Clave con que Telegram firma lo que le manda a ArgosIsp. Si guardas un token sin secreto, ArgosIsp genera uno                                                           |
| «Ruta del webhook»                      | Solo lectura: la dirección donde ArgosIsp recibe los mensajes de ese bot                                                                                                |

### WhatsApp

Un solo interruptor: **«Avisos a clientes por WhatsApp»**. Los mensajes de WhatsApp no salen de ArgosIsp, sino de la mensajería de Iris: Iris tiene los textos aprobados por Meta, los permisos de contacto de cada cliente, el límite diario y el horario de silencio. Además del interruptor, hace falta el conector con Iris activo y con contrato 0.6.0 o posterior. Si falta, cada aviso por WhatsApp queda «Omitido» con el motivo en la lista de envíos. Correo y Telegram siguen saliendo de ArgosIsp. Si tienes el permiso `iris.ver`, el enlace «Ver el conector con Iris» te lleva a esa pantalla.

### Avisos

Un interruptor por tipo de aviso. **Un aviso apagado no se envía por ningún canal** y queda registrado como «Omitido».

| Interruptor         | Qué avisa                                                                                                               |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| «Factura emitida»   | Aviso de cobro nuevo (también la factura anulada y el periodo o cargo sin costo)                                        |
| «Factura vencida»   | Cuando una factura vence sin pago                                                                                       |
| «Recordatorio»      | Los recordatorios de pago antes y después del vencimiento                                                               |
| «Corte»             | Servicio suspendido, limitado o reactivado, y la bienvenida al activar la instalación                                   |
| «Pago registrado»   | El recibo del pago                                                                                                      |
| «Promesa de pago»   | Promesa creada, cumplida o incumplida                                                                                   |
| «Comprobante»       | Comprobante de depósito recibido, aprobado o rechazado                                                                  |
| «Puntos de lealtad» | Puntos ganados, por vencer, referido calificado, canjes y sorteos (solo si tu instalación tiene el programa de lealtad) |

## Acciones

### Guardar la configuración

- **Permiso:** `notificaciones.configurar`
- **Dónde:** botón «Guardar», arriba a la derecha.
- **Qué pasa:** el envío usa los cambios desde ya («El envío usa los cambios desde ya»). El cambio queda en la bitácora; las contraseñas y tokens aparecen como `***`.
- **Se puede deshacer:** sí, volviendo a cambiar los campos y guardando.

### Cambiar o borrar una contraseña o un token

La contraseña del correo, el token del bot y el secreto del webhook **nunca se vuelven a mostrar**. Si hay uno guardado, el campo dice «Guardado» y muestra puntos.

- «Reemplazar» (o «Escribir», si no hay ninguno): abre el campo para escribir el valor nuevo.
- «Borrar»: el campo dice «Se borrará al guardar».
- «Deshacer»: vuelve a dejar el valor guardado como estaba.

Nada cambia hasta que pulsas «Guardar». Si no tocas el campo, el valor guardado se conserva.

### Enviar una prueba

- **Permiso:** `notificaciones.probar`
- **Dónde:** al final de la sección de correo y de la de Telegram, campo de destino y botón «Enviar prueba».
- **Qué pasa:** manda un mensaje en ese momento **con la configuración guardada** (si cambiaste algo, guarda primero), aunque el canal esté apagado. El resultado queda junto al botón:
    - «Enviado a …», con qué configuración salió (global, de la empresa o del entorno) y el número de envío.
    - «No se pudo enviar a …» con el error real del servidor de correo o de Telegram, por ejemplo `535 5.7.8 Authentication failed` (usuario o contraseña del correo) o `401 Unauthorized` (token del bot).
- En correo el destino es obligatorio. En Telegram, si lo dejas vacío, va al chat del equipo.
- La prueba queda en la pestaña «Envíos» de Plantillas de avisos.

### Registrar el webhook del bot (una vez, en el servidor)

Para que el bot responda a los clientes (vincular su cuenta, `/estado`, `/desvincular`), Telegram tiene que saber a dónde mandar los mensajes. Esto no se hace desde el panel: después de guardar el token, quien administra el servidor corre `node ace telegram:webhook` (con `--empresa=<id>` para el bot de una empresa). Ver [Comandos del servidor](../../runbooks/comandos.md#comandos-de-la-api-dentro-del-contenedor).

## Preguntas frecuentes y errores

| Ves                                                       | Por qué                                                                      | Qué hacer                                                  |
| --------------------------------------------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------- |
| «Alguien más cambió esta configuración»                   | Otra persona guardó mientras tú editabas. Tus cambios no se guardaron        | Pulsa «Recargar» y vuelve a aplicar tus cambios            |
| «Escribe correos válidos separados por coma»              | El correo de contabilidad tiene una dirección mal escrita                    | Corrige la dirección; usa coma entre una y otra            |
| «Indica el correo al que se envía la prueba»              | Pulsaste «Enviar prueba» de correo sin destino                               | Escribe un correo de destino                               |
| «Indica un chat o configura el chat del equipo»           | Prueba de Telegram sin destino y sin chat del equipo guardado                | Escribe un chat o guarda el chat del equipo                |
| La prueba dice `Authentication failed`                    | Usuario o contraseña del correo incorrectos                                  | Reemplaza la contraseña, guarda y prueba otra vez          |
| La prueba de Telegram dice `chat not found` o `Forbidden` | El bot no está en ese grupo o el cliente nunca le escribió                   | Agrega el bot al grupo del equipo                          |
| Los campos están bloqueados                               | No tienes `notificaciones.configurar`, o la empresa está heredando la global | Pide el permiso o apaga «Usar la configuración global»     |
| Los avisos por WhatsApp salen «Omitido»                   | Falta el conector con Iris activo o su contrato es anterior a 0.6.0          | Revisa el conector en Configuración → Integraciones → Iris |

## Relacionado

- [Plantillas de avisos, recordatorios y envíos](./plantillas-y-envios.md)
- [Monitoreo y alertas del servidor](../../runbooks/monitoreo.md)
- [Puesta en marcha](../../guia/puesta-en-marcha.md)
