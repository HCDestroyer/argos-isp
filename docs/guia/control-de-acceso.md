---
orden: 4
---

# Cómo Argos deja navegar a un cliente

Argos decide quién navega, a qué velocidad y quién ve la página de corte. El router MikroTik solo obedece: cada vez que el equipo del cliente se conecta, el router le pregunta a Argos qué hacer con él. Esta página explica ese camino en palabras sencillas, qué pasa al suspender o reactivar y qué revisar cuando un cliente llama diciendo «no tengo internet».

## La conexión del cliente en tres pasos

1. **El equipo del cliente se conecta** (PPPoE) con su usuario y contraseña. Los ves en la ficha del servicio, en **Credenciales PPPoE**.
2. **El router pregunta a Argos** si ese usuario puede entrar. Esa pregunta viaja por RADIUS, el idioma estándar entre routers y sistemas de gestión.
3. **Argos responde** según el estado del servicio: deja entrar con la velocidad del plan, deja entrar con la velocidad limitada, deja entrar cortado (para que vea la página de corte) o no deja entrar.

Mientras el cliente está conectado, el router le avisa a Argos cada 5 minutos que la sesión sigue abierta y cuánto ha descargado. Por eso en la ficha del servicio ves si está **En línea** y su consumo.

## Qué recibe el cliente según el estado del servicio

| Estado del servicio      | ¿Se conecta? | Qué recibe                                                                                                  |
| ------------------------ | ------------ | ----------------------------------------------------------------------------------------------------------- |
| Activo                   | Sí           | La velocidad completa de su plan, su IPv4 y sus prefijos IPv6                                               |
| Limitado                 | Sí           | La velocidad limitada del plan. Navega, pero más lento                                                      |
| Suspendido               | Sí, cortado  | Una velocidad mínima y su navegación se redirige a la **página de corte**, donde puede ver su saldo y pagar |
| Pendiente de instalación | No           | El router lo rechaza hasta que se active la instalación                                                     |
| Retirado                 | No           | El router lo rechaza. El usuario PPPoE no se vuelve a usar                                                  |

::: tip Por qué el suspendido sí se conecta
Si Argos no dejara entrar al suspendido, su equipo solo mostraría «error de autenticación» y el cliente no sabría por qué. Al dejarlo entrar cortado, cualquier página que abra lo lleva a la página de corte con su saldo y la forma de pagar.
:::

Si la contraseña PPPoE no coincide con la de Argos, el router lo rechaza aunque el servicio esté activo.

## Suspender, reactivar y limitar

Cuando un servicio cambia de estado (porque alguien usó «Suspender», «Reactivar», «Limitar» o «Quitar límite» en la ficha, o porque el sistema lo cortó por mora o lo reactivó al recibir un pago), Argos le avisa al router en el momento. No espera a que el cliente se vuelva a conectar ni a ningún proceso nocturno.

| Qué pasa                                                | Qué hace Argos con la conexión del cliente                                                                                                                                                   | Cuánto tarda                                                                   |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Suspender                                               | Por defecto **desconecta la sesión**. El equipo del cliente se vuelve a conectar solo, ya suspendido, y ve la página de corte                                                                | Unos segundos: lo que tarda el equipo del cliente en reconectarse              |
| Reactivar                                               | **Desconecta la sesión** para que el equipo vuelva a entrar con la navegación completa                                                                                                       | Unos segundos, igual que al suspender                                          |
| Limitar o quitar el límite                              | Cambia la velocidad **sin desconectar** al cliente. Según cómo esté configurado el control de velocidad del router, el cambio lo manda Argos por RADIUS o reescribiendo las colas del router | En las pruebas, el router confirma el cambio por RADIUS en menos de 5 segundos |
| Cambiar la IP, el prefijo IPv6 o el router del servicio | Desconecta la sesión: al volver a entrar, el cliente recibe la IP o el prefijo nuevos                                                                                                        | Unos segundos                                                                  |
| Retirar                                                 | Desconecta la sesión y ya no lo deja volver a entrar                                                                                                                                         | Unos segundos                                                                  |

El modo de suspender se elige en **Configuración → Portal de corte**, en «Al suspender un servicio»:

- **Desconectar la sesión** (recomendado, viene así): el cliente ve la página de corte de inmediato y no le quedan descargas ni llamadas abiertas de antes.
- **Mantener la sesión y cambiar velocidad (CoA)**: el cliente no se desconecta; el router le cambia el perfil en caliente. Lo que ya tenía abierto puede seguir funcionando hasta que se cierre.

El cambio de modo rige desde la siguiente suspensión: los servicios que ya estaban suspendidos siguen como están.

::: warning Un pago no quita una suspensión manual
Si alguien suspendió el servicio a mano, la ficha muestra el aviso «Suspendido manualmente» con el motivo. En ese caso un pago no lo reactiva solo: hay que usar «Reactivar».
:::

Si el cliente no tiene ninguna sesión abierta en ese momento, Argos no tiene nada que avisarle al router: la próxima vez que el equipo se conecte ya recibe lo que corresponde a su estado.

## Routers sin RADIUS

Un router puede trabajar **Sin RADIUS**. Lo ves en la ficha del router, en «RADIUS y CoA», con la etiqueta «Sin RADIUS» y el texto «PPPoE con secrets locales». En ese caso:

