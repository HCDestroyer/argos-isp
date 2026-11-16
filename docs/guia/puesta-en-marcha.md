---
orden: 5
---

# Puesta en marcha: de cero a cobrar

La lista, en orden, de lo que hay que hacer para pasar de un servidor vacío a la primera facturación. Cada paso enlaza a la página que lo explica. Hazlos en este orden: cada uno necesita el anterior.

## 1. Instalar el servidor

Quien administra el servidor instala ArgosIsp con un solo comando. Necesita un servidor Ubuntu o Debian (o un Raspberry Pi de 64 bits con SSD), tres nombres de dominio (`panel.`, `api.` y `portal.` de tu dominio) apuntando a él y los puertos abiertos.

- [Instalar ArgosIsp en un servidor](../runbooks/instalacion.md)
- Si el servidor ya tiene otro proxy en los puertos 80 y 443: [Argos detrás de otro proxy](../runbooks/detras-de-proxy.md)
- Guarda una copia del archivo de configuración del servidor fuera de él: sin sus claves un respaldo no sirve. Ver [Respaldos](../runbooks/respaldos.md).

## 2. Entrar al panel

Entra a `https://panel.<tu-dominio>` con el correo y la clave que mostró el instalador y **cambia la clave** en tu perfil. Si la pierdes, el administrador del servidor puede darte otra con `argosisp admin-clave` ([Comandos del servidor](../runbooks/comandos.md)).

## 3. Configurar la empresa y sus datos fiscales

Nombre comercial, NIT, logo, dirección, establecimientos, régimen y la facturación electrónica (FEL). Si manejas varios NIT, crea una empresa por cada uno.

- [Configuración](../manual/configuracion/)
- [Fiscal y FEL](../manual/fiscal/)

## 4. Crear los usuarios

Una cuenta por persona (nunca cuentas compartidas), con el rol que corresponde a su puesto: `cajero`, `soporte`, `tecnico`, `contabilidad`, `lectura` o `admin`.

- [Usuarios y permisos](../manual/usuarios/)

## 5. Conectar el primer MikroTik

Da de alta el router en el panel, descarga su script de conexión y aplícalo en el MikroTik. El router queda unido al servidor por un túnel cifrado, con RADIUS y la gestión protegida.

- [Red](../manual/red/)
- [MikroTik: qué configura ArgosIsp](../runbooks/mikrotik.md)

## 6. Crear los planes y las plantillas de facturación

Los planes dicen la velocidad y el precio. Las plantillas de facturación dicen cuándo se factura, cuándo vence y cuándo se corta.

- Planes: [Red](../manual/red/)
- Plantillas de facturación: [Facturación](../manual/facturacion/)

## 7. Importar o crear los clientes

Si vienes de Mikrowisp, SmartISP u otro sistema, importa clientes, servicios, facturas pendientes y saldos. Haz siempre dos corridas de prueba antes de la importación real. Si empiezas de cero, crea los clientes y sus servicios en el panel.

- [Importar desde otro sistema](../importacion/)
- [Paso a paso de la importación](../runbooks/importacion.md)
- [Clientes y servicios](../manual/clientes-y-servicios/)

## 8. Configurar las notificaciones y el portal de corte

- Correo, bot de Telegram y qué avisos se mandan: [Configuración de notificaciones](../manual/notificaciones/configuracion.md). Usa «Enviar prueba» antes de seguir.
- Textos de los avisos y recordatorios de pago: [Plantillas de avisos](../manual/notificaciones/plantillas-y-envios.md).
- La página que ve un cliente suspendido y el portal del cliente: [Portal y corte](../manual/portal/).

## 9. Primera facturación

Revisa con contabilidad las facturas del primer periodo antes de que salgan a los clientes, y que la caja esté lista para cobrar.

- [Facturación](../manual/facturacion/)
- [Cobros y caja](../manual/cobros/)

## Después de arrancar

- [Respaldos](../runbooks/respaldos.md) y [restaurar un respaldo](../runbooks/restaurar-backup.md): prueba una restauración el primer mes.
- [Monitoreo y alertas](../runbooks/monitoreo.md): que el chat del equipo reciba las alertas.
- [Actualizar y revertir](../runbooks/actualizacion.md).
