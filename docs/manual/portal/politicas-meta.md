---
orden: 6
---

# Políticas para Meta

Para conectar WhatsApp Business, Meta revisa la app y pide tres direcciones públicas: la política de privacidad, las condiciones del servicio y las instrucciones para eliminar datos. El portal del cliente ya las publica, con el nombre y los datos de contacto de tu empresa. No tienes que escribirlas ni subirlas a otro sitio.

## Qué URLs poner en la app de Meta

En la configuración básica de la app de Meta, con el dominio de tu portal (por ejemplo `https://portal.tuempresa.com`):

| Campo en Meta | URL |
| --- | --- |
| URL de la política de privacidad | `https://portal.<dominio>/privacidad` |
| URL de las condiciones del servicio | `https://portal.<dominio>/terminos` |
| Instrucciones para la eliminación de datos (elige «URL de instrucciones») | `https://portal.<dominio>/eliminar-datos` |

Las tres se abren sin iniciar sesión, salen completas aunque el navegador no ejecute JavaScript y tienen enlaces entre sí y en el pie de todas las páginas del portal, incluida la página de corte. Usa la dirección pública del portal con `https://`; la dirección interna que usan los routers no sirve, porque Meta la revisa desde Internet.

## De dónde salen los datos

El responsable que aparece en las tres páginas es la empresa configurada en **Configuración → Empresas**:

- **Razón social** (nombre legal) y **Nombre comercial.** Si no hay razón social, se usa el nombre comercial.
- **NIT**, **Dirección fiscal**, **Correo**, **Teléfono** y **Horario de atención.**

Lo que no está configurado no se muestra ni se inventa: por ejemplo, sin correo, «Eliminar mis datos» ofrece solo el teléfono y la página de contacto. Antes de enviar la app a revisión, revisa que la razón social, el NIT, la dirección y el correo estén completos: Meta suele pedir un correo de contacto para las solicitudes de eliminación.

**Varias empresas.** Desde Internet (como entra el revisor de Meta) las páginas muestran la empresa principal. Un cliente conectado a la red ve la empresa de su servicio. Para mostrar otra empresa en particular agrega `?empresa=<número>`, por ejemplo `https://portal.<dominio>/privacidad?empresa=2`, y usa esa URL en la app de Meta de esa empresa.

## Qué dicen las páginas

- **Privacidad:** qué datos guarda el sistema (identificación y facturación, contacto, ubicación del servicio, IP y sesiones, cobros y comprobantes, permiso de WhatsApp), para qué, con quién se comparten (certificador FEL y SAT, procesador de pagos en línea, Iris y Meta para WhatsApp, Telegram, correo y, si lo usas, Horus Flow), cuánto tiempo se conservan, cómo se protegen y los derechos del cliente. Lleva versión y fecha de vigencia.
- **Términos:** uso del portal y de los canales de mensajería, pagos y comprobantes, promesas de pago, corte y reactivación según el plan de facturación (sin cifras) y ley aplicable.
- **Eliminar mis datos:** cómo pedirlo (correo y teléfono de la empresa, página de contacto u oficina), plazo de respuesta de 30 días, qué se elimina (correo, teléfonos, Telegram y el permiso de WhatsApp) y qué se conserva por ley (facturas, pagos, registros contables y el registro de actividad). También explica cómo dejar de recibir WhatsApp sin eliminar nada.

## Cómo atender una solicitud de eliminación

No hay un botón que borre a un cliente: las facturas, los pagos y el libro contable no se borran nunca. Para atenderla:

1. Confirma la identidad de quien lo pide.
2. En la ficha del cliente, quita su correo, teléfono y celular.
3. Desvincula su Telegram y registra la baja de su permiso de WhatsApp.
4. Si además quiere terminar el servicio, retíralo.
5. Respóndele, dentro de los 30 días, qué se eliminó y qué se conserva.

## Relacionado

- [Portal del cliente](./portal-del-cliente.md)
- [Empresas](../configuracion/empresas.md)
