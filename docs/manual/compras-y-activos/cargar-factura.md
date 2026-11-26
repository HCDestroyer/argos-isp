---
orden: 2
pantallas:
    - /compras/cargar
    - /compras/borradores/[id]#revisar-un-borrador
---

# Cargar una factura de compra

Subes el XML, el PDF o una foto de la factura del proveedor y ArgosIsp la lee por ti: queda un borrador que revisas y confirmas como compra, con su entrada al inventario.

Está en **Finanzas → Compras → Compras → Cargar factura**.

## Quién la usa

- Cargar: `compras.cargar_borrador`.
- Corregir el borrador: `compras.editar_borrador`.
- Confirmar: `compras.confirmar_borrador` y además `compras.registrar`.
- Descartar: `compras.descartar_borrador`.
- Ver la lista «Por revisar» y abrir los borradores: `compras.ver`.

El rol **contabilidad** trae todos. Para elegir productos y bodegas al confirmar hace falta también `inventario.ver`.

## Cargar la factura

1. En **Factura**, elige o arrastra el archivo: XML FEL, PDF, JPG, PNG o WebP, hasta 10 MB.
2. Pulsa «Cargar».
    - El **XML FEL** se lee exacto.
    - Un **PDF o una imagen** los lee la IA y marca qué tan segura está de cada dato.
3. Se abre el borrador para revisarlo.

Si no tienes el archivo, pulsa «Capturar a mano»: se crea un borrador vacío para llenar.

Abajo, la lista **Por revisar** muestra los borradores pendientes con su número o NIT, su origen (**XML FEL**, **Leído con IA** o **Captura manual**) y cuándo se cargaron.

| Aviso                                          | Qué significa                                                                |
| ---------------------------------------------- | ---------------------------------------------------------------------------- |
| Esta factura ya está registrada                | El mismo emisor, serie y número ya están en las compras de la empresa        |
| Este archivo ya se cargó                       | Hay un borrador con el mismo archivo: búscalo en «Por revisar»               |
| Borrador creado para capturar a mano           | No se pudo leer el archivo; llena los datos tú                               |
| No hay IA configurada para leer PDF o imágenes | Captura a mano o pide que configuren la IA en **Ajustes → Red y equipos → Inventario** |
| La IA no pudo leer la factura                  | Por ejemplo, un PDF escaneado sin texto: súbelo como imagen o captura a mano |

## Revisar un borrador

La pantalla del borrador muestra su estado (**Por revisar**, **Confirmado** o **Descartado**), su origen y un botón para ver el archivo original. Si ya se confirmó, el botón «Ver la compra» abre la compra.

### Datos de la factura

Revisa y corrige: **NIT del emisor**, **Emisor**, **Tipo**, **Serie**, **Número**, **Fecha**, **Autorización (UUID FEL)**, **NIT del receptor**, **Moneda** y cada línea (**Descripción**, **Código**, **B/S** bien o servicio, **Cantidad**, **Unidad**, **Precio unitario**, **Descuento**, **IVA** y **Total con IVA**). Puedes agregar o quitar líneas.

Abajo se comparan el **Total de la factura** y el **IVA** con la suma de las líneas: si no cuadran, lo dice.

::: tip Leído con IA
Los campos en ámbar tienen confianza media y en rojo, baja. Corrígelos y pulsa «Guardar cambios» antes de confirmar.
:::

«Guardar cambios» (permiso `compras.editar_borrador`) guarda y recalcula la propuesta de proveedor y productos. Mientras haya «Cambios sin guardar», no se puede confirmar.

### Confirmar la compra

1. **Proveedor**: «Proveedor existente» (búscalo por nombre o NIT) o «Crear el proveedor» con su **NIT** y **Nombre del proveedor**.
2. **Condición**: al crédito (con **Vence**; vacío, los días de crédito del proveedor) o al contado (con qué se pagó).
3. Para cada línea, qué hacer:
    - **Producto existente**: elige el **Producto**. Si ArgosIsp encontró uno, lo propone y dice por qué coincide (código del proveedor, SKU o nombre).
    - **Producto nuevo**: **SKU**, **Nombre**, **Tipo**, **Modalidad** y **Unidad**.
    - **Gasto**: la **Cuenta de gasto** (vacía: la cuenta por defecto de compras).
    - Para producto, la bodega en **Entra a** y, si va por serie, las **Series o MAC** (una por unidad).
4. Si el NIT del receptor no es el de la empresa, marca «Confirmar aunque el NIT del receptor no sea el de la empresa» solo si estás seguro.
5. Pulsa «Confirmar compra».

**Qué pasa:** se registra la compra con su asiento y lo que va a un producto entra al inventario, en unidades enteras. Lo demás va a gasto.

### Descartar el borrador

- **Permiso:** `compras.descartar_borrador`
- **Dónde:** botón «Descartar». Pide motivo.
- **Qué pasa:** el borrador queda descartado y no se registra ninguna compra. El archivo se conserva.

## Relacionado

- [Compras](./compras.md)
- [Tutorial: registrar una compra con su factura](../../tutoriales/contabilidad/registrar-una-compra.md)
