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

| Columna   | Qué muestra                                                                                |
| --------- | ------------------------------------------------------------------------------------------ |
| Cliente   | Nombre (enlace a la ficha), su código (`C-000412`) y la marca «Empresa» si es una empresa. |
| Teléfono  | Teléfono y, debajo, el móvil.                                                              |
| Zona      | Solo si tienes `zonas.ver`.                                                                |
| NIT / CUI | El documento fiscal.                                                                       |
| Alta      | Fecha en que se creó.                                                                      |

Al final de cada fila, «Cobrar» (con `pagos.registrar`) y el botón «⋯» con las mismas acciones del clic derecho. En el teléfono algunas columnas se esconden y el teléfono aparece debajo del nombre.

Un clic en la fila (fuera del nombre) abre la **vista rápida**: una tarjeta que flota a la derecha sin tapar la lista, con el estado (el del servicio más atrasado y sus facturas vencidas), el saldo, cuántos servicios tiene, el teléfono, cada servicio con su IP y la zona. Abajo, «Cobrar Q …», «Promesa» (si tiene varios servicios, pregunta de cuál) y «Abrir ficha». Se cierra con Esc o con la ×.

### Buscar y filtrar

- **Buscador:** escribe nombre, NIT, teléfono, usuario PPP o IP. La lista se actualiza sola mientras escribes.
- **Contadores** (arriba): «Al día» (sin facturas vencidas), «Con deuda» (alguna vencida), «Suspendidos» y «Con promesa». Un clic filtra la lista; otro clic lo quita. Todavía no muestran cuántos clientes hay en cada uno.
- **Pestañas de la lista:** «Todos», «Al día», «Con deuda» y «Suspendidos», los mismos filtros.
- **Más filtros:** estado del servicio, zona, router y plan (cada lista aparece solo si tienes permiso para verla), y los interruptores «Con deuda vencida», «Con promesa activa» y «NIT o CUI por corregir». El botón muestra cuántos tienes puestos.
- «Limpiar» quita la búsqueda y todos los filtros.

Los filtros quedan en la dirección de la página: si la copias y la compartes, la otra persona ve la misma lista.

## Crear un cliente

- **Permiso:** `clientes.crear`
- **Dónde:** botón «Nuevo cliente» en la lista. Se abre el alta en **3 pasos** (Cliente, Servicio y Cobro), con el progreso arriba.
- **Paso 1, Cliente:** solo el nombre es obligatorio, lo demás se completa después. «Siguiente: servicio» crea el cliente y sigue con su servicio (con `servicios.crear`); «Crear cliente sin servicio» lo crea y abre su ficha.
- **Pasos 2 y 3, Servicio y Cobro:** el [alta de servicio](alta-de-servicio.md) con el cliente ya elegido: router, plan, red y PPPoE; después instalación, plantilla de facturación y el resumen. Al crear el servicio se abre la ficha del cliente en «Servicios». Si cierras el alta con la ×, el cliente ya creado queda en su ficha.
- «Registrar prospecto» (para quien solo está interesado) se activa cuando la API lo publique.

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

Arriba, en una franja: el nombre con el estado (el de su servicio más atrasado), su código, teléfono y zona, y tres contadores: **Saldo** (en rojo si debe, con las facturas vencidas), **Próximo vencimiento** y **Servicios** (por estado, con lo que paga al mes). Si otro cliente paga por él, aparece «Paga: …» con el enlace. Si vino de una importación (por ejemplo de Mikrowisp), lo dice en letra pequeña. Al bajar, la franja se queda arriba y se reduce a nombre, estado, saldo y «Cobrar». En el teléfono, abajo quedan fijos «Promesa» y «Cobrar Q …».

### Botones de la ficha

| Botón                  | Permiso                                        | Qué hace                                                                                    |
| ---------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------- |
| «Cobrar»               | `pagos.registrar`                              | Abre la caja con el cliente ya elegido.                                                     |
| Mano (Promesa de pago) | `promesas.crear`                               | Promesa para un servicio; con varios, pregunta de cuál.                                     |
| Recibo (Cargo único)   | `facturas.emitir_cargo_unico` y `facturas.ver` | Factura algo que no es la mensualidad (venta de equipo, visita técnica).                    |
| Más (Nuevo servicio)   | `servicios.crear`                              | Abre el [alta de servicio](alta-de-servicio.md) en un panel lateral, sin salir de la ficha. |
| Persona (Datos)        |                                                | Abre o cierra los datos del cliente y los fiscales, con «Editar» (`clientes.editar`).       |
| «⋯»                    |                                                | Editar y Estado de cuenta.                                                                  |

### Datos del cliente

Con el ícono de persona de la franja («Datos» en el teléfono): contacto, canal preferido, Telegram, zona, dirección, coordenadas (con enlace al mapa), referencia, los datos adicionales y la última edición con su número de versión; el estado de WhatsApp (con `notificaciones.ver`), el **portal del cliente** y el **responsable de pago**; y los **datos fiscales**: documento, país, retención, nombre y dirección fiscal. Si el NIT o CUI no pasó la validación, verás «NIT o CUI por corregir»: corrígelo en «Editar», porque la factura FEL lo exige válido. Sin NIT, los avisos salen a nombre de Consumidor Final (CF).

### Pestañas

Las pestañas van dentro de la misma tarjeta que su contenido:

- **Resumen:** si un servicio está suspendido o limitado, el aviso con «Cobrar» y «Promesa»; los contadores de saldo pendiente, próximo vencimiento, pagado en el año y cliente desde; sus servicios y la actividad reciente.
- **Servicios** (con `servicios.ver`): cada servicio con su usuario PPP, router, plan y precio (con «precio especial» si lo tiene), direcciones IP y estado. Con varias empresas, los servicios se agrupan por empresa.
- **Contactos** (con `contactos.buscar`): «A cargo de sus servicios», con el titular primero (sus números adicionales) y cada contacto con su relación, números (y si tiene WhatsApp), a qué servicios aplica y qué puede hacer (Consulta, Fallas, Paga, Avisos); «Agregar contacto» y quitar uno con `contactos.gestionar`. Debajo, «Está a cargo de»: servicios de otros clientes que esta persona tiene a cargo.
- **Facturación** (con `clientes.estado_cuenta`): facturas, pagos y notas de crédito, con el número de vencidas en la pestaña. Ver [Cobros](../cobros/index.md).
- **Pagos** (con `pagos.ver`) y **Promesas** (con `promesas.ver`) del cliente.
- **Puntos** (con `lealtad.ver`): el programa de lealtad.
- **Soporte** y **Documentos:** se mostrarán cuando la API los entregue.
- **Bitácora** (con `bitacora.ver`): todo lo que le pasó al cliente y a sus servicios, facturas, pagos y promesas.

### Telegram

En los datos del cliente, el campo Telegram dice «Vinculado» o «Sin vincular».

- «Vincular» (`clientes.vincular_telegram`): pide al cliente que le escriba `/start` al bot de la empresa; el bot le responde con su chat id. Escribe ese número en «Chat id» y pulsa «Vincular».
- «Quitar» (`clientes.desvincular_telegram`): deja de mandarle avisos por Telegram.

### Portal del cliente

En los datos del cliente, la tarjeta «Portal del cliente» dice cómo entra el cliente al portal con su número de documento:

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
