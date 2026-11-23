---
orden: 6
pantallas:
    - /configuracion/importar
---

# Importar desde Mikrowisp

Trae a ArgosIsp los datos de tu sistema anterior: clientes, servicios, planes, facturas pendientes, pagos y promesas activas, con una revisión antes de guardar nada.

## Quién la usa

- Solo usuarios con el rol `admin`.

Se llega desde **Configuración → Importar datos → Importar desde Mikrowisp**.

## Pasos

1. **Origen:** el respaldo de la base de Mikrowisp (archivo `.sql`, o comprimido).
2. **Qué traer:** clientes (los incompletos se marcan para revisar), servicios con su plan equivalente y sus credenciales PPPoE, planes (sin duplicar los que ya existen), facturas pendientes con su saldo, pagos históricos (los que no tienen factura quedan como saldo a favor) y promesas activas.
3. **Revisar:** la vista previa con cuánto hay en Mikrowisp y cuánto se importa, y el cuadre del saldo por cobrar.
4. **Importar:** se guarda y queda en la bitácora de corridas.

A la derecha, **Para atender** lista lo que la vista previa encuentre (clientes sin teléfono o documento, saldos que no cuadran).

::: info Se puede repetir
Correr la importación otra vez no duplica lo que ya entró. No avisa a los clientes ni corta a nadie: el siguiente corte decide con todo cargado.
:::

::: warning Todavía desde el servidor
Por ahora la importación la corre el equipo técnico en el servidor. La pantalla muestra los pasos; subir el respaldo, importar y «Corridas anteriores» estarán disponibles en una próxima versión.
:::

## Relacionado

- [Clientes](../clientes-y-servicios/clientes.md)
- [Servicios](../clientes-y-servicios/servicios.md)
