---
orden: 1
pantallas:
    - /configuracion/integraciones
---

# Integraciones

Las otras aplicaciones de la familia que se conectan con ArgosIsp. Cada una tiene su tarjeta con su estado y el botón «Configurar».

## Quién la usa

- Abrir la pantalla: `horus.ver` o `iris.ver` (`admin`, `lectura`).
- Cada tarjeta aparece solo con su permiso: la de Horus con `horus.ver` y la de Iris con `iris.ver`.

## Qué ves

### Horus Flow

Consumo, salud y seguridad de cada servicio, avisos de Horus y entrada sin contraseña entre los dos sistemas. Estado: «Activa», «Apagada» o «Sin conectar». «Configurar» abre [Horus Flow](horus.md).

### Iris

Tickets, órdenes de trabajo y seguimiento comercial: Iris lee clientes y servicios, activa instalaciones y recibe los avisos de ArgosIsp. Estado: «Activa», «Apagada» o «Sin conectar», y cuando aplica las marcas «Volver a conectar», «Esperando que Iris active la conexión», «Desconectada» o «Reconexión pendiente», con la fecha que corresponda. «Configurar» abre [Iris](iris.md).

Cada tarjeta se lee por separado: si una falla, la otra se ve igual.

::: tip Apagadas por defecto
Una integración apagada no hace llamadas ni manda avisos. El cobro, el corte y la autenticación de los clientes nunca esperan a Horus ni a Iris.
:::

## Relacionado

- [Horus Flow](horus.md)
- [Iris](iris.md)
- [Tokens de API](../usuarios/tokens.md)
