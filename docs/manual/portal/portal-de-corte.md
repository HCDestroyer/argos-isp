---
orden: 3
pantallas:
    - /configuracion/portal-corte
---

# Portal de corte (configuración)

En esta pantalla decides a qué dirección mandan los routers a los clientes suspendidos y qué pasa con su conexión en el momento de suspenderlos. Es una sola configuración para toda la instalación. Cómo funciona la página que ve el cliente: [Página de corte](./pagina-de-corte.md).

## Quién la usa

- **Ver:** permiso `portal_corte.ver` (roles `admin` y `lectura`).
- **Guardar:** permiso `portal_corte.configurar` (solo `admin`). Sin él la pantalla dice «Solo lectura» y no muestra los botones.

Está en **Configuración → Portal de corte**.

## Qué ves

- Si nunca se guardó, el aviso «Valores iniciales del servidor, todavía no guardados»: así funciona hoy, con los valores de la instalación. Al guardar quedan fijos aquí y desde entonces solo se cambian en esta pantalla. Si ya se guardó, ves «Guardado el …».
- **A dónde van los suspendidos:**
    - «IPv4 del portal». Vacía, se usa la IP de la dirección pública del portal (la ayuda del campo dice cuál). Si el servidor no tiene esa dirección, la ayuda sale en rojo: los routers no sabrían a dónde mandar a los suspendidos y tienes que escribir la IPv4.
    - «IPv6 del portal (opcional)». Vacía, la navegación por IPv6 de un suspendido se corta y su equipo pasa a IPv4.
    - «Puerto»: 80 normalmente; 8088 si el servidor de Argos usa el puerto dedicado a la página de corte (por ejemplo, detrás de Nginx Proxy Manager).
- **Al suspender un servicio**, una de dos opciones:
    - «Desconectar la sesión» (recomendado): el equipo del cliente se vuelve a conectar ya suspendido y ve la página de corte de inmediato.
    - «Mantener la sesión y cambiar velocidad (CoA)»: el cliente no se desconecta; el router le cambia el perfil en caliente. Descargas o llamadas ya abiertas pueden seguir hasta que se cierren.
- **Página de corte de cada empresa**: con `empresas.ver`, el botón «Ver la URL de corte de cada empresa» lleva a **Configuración → Empresas**, donde cada empresa puede usar la página de corte de Argos o una propia.

## Acciones

### Guardar

- **Permiso:** `portal_corte.configurar`
- **Dónde:** botón «Guardar» (o «Guardar estos valores» si nunca se guardó y no cambiaste nada).
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
- **Conflicto de versión** («La configuración del portal de corte cambió en otra sesión…»): otra persona guardó mientras editabas. Toca «Recargar» y repite tu cambio.
- **Los clientes suspendidos no ven la página después de guardar:** revisa el diagnóstico del router y que el puerto esté abierto en el servidor. Si el portal no los reconoce («No pudimos identificar tu servicio»), revisa la «Identificación del cliente cortado» del router ([Página de corte](./pagina-de-corte.md#como-reconoce-argos-al-cliente)).

## Relacionado

- [Página de corte](./pagina-de-corte.md)
- [Nodos del portal](./nodos-del-portal.md)
- [Argos detrás de un proxy](../../runbooks/detras-de-proxy.md)
