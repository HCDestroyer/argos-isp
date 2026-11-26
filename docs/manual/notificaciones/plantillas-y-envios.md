---
orden: 2
pantallas:
    - /notificaciones
---

# Plantillas de avisos, recordatorios y envíos

En esta pantalla decides qué dice cada aviso que reciben tus clientes, cuándo salen los recordatorios de pago y revisas cada mensaje que salió (o que no salió, y por qué). Los canales (servidor de correo, bot de Telegram) y los interruptores por tipo de aviso están en [Canales de aviso](./configuracion.md).

## Quién la usa

- **Ver la pantalla:** permiso `notificaciones.ver`. Lo traen los roles `admin`, `soporte` y `lectura`.
- **Editar plantillas y recordatorios:** permiso `notificaciones.editar`. Solo lo trae `admin`. Sin él no aparece el lápiz de editar.
- El filtro por cliente de la pestaña «Envíos» y el nombre de cada cliente necesitan además `clientes.ver`.

Menú: **Ajustes → Comunicación e integraciones → Plantillas de avisos**. Tiene tres pestañas: «Plantillas», «Recordatorios» y «Envíos».

## Cómo sale un aviso

Cuando pasa algo en la cuenta de un cliente (se emite una factura, se registra un pago, se suspende el servicio…), ArgosIsp prepara el aviso con la plantilla de ese evento y lo manda **por todos los canales que sirvan**, para que le llegue por cualquier medio. Un canal sirve si:

1. está encendido y configurado en Ajustes → Comunicación e integraciones → Canales de aviso,
2. el cliente tiene destino en ese canal (correo en su ficha, o Telegram vinculado), y
3. la plantilla de ese evento y canal está activa.

Si un envío por Telegram falla sin remedio y el cliente no tenía ya el mismo aviso por correo, ArgosIsp lo manda por correo como respaldo. Los errores pasajeros (red, servidor ocupado) se reintentan solos, con esperas cada vez más largas.

::: tip
Un mismo hecho nunca se avisa dos veces: si el sistema recibe el mismo evento de nuevo, no crea otro envío.
:::

## Pestaña «Plantillas»

Un texto por **evento** y **canal** (correo, Telegram o WhatsApp).

### Qué ves

- Filtros: tipo de evento («Avisos al cliente», «Recordatorios de pago», «Alertas al equipo» o «Todos los eventos») y canal.
- Columnas: «Evento» (nombre y nombre técnico; «Apagada» si la plantilla está desactivada), «Canal», «Mensaje» (asunto y el inicio del texto, en pantallas anchas) y el lápiz para editar.

Algunos eventos que vas a encontrar: «Factura emitida», «Factura vencida», «Cambio de estado del servicio», «Bienvenida al activar la instalación», «Pago registrado», «Pago hecho por otro cliente», «Promesa creada», «Promesa cumplida», «Promesa incumplida», «Comprobante recibido», «Comprobante aprobado», «Comprobante rechazado», «Periodo o cargo sin costo», «Recordatorio de pago 1» a «3», los de lealtad y sorteos, y las «Alerta al equipo · …» (estas solo van por Telegram al chat del equipo).

### Editar una plantilla

- **Permiso:** `notificaciones.editar`
- **Dónde:** lápiz al final de la fila. Se abre un panel a la derecha.
- **Campos:**
    - «Activa»: apagada, ese evento no se avisa por ese canal.
    - «Asunto»: en correo es el asunto; en Telegram va como primera línea del mensaje (vacío = sin ella). Hasta 300 caracteres.
    - «Mensaje»: texto plano de hasta 4000 caracteres, con variables entre llaves dobles, por ejemplo `{{cliente.nombre}}` o `{{factura.total_q}}`. Para mostrar algo solo en ciertos casos: `{{#estado.es_suspendido}}…{{/estado.es_suspendido}}`.
- **Variables de este evento:** abajo aparece la lista de variables que trae el evento, agrupadas (Cliente, Servicio, Factura, Empresa…). Toca una para insertarla donde está el cursor; al pasar encima ves un ejemplo. Los montos que terminan en `_q` ya vienen en quetzales (`Q 200.00`) y las fechas en hora de Guatemala.
- **«Ver vista previa»:** muestra cómo lo recibe el cliente con datos de ejemplo, sin guardar nada. Si usaste una variable que ese evento no trae, avisa «Variables que este evento no trae (salen vacías)».
- **«Guardar»:** aviso «Plantilla guardada». Se usa en los avisos que salgan desde ese momento; lo que ya se envió no cambia. El cambio queda en la bitácora con el texto anterior y el nuevo.

**WhatsApp:** el texto no se edita aquí. Por WhatsApp sale la plantilla aprobada por Meta que tiene Iris con el código que se muestra («Código de la plantilla de Iris»); sus textos se cambian en Iris. Aquí solo enciendes o apagas el aviso con «Activa».

