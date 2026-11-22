---
orden: 1
pageClass: capturas-movil
---

# Página de corte

La página de corte es lo que ve un cliente con el servicio suspendido cuando abre el navegador. Ahí ve cuánto debe y puede pagar, subir su comprobante o pedir una promesa de pago sin llamar a la oficina. Esta página explica cómo funciona, para que puedas ayudar al cliente por teléfono. Al final hay una sección técnica para el administrador.

![Página de corte en un teléfono: servicio suspendido, monto pendiente y acciones](/capturas/portal/01-corte.png)

## Cómo llega el cliente a la página

1. Cuando un servicio queda suspendido, el router de Argos desvía su navegación web hacia el portal.
2. El cliente abre cualquier página que empiece con `http://` y aterriza en la página de corte.
3. Los teléfonos y las computadoras detectan solos que hay un «portal» y muestran el aviso **Iniciar sesión en la red** (Android, iPhone, Windows, macOS, Firefox). Al tocarlo se abre la página de corte.

::: tip Páginas con candado (https)
Las páginas con `https://` (Google, Facebook, el banco) no se desvían: el navegador solo muestra que no carga. Si el cliente dice «no me abre nada», pídele que abra una página `http://`, por ejemplo `http://neverssl.com`, o que toque el aviso de «Iniciar sesión en la red».
:::

Mientras está suspendido, el cliente solo puede llegar al portal, a la pasarela de pago y a los sitios que el ISP dejó permitidos. Todo lo demás está cerrado.

## Qué ve el cliente

Si el portal reconoce su servicio, ve:

