---
orden: 1
pantallas:
    - /clientes
    - /clientes/nuevo#crear-un-cliente
    - /clientes/[id]#ficha-del-cliente
    - /clientes/[id]/editar#editar-un-cliente
---

# Clientes

La lista de clientes es la puerta de entrada al día a día: buscas al cliente, abres su ficha y desde ahí ves sus servicios, su estado de cuenta y su historia, o le cobras.

## Quién la usa

- Ver la lista y la ficha: `clientes.ver` (todos los roles base).
- Crear clientes: `clientes.crear` (`admin`, `soporte`).
- Editar clientes: `clientes.editar` (`admin`, `soporte`).

## Lista de clientes

Abre **Clientes** en el menú.

### Qué ves

| Columna   | Qué muestra                                                                                    |
| --------- | ---------------------------------------------------------------------------------------------- |
| Cliente   | Nombre (enlace a la ficha), la marca «Empresa» si es una empresa y su correo (o «Sin correo»). |
| NIT / CUI | El documento fiscal.                                                                           |
| Teléfono  | Teléfono y, debajo, el móvil.                                                                  |
| Zona      | Solo si tienes `zonas.ver`.                                                                    |
| Alta      | Fecha en que se creó.                                                                          |

En el teléfono algunas columnas se esconden y el NIT aparece debajo del nombre.

### Buscar y filtrar

- **Buscador:** escribe nombre, NIT, teléfono, usuario PPP o IP. La lista se actualiza sola mientras escribes.
- **Accesos rápidos:** «Todos», «Cortados» (servicios suspendidos) y «Con deuda» (algún aviso de cobro vencido).
- **Filtros:** estado del servicio, zona, router y plan (cada lista aparece solo si tienes permiso para verla), y los interruptores «Con deuda vencida», «Con promesa activa» y «NIT o CUI por corregir». En el teléfono, los filtros se abren con el botón «Filtros», que muestra cuántos tienes puestos.
- «Limpiar» quita la búsqueda y todos los filtros.

Los filtros quedan en la dirección de la página: si la copias y la compartes, la otra persona ve la misma lista.

## Crear un cliente

- **Permiso:** `clientes.crear`
- **Dónde:** botón «Nuevo cliente» en la lista. Se abre un panel lateral; también existe la página **Clientes → Nuevo cliente** con el mismo formulario.
- **Qué pasa:** solo el nombre es obligatorio, lo demás se completa después. Al pulsar «Crear cliente» se abre su ficha y aparece el aviso «Cliente creado». Si tienes `servicios.crear`, el aviso trae el botón «Agregar servicio» para seguir con el alta del servicio.

Un doble clic o un reintento por mala señal no crea dos clientes.

### Campos del formulario

**Datos generales**

- **Nombre** (obligatorio): sale en el aviso de cobro, el recibo y la búsqueda.
- **Tipo:** Persona o Empresa.
- **Canal de avisos:** Correo, Telegram o WhatsApp. Por ahí le llegan los avisos de cobro, de corte y de reactivación.
- **Acepta avisos por WhatsApp:** solo con `notificaciones.registrar_consentimiento`. El permiso de contacto se guarda en Iris; si el cliente escribe BAJA en el chat, la baja manda. Al editar, si no se pudo leer el estado actual, la casilla queda deshabilitada con el error y «Reintentar».
- **Teléfono** y **Móvil:** para buscarlo al cobrar y para contactarlo. Se valida el formato.
- **Correo:** para el aviso de cobro y la factura electrónica.

**Ubicación**

- **Zona:** agrupa clientes por sector para reportes, corte y la empresa que factura. Solo con `zonas.ver`.
- **Coordenadas** (opcional), por ejemplo `14.6349,-90.5069`.
- **Dirección:** se propone como dirección de instalación de sus servicios.
- **Referencia** (opcional, hasta 300 caracteres): cómo llegar. La ve el técnico.

**Datos fiscales** (aviso de cobro y factura electrónica FEL)

- **Documento:** NIT, CUI (DPI), Pasaporte o Consumidor final (CF).
- **Número:** el NIT con su dígito verificador; el CUI con sus 13 dígitos; el pasaporte de 3 a 20 letras o dígitos. Consumidor final no lleva número. El botón «CF» lo marca como consumidor final.
- **País** (obligatorio, dos letras): NIT y CUI son de Guatemala; un extranjero usa pasaporte.
- **Nombre fiscal** y **Dirección fiscal.** «Copiar nombre y dirección» copia el nombre (en mayúsculas) y la dirección de arriba.
- **Agente de retención de IVA** y **Sector público.**

**Datos adicionales:** los campos propios de tu empresa, si los definiste en [Campos personalizados](campos-personalizados.md). Los obligatorios llevan asterisco.

## Ficha del cliente

Haz clic en el nombre del cliente en la lista.

Arriba ves el nombre, si es Persona o Empresa, su número de cliente, su zona y la fecha de alta. Si otro cliente paga por él, aparece «Paga: …» con el enlace. Si vino de una importación (por ejemplo de Mikrowisp), lo dice en letra pequeña.

### Botones de la ficha

| Botón            | Permiso                                        | Qué hace                                                                                    |
| ---------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------- |
| «Cobrar»         | `pagos.registrar`                              | Abre la caja con el cliente ya elegido.                                                     |
| «Nuevo servicio» | `servicios.crear`                              | Abre el [alta de servicio](alta-de-servicio.md) en un panel lateral, sin salir de la ficha. |
| «Cargo único»    | `facturas.emitir_cargo_unico` y `facturas.ver` | Factura algo que no es la mensualidad (venta de equipo, visita técnica).                    |
| «Editar»         | `clientes.editar`                              | Abre el formulario del cliente en un panel lateral.                                         |
| «Ver en Horus»   | `horus.abrir`                                  | Abre el cliente en Horus Flow, si la integración está activa.                               |

