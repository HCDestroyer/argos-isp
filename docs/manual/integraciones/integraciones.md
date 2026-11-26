---
orden: 1
pantallas:
    - /configuracion/integraciones
    - /configuracion/integraciones/smartolt/nueva
    - /configuracion/integraciones/smartolt/[id]
    - /configuracion/integraciones/smartolt/[id]/editar
---

# Integraciones

Las otras aplicaciones de la familia que se conectan con ArgosIsp. Cada una tiene su tarjeta con su estado y el botón «Configurar».

## Quién la usa

- Abrir la pantalla: `horus.ver`, `iris.ver`, `smartolt.ver` o `acs.ver` (`admin`, `lectura`).
- Cada tarjeta aparece solo con su permiso: Horus con `horus.ver`, Iris con `iris.ver`, SmartOLT con `smartolt.ver` y el ACS con `acs.ver`.

## Qué ves

### Horus Flow

Consumo, salud y seguridad de cada servicio, avisos de Horus y entrada sin contraseña entre los dos sistemas. Estado: «Activa», «Apagada» o «Sin conectar». «Configurar» abre [Horus Flow](horus.md).

### Iris

Tickets, órdenes de trabajo y seguimiento comercial: Iris lee clientes y servicios, activa instalaciones y recibe los avisos de ArgosIsp. Estado: «Activa», «Apagada» o «Sin conectar», y cuando aplica las marcas «Volver a conectar», «Esperando que Iris active la conexión», «Desconectada» o «Reconexión pendiente», con la fecha que corresponda. «Configurar» abre [Iris](iris.md).

### SmartOLT

Las **cuentas de SmartOLT** (instancias: un subdominio con su token) que usa Argos para autorizar las ONU y ver su estado. Una empresa puede tener varias, y una cuenta puede ser **compartida** con todas las empresas (la crea y la cambia solo quien tiene acceso a todas). Con «Todas las empresas» la lista pide elegir una.

- **Lista:** cada cuenta con su subdominio, la empresa o «Compartida», su estado («Probada», «Falla», «Sin probar» y «Apagada»), cuántas OLT trae y la última prueba. Filtros «Todas», «Compartidas» y «Con falla». En la lista de integraciones, SmartOLT dice cuántas están operativas («2 de 4 operativas»).
- **Agregar instancia** (`smartolt.crear_instancia`): nombre en Argos, subdominio (solo lo que va antes de «.smartolt.com»), el token (General › API key en SmartOLT), si es de una empresa o compartida, una nota y si se enciende al guardar. Un subdominio se registra una sola vez.
- **Detalle de una cuenta:** sus datos (el token siempre como «***» con «Cambiar»), las empresas que la usan, la última prueba (en cuánto respondió y quién la hizo) y **sus OLT**.
- **Probar conexión** / **Sincronizar OLT** (`smartolt.probar_instancia`): una sola llamada a SmartOLT que comprueba el token y trae las OLT de la cuenta. Una OLT nueva que se llama igual que una OLT de la [red de acceso](../red/red-de-acceso.md) se liga sola.
- **Ligar cada OLT** (`smartolt.vincular_olt`) con su OLT de Argos: de ahí sale qué cuenta usa cada servicio. Una OLT de Argos se liga a una sola OLT de SmartOLT; las de otra empresa no se pueden elegir. En «…» de cada OLT están sus **perfiles por plan** (qué preset de SmartOLT usa al autorizar una ONU) y «Quitar vínculo».
- **Apagar / Encender** y **Eliminar** (`smartolt.editar_instancia`, `smartolt.eliminar_instancia`). Apagada no autoriza ONU nuevas ni lee su estado; los aprovisionamientos en proceso se reintentan al encenderla. No se puede eliminar mientras un equipo o un pedido en proceso la use.

### ACS (GenieACS)

El servidor que **cambia el Wi-Fi y el PPPoE de la ONU** (TR-069), uno por empresa. **Sin ACS no se configuran Wi-Fi ni PPPoE de la ONU**: SmartOLT sigue autorizando las ONU y mostrando su estado.

- **Ver:** `acs.ver`. **Editar** (`acs.configurar`): la dirección (URL), usuario, clave, el certificado propio del servidor (opcional) y «PPPoE por ACS». **Probar conexión:** `acs.probar` (no toca SmartOLT).
- Estado: «Probado», «Falla», «Apagado» o «Sin configurar», con «Encendido» para apagarlo sin borrar nada.

### En los dos

- Las credenciales se guardan cifradas y **nunca se vuelven a mostrar** («***»). Cambiar una dirección o una credencial borra la última prueba.
- Argos solo usa lo que está **encendido y con la última prueba correcta**; eso mismo es lo que Iris puede pedir.
- En la ficha de cada servicio, la pestaña **Equipo** dice qué cuenta y qué OLT de SmartOLT usa, si el Wi-Fi y el PPPoE van por el ACS y qué pasaría al aprovisionar una ONU nueva.

Cada tarjeta se lee por separado: si una falla, la otra se ve igual.

::: tip Apagadas por defecto
Una integración apagada no hace llamadas ni manda avisos. El cobro, el corte y la autenticación de los clientes nunca esperan a Horus ni a Iris.
:::

## Relacionado

- [Horus Flow](horus.md)
- [Iris](iris.md)
- [Tokens de API](../usuarios/tokens.md)
