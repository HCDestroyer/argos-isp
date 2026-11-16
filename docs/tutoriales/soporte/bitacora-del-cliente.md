---
orden: 5
---

# Revisar la bitácora de un cliente

Al terminar, sabes qué se hizo con el cliente y sus servicios, quién lo hizo, cuándo y por qué.

## Antes de empezar

- Permiso: `bitacora.ver` (roles `soporte`, `contabilidad`, `admin`, `lectura`).

## Pasos

1. [Busca al cliente](./buscar-cliente.md) y abre su ficha.
2. Toca la pestaña **Línea de tiempo**. Ves todo lo hecho con el cliente y con sus servicios, facturas, pagos y promesas, de lo más reciente a lo más viejo. Cada entrada dice quién, por qué canal y si salió bien.
3. Toca «Ver más» para seguir hacia atrás.
4. Para el detalle completo, abre **Reportes y bitácora → Bitácora**:
    - Filtra por **Tipo de entidad** «Cliente» y escribe su número en **ID de la entidad**.
    - Toca una fila para ver el detalle: qué se envió, el motivo y el error si lo hubo.
    - En el detalle, «Historial de cambios de la entidad» muestra campo por campo qué cambió (por ejemplo, el teléfono anterior y el nuevo).
5. Para ver solo lo de un servicio, abre la ficha del servicio: abajo tiene su propia línea de tiempo.

![Línea de tiempo en la ficha del cliente](/capturas/soporte/linea-de-tiempo.png)

## Qué pasa después

Nada: revisar la bitácora no cambia nada. Las contraseñas y los tokens aparecen como `***`.

## Si algo sale mal

| Situación                                      | Qué hacer                                                                                   |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------- |
| No ves la pestaña **Línea de tiempo**          | Tu rol no tiene `bitacora.ver`                                                              |
| No aparece lo que hizo el cliente en el portal | La línea de tiempo de la ficha no lo incluye. Búscalo en **Bitácora** con el canal «Portal» |
| «Sin actividad registrada»                     | No hay acciones sobre ese cliente                                                           |

## Relacionado

- [Manual de la bitácora](../../manual/general/bitacora.md)
