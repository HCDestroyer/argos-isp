---
orden: 2
pantallas:
    - /bitacora
---

# Bitácora

Todo lo que se hace en ArgosIsp queda anotado aquí: quién lo hizo, cuándo, desde dónde, sobre qué y si salió bien o con error. También guarda el historial de cambios campo por campo (qué valor tenía antes y cuál tiene ahora). Nada de la bitácora se puede editar ni borrar.

![Bitácora con los filtros arriba y la lista de acciones con fecha, acción, actor, entidad y resultado](/capturas/general/bitacora.png)

## Quién la usa

- **Permiso:** `bitacora.ver`. Lo traen los roles `admin`, `soporte`, `contabilidad` y `lectura`. El `cajero` y el `tecnico` no la ven.
- Con `usuarios.ver` el filtro de actor es una lista con los nombres de los usuarios; sin ese permiso, escribes el número del usuario.

## Qué registra

- **Cada acción del sistema**, la haga una persona en el panel, el cliente en el portal, un token de API, un agente de IA o el propio sistema (el corte automático, la facturación del mes). Por ejemplo: crear un cliente, suspender un servicio, registrar o anular un pago, abrir o cerrar caja, aprobar un comprobante, publicar un anuncio, iniciar sesión.
- **Las que fallaron también**, con el error que vio quien lo intentó.
- **El motivo**, cuando la acción lo pide (suspender, anular, retirar…).
- **Los datos sensibles nunca se ven:** contraseñas PPPoE, credenciales y tokens aparecen como `***`.
- Algunas tareas automáticas que se repiten mucho solo se anotan cuando cambian algo (por ejemplo, la revisión del estado de un servicio que no cambió de estado).

## Qué ves

Dos pestañas:

### Acciones

Una fila por acción, de la más reciente a la más vieja:

| Columna           | Qué dice                                                                                                                                                                                                                   |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Fecha**         | Día y hora, en hora de Guatemala                                                                                                                                                                                           |
| **Acción**        | Qué se hizo, en palabras («Suspender servicio») y con su nombre técnico debajo (`servicios.suspender`). Si la acción pidió motivo, se ve «Motivo: …». Con varias empresas, también de cuál es                              |
| **Actor y canal** | Quién (nombre del usuario, token o «Sistema») y por dónde: **Panel**, **Portal**, **API**, **Agente de IA**, **Automático**, **Webhook**, **Interno** o **Consola**. Si vino de Iris, dice quién en Iris y la conversación |
| **Entidad**       | Sobre qué fue (cliente 12, servicio 34, factura 56…). Si el panel tiene ficha para esa entidad, es un enlace                                                                                                               |
| **Resultado**     | **Correcto** (verde) o **Error** (rojo)                                                                                                                                                                                    |

En el teléfono, la fecha, el actor y el canal se ven debajo de la acción.

### Historial de cambios

Un renglón por campo que cambió: **Fecha**, **Campo** (con la entidad, por ejemplo «Cliente 12»), **Antes** (tachado), **Después** y **Actor**. Sirve para saber, por ejemplo, quién cambió el plan de un servicio o el teléfono de un cliente y qué tenía antes. Para ver el historial de una cosa, elige el tipo de entidad y escribe su número.

## Filtros

Los filtros se aplican solos al cambiarlos y quedan en la dirección de la página, así que puedes copiar el enlace y compartir la misma búsqueda.

| Filtro                   | Pestaña  | Para qué                                                                |
| ------------------------ | -------- | ----------------------------------------------------------------------- |
| **Actor**                | Acciones | Lo que hizo un usuario                                                  |
| **Canal**                | Acciones | Solo lo del panel, del portal, de la API, automático…                   |
| **Acción**               | Acciones | Un tipo de acción; se puede buscar escribiendo («Buscar acción…»)       |
| **Tipo de entidad**      | Las dos  | Cliente, servicio, factura, pago, promesa, caja, plan, router, anuncio… |
| **ID de la entidad**     | Las dos  | El número de esa entidad                                                |
| **Conversación de Iris** | Acciones | Lo que se hizo desde una conversación de Iris                           |
| **Desde** y **Hasta**    | Acciones | Rango de días, en hora de Guatemala                                     |

«Limpiar filtros» los quita todos. Abajo, «Anterior» y «Siguiente» pasan de página.

## Acciones

### Ver el detalle de una entrada

- **Permiso:** `bitacora.ver`
- **Dónde:** toca cualquier fila de **Acciones**.
- **Qué pasa:** se abre un panel lateral con el resultado, el canal, la fecha, el actor, la entidad (con enlace), la empresa, el identificador de la petición («Request ID»), el error si lo hubo y la **Entrada**: los datos exactos que se enviaron, con lo sensible como `***`.
- Desde el detalle:
    - **«Acciones de esta petición»** filtra todo lo que se hizo en la misma operación. Por ejemplo, un pago y la reactivación del servicio que provocó.
    - **«Historial de cambios de la entidad»** pasa a la pestaña de cambios con esa entidad ya elegida.

## Preguntas frecuentes y errores

- **«Ninguna acción coincide».** No hay nada con esos filtros. Revisa las fechas o toca «Limpiar filtros».
- **«Sin cambios registrados» en Historial de cambios.** Elige un tipo de entidad y su número; no todas las acciones cambian campos (por ejemplo, desconectar una sesión no cambia datos del servicio).
- **Veo «Usuario #7» en lugar del nombre.** Tu usuario no tiene `usuarios.ver`, o ese usuario ya no aparece en la lista.
- **La línea de tiempo de un cliente.** En la ficha del cliente, la pestaña **Línea de tiempo** muestra la bitácora de ese cliente y de sus servicios, facturas, pagos y promesas, sin lo que hizo el cliente en el portal. Ver [Revisar la bitácora de un cliente](../../tutoriales/soporte/bitacora-del-cliente.md).
- **Aviso de error con «Reintentar».** No se pudo leer la bitácora. Reintenta; si sigue, avisa a soporte técnico.

## Relacionado

- [Revisar la bitácora de un cliente](../../tutoriales/soporte/bitacora-del-cliente.md)
- [Glosario](../../guia/glosario.md)
