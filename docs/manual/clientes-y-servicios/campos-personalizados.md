---
orden: 5
pantallas:
    - /campos-personalizados
---

# Campos personalizados

Los datos extra que tu ISP quiere pedir de cada cliente, además de los de siempre: por ejemplo, «Número de contrato», «Fecha de nacimiento» o «Tipo de vivienda». Cada campo que definas aparece en el formulario y en la ficha del cliente, en la sección «Datos adicionales».

## Quién la usa

- Abrir la pantalla: `campos_personalizados.editar` (`admin`). Para leer el catálogo hace falta además `clientes.ver`.
- «Nuevo campo»: `campos_personalizados.crear`.
- «Desactivar» y «Activar»: `campos_personalizados.desactivar` y `campos_personalizados.activar`.

## Qué ves

| Columna | Qué muestra                                         |
| ------- | --------------------------------------------------- |
| Campo   | La etiqueta y, si aplica, la marca «Obligatorio».   |
| Tipo    | Texto, Número, Fecha, Sí o no, o Lista de opciones. |
| Orden   | En qué lugar aparece en la ficha (menor primero).   |
| Estado  | Activo o Inactivo.                                  |

## Acciones

### Crear un campo

- **Permiso:** `campos_personalizados.crear`
- **Dónde:** botón «Nuevo campo».
- **Campos:**
    - **Etiqueta:** lo que ve el operador en la ficha y el formulario.
    - **Clave:** nombre interno del dato. Se sugiere a partir de la etiqueta y no cambia después.
    - **Tipo:** Texto (hasta 500 caracteres), Número (con o sin decimales), Fecha, Sí o no (un interruptor) o Lista de opciones. El tipo no cambia después de crear el campo.
    - **Opciones:** solo para «Lista de opciones». Escribe cada opción y pulsa Enter.
    - **Orden:** menor primero en la ficha.
    - **Obligatorio:** se exige al crear un cliente y al guardar sus datos.
- **Qué pasa:** desde ese momento el campo aparece en el formulario de todos los clientes.

### Editar un campo

- **Permiso:** `campos_personalizados.editar`
- **Qué se cambia:** etiqueta, opciones, orden y si es obligatorio. La clave y el tipo no se cambian.
- Quitar una opción de la lista no borra el valor de los clientes que la tienen: se les pide otra cuando se guarde su ficha.

### Desactivar y activar

- **Permisos:** `campos_personalizados.desactivar` y `campos_personalizados.activar`
- **Qué pasa:** un campo inactivo deja de pedirse y de validarse en el formulario. Nunca se borra: los valores guardados se conservan y la ficha del cliente los sigue mostrando. Al activarlo de nuevo vuelve a pedirse.

## Preguntas frecuentes y errores

**No puedo cambiar el tipo de un campo.** Es a propósito: los valores ya guardados seguirían el tipo viejo. Desactiva el campo y crea otro.

**Un cliente viejo no me deja guardar.** Si marcaste un campo como obligatorio, el formulario lo pide al guardar cualquier cliente que no lo tenga. Complétalo.

**Mientras editabas, alguien más guardó el campo.** Verás un error de conflicto. Recarga y vuelve a aplicar el cambio.

## Relacionado

- [Clientes](clientes.md)
