---
orden: 2
pantallas:
    - /configuracion/integraciones/horus
---

# Horus Flow

Horus Flow mide el tráfico, la salud y la seguridad de tu red. Conectado con ArgosIsp, cada servicio muestra su consumo y su estado de seguridad, Horus le avisa a ArgosIsp de lo que detecta y los usuarios pasan de un sistema al otro sin volver a escribir su contraseña.

## Quién la usa

- Ver: `horus.ver` (`admin`, `lectura`).
- Configurar (interruptor, enlace, conexión manual): `horus.configurar` (solo `admin`).
- «Probar conexión»: `horus.probar`.
- Tokens: `horus.generar_token` y `horus.revocar_token` (`admin`).
- Revocar vinculaciones: `vinculaciones.revocar` (`admin`).

## Qué ves

**Integración con Horus:** su estado y el interruptor «Activa» o «Apagada». Apagada no hay llamadas a Horus ni webhooks, y nada del cobro, el corte ni la autenticación espera a Horus. Para encenderla hacen falta la URL de Horus y el código de conexión (`hf_pat_`).

Debajo, **Último éxito**, **Fallos seguidos** y **Conectado por enlace**. Si hubo errores, el último error y, tras varios fallos seguidos, «En pausa hasta las …».

Si cambió la clave de cifrado del servidor, aparece «Hay secretos que no se pueden leer» con cuáles hay que volver a escribir.

## Acciones

### Conectar con un enlace

La forma más fácil: un enlace intercambia en un paso los tokens y los secretos de los dos sentidos. Dura 15 minutos y sirve una vez. Hay dos caminos:

- **Generar enlace para Horus:** pulsa «Generar enlace de conexión», cópialo y pégalo en Horus (**Administración → Integraciones → ArgosISP → Conectar con enlace**).
- **Enlace generado en Horus:** si el enlace lo generaste en Horus, pégalo aquí y pulsa «Conectar».

Al terminar verás «Conectado con Horus». El conector queda apagado: actívalo con el interruptor cuando quieras empezar.

Si alguien abre el enlace en el navegador, ve una [pantalla](../red/conectar.md) que le explica que va pegado en Horus.

### Conexión manual

Alternativa al enlace: copias los datos a mano.

- **URL de Horus** (sin `/api/v1`), **Código de conexión de Horus (`hf_pat_`)**, **Receptor de Horus** (la URL que muestra Horus para los avisos de ArgosIsp) y **Secreto del receptor de Horus**.
- **Receptor de ArgosIsp (para pegar en Horus):** la URL y el secreto que Horus usa para avisarle a ArgosIsp. «Generar secreto» o «Regenerar secreto»; el secreto se ve una sola vez.
- «Guardar conexión».

Los secretos guardados nunca se vuelven a mostrar.

### Probar conexión

«Probar conexión» comprueba la lectura de Horus (con su tiempo de respuesta) y manda un ping firmado al receptor de Horus. Cada resultado dice si salió bien y, si no, el error.

### Token de ArgosIsp para Horus

Lo que usa Horus para leer de ArgosIsp, como el usuario técnico «Horus» (solo puede resolver IPs y ver clientes y servicios). El enlace de conexión lo genera solo.

- «Generar token» (`horus.generar_token`): nombre opcional. El valor se ve una sola vez. Un token nuevo no revoca los anteriores.
- Revocar (`horus.revocar_token`): Horus ya no puede leer con ese token.

### Autologin desde Horus

Cada usuario vincula su cuenta de Horus la primera vez que entra a ArgosIsp desde Horus: ArgosIsp le pide su correo y contraseña de ArgosIsp y recuerda la vinculación. Desde entonces, «Ver en ArgosIsp» en Horus lo abre directo, **con sus propios permisos**. Nunca se crea un usuario ni se vincula por correo.

- Cada usuario ve y quita sus vinculaciones en **Mi cuenta**.
- «Revocar todas las vinculaciones» (`vinculaciones.revocar`): obliga a todos a volver a iniciar sesión la próxima vez que entren desde Horus. Nadie pierde su usuario.

## Preguntas frecuentes y errores

**«El enlace de Horus venció o ya se usó».** Los enlaces duran 15 minutos y sirven una vez. Genera otro en Horus.

**«Alguien más cambió el conector».** Tus cambios no se guardaron. Pulsa «Recargar» y vuelve a aplicarlos.

**No me deja encender la integración.** Faltan la URL de Horus o el código de conexión.

## Relacionado

- [Integraciones](integraciones.md)
- [Iris](iris.md)
- [Tokens de API](../usuarios/tokens.md)
