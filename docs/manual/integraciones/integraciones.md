---
orden: 1
pantallas:
    - /configuracion/integraciones
---

# Integraciones

Las otras aplicaciones de la familia que se conectan con ArgosIsp. Cada una tiene su tarjeta con su estado y el botón «Configurar».

## Quién la usa

- Abrir la pantalla: `horus.ver`, `iris.ver` o `equipos.ver` (`admin`, `lectura`).
- Cada tarjeta aparece solo con su permiso: la de Horus con `horus.ver` y la de Iris con `iris.ver`.

## Qué ves

### Horus Flow

Consumo, salud y seguridad de cada servicio, avisos de Horus y entrada sin contraseña entre los dos sistemas. Estado: «Activa», «Apagada» o «Sin conectar». «Configurar» abre [Horus Flow](horus.md).

### Iris

Tickets, órdenes de trabajo y seguimiento comercial: Iris lee clientes y servicios, activa instalaciones y recibe los avisos de ArgosIsp. Estado: «Activa», «Apagada» o «Sin conectar», y cuando aplica las marcas «Volver a conectar», «Esperando que Iris active la conexión», «Desconectada» o «Reconexión pendiente», con la fecha que corresponda. «Configurar» abre [Iris](iris.md).

### SmartOLT y GenieACS

SmartOLT (estado de las ONU y su autorización) y GenieACS (configuración remota de los equipos por TR-069, en su propio servidor). Son **de cada empresa**: con «Todas las empresas» la tarjeta pide elegir una. Estado: «Sin conectar», «Apagada», «Sin probar», «Conectado» o «No responde».

- **Ver:** `equipos.ver`. **Guardar:** `equipos.configurar`. **Probar conexión:** `equipos.probar`.
- **Integración encendida en esta empresa:** SmartOLT y GenieACS se encienden juntos. Apagada, Iris no puede activar equipos desde la orden.
- **SmartOLT:** la dirección de tu cuenta (`https://<subdominio>.smartolt.com`), el token de la API y los **perfiles de autorización** (qué preset usa cada OLT y plan al autorizar una ONU; «Probar conexión» trae la lista de OLT).
- **GenieACS:** la dirección del NBI (o del proxy que lo protege), usuario, clave, el certificado raíz propio del proxy (opcional) y «Configurar el PPPoE en el equipo por TR-069».
- Las credenciales se guardan cifradas y **nunca se vuelven a mostrar**: dicen «Guardado» y solo se pueden reemplazar o borrar. Cambiar una dirección o una credencial borra la última prueba.
- **Probar conexión** prueba lo guardado (guarda primero) y deja el resultado con su fecha; si falla, dice el error del sistema. Iris solo puede pedir lo que tenga la integración encendida y su última prueba correcta.

Cada tarjeta se lee por separado: si una falla, la otra se ve igual.

::: tip Apagadas por defecto
Una integración apagada no hace llamadas ni manda avisos. El cobro, el corte y la autenticación de los clientes nunca esperan a Horus ni a Iris.
:::

## Relacionado

- [Horus Flow](horus.md)
- [Iris](iris.md)
- [Tokens de API](../usuarios/tokens.md)
