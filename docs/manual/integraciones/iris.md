---
orden: 3
pantallas:
    - /configuracion/integraciones/iris
    - /integraciones/iris/autorizar#aprobar-la-conexion-desde-iris
---

# Iris

Iris lleva los tickets de soporte, las órdenes de trabajo de los técnicos y el seguimiento comercial. Conectado con ArgosIsp, Iris consulta clientes, servicios, planes y routers, registra instalaciones y retiros, y recibe los avisos de ArgosIsp (pagos, cortes, cambios de servicio).

## Quién la usa

- Ver: `iris.ver` (`admin`, `lectura`).
- Configurar (interruptor, enlace, configuración a mano y aprobar la conexión): `iris.configurar` (solo `admin`).
- Tokens: `iris.generar_token` (solo `admin`) y `iris.revocar_token`.

## Qué ves

**Integración con Iris:** su estado y el interruptor «Activa» o «Apagada». Apagada no hay llamadas a Iris ni webhooks, y nada del cobro, el corte ni la autenticación espera a Iris. Para encenderla hacen falta la URL de Iris y su token (`iris_pat_`).

Marcas que pueden aparecer:

| Marca                                   | Qué significa                                                                                                                                            |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| «Volver a conectar»                     | Iris pidió que se vuelva a conectar (por ejemplo, porque le falta el receptor de ArgosIsp). El aviso dice el motivo y trae «Generar enlace de conexión». |
| «Esperando que Iris active la conexión» | Iris ya canjeó el enlace. Si no la activa antes de la fecha que se muestra, ArgosIsp revoca el token y desconecta el conector.                           |
| «Desconectada»                          | El conector se desconectó; el aviso dice cuándo y por qué.                                                                                               |
| «Reconexión pendiente»                  | Se canjeó un enlace nuevo sobre una conexión en uso: mientras Iris no lo use, sigue la conexión actual.                                                  |

También se ven la URL de Iris, cuándo se conectó por enlace y el id del conector. Nunca se muestran tokens ni secretos.

**Contrato entre Argos e Iris:** la versión del contrato que habla este ArgosIsp (con `iris.abrir`) y la que informó Iris. Si Iris habla una anterior a la 0.8.0, o todavía no la informó, un aviso dice en palabras qué queda apagado:

- Iris no se entera al momento cuando se crea o edita una cuenta bancaria; la ve en la próxima sincronización.

Es lo único que ArgosIsp apaga por la versión. El precio mensual del servicio, la reconexión sin personal de caja y el avance de la sincronización están disponibles para cualquier Iris: los usa cuando su versión ya los conoce. El aviso de cuentas bancarias se enciende solo cuando Iris se actualiza y vuelve a informar su contrato.

**Sincronización informada por Iris:** lo que Iris dice que ya copió de ArgosIsp en su primera sincronización. Arriba, el estado general («En curso», «Completa» o «Con errores»), cuándo empezó y el último aviso de Iris. Debajo, una fila por recurso (empresas, zonas, planes, routers, bancos, cuentas bancarias, clientes y servicios) con cuántos lleva de cuántos («120 de 300»), su estado («Sin empezar», «En curso», «Completa», «Con errores»), el error que informó Iris y cuándo terminó. Las fechas van en hora de Guatemala. ArgosIsp no calcula nada de esto: lo muestra tal como llegó. Si Iris nunca lo informó, dice «Iris aún no ha informado la sincronización». «Actualizar» vuelve a leerlo.

