---
orden: 1
---

# Buscar a un cliente

Al terminar, tienes abierta la ficha del cliente con sus datos, sus servicios y su estado de cuenta.

## Antes de empezar

- Permiso: `clientes.ver` (roles `soporte`, `cajero`, `tecnico`, `contabilidad`, `lectura`).

## Pasos

1. Abre **Operación → Clientes**.
2. En el buscador escribe cualquiera de estos datos:
    - **Nombre** o parte del nombre: `María Pérez`.
    - **NIT** o **CUI**.
    - **Teléfono**.
    - **Usuario PPP** del servicio, como `maria.jose1`.
    - **IP** del servicio, como `10.20.0.15`. Sirve cuando te llega una alerta de la red con la IP.
3. La lista se actualiza sola mientras escribes. Toca el nombre del cliente para abrir su ficha.

![Lista de clientes con el buscador, los accesos rápidos y los filtros](/capturas/soporte/clientes.png)

## Afinar la búsqueda

- Los botones **Todos**, **Cortados** y **Con deuda** son accesos rápidos.
- **Filtros** abre más opciones: **Estado del servicio**, **Zona**, **Router**, **Plan**, «Con deuda vencida», «Con promesa activa» y «NIT o CUI por corregir». Junto al botón ves cuántos filtros tienes activos y «Limpiar» los quita.
- Los filtros quedan en la dirección de la página: puedes copiar el enlace y compartir la misma búsqueda.

## Qué ves en la ficha

Arriba, el nombre, el tipo (persona o empresa) y los botones que tu rol permite («Cobrar», «Nuevo servicio», «Editar»…). Las pestañas:

| Pestaña              | Qué tiene                                                                                             | Permiso                  |
| -------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------ |
| **Datos**            | Teléfono, móvil, correo, canal preferido, Telegram, zona, dirección, coordenadas, responsable de pago | `clientes.ver`           |
| **Datos fiscales**   | NIT o CUI y nombre para la factura                                                                    | `clientes.ver`           |
| **Servicios**        | Sus servicios con su estado                                                                           | `servicios.ver`          |
| **Estado de cuenta** | Facturas, pagos y saldo                                                                               | `clientes.estado_cuenta` |
| **Puntos**           | Puntos de lealtad                                                                                     | `lealtad.ver`            |
| **Línea de tiempo**  | Todo lo que se hizo con el cliente                                                                    | `bitacora.ver`           |

Si una pestaña no aparece, tu rol no tiene su permiso.

## Si algo sale mal

| Situación                       | Qué hacer                                                                          |
| ------------------------------- | ---------------------------------------------------------------------------------- |
| «Ningún cliente coincide»       | Prueba con menos letras, sin tildes, o quita los filtros                           |
| Buscas por IP y no sale         | La IP puede ser de una sesión que ya cambió; prueba con el usuario PPP o el nombre |
| Aviso de error con «Reintentar» | No se pudo leer la lista: reintenta                                                |

## Relacionado

- [«No tengo internet»](./no-tengo-internet.md)
- [Manual de clientes y servicios](../../manual/clientes-y-servicios/)
