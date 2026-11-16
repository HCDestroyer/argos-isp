---
orden: 1
pantallas:
    - /configuracion/empresa
---

# Datos de contacto de la empresa

Los datos de contacto, el horario de atención y las instrucciones de pago que ven tus clientes en el aviso de cobro, en el portal y en las notificaciones.

## Quién la usa

- Ver: `empresa.ver` (`admin`, `lectura`).
- Editar: `empresa.editar` (`admin`). Sin este permiso la pantalla se ve en solo lectura.

::: warning Con varias empresas
Esta pantalla lee y guarda los datos de la empresa activa (la del selector de empresa). Con «Todas las empresas» seleccionada no se puede abrir: elige primero una empresa. Los datos fiscales y de contacto de cada empresa (NIT) se editan en [Empresas](empresas.md).
:::

## Qué ves

Si nunca se guardó, arriba aparece «Aún no se ha guardado» y se muestran los valores por defecto. Complétalos para que el aviso de cobro y el portal muestren tus datos.

- **Datos generales:** Nombre comercial, NIT, Correo y Dirección.
- **Atención al cliente:** Teléfono, Teléfono alterno, WhatsApp y Horario.
- **Instrucciones de pago** (hasta 1000 caracteres): acompañan las cuentas para depósito en el aviso de cobro y en el portal.

## Acciones

### Guardar

- **Permiso:** `empresa.editar`
- **Qué pasa:** aparece «Datos de la empresa guardados» con su número de versión. El próximo aviso de cobro ya los usa. El cambio queda en la bitácora.

«Descartar cambios» vuelve a lo último guardado.

## Preguntas frecuentes y errores

**«Alguien más guardó estos datos».** Otra persona guardó mientras editabas. Pulsa «Recargar» para ver la versión actual; tus cambios sin guardar se pierden.

## Relacionado

- [Empresas](empresas.md)