**Empresas que ve Iris:** las empresas del usuario técnico «Iris». Iris copia los clientes, los servicios y las cuentas bancarias de estas empresas. «Alcance global» quiere decir todas, también las que se creen después. Se cambian en [Usuarios](../usuarios/usuarios.md#asignar-empresas).

## Acciones

### Conectar con un enlace

- **Permiso:** `iris.configurar`
- Pulsa «Generar enlace de conexión» y pégalo en Iris. Iris lo canjea y recibe en un paso su token de ArgosIsp; ArgosIsp guarda la URL de Iris, su token y su receptor.
- El enlace dura 15 minutos y sirve una vez. Un enlace nuevo anula los anteriores sin usar.
- El conector queda apagado hasta que lo actives. Con el botón «Conectar con Argos» de Iris, en cambio, se enciende solo al confirmar la conexión.
- Iris copiará los clientes, los servicios y las cuentas bancarias de las empresas de «Empresas que ve Iris».

### Configuración a mano

Rotulada «Vía de recuperación (avanzado)». Úsala solo si el botón «Conectar con Argos» de Iris o el enlace no funcionan. Pide **URL de Iris** (sin `/api/v1`), **Token de Iris (`iris_pat_`)**, **Receptor de Iris** (la URL que muestra Iris para los avisos de ArgosIsp) y **Secreto del receptor de Iris**. «Guardar conexión». Los secretos guardados nunca se vuelven a mostrar.

### Token de ArgosIsp para Iris

Lo que usa Iris para leer y escribir en ArgosIsp como el usuario técnico «Iris». El botón y el enlace de conexión lo generan solos; generarlo a mano es la «Vía de recuperación (avanzado)».

- «Generar token» (`iris.generar_token`): nombre opcional. El valor se ve una sola vez. Un token nuevo no revoca los anteriores.
- Revocar (`iris.revocar_token`): Iris ya no puede usar ese token.

### Envíos recientes

Los avisos que ArgosIsp mandó a Iris: evento, estado («Pendiente», «Enviado», «Fallido» o «Descartado»), intentos, cuándo y el último error. Se reintentan a 1 min, 5 min, 30 min, 2 h y 12 h; después quedan como fallidos. Arriba se resume el último fallo. «Actualizar» vuelve a leer la lista.

Si dice «No se envía nada a Iris», falta el conector activo con el receptor de Iris y su secreto.

## Aprobar la conexión desde Iris

Iris también puede pedir la conexión con un botón. Iris te manda a esta pantalla de ArgosIsp; si no tienes sesión, primero inicias sesión.

1. Revisa la dirección: «Iris en … pide conectarse con Argos». Dice con qué usuario la apruebas.
2. Revisa **Empresas que verá Iris**: las del usuario técnico «Iris». Si Iris nunca se conectó, verás «Todas las empresas, también las futuras». Las empresas de ese usuario se cambian en [Usuarios](../usuarios/usuarios.md#asignar-empresas). El aviso «Iris copiará los clientes, los servicios y las cuentas bancarias de estas empresas» recuerda qué datos salen hacia Iris.
3. Si aparece «Esta dirección de Iris no está registrada en Argos», solo aprueba si tú abriste esta conexión desde tu Iris, y escribe el dominio de Iris (tal como aparece arriba, sin `https://`) para confirmar.
4. Pulsa «Aprobar». Vuelves a Iris con la conexión hecha. La conexión se enciende sola cuando Iris la confirma.

«Rechazar» no conecta nada.

Sin `iris.configurar` verás «No puedes aprobar esta conexión»: pide a un administrador que la apruebe desde su usuario o que te dé el permiso.

## Vincular usuarios con Iris

Cada persona de Iris puede ligar su usuario de Iris con su usuario de ArgosIsp:

1. En Iris, la persona usa «Vincular mi usuario de Argos» (o «Abrir en Argos» desde un cliente o servicio).
2. Si su usuario todavía no está vinculado, ArgosIsp le pide su correo y su contraseña de ArgosIsp y guarda la vinculación.
3. Desde entonces entra a ArgosIsp desde Iris sin contraseña, **con sus propios permisos**.

ArgosIsp nunca crea usuarios ni vincula por correo. La vinculación también sirve para que esa persona apruebe o rechace comprobantes de depósito desde una conversación de Iris, siempre con su permiso de ArgosIsp. Cada usuario ve y quita sus vinculaciones en **Mi cuenta**.

## Preguntas frecuentes y errores

**«Alguien más cambió el conector».** Tus cambios no se guardaron. Pulsa «Recargar» y vuelve a aplicarlos.

**«Generar el enlace requiere el permiso para configurar Iris».** Hace falta `iris.configurar`.

**«Enlace incompleto» o «Enlace no compatible» al aprobar.** El enlace que abrió Iris no trae todos los datos o es de una versión que ArgosIsp no admite. Vuelve a pedir la conexión desde Iris.

## Relacionado

- [Integraciones](integraciones.md)
- [Horus Flow](horus.md)
- [Tokens de API](../usuarios/tokens.md)