## Pestaña «Recordatorios»

Hasta **tres recordatorios** por factura sin pagar. Cada tarjeta muestra «Recordatorio 1», «2» o «3», cuándo sale («3 días antes del vencimiento», «El día que vence», «3 días después del vencimiento»), la hora (de Guatemala) y si está «Activo» o «Apagado». El texto de cada uno es la plantilla «Recordatorio de pago n» de cada canal.

Si no se cambiaron, salen 3 días antes, el día del vencimiento y 3 días después, a las 09:00.

### Editar un recordatorio

- **Permiso:** `notificaciones.editar`
- **Dónde:** lápiz de la tarjeta.
- **Campos:** «Días respecto al vencimiento» (de −60 a 60: negativo es antes, 0 el día que vence, positivo después), «Hora» (de Guatemala) y «Activo».
- **Qué pasa:** aviso «Recordatorio n guardado». Cambiar un recordatorio no reenvía lo que ya salió.

### Qué facturas reciben recordatorio

- Solo las que tienen saldo pendiente (emitidas, con abono parcial o vencidas). Nunca las pagadas, anuladas, castigadas, acreditadas o sustituidas.
- No sale un recordatorio cuya fecha es anterior a la emisión de la factura, ni uno de hace más de 7 días (así no se avisa por facturas viejas importadas ni después de una caída larga del servidor). Si el servidor estuvo detenido, al volver manda solo el último recordatorio que toca, no los tres atrasados.
- Los servicios pendientes de instalación no reciben recordatorios ni aviso de factura vencida.

## Pestaña «Envíos»

El registro de cada mensaje: a clientes, al equipo y las pruebas.

### Qué ves

- Filtros: cliente (con `clientes.ver`), evento exacto (por ejemplo `factura.emitida`), canal y estado.
- Columnas: «Fecha», «Aviso» (nombre del evento, canal y destino), «Cliente» («Equipo» si es una alerta interna) y «Estado».
- Estados:

| Estado                  | Qué quiere decir                                                                                               |
| ----------------------- | -------------------------------------------------------------------------------------------------------------- |
| «En cola» (azul, reloj) | Está esperando salir o reintentándose                                                                          |
| «Enviado» (verde)       | El servidor de correo o Telegram lo aceptó                                                                     |
| «Fallido» (rojo)        | No se pudo enviar y ya no se reintenta. El error dice por qué                                                  |
| «Omitido» (gris)        | No se mandó a propósito: canal o tipo de aviso apagado, o WhatsApp sin el conector con Iris. El motivo lo dice |

Debajo del estado puede decir «respaldo del #…»: es el correo que salió porque falló el envío por otro canal.

### Ver un envío

El ojo al final de la fila abre el detalle: estado y número de intentos, cliente, cuándo se creó y cuándo se envió, origen (qué lo produjo), el **error** o el **motivo**, el asunto y el mensaje tal como salió.

## Preguntas frecuentes y errores

| Ves                                        | Por qué                                                                                | Qué hacer                                                                                                                                                                                                |
| ------------------------------------------ | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| «Plantilla Mustache inválida: …»           | El mensaje tiene llaves mal cerradas, por ejemplo una sección `{{#…}}` sin su `{{/…}}` | Revisa las llaves y vuelve a guardar                                                                                                                                                                     |
| «Escribe el texto del aviso»               | El mensaje quedó vacío                                                                 | Escribe el texto o apaga la plantilla con «Activa»                                                                                                                                                       |
| «Entre −60 y 60» / «Hora en formato HH:MM» | Días o hora fuera de rango en un recordatorio                                          | Corrige el valor                                                                                                                                                                                         |
| Error de que el dato cambió (versión)      | Otra persona guardó la misma plantilla o recordatorio                                  | Cierra, recarga la página y vuelve a editar                                                                                                                                                              |
| Un cliente dice que no le llegó nada       | Revisa en «Envíos» filtrando por el cliente                                            | «Fallido» con destino `-`: no tiene correo ni Telegram; agrégalo en su ficha. «Omitido»: ese aviso o canal está apagado. «Fallido» con error del servidor: revisa la configuración y usa «Enviar prueba» |
| «No se pudo leer el catálogo de eventos»   | La lista de eventos y variables no cargó                                               | «Reintentar». La vista previa y el guardado siguen funcionando                                                                                                                                           |
| No veo el lápiz                            | No tienes `notificaciones.editar`                                                      | Pide el permiso a un administrador                                                                                                                                                                       |

## Relacionado

- [Canales de aviso](./configuracion.md)
- [Monitoreo y alertas del servidor](../../runbooks/monitoreo.md)
