---
orden: 3
pantallas:
    - /configuracion/portal-corte
---

# Red y portal (configuración)

En esta pantalla decides a qué dirección mandan los routers a los clientes suspendidos y qué pasa con su conexión en el momento de suspenderlos. Es una sola configuración para toda la instalación. Cómo funciona la página que ve el cliente: [Página de corte](./pagina-de-corte.md).

## Quién la usa

- **Ver:** permiso `portal_corte.ver` (roles `admin` y `lectura`).
- **Guardar:** permiso `portal_corte.configurar` (solo `admin`). Sin él la pantalla dice «Solo lectura» y no muestra los botones.

- **Ajustes de operación** (pestañas «Caídas y fallas generales» y «Retiro, historial de IP y acceso», y la vigencia del código): ver con `ajustes_operacion.ver`, guardar con `ajustes_operacion.editar` (solo `admin`).

Está en **Ajustes → Red y equipos → Corte, caídas y retiro**. La tarjeta tiene tres pestañas: **Portal de corte**, **Caídas y fallas generales** y **Retiro, historial de IP y acceso**.

### Ajustes para todas las empresas o para una

Arriba, **Ajustes para** elige «Todas las empresas» (lo global) o una empresa. Lo que cambies en una empresa manda sobre «Todas». Cada ajuste lleva su etiqueta:

- **Para todas las empresas:** solo es global; en una empresa se ve pero no se cambia.
- **Cada empresa puede cambiarlo:** en «Todas» es el valor de las empresas que no tienen uno propio.
- **Propio de esta empresa** con **Usar el de «Todas»**, que borra el de la empresa; o **Igual que «Todas»** si no tiene uno propio.

El portal de corte (IP, puerto y modo de suspensión) es uno para toda la instalación: con una empresa elegida se ve bloqueado.

## Qué ves

- Si nunca se guardó, el aviso «Valores iniciales del servidor, todavía no guardados»: así funciona hoy, con los valores de la instalación. Al guardar quedan fijos aquí y desde entonces solo se cambian en esta pantalla. Si ya se guardó, ves «Guardado el …».
- **A dónde van los suspendidos:**
    - «IPv4 del portal». Vacía, se usa la IP de la dirección pública del portal (la ayuda del campo dice cuál). Si el servidor no tiene esa dirección, la ayuda sale en rojo: los routers no sabrían a dónde mandar a los suspendidos y tienes que escribir la IPv4.
    - «IPv6 del portal (opcional)». Vacía, la navegación por IPv6 de un suspendido se corta y su equipo pasa a IPv4.
    - «Puerto»: 80 normalmente; 8088 si el servidor de Argos usa el puerto dedicado a la página de corte (por ejemplo, detrás de Nginx Proxy Manager).
- **Al suspender un servicio**, una de dos opciones:
    - «Desconectar la sesión» (recomendado): el equipo del cliente se vuelve a conectar ya suspendido y ve la página de corte de inmediato.
    - «Mantener la sesión y cambiar velocidad (CoA)»: el cliente no se desconecta; el router le cambia el perfil en caliente. Descargas o llamadas ya abiertas pueden seguir hasta que se cierren.
- **Página de corte de cada empresa**: con `empresas.ver`, el botón «Ver la URL de corte de cada empresa» lleva a **Ajustes → Empresa y fiscal → Datos de la empresa**, donde cada empresa puede usar la página de corte de Argos o una propia.

- **El código que da el personal vale** (en «Cómo se identifica al cliente cortado»): minutos que dura el código de 6 dígitos que se da desde la ficha del servicio, de 5 a 60 (15 de fábrica). Cada empresa puede tener el suyo.

### Caídas y fallas generales

- **Caídas repetidas de un servicio:** «Avisar las caídas repetidas» (alerta en Conectados › Caídas repetidas y un ticket en Iris, uno por servicio mientras siga abierto), «Cuántas caídas» (2 a 50) y «En cuánto tiempo» (5 a 1,440 minutos). De fábrica, 3 caídas en 60 minutos. Cada empresa puede cambiarlo.
- **Falla general** (solo para todas las empresas: un router, OLT, PON o zona puede ser de varias): «Detectar fallas generales», «Cómo se mide» (Porcentaje o Cantidad), «Umbral», «Mínimo de servicios» y «En cuánto tiempo» (1 a 60 minutos). Un ejemplo debajo dice con cuántos servicios caídos se abriría con los valores escritos. Si un servicio está en una falla general, no se abre su propio ticket: va al ticket general de Iris.

### Retiro, historial de IP y acceso

- **Pedir a Iris la orden de retiro** al retirar un servicio y dejar su equipo «por recuperar» (se puede omitir al retirar si ya se entregó).
- **Quién tenía una IP · Buscar hasta:** días hacia atrás que se pueden buscar en Red › Direcciones IP (30 a 3,650; 730 de fábrica). Lo más viejo lo guarda Horus.
- **Recuperar la contraseña por correo:** muestra «¿La olvidaste?» en el inicio de sesión ([Iniciar sesión](../general/iniciar-sesion.md)).

## Acciones

### Guardar

- **Permiso:** `portal_corte.configurar`
- **Dónde:** botón «Guardar» (o «Guardar estos valores» si nunca se guardó y no cambiaste nada). Guarda a la vez lo que cambiaste del portal de corte y de los ajustes de operación; los ajustes necesitan `ajustes_operacion.editar` y se guardan para lo elegido en «Ajustes para».
- **Qué pasa:**
    - Si cambiaste la IPv4, la IPv6 o el puerto, primero se abre la confirmación «¿Actualizar las reglas de corte en todos los routers?» con el nuevo destino. Al tocar «Guardar y actualizar routers», Argos reescribe la redirección de los suspendidos en cada router con conexión (API). Los routers sin API la reciben al volver a correr su script.
    - Si solo cambiaste el modo de suspensión, se guarda sin confirmación y aplica desde la siguiente suspensión. Los servicios ya suspendidos siguen como están.
    - Queda en la bitácora con el antes y el después de cada campo.
- **Deshacer:** vuelve a poner los valores anteriores y guarda.

::: warning Un dato equivocado deja a los suspendidos sin página de corte
Si la IP o el puerto no son los del servidor, los clientes suspendidos no verán la página. Después de cambiarlos, comprueba con «Probar conexión» en la ficha de un router: el diagnóstico del corte debe salir en verde.
:::

### Descartar cambios

«Descartar cambios» vuelve el formulario a lo que está guardado, sin guardar nada.

## Preguntas frecuentes y errores

- **«Escribe una IPv4, p. ej. 190.56.10.20, o déjala vacía»** o el equivalente de IPv6: el formato no es válido.
- **«De 1 a 65535»** en el puerto: fuera de rango.
- **«De 5 a 60»** (u otro rango) en un ajuste: el valor está fuera de sus límites; la pestaña con el error se abre sola. En porcentaje, el umbral de la falla general va de 1 a 100.
- **Conflicto de versión** («La configuración del portal de corte cambió en otra sesión…»): otra persona guardó mientras editabas. Toca «Recargar» y repite tu cambio.
- **Los clientes suspendidos no ven la página después de guardar:** revisa el diagnóstico del router y que el puerto esté abierto en el servidor. Si el portal no los reconoce («No pudimos identificar tu servicio»), revisa la «Identificación del cliente cortado» del router ([Página de corte](./pagina-de-corte.md#como-reconoce-argos-al-cliente)).

## Relacionado

- [Página de corte](./pagina-de-corte.md)
- [Nodos del portal](./nodos-del-portal.md)
- [Argos detrás de un proxy](../../runbooks/detras-de-proxy.md)
