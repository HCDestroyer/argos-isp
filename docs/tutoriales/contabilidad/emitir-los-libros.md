---
orden: 4
---

# Emitir los libros con folio

Al terminar, el Libro Diario, el Mayor, el de Ventas o el de Compras del mes quedan emitidos con sus folios, listos para imprimir y archivar.

## Antes de empezar

- Permisos: `libros.emitir`, `libros.habilitar` y `libro.bloquear` (rol **contabilidad**).
- Los folios del libro autorizados por la SAT (SAT-7121).
- El mes ya está cerrado (ver [Cerrar el mes](./cerrar-el-mes.md)).
- Elige la empresa en el selector de empresa.

## Pasos

1. **Registra la habilitación** (solo la primera vez o cuando se acaben los folios): **Contabilidad → Libros legales → Habilitaciones** → «Registrar habilitación». Elige el **Libro**, escribe el **Número de autorización**, **Del folio**, **Al folio** y la **Fecha de la autorización**, y pulsa «Registrar».
2. **Bloquea el libro** hasta el último día del mes: **Contabilidad → Bloqueos del libro** → «Bloquear», tipo **Global**, **Bloquear hasta** = el último día del mes, y el motivo (por ejemplo, «emisión de libros de octubre»).
3. Abre **Contabilidad → Libros legales → Vista previa**, elige el libro y el mes, y revisa el borrador en **Tabla** o **PDF**.
4. Pulsa «Emitir con folio». Elige **Desde el mes**, **Hasta el mes** y el **Formato** (PDF o Excel). Mira en qué folio empieza.
5. Marca «Entiendo que la emisión gasta folios» y pulsa «Emitir con folio».
6. En el aviso, pulsa «Descargar» para bajar el archivo.

Repite los pasos 3 a 6 para cada libro.

## Qué pasa después

- La emisión aparece en **Emisiones** con sus folios, su huella SHA-256 y quién la emitió. Desde ahí la vuelves a descargar.
- El siguiente folio del libro avanza tantas páginas como tuvo la emisión.
- Si emites otra vez un rango que ya tenía emisión, sale como reimpresión con folios nuevos.

::: danger
Una emisión no se deshace: los folios que gastó no vuelven.
:::

## Si algo sale mal

| Mensaje                               | Causa                                     | Qué hacer                                                         |
| ------------------------------------- | ----------------------------------------- | ----------------------------------------------------------------- |
| El periodo todavía no se puede emitir | Un mes abierto o falta el bloqueo         | Usa «Ir a cierres» o «Ir a bloqueos» según lo que diga el mensaje |
| No hay folios habilitados suficientes | Sin habilitación o se acabaron            | «Registrar habilitación» con el siguiente rango autorizado        |
| La habilitación no es correlativa     | El rango no empieza en el folio siguiente | Empieza en el folio que propone el formulario                     |
| La cadena del libro no verifica       | El libro fue alterado                     | No emitas; avisa al administrador                                 |

Más detalle en el manual de [Libros legales](../../manual/contabilidad/libros-legales.md).
