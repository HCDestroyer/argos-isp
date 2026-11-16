---
orden: 4
pantallas:
    - /adicionales
    - /adicionales/motivos#motivos-de-cortesia
---

# Adicionales

El catálogo de servicios que acompañan al internet: streaming, IPTV, cuentas de correo y similares. Aquí se definen; a cada servicio se le asignan desde su ficha, y los planes pueden traerlos incluidos.

## Quién la usa

- Ver el catálogo y los motivos: `adicionales.ver` (todos los roles base).
- Crear, editar y desactivar adicionales: `adicionales.crear`, `adicionales.editar` y `adicionales.desactivar` (`admin`).
- Crear y desactivar motivos de cortesía: `adicionales.crear_motivo` y `adicionales.desactivar_motivo` (`admin`).

## Catálogo de adicionales

Abre **Adicionales** en el menú. El catálogo es de la **empresa activa**: cada empresa tiene el suyo.

### Qué ves

- **Adicional:** nombre y código, con la marca «Desactivado» si ya no se asigna.
- **Empresa:** solo si trabajas con varias.
- **Precio sugerido** y **Estado** (Activo o Desactivado).
- Arriba, el buscador y el filtro «Activos», «Desactivados» o «Todos».

### Crear o editar un adicional

- **Permisos:** `adicionales.crear` («Nuevo adicional») y `adicionales.editar` (lápiz de la fila).
- **Campos:** **Código** (se guarda en mayúsculas y no se puede repetir en la empresa), **Nombre**, **Descripción** y **Precio sugerido** (se propone al asignarlo como cobrado; cada servicio puede llevar otro precio).
- **Qué pasa:** el adicional queda disponible para asignarlo a servicios y para incluirlo en planes.

### Desactivar un adicional

- **Permiso:** `adicionales.desactivar`
- **Qué pasa:** ya no se asigna a servicios nuevos ni lo traen los planes. Las asignaciones vigentes siguen como están. Nada se borra.

## Motivos de cortesía

Abre «Motivos de cortesía» desde el catálogo. Un motivo explica por qué se regala un adicional. Hay cinco comunes que vienen de fábrica (promoción, cortesía, garantía, compensación por falla y convenio) y cada empresa puede agregar los suyos. Cada cortesía exige uno.

### Qué ves

- **Motivo:** nombre y código.
- **Ámbito:** «Común» (vale para todas las empresas) o el nombre de una empresa.
- **Estado:** Activo o Desactivado, con su filtro.

### Crear un motivo

- **Permiso:** `adicionales.crear_motivo`
- **Dónde:** «Nuevo motivo». Se crea para la empresa activa, con **Código** y **Nombre**. El código no se puede repetir.

### Desactivar un motivo

- **Permiso:** `adicionales.desactivar_motivo`. Un motivo «Común» solo lo desactiva quien tiene alcance global.
- **Qué pasa:** ya no se ofrece para nuevas cortesías. Las cortesías que ya lo usan lo conservan.

## Preguntas frecuentes y errores

**«Ya existe el adicional … en la empresa».** El código se repite en la empresa, también entre los desactivados. Usa otro.

**El adicional no aparece al agregarlo a un servicio.** Está desactivado o es de otra empresa: el servicio solo ofrece el catálogo de su propia empresa.

**No me deja elegir «Cortesía».** Hace falta el permiso `servicios.adicional_cortesia`.

## Relacionado

- [Servicios: adicionales del servicio](servicios.md#adicionales-del-servicio)
- [Planes: adicionales incluidos](../red/planes.md#adicionales-incluidos)
