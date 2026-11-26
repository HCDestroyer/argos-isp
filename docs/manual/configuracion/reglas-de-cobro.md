---
orden: 5
pantallas:
    - /configuracion/reglas-cobro
---

# Reglas de cobro y libro

Reglas de cada empresa para los asientos manuales y la pausa sin cobro, y el formato de impresión de cada caja.

## Quién la usa

- **Ver:** `ajustes_cobro.ver`. **Guardar:** `ajustes_cobro.editar`.
- **Impresión por caja:** ver con `cajas.ver`, cambiar con `cajas.configurar_impresion`.

Se llega desde **Ajustes → Facturación y cobro → Reglas de cobro y libro**. Cada empresa tiene sus reglas: con «Todas las empresas» la pantalla pide elegir una en las pastillas de arriba.

## Qué ves

- **Asientos manuales · Pedir aprobación de otro usuario:** encendido, un asiento de ajuste queda como borrador en Libro › Por aprobar hasta que otra persona lo aprueba; quien lo crea no puede aprobarlo. De fábrica, apagado.
- **Pausa sin cobro · Tope de días:** lo más que puede durar una pausa sin cobro, de 1 a 365 días (90 de fábrica). La suspensión normal sigue facturando; la pausa sin cobro pide su propio permiso y motivo.
- **Facturas de meses pasados:** los días de gracia antes del corte no son un ajuste; los escribe quien emite en «Emitir facturas por periodo».
- **Impresión por caja:** cada caja activa con su **Recibo** y su **Factura** en «Ticket de 80 mm» u «Hoja carta». De fábrica, recibo en ticket y factura en carta.
- Abajo, de qué empresa son las reglas y la fecha del último cambio.

## Acciones

- **Guardar** las reglas: se guardan para la empresa elegida y quedan en la bitácora.
- **Descartar** vuelve a lo guardado.
- **Cambiar el formato de una caja:** se guarda al elegirlo, en la caja (no en el navegador), y lo usa cualquier equipo que cobre con ella.

## Preguntas frecuentes y errores

| Mensaje | Qué hacer |
| --- | --- |
| «Elige una empresa» | Elige una empresa en las pastillas de arriba. |
| «De 1 a 365 días» | Escribe un tope dentro del rango. |
| Conflicto de versión | Otra persona guardó mientras editabas: toca **Recargar** y repite tu cambio. |

## Relacionado

- [Bancos de origen](./bancos-de-origen.md)
- [Plantillas y conceptos](./plantillas-y-conceptos.md)