- Su primer nombre con una inicial («Hola, Juan P.»). Nunca el nombre completo, el NIT, la dirección ni el teléfono.
- El estado: «Tu servicio está suspendido», «Tu servicio está limitado», «Tu servicio está dado de baja», «Tu instalación está pendiente» o «Tu servicio está activo».
- El **monto pendiente** y cuántas facturas están vencidas, con su total.
- Los botones de lo que puede hacer **en ese momento** (solo aparece lo que el sistema aceptaría):
    - «Pagar en línea», si la empresa tiene pasarela de pago. Si no la tiene, el botón principal es «Ver datos de depósito».
    - «Subir comprobante», si la empresa tiene cuentas para depósito.
    - «Ver datos de depósito»: las cuentas y las instrucciones de pago.
    - «Prometer pago», solo si su plantilla le permite pedir una promesa ahora.
    - «Ver mi cuenta»: abre su cuenta (facturas, pagos y datos) sin pedirle nada, porque la página ya reconoció su servicio. Ver [Entrar con documento y contraseña](./acceso-con-contrasena.md#ver-mi-cuenta-desde-la-pagina-de-corte).
    - «Contactar soporte»: llama al teléfono configurado en el panel.

Cómo hace el cliente cada cosa está en [Portal del cliente](./portal-del-cliente.md).

### Reactivación sin recargar

Después de pagar en línea, de una promesa aprobada o de subir un comprobante, la página revisa el servicio cada 5 segundos (durante unos 2 minutos). Cuando el servicio vuelve, cambia sola a «Ya tienes servicio» con el botón «Seguir navegando». Si se agota la espera, el cliente puede tocar «Ya pagué: revisar mi servicio».

![Ya tienes servicio, con el recordatorio de la promesa](/capturas/portal/04-ya-tienes-servicio.png)

Un comprobante no reactiva solo: la página queda esperando hasta que alguien lo apruebe en **Comprobantes** ([Comprobantes](../cobros/comprobantes.md)).

## Cómo reconoce Argos al cliente

Sin usuario ni contraseña, Argos tiene que saber de qué servicio viene el cliente. Lo hace de una de dos formas, y cada router usa la suya (se elige al crear o editar el router, en «Identificación del cliente cortado»):

| Forma          | Cómo funciona                                                                                                                          | Cuándo se usa                                                                                                                |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| **Por código** | El router manda a cada suspendido a la página de corte con un código propio de su servicio en el enlace. Argos lo lee y sabe quién es. | Routers con la API configurada (usuario y contraseña). Es la recomendada.                                                    |
| **Por IP**     | Argos mira la dirección IP con la que llega el cliente y busca qué servicio la tiene.                                                  | Routers sin API. Solo funciona si nada en el camino cambia la IP (túnel WireGuard, servidor en la misma red del ISP o IPv6). |

El código dura lo que dura la suspensión. Al reactivar el servicio se cierra, y todavía sirve 30 minutos más para que el cliente vea «Ya tienes servicio».

::: info Lo que da el código o la IP
Reconocer al cliente por su conexión solo muestra el nombre parcial, el estado y los montos, y le permite pagar, subir un comprobante o pedir una promesa. Para ver facturas, pagos y datos de contacto siempre tiene que entrar con el código de 6 dígitos que le llega al correo o a Telegram.
:::

Desde la ficha del servicio, la tarjeta «Código de corte» muestra si el servicio tiene un código activo y desde cuándo, sin mostrar el código.

## Cliente no identificado

![Página de corte sin identificar el servicio](/capturas/portal/09-no-identificado.png)

Significa que el portal no supo de qué servicio viene la visita. El cliente solo ve «Entrar con mi NIT o usuario», «Ver datos de depósito», «Contactar soporte» y, abajo, «Conexión desde» con la IP que vio el portal.

Qué decirle según el mensaje:

| El cliente lee                                                                                                  | Qué pasa                                                                     | Qué hacer                                                                                                                          |
| --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| «El enlace que abriste ya venció…»                                                                              | Abrió un enlace viejo de la página de corte (por ejemplo, del historial)     | Que abra cualquier página `http://` otra vez, o que entre con su NIT o usuario                                                     |
| «Desde esta conexión no podemos saber cuál es tu servicio. Entra con tu NIT o usuario y te mandamos un código.» | El portal ve la IP del router, del servidor o de un proxy, no la del cliente | Que entre con su NIT, CUI o usuario de conexión. Avisa al administrador: el router probablemente debe pasar a «Por código»         |
| «Conéctate desde la red de tu servicio de internet o entra con tu NIT o usuario.»                               | Está en datos móviles u otro wifi, o su equipo aún no tiene sesión           | Que se conecte al wifi de su casa. Si ya está en casa, que reinicie su router; si sigue, revisa su sesión en la ficha del servicio |

En todos los casos el cliente puede **entrar con su NIT o usuario**: recibe un código de 6 dígitos en su correo o Telegram registrado y desde **Mi cuenta** paga, sube su comprobante o pide su promesa.

::: tip Muchos clientes «no identificados» el mismo día
Si varios clientes del mismo router dicen lo mismo, el problema es de red, no del cliente. Avisa al administrador para que revise el diagnóstico del router (sección técnica abajo).
:::

## Qué pasa con la conexión al suspender

En **Configuración → Red y portal → Portal de corte** el administrador elige una de dos formas ([Portal de corte](./portal-de-corte.md)):

- **Desconectar la sesión** (recomendado): el equipo del cliente se vuelve a conectar ya suspendido y ve la página de corte de inmediato.
- **Mantener la sesión y cambiar velocidad (CoA)**: el cliente no se desconecta, pero descargas o llamadas ya abiertas pueden seguir un rato hasta que se cierren.

## Preguntas frecuentes

**«Ya pagué y sigo viendo la página de corte.»** Si pagó en línea, la página se actualiza sola en segundos. Si depositó, el pago cuenta cuando se aprueba su comprobante. Si pidió promesa y quedó «pendiente de aprobación», alguien tiene que aprobarla en **Promesas**. No hace falta reiniciar el router.

**«Me sale _No pudimos consultar tu servicio_.»** El sistema no respondió. La página no muestra montos inventados; el cliente toca «Reintentar». Mientras tanto ve los datos de depósito y el teléfono de soporte. Si dura más de unos minutos, avisa a soporte técnico.

**«Me sale _Demasiadas consultas_.»** El portal limita las consultas por conexión. Basta esperar un minuto.

**«Tengo dos servicios.»** La página de corte muestra el servicio de la conexión desde la que entra. En **Mi cuenta** ve todos.

## Sección técnica (administrador)

Esta parte es para quien administra el servidor y los routers. El detalle completo está en el contrato [corte e identificación](../../../.claude/integration/contratos/corte-identificacion.md) y en el del [nodo del portal](../../../.claude/integration/contratos/nodo-portal.md).

### El camino de una visita

1. **Primer salto.** El router hace `dst-nat` del HTTP (puerto 80) de los suspendidos hacia la IPv4 y el puerto de **Configuración → Red y portal → Portal de corte** (por IPv6 solo si hay IPv6 del portal). Ahí responde el portal, que identifica al cliente y lo redirige con `302` a `https://<dominio del portal>/corte?c=<código>`. Si la empresa tiene su propia URL de corte (en **Configuración → Empresa y fiscal → Empresas**), después de identificar redirige a esa URL.
2. **Segundo salto.** La página y sus consultas (estado, promesa, comprobante, pago) viajan por HTTPS con el código de la suspensión. Ya no dependen de la IP.

El problema clásico: el masquerade del router (o Nginx Proxy Manager y Docker en el servidor) cambia la IP del cliente por la del router o la del proxy. Por eso existen los dos modos.

### Modo por código

- Argos activa el web proxy del router en el puerto **3346**, cerrado desde fuera (solo entra lo que trae el `dst-nat` de un suspendido). Si el proxy ya se usaba para otra cosa, solo agrega su puerto y sus reglas. Primero cierra el 3346 desde fuera y agrega el puerto al proxy sin encenderlo; luego escribe las reglas y el NAT, y enciende el proxy al final (RouterOS no acepta reglas para un puerto que el proxy aún no tiene).
- Por cada suspendido escribe una regla `/ip proxy access` que lo redirige a `/corte?c=<código>`, más una regla final sin código. El reconciliador las mantiene y borra las que sobran.
- Necesita la API del router. Sin ella la API responde 422 `corte_codigo_sin_api`.

### Modo por IP: túnel WireGuard, LAN o IPv6

- **Túnel WireGuard:** si el router está en modo IP y registrado en el túnel, el `dst-nat` del corte va a la IP del servidor en el túnel (`10.255.0.1:8088` por defecto) y el router no enmascara a sus clientes hacia esa IP. La ficha del router muestra «Corte por el túnel: sí/no» con el motivo. Se apaga con `PORTAL_CORTE_TUNEL=0`.
- **Servidor o nodo en la LAN del ISP:** la IPv4 del portal es la del servidor en la LAN. Funciona si el masquerade del router no aplica hacia esa IP y el servidor tiene ruta de vuelta a los pools.
- **IPv6:** sin NAT, la IP llega tal cual si configuras la IPv6 del portal.
- Los routers sin API reciben estas piezas con «Generar script»; hay que volver a correrlo.

### Nodo del portal

El portal puede correr en otro servidor (otra oficina o la nube) que habla con el central por HTTPS con su token. Se crea en **Configuración → Red y portal → Nodos del portal** ([Nodos del portal](./nodos-del-portal.md)) o con `argosisp nodo-portal crear <nombre>`, y se instala con `instalar.sh --rol portal --central https://api.<dominio> --token <token>`. Con routers por el túnel, el primer salto lo atiende el central y redirige al nodo con el código.

### Diagnóstico

En la ficha del router, «Probar conexión» incluye el diagnóstico del corte:

- `portal_ip_cliente`: el router pide `/api/v1/portal/eco-ip` desde la puerta de enlace de sus clientes y compara la IP que ve el portal. En modo IP, si ve otra IP, sale en rojo («hay NAT o un proxy en medio») con la sugerencia de pasar el router a «Por código», registrarlo en el túnel o agregar un `srcnat accept` hacia la IP del portal antes de tu masquerade.
- `proxy_corte` (modo código): el proxy en el 3346, la regla final y una regla por suspendido. Si falla, «Reconciliar ahora» lo corrige.

Motivos de «no identificado» que devuelve la API: `codigo_vencido`, `ip_de_router`, `ip_de_servidor` (`PORTAL_IPS_SERVIDOR`), `ip_de_proxy` (`PORTAL_PROXIES_CONFIABLES`) e `ip_desconocida`. El sitio del corte en Caddy (`:8088`) nunca cree encabezados `X-Forwarded-For`; detrás de Nginx Proxy Manager revisa el runbook [detrás de un proxy](../../runbooks/detras-de-proxy.md).

### Pruebas en el laboratorio

La guía [portal cautivo en un MikroTik real](../../laboratorio/portal-cautivo.md) tiene los pasos con Android, iPhone y Windows, el modo código y el túnel.

## Relacionado

- [Portal del cliente](./portal-del-cliente.md)
- [Portal de corte (configuración)](./portal-de-corte.md)
- [Comprobantes](../cobros/comprobantes.md)
