---
orden: 4
---

# Recibir un traslado en tu bodega

Al terminar, los productos y equipos que te enviaron quedan en tu bodega de técnico, con tu firma de recibido.

## Antes de empezar

- Permisos: `inventario.ver` para ver **Mi bodega** y `inventario.recibir_traslado` para recibir (rol `tecnico`).
- Tienes que tener una bodega de técnico. Si no, **Mi bodega** dice «No tienes una bodega de técnico»: pide a un encargado que la cree.

## Pasos

1. Abre **Inventario → Mi bodega**. Ves tus existencias, tus equipos por serie, lo que viene en camino (**Por recibir**) y tus últimos movimientos.
2. En **Por recibir**, cada orden dice su número, desde qué bodega viene, cuándo se envió y cuántas líneas trae. Toca «Recibir y firmar».
3. Revisa cada línea contra lo que te entregaron:
    - En productos por cantidad, escribe lo **Recibido**.
    - En equipos por serie, deja marcados los **Equipos que llegaron** y desmarca los que no.
    - Si falta algo, el panel te avisa: «Falta …: vuelve al origen».
4. En **¿Cómo se recibe?** elige:
    - **Firma digital**: firmas en la pantalla del teléfono o la tableta.
    - **Firma en papel**: solo la registra un encargado con alcance global; después se adjunta la foto del papel firmado.
    - **Aceptación simple**: sin firma, solo si la empresa no la exige.
5. Si quieres, escribe **Observaciones** (por ejemplo, «una caja llegó golpeada»).
6. Toca «Recibir y firmar» (o «Recibir»).

![Mi bodega del técnico con lo que tiene y lo que viene en camino](/capturas/tecnico/mi-bodega.png)

## Qué pasa después

- Lo que recibiste entra a tu bodega y aparece en tus existencias y en el kardex.
- Lo que no llegó vuelve a la bodega de origen al mismo costo.
- La recepción es definitiva: no se puede recibir dos veces la misma orden.
- Ya puedes [asignar los equipos en comodato](./equipo-en-comodato.md) a los servicios que instales.

## Enviar tú un traslado

Si tienes que devolver material o pasarlo a otra bodega, con `inventario.crear_traslado` (rol `tecnico`): **Inventario → Traslados**, nueva orden. Eliges **Desde** y **Hacia**, el **Motivo**, agregas productos con «Agregar producto» o escaneas equipos con «Escanear serie o MAC», y tocas «Enviar orden». Si no hay existencia suficiente de algo, no sale nada y el panel dice qué línea falló.

## Si algo sale mal

| Situación                                         | Causa                                                                                                                | Qué hacer                            |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| «Nada en camino»                                  | No hay órdenes enviadas a ti                                                                                         | Confirma con la bodega que la envió  |
| La orden ya se recibió                            | Otra persona la recibió antes                                                                                        | Revisa en **Inventario → Traslados** |
| No aparece «Firma en papel» o «Aceptación simple» | La firma en papel es solo para encargados con alcance global; la aceptación simple solo si la empresa no exige firma | Usa la firma digital                 |

## Relacionado

- [Asignar y devolver un equipo en comodato](./equipo-en-comodato.md)
- [Manual de inventario](../../manual/inventario/)
