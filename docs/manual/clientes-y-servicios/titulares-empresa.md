---
orden: 6
pantallas:
    - /clientes/titulares
    - /clientes/titulares/[id]#detalle-de-una-revision
---

# Revisión de titulares

Cuando un técnico de Iris cambia el titular de un servicio por instalar a una empresa y Argos no puede decidir solo, el cambio espera aquí a que una persona lo apruebe o lo rechace. Mientras tanto el servicio sigue con su titular de antes.

## Quién la usa

- Ver la lista y el detalle: `clientes.ver_identidad` (`admin`). Cada vez que abres un detalle o una foto queda en la bitácora con tu usuario.
- «Aprobar»: `servicios.aprobar_titular_empresa`, además de `clientes.ver_identidad`.
- «Rechazar»: `servicios.rechazar_titular_empresa`, además de `clientes.ver_identidad`.

La encuentras en el menú, en **Día a día**, debajo de **Clientes**.

## Por qué un cambio queda en revisión

Argos solo pasa un servicio a una empresa por su NIT si ese NIT está **verificado** en la ficha del cliente (ver [Verificar el NIT de una empresa](clientes.md#verificar-el-nit-de-una-empresa)). Queda en revisión cuando:

- **Representante nuevo:** la empresa existe con su NIT verificado, pero la persona que firmó con el técnico no está registrada como su representante.
- **Varias empresas con ese NIT:** hay más de un cliente empresa con ese NIT verificado y hay que elegir a cuál pasa.

Si la razón social no coincide con la de la empresa, Iris recibe «titular no coincide» y no llega aquí.

## Qué ves

Pestañas **Pendientes**, **Aprobadas** y **Rechazadas**. Cada fila muestra:

| Columna           | Qué muestra                                                               |
| ----------------- | ------------------------------------------------------------------------- |
| Empresa           | La razón social que dio el técnico, el NIT y el documento del representante. |
| Por qué se revisa | Representante nuevo o varias empresas con ese NIT.                        |
| Servicio          | El servicio por instalar.                                                 |
| Pedida o Decidida | Cuándo llegó o cuándo se decidió.                                         |
| Estado            | Pendiente, Aprobada, Rechazada o Reemplazada (llegó otra para el mismo servicio). |

La lista no muestra el nombre ni el documento del representante: se ven solo en el detalle.

## Detalle de una revisión

Al abrir una revisión ves todo lo que hace falta para decidir: quién es el representante, su documento y a qué empresa pasaría el servicio. Haz clic en la empresa de la lista; verás:

- **La franja:** estado, por qué se revisa, NIT, el servicio y su titular cuando se pidió el cambio.
- **Representante:** nombre, DPI o pasaporte, relación con la empresa, teléfono, correo y el motivo que escribió quien lo pidió.
- **Documento del representante:** las fotos del frente y del reverso. Se piden solo al abrir el detalle.
- **Empresas con ese NIT verificado:** cada candidata con su código y NIT, y la marca «Ya no está verificado» si alguien cambió su NIT después.

Al decidir, Argos borra el documento, el nombre y las fotos del representante: en una revisión decidida verás «Datos borrados al decidir».

En el teléfono, «Aprobar» y «Rechazar» van fijos abajo.

## Acciones

### Aprobar

- **Permiso:** `servicios.aprobar_titular_empresa`
- **Campos:**
    - **Empresa:** solo con varias empresas con ese NIT; elige a cuál pasa el servicio.
    - **Motivo:** de 10 a 500 caracteres.
- **Qué pasa:** el servicio pasa a la empresa, el representante queda registrado en ella e Iris recibe el aviso. Si el titular anterior no tenía historia (otros servicios, facturas o pagos), se elimina.

### Rechazar

- **Permiso:** `servicios.rechazar_titular_empresa`
- **Campos:** **Motivo**, de 10 a 500 caracteres.
- **Qué pasa:** el servicio sigue con su titular y se borran los datos del representante.

## Preguntas frecuentes y errores

**«Alguien decidió antes».** Otra persona aprobó o rechazó la revisión, o cambió el titular del servicio, mientras la veías. Pulsa «Volver a cargar» para ver cómo quedó.

**«El servicio ya no está pendiente de instalación».** El titular solo se cambia antes de instalar; si el técnico ya activó el servicio, el cambio se hace de otra forma.

**«Esa empresa ya no tiene ese NIT verificado».** Alguien cambió el NIT de la empresa después de pedirse el cambio. Revisa su ficha y vuelve a verificarlo, o elige otra.

**No veo esta pantalla en el menú.** Hace falta `clientes.ver_identidad`.

## Relacionado

- [Clientes](clientes.md)
- [Servicios](servicios.md)
