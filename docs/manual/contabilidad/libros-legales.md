---
orden: 3
pantallas:
    - /libros
    - /libros/emisiones#emisiones
    - /libros/habilitaciones#habilitaciones
---

# Libros legales

Los libros que exige la ley, con folio: Libro Diario, Libro Mayor, Libro de Ventas y Servicios Prestados y Libro de Compras y Servicios Recibidos. Aquí ves su borrador, los emites con folio y registras las habilitaciones de folios autorizadas por la SAT.

Está en **Contabilidad → Libros legales**. Arriba hay tres pestañas: **Vista previa**, **Emisiones** y **Habilitaciones**.

::: tip Una empresa a la vez
Cada libro es de una empresa (NIT). Con «Todas» en el selector de empresa no hay libro que mostrar ni emitir: elige la empresa arriba.
:::

## Quién la usa

- Ver los libros, las emisiones y las habilitaciones: `libros.ver` (**admin**, **contabilidad** y **lectura**).
- Emitir con folio: `libros.emitir` (**contabilidad** y **admin**).
- Registrar habilitaciones: `libros.habilitar` (**contabilidad** y **admin**).

## Qué ves

### Folios por libro

Una tarjeta por libro con el siguiente folio, los folios habilitados, hasta dónde se usaron y una etiqueta:

- **Sin habilitación** (gris): el libro no tiene folios.
- **N disponibles** (verde).
- **Quedan N** (ámbar): 10 o menos.
- **Folios agotados** (rojo).

### Vista previa

1. Elige el libro en las pestañas **Diario**, **Mayor**, **Ventas** o **Compras**.
2. Elige el **Mes** (los últimos 24) o «Personalizado» con **Desde** y **Hasta**.
3. Mira el borrador como **Tabla** o como **PDF**. Lleva la etiqueta «Borrador sin folio».

Qué trae cada libro:

- **Diario**: cada partida con sus movimientos y su total, en orden cronológico.
- **Mayor**: por cuenta, saldo inicial, movimientos con su saldo y saldo final.
- **Ventas**: los DTE certificados y, sin FEL, las facturas y notas de crédito del mes.
- **Compras**: las compras por mes del IVA y las anulaciones en el mes de su reverso.

Los botones «CSV», «Excel» y «PDF» descargan el borrador. No gastan folios.

## Acciones

### Emitir un libro con folio

- **Permiso:** `libros.emitir`
- **Dónde:** botón «Emitir con folio» en la vista previa.
- **Campos:** **Desde el mes**, **Hasta el mes** y **Formato**: **PDF** (carta horizontal, un folio por página, con «Van» y «Vienen») o **Excel** (las mismas filas, cada una con el folio de su página; gasta los mismos folios).
- El diálogo te dice en qué folio empieza y cuántos quedan. Marca «Entiendo que la emisión gasta folios» y pulsa «Emitir con folio».
- **Qué pasa:** se genera el archivo con un folio por página y se guarda con su huella SHA-256. Al terminar aparece un aviso con los folios usados y los botones «Descargar» y «Ver en emisiones».
- **Requisitos:** cada mes del rango cerrado, el rango bajo el bloqueo global o duro hasta su último día, la cadena del libro verificada y folios suficientes.
- **Reimpresión:** si el rango se cruza con una emisión anterior del mismo libro, se emite como reimpresión con folios nuevos.

::: danger Los folios no vuelven
Una emisión no se deshace: los folios que usó quedan gastados.
:::

Si falta algo, el error dice qué hacer:

| Error                                 | Qué hacer                                                                                            |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| El periodo todavía no se puede emitir | Cierra cada mes abierto («Ir a cierres») y bloquea el libro hasta el fin del rango («Ir a bloqueos») |
| No hay folios habilitados suficientes | Registra la habilitación de folios («Registrar habilitación») y vuelve a emitir                      |
| La cadena del libro no verifica       | Revisa la integridad del libro («Ver integridad») y avisa al administrador                           |

El paso a paso está en el tutorial [Emitir los libros con folio](../../tutoriales/contabilidad/emitir-los-libros.md).

## Emisiones

Pestaña **Emisiones**. Cada emisión gasta un folio por página y guarda su archivo con su huella SHA-256.

- Filtra por libro.
- Cada fila muestra el libro y el número de emisión (con la etiqueta «Reimpresión de #…» si lo es), el periodo, los folios, las páginas, el formato y quién la emitió y cuándo.
- El botón de descarga baja el archivo. El botón de detalle abre un panel con los folios, páginas, formato, tamaño, filas, la huella SHA-256 del archivo, el último sello de la cadena del periodo y los totales del libro.

Si al descargar aparece «El archivo de la emisión fue alterado», su huella ya no coincide con la registrada y el archivo no se entrega. Avisa al administrador; una reimpresión genera folios nuevos.

## Habilitaciones

Pestaña **Habilitaciones**. Las emisiones toman sus folios de aquí.

- Filtra por libro. Cada fila muestra el libro, el rango de folios, los disponibles, una barra de lo usado, el número de autorización, su fecha, la nota y quién la registró.
- Los rangos de cada libro son correlativos: el primero empieza donde diga la autorización (SAT-7121 y Registro Mercantil) y cada uno nuevo en el folio siguiente al último habilitado.

### Registrar una habilitación

- **Permiso:** `libros.habilitar`
- **Dónde:** botón «Registrar habilitación» (o desde el folio de la vista previa). Necesitas una empresa elegida.
- **Campos:** **Libro**, **Número de autorización** (por ejemplo `SAT-7121-2026-000187`), **Del folio** (se propone el siguiente al último habilitado), **Al folio**, **Fecha de la autorización** (no futura) y **Nota** opcional.
- **Qué pasa:** el rango queda disponible para emitir. También se pueden habilitar el Libro de Inventarios y el Libro de Estados Financieros, aunque su emisión desde el panel no está disponible.
- **Se puede deshacer:** no. Una habilitación no se edita ni se borra.
- Si el rango no empieza en el folio siguiente, verás «La habilitación no es correlativa».

## Relacionado

- [Libro](./libro.md): cierres e integridad.
- [Bloqueos del libro](./bloqueos.md)
- [Tutorial: emitir los libros con folio](../../tutoriales/contabilidad/emitir-los-libros.md)