### Pestañas

- **Datos:** contacto, canal preferido, Telegram, zona, dirección, coordenadas (con enlace al mapa), referencia, los datos adicionales y la última edición con su número de versión. Debajo, el estado de WhatsApp (con `notificaciones.ver`), el **portal del cliente** y el **responsable de pago**.
- **Datos fiscales:** documento, país, retención, nombre y dirección fiscal. Si el NIT o CUI no pasó la validación, verás «NIT o CUI por corregir»: corrígelo en «Editar», porque la factura FEL lo exige válido. Sin NIT, los avisos salen a nombre de Consumidor Final (CF).
- **Servicios** (con `servicios.ver`): cada servicio con su usuario PPP, router, plan y precio (con «precio especial» si lo tiene), direcciones IP y estado. Con varias empresas, los servicios se agrupan por empresa.
- **Estado de cuenta** (con `clientes.estado_cuenta`): facturas, pagos y notas de crédito. Ver [Cobros](../cobros/index.md).
- **Puntos** (con `lealtad.ver`): el programa de lealtad.
- **Línea de tiempo** (con `bitacora.ver`): todo lo que le pasó al cliente y a sus servicios, facturas, pagos y promesas.

### Telegram

En **Datos**, el campo Telegram dice «Vinculado» o «Sin vincular».

- «Vincular» (`clientes.vincular_telegram`): pide al cliente que le escriba `/start` al bot de la empresa; el bot le responde con su chat id. Escribe ese número en «Chat id» y pulsa «Vincular».
- «Quitar» (`clientes.desvincular_telegram`): deja de mandarle avisos por Telegram.

### Portal del cliente

En **Datos**, la tarjeta «Portal del cliente» dice cómo entra el cliente al portal con su número de documento:

- **Contraseña propia**, con la fecha y hora del último cambio: la eligió él.
- **Contraseña por defecto**: todavía entra con la contraseña de su empresa ([Contraseña del portal](../portal/contrasena-del-portal.md)); el portal le pedirá elegir una propia.
- Si su empresa **no tiene contraseña por defecto**, un aviso dice que solo puede entrar con código (o con «Ver mi cuenta» desde la página de corte).

«Restaurar contraseña por defecto» (`clientes.restaurar_contrasena_portal`, roles `admin` y `soporte`) sirve cuando el cliente olvidó la suya:

1. Pulsa el botón. El diálogo explica que volverá a entrar con la contraseña de la empresa, que deberá elegir una nueva y que **se cerrarán sus sesiones del portal**. Si su empresa no tiene contraseña por defecto, también avisa que solo podrá entrar con código.
2. Pulsa «Restaurar». El aviso dice cuántas sesiones del portal se cerraron y la tarjeta pasa a «Contraseña por defecto».

Se puede repetir sin problema: si ya usaba la de la empresa, solo cierra las sesiones que tenga abiertas. Queda en la línea de tiempo como «Contraseña del portal restaurada a la de por defecto». Nunca se muestra ninguna contraseña.

Sin el permiso ves el estado, pero no el botón.

### Responsable de pago

Sirve cuando otra persona paga las facturas de este cliente (por ejemplo, un familiar o la empresa matriz).

- «Asignar responsable» o «Cambiar» (`clientes.asignar_responsable_pago`): busca al cliente que paga por nombre, NIT, teléfono, usuario PPP o IP, escribe el motivo y pulsa «Asignar». En la caja, al buscar al responsable aparecen también las facturas de este cliente.
- «Quitar» (`clientes.quitar_responsable_pago`): el cliente vuelve a pagar sus propias facturas.

Si este cliente ya es responsable de pago de otros, la ficha muestra la lista y no deja asignarle un responsable a él.

## Editar un cliente

- **Permiso:** `clientes.editar`
- **Dónde:** botón «Editar» en la ficha (panel lateral). También existe la página de edición con el mismo formulario.
- **Qué pasa:** al pulsar «Guardar cambios» la ficha muestra los datos nuevos y el aviso «Cambios guardados». El cambio queda en la línea de tiempo del cliente. Si cambiaste la casilla de WhatsApp, el permiso se manda a Iris después de guardar.

El teléfono y el móvil solo se validan si los cambiaste: un número viejo con otro formato no te impide guardar lo demás.

## Preguntas frecuentes y errores

**«Alguien más editó este cliente».** Otra persona guardó cambios mientras tenías el formulario abierto. Tus cambios no se guardaron: pulsa «Cargar versión actual» y vuelve a aplicarlos.

**«Hay datos por corregir».** Revisa los campos marcados en rojo. Los más comunes: el NIT no tiene un dígito verificador válido, el CUI no tiene 13 dígitos, falta el número del documento o falta un dato adicional obligatorio.

**«No se registró el permiso de WhatsApp».** El cliente sí se guardó, pero Iris no recibió el permiso. Pulsa «Reintentar» en el aviso.

**No veo el botón «Nuevo cliente» o «Editar».** Te falta el permiso `clientes.crear` o `clientes.editar`. Pídeselo a un administrador.

**La tarjeta «Portal del cliente» muestra un error con «Reintentar».** No se pudo leer cómo entra el cliente; pulsa «Reintentar». El resto de la ficha sigue funcionando.

**«Cliente no encontrado».** El enlace apunta a un número de cliente que no existe.

## Relacionado

- [Conceptos básicos](../../guia/conceptos.md)
- [Alta de un servicio](alta-de-servicio.md)
- [Servicios](servicios.md)
- [Campos personalizados](campos-personalizados.md)
