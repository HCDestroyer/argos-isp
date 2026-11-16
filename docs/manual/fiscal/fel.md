---
orden: 2
pantallas:
    - /configuracion/fel
---

# FEL

La factura electrónica en línea de cada empresa: el certificador, sus credenciales, el modo de emisión, la contingencia y el momento en que se certifica cada plantilla de facturación.

Está en **Configuración → FEL**. Como todo lo fiscal, es por empresa: elige una en el selector de empresa.

## Quién la usa

- Ver: `fel.ver` (**admin**, **contabilidad**, **cajero** y **lectura**).
- Cambiar certificador, modo, ambiente y credenciales: `fel.configurar` (solo **admin**).
- Activar o levantar la contingencia: `fel.contingencia` (**contabilidad** y **admin**).
- Cambiar el momento de certificar de una plantilla: `plantillas.editar`.

## Qué ves

Avisos arriba, si aplican:

- **FEL desactivada**: la FEL es obligatoria para el régimen general; sin ella las facturas no tienen validez fiscal.
- **Contingencia activa**: desde cuándo y por qué.

### Certificador y modo

Muestra el modo, el certificador y el ambiente. Con `fel.configurar` puedes cambiar:

- **Ambiente**: Pruebas o Producción.
- **Certificador**: los disponibles («Solo pruebas» si no sirve para producción).
- **Modo de emisión**:
    - **Obligatoria**: toda factura sale con DTE. Con «al emitir» nace por certificar y se emite al certificarse; con «al pagar» nace como aviso de cobro y se certifica al cubrirse.
    - **Opcional**: se certifica a mano desde la factura. Los avisos «al pagar» se certifican al cubrirse.
    - **Desactivada**: sin DTE; las facturas salen como aviso de cobro interno.

Pulsa «Guardar» o «Descartar». Si al guardar ves «N avisos de cobro sin certificar», hay avisos pendientes que impiden ese cambio de modo; el detalle explica cuáles.

### Credenciales

Una tarjeta por ambiente con «Configuradas» o «Sin configurar», el certificador, el usuario y la última prueba. Las credenciales son de solo escritura: nunca se vuelven a mostrar.

- **Guardar credenciales** o **Reemplazar** (`fel.configurar`): escribe todos los datos que pide el certificador. Los secretos se guardan cifrados; para cambiarlos, escríbelos de nuevo completos.
- **Probar**: envía una prueba al certificador y dice «Credenciales válidas» o «El certificador rechazó las credenciales» con el detalle.

### Contingencia

Para cuando el certificador no responde.

- **Activar contingencia** (`fel.contingencia`): pide motivo (por ejemplo, «el certificador no responde desde las 8:00»). Las facturas nuevas se emiten igual y su DTE queda en cola, en contingencia.
- **Levantar contingencia**: la cola transmite al certificador los DTE que quedaron en contingencia.

::: warning Confirmar con contador
El procedimiento y el plazo oficiales de la contingencia los debe confirmar el contador.
:::

### Momento de certificar

Se ve con `plantillas.ver`. Una fila por plantilla de facturación con su momento: **Al emitir**, **Al pagar** (aviso de cobro: su IVA queda por certificar hasta que el pago lo cubre) o **Nunca** (sin DTE; no se admite con la FEL obligatoria). Con `plantillas.editar` lo cambias desde la fila.

Las plantillas nuevas nacen «al pagar». Cada servicio puede tener su excepción (en la ficha del servicio). El cambio rige para las facturas que se emitan desde ahora; lo ya emitido no cambia. Si ves «Plantillas incompatibles con la FEL obligatoria», alguna está en «nunca».

## Preguntas frecuentes y errores

| Mensaje                                  | Qué hacer                                                          |
| ---------------------------------------- | ------------------------------------------------------------------ |
| La FEL no está configurada               | Un admin elige el certificador y guarda las credenciales           |
| El certificador no responde              | Revisa la prueba de credenciales; si sigue, activa la contingencia |
| Hay servicios que no se certifican nunca | Cambia su excepción o la plantilla antes de pasar a obligatoria    |
| Hay avisos de cobro sin certificar       | Certifícalos o espera a que se cubran antes del cambio             |

## Relacionado

- [Cola de DTE](./dte.md)
- [Configuración fiscal](./configuracion-fiscal.md)
