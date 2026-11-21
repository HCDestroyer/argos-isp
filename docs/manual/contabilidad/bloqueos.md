---
orden: 2
pantallas:
    - /libro/bloqueos
---

# Bloqueos del libro

Un bloqueo impide registrar asientos con fecha hasta un día. Sirve para proteger lo que ya revisaste o declaraste: nadie puede meter una factura, compra o ajuste en un periodo ya trabajado. Aquí ves los bloqueos de cada empresa, su historial, las excepciones y los procesos que quedaron detenidos por un bloqueo.

Está en **Contabilidad y fiscal → Bloqueos del libro**, o con el botón «Libro» de vuelta al libro.

## Quién la usa

- Para verla necesitas `libro.ver` (**admin**, **contabilidad** y **lectura**).
- Bloquear (`libro.bloquear`) y desbloquear (`libro.desbloquear`): **contabilidad** y **admin**.
- Bloqueo duro (`libro.bloquear_duro`) y excepciones (`libro.excepcion_bloqueo`): solo **admin**.
- «Correr ahora» en los procesos detenidos: `facturas.generar` (**contabilidad** y **admin**).

## Qué ves

### Tarjeta de cada empresa

Para cada empresa hay una tarjeta con cinco tipos de bloqueo. Cada uno dice «Hasta …» o «Sin bloqueo», el motivo del último cambio, quién y cuándo.

| Tipo             | Qué cubre                                                                               |
| ---------------- | --------------------------------------------------------------------------------------- |
| **Global**       | Todo el libro de la empresa                                                             |
| **Ventas**       | Facturas, notas de crédito y moras                                                      |
| **Compras**      | Compras y pagos a proveedores                                                           |
| **Impuestos**    | Los asientos que tocan una cuenta de impuesto. No retrocede: se usa una excepción       |
| **Bloqueo duro** | Nada con fecha hasta ese día, ni con excepción, y ningún mes se reabre. Nunca retrocede |

Si en Ventas, Compras o Impuestos ves «Efectivo hasta … (global o duro)», es porque el bloqueo global o el duro llegan más lejos que el propio y mandan.

### Procesos detenidos por un bloqueo

La facturación y el vencimiento de facturas no registran lo que cae bajo un bloqueo: lo dejan pendiente y cada corrida lo vuelve a intentar. Esta tarjeta muestra, por empresa, la última corrida de **Facturación pendiente** y de **Vencimiento y moras**: cuándo corrió, cuántos documentos siguen pendientes, por qué bloqueo y qué fecha, con algunos ejemplos.

### Excepciones

La tabla muestra cada excepción con su tipo, usuario («Todos los usuarios» si es general), motivo, hasta cuándo vale, cuántos asientos entraron por ella y su estado: **Vigente**, **Vencida** o **Revocada**. Puedes filtrar por estado.

### Historial

Cada cambio de bloqueo con fecha, quién, tipo, la nueva fecha («Sin bloqueo» si se quitó) y la anterior. Filtra por tipo.

## Acciones

### Bloquear

- **Permiso:** `libro.bloquear`
- **Dónde:** botón «Bloquear» en la tarjeta de la empresa.
- **Campos:** **Tipo** (global, ventas, compras o impuestos), **Bloquear hasta** (no puede ser una fecha futura) y **Motivo**.
- **Qué pasa:** nada se registra con fecha hasta ese día bajo ese tipo, salvo con una excepción vigente. El cambio queda en el historial y en la bitácora.
- Un bloqueo solo avanza. Para moverlo hacia atrás se usa «Desbloquear».

### Desbloquear

- **Permiso:** `libro.desbloquear`
- **Dónde:** botón «Desbloquear» (aparece si hay un bloqueo global, de ventas o de compras).
- **Campos:** **Tipo**, el interruptor **Quitar el bloqueo de este tipo** o la fecha **Nuevo bloqueo hasta** (anterior a la vigente y no antes del duro), y **Motivo**.
- El bloqueo de impuestos y el duro no se desbloquean.

### Bloqueo duro

- **Permiso:** `libro.bloquear_duro` (solo admin)
- **Dónde:** botón «Bloqueo duro».
- **Campos:** **Bloquear para siempre hasta**, **Motivo** y **Confirmación**: escribe exactamente el texto que se muestra, por ejemplo `BLOQUEO DURO hasta 2026-06-30`.
- **Requisitos:** los meses hasta esa fecha cerrados, ningún DTE pendiente o en contingencia y los extractos bancarios conciliados hasta esa fecha. Además, la lista de verificación del mes debe pasar; si falta algo, el diálogo lo lista con un botón a la lista de verificación del mes.

::: danger No se puede deshacer
El bloqueo duro nunca retrocede. Después de aplicarlo, nada con fecha hasta ese día entra al libro (ni con excepción) y ningún mes hasta ahí se puede reabrir.
:::

### Crear una excepción

- **Permiso:** `libro.excepcion_bloqueo` (solo admin)
- **Dónde:** botón «Nueva excepción».
- **Campos:** **Bloqueo que cubre**, **Usuario** (o todos; sin el permiso de ver usuarios, la excepción es para todos), **Vigente hasta** (fecha y hora de Guatemala) y **Motivo**.
- **Qué pasa:** mientras esté vigente, quien la tenga puede registrar con fecha bajo ese bloqueo. Cubre solo su tipo, nunca el duro, y cada asiento que entra por ella queda marcado.

### Revocar una excepción

- **Permiso:** `libro.excepcion_bloqueo`
- **Dónde:** botón «Revocar» en la fila de una excepción vigente. Pide motivo.
- **Qué pasa:** desde ahora no cubre asientos nuevos. Los que ya entraron se quedan como están.

### Correr un proceso detenido

- **Permiso:** `facturas.generar`
- **Dónde:** botón «Correr ahora» en la tarjeta de procesos detenidos.
- **Qué pasa:** procesa todo lo pendiente hasta hoy, igual que la corrida automática. Úsalo después de desbloquear o de crear una excepción. Lo que siga bajo un bloqueo queda pendiente y se ve aquí.

## Preguntas frecuentes y errores

| Situación                                     | Qué hacer                                                                                              |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| No me deja poner una fecha futura             | Un bloqueo solo llega hasta hoy                                                                        |
| No me deja bloquear antes de la fecha vigente | Bloquear solo avanza; usa «Desbloquear»                                                                |
| No puedo desbloquear impuestos                | No retrocede: pide a un admin una excepción con fecha de fin                                           |
| La fecha queda antes del bloqueo duro         | No se permite: el duro manda                                                                           |
| «Bloqueo duro» rechaza la confirmación        | Copia el texto exacto que se muestra, con la misma fecha                                               |
| El bloqueo duro pide requisitos               | Cierra los meses, certifica los DTE y concilia los extractos que se listan                             |
| Las facturas del mes no salieron              | Mira «Procesos detenidos»: si están bajo un bloqueo, desbloquea o usa una excepción y corre el proceso |

## Relacionado

- [Libro](./libro.md)
- [Libros legales](./libros-legales.md): emitir un libro con folio exige el periodo bloqueado.
- [Declaraciones](../fiscal/declaraciones.md): revisar el IVA bloquea los impuestos del mes.