- Argos guarda el usuario y la contraseña de cada cliente directamente en el router, con el perfil de su plan (o el perfil de corte si está suspendido).
- Al suspender, reactivar, limitar o cambiar la IP, Argos cambia ese perfil en el router y **desconecta la sesión** para que el equipo vuelva a entrar con lo nuevo. Aquí no existe el cambio de velocidad sin desconectar.
- Argos revisa cada minuto qué clientes están conectados en el router. Por eso una conexión o desconexión puede tardar hasta un minuto en verse en el panel, y una sesión muy corta puede no quedar registrada.
- No hay datos de consumo. Las sesiones de estos routers llevan el distintivo «Por sondeo» y en consumo dicen «— (sin RADIUS no hay consumo)».
- Si el router no responde cuando Argos quiere aplicar un cambio, Argos lo reintenta y además revisa el router cada 15 minutos para corregir lo que no coincida.

## Cuando un cliente dice «no tengo internet»

Abre la ficha del servicio (**Operación → Servicios** y busca al cliente). Revisa en este orden:

1. **Estado del servicio.** Si está suspendido, el cliente debería estar viendo la página de corte; si está retirado o pendiente de instalación, el router no lo deja entrar. Si el cliente ya pagó y sigue suspendido, revisa si tiene otras facturas vencidas o una suspensión manual.
2. **Sesión activa.** La tarjeta «Sesión activa» dice **En línea** o **Desconectada** y se actualiza sola cada 30 segundos mientras la tienes abierta.
    - **En línea**: el router lo tiene conectado. Ahí ves desde cuándo, la IPv4, los prefijos IPv6 y el tráfico. Si está en línea y aun así no navega, el problema suele estar dentro de la casa del cliente (Wi-Fi, cable, equipo) o es un tema de velocidad.
    - **Desconectada**: el equipo del cliente no logra conectarse. Puede ser que su equipo esté apagado, sin señal (antena, fibra) o que el router lo esté rechazando.
3. **Historial de sesiones.** Debajo de la ficha está el historial, de la más reciente a la más vieja, con inicio, fin, IPv4, consumo y por qué terminó cada una. Algunos motivos que vas a ver:
    - «Reemplazada por una sesión nueva»: el equipo volvió a entrar sin cerrar la anterior; normal tras un corte de luz.
    - «Cerrada sin noticias del router»: el router dejó de reportar la sesión durante 15 minutos.
    - «Ya no estaba en el router»: en un router sin RADIUS, la sesión desapareció entre dos revisiones.
    - «Desconectada por ArgosIsp»: en un router sin RADIUS, Argos la quitó (corte, reactivación, desconexión manual).
    - Otros motivos llegan tal como los manda el router, en inglés: `Lost-Carrier` (se perdió la señal del equipo), `User-Request` (el equipo cerró la sesión), `Admin-Reset` (la desconectó Argos o un técnico), `NAS-Reboot` (se reinició el router).
4. **Caídas repetidas.** Muchas sesiones cortas seguidas en poco tiempo señalan un problema de enlace o de equipo, no de cobro. Argos lo detecta solo cuando un servicio tiene 5 caídas en 2 horas (sin contar los cortes que hace Argos ni los reinicios del router) y, si Iris está conectado, se lo avisa.
5. **El router.** En la ficha del router, la salud muestra si está **En línea**, **Fuera de línea** o **Desconocido**, y cuántos servicios PPPoE están conectados. Si muchos clientes del mismo router están desconectados a la vez, el problema es del router o de su enlace, no del cliente.

Si el cliente está en línea pero con datos viejos (por ejemplo, se reactivó y sigue cortado), puedes usar «Desconectar sesión» en la ficha del servicio (permiso `servicios.desconectar`). Su equipo se vuelve a conectar solo en segundos y recibe lo que corresponde a su estado. No cambia el estado del servicio ni avisa al cliente.

## Cuándo escalar

Pasa el caso al técnico o al administrador del servidor cuando:

- Varios clientes de un mismo router se quedan **Desconectada** a la vez, o el router aparece **Fuera de línea**.
- Llega al chat del equipo la alerta «ALERTA · RADIUS (aaa) caído» o «ALERTA · CoA sin respuesta del router …» / «ALERTA · Disconnect sin respuesta del router …».
- Un cliente suspendido sigue navegando normal más de un minuto después del corte, o uno reactivado sigue en la página de corte después de «Desconectar sesión».
- Un servicio activo, con la contraseña correcta, sigue **Desconectada** y el equipo del cliente dice «error de autenticación».
- Un cliente nuevo o recién instalado no logra conectarse ni una vez.

Lleva estos datos: nombre del cliente, número de servicio, router, hora aproximada del problema y lo que viste en «Sesión activa» y en el historial.

::: tip Si se cae el servidor RADIUS
Los clientes que ya estaban conectados siguen navegando. Los que reinician su equipo durante la caída pueden quedarse sin internet hasta que vuelva; no hace falta visita técnica. El detalle para el técnico está en [RADIUS caído](../runbooks/aaa-caido.md).
:::

## Relacionado

- [Diagnóstico de RADIUS y CoA](../runbooks/radius-y-coa.md), para el técnico.
- [RADIUS caído](../runbooks/aaa-caido.md).
- [RADIUS, accounting y CoA](../desarrolladores/radius.md), para desarrolladores.
- [Manual de red](../manual/red/index.md) y [Clientes y servicios](../manual/clientes-y-servicios/index.md).
