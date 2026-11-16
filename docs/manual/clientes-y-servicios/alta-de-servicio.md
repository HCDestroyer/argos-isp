---
orden: 3
pantallas:
    - /servicios/nuevo
---

# Alta de un servicio

Con el alta le das internet a un cliente: eliges el router y el plan, ArgosIsp le asigna la IP y los prefijos IPv6, genera su usuario y contraseña PPPoE y le pone la plantilla de cobro. Casi todo viene ya elegido; tú revisas y confirmas.

## Quién la usa

- **Permiso:** `servicios.crear` (`admin`, `soporte`, `tecnico`).

## Dónde se abre

- Desde la ficha del cliente, botón «Nuevo servicio»: se abre en un panel lateral y el paso «Cliente» no aparece.
- Desde **Servicios → Nuevo servicio**: la página completa, con un resumen al lado.
- Desde el aviso «Cliente creado», botón «Agregar servicio».

## Pasos

El alta tiene pasos numerados arriba. Puedes volver a un paso anterior haciendo clic en él, y «Ir al resumen» te salta al final cuando ya todo está bien.

### 1. Cliente

Solo si abriste el alta desde **Servicios**. Busca al cliente por nombre, NIT, teléfono, usuario PPP o IP.

### 2. Conexión: router y plan

- **Router:** donde se conecta el cliente. Define qué planes, redes y pools hay disponibles. Si solo hay un router activo, ya viene elegido. Cada opción dice su dirección, cómo controla la velocidad y si funciona sin RADIUS.
- **Plan:** solo aparecen los planes disponibles en ese router, con su precio y velocidades. Si solo hay uno, ya viene elegido.
- **Tipo de conexión:** lo define el router (PPPoE, IP estática o DHCP con IP fija); aquí solo se muestra. Se cambia en la [ficha del router](../red/ficha-del-router.md#tipo-de-conexion).
- **Empresa que factura:** solo si trabajas con más de una empresa. Viene sugerida (la de la zona del cliente, si no la del router, si no tu empresa activa) y puedes elegir otra de las tuyas. Las facturas del servicio salen con el NIT de esa empresa.

Si el router no usa RADIUS, verás un aviso: el usuario PPPoE se crea directamente en el MikroTik y los cambios rigen cuando el cliente se reconecta.

### 3. Red: IPv4, IPv6 y acceso

**Servidor PPPoE.** Si el router tiene varios (uno por VLAN), elige por dónde entra el cliente, o deja «Que lo elija Argos por la red». Con uno solo, ya viene elegido. Debajo se ve el gateway que usará la sesión.

**IPv4.**

- **Automática** (por defecto): al crear el servicio se toma la siguiente IP libre de las redes del router. Puedes elegir una red en particular o dejar «Cualquier red del router».
- **IP fija:** para una IP pública o para reglas por IP. Eliges la red y escribes la IP, que debe caer dentro de esa red.

Con IP estática o DHCP fija la IPv4 es obligatoria.

**IPv6.** Por defecto se muestra lo recomendado según el plan: «Automática por servicio», que le da al cliente un /64 para el enlace con el router y un prefijo para su red (/56 o /48, según el plan) tomados de los pools IPv6 del router. «Cambiar» abre todos los modos:

| Modo                    | Para qué                                                                                            |
| ----------------------- | --------------------------------------------------------------------------------------------------- |
| Automática por servicio | Recomendado con PPPoE. ArgosIsp reserva los prefijos para este servicio y siempre le da los mismos. |
| Pool del router         | El router reparte desde su propio pool. Solo con PPPoE.                                             |
| DHCPv6-PD por DUID      | Prefijo fijo para un equipo identificado por su DUID.                                               |
| Prefijo estático        | Prefijo delegado fijo, escrito a mano.                                                              |
| Sin IPv6                | Solo IPv4.                                                                                          |

Si el plan es solo IPv4, los modos IPv6 aparecen deshabilitados. Si el router no tiene bloques IPv6, el aviso lo dice y el servicio funciona solo con IPv4 hasta que registres un bloque.

**Credenciales PPPoE** (solo PPPoE).

- **Usuario PPP:** se genera a partir del nombre del cliente. Puedes cambiarlo o generar otro.
- **Contraseña PPP:** se genera sola y se ve en claro para dictarla en la instalación. Puedes generar otra o copiarla.

**Equipo del cliente** (IP estática y DHCP fija).

- **MAC del equipo:** obligatoria con DHCP fija, porque el lease del router se crea con esa MAC.
- **Amarrar la IP a la MAC:** crea un ARP estático en el router para que solo esa MAC use la IP.

### 4. Instalación y cobro

- **Pendiente de instalación:** actívalo si el técnico todavía no instaló el equipo. El servicio queda con usuario, IP y plan para configurar el equipo, pero no navega ni se factura hasta que alguien use «Activar instalación» en su ficha. Apagado, el servicio nace activo: navega en cuanto el equipo se conecte y se factura desde hoy.
- **Fecha de instalación** (opcional): con ciclo de aniversario, la facturación toma este día.
- **MAC del equipo** (opcional en PPPoE).
- **Dirección de instalación**, **Referencia** y **Coordenadas:** por defecto, las del cliente. La referencia la lee el técnico en la orden.
- **Contacto en sitio** y **Teléfono del contacto** (opcionales): quién recibe al técnico, si no es el cliente.
- **Plantilla de facturación:** define el día de cobro, los días de gracia, la mora y cuándo se limita o se corta. Viene elegida la primera; también puedes dejar «Sin plantilla».
- **Excepciones: precio especial y firewall** (se abre con un clic):
    - **Precio especial:** vacío cobra el precio del plan.
    - **Excluir del firewall:** no aplica las reglas de corte del router a este servicio.

### 5. Resumen

Revisa todo agrupado. Cada grupo tiene «Cambiar» para volver a su paso. Pulsa «Crear servicio».

## Qué pasa después

- Ves el aviso «Servicio creado» (o «Servicio creado, pendiente de instalación») con el tipo de conexión, el usuario y la IP.
- ArgosIsp deja reservadas la IPv4 y, en modo automático, el /64 de enlace y el prefijo delegado.
- Con PPPoE, el cliente ya puede conectarse con su usuario y contraseña (salvo que esté pendiente de instalación).
- Con IP estática o DHCP fija, ArgosIsp crea en el router la cola, el lease o el ARP.
- El alta queda en la bitácora con tu nombre.
- Si el plan trae adicionales incluidos (por ejemplo, una cuenta de streaming), se asignan solos.

Si la API devolvió advertencias (por ejemplo, un plan dedicado en un router con reuso), aparecen en un aviso «Servicio creado con advertencias»: el servicio sí se creó.

## Si algo sale mal

**«No hay routers activos».** Registra un router en **Red → Routers** antes de dar de alta servicios.

**«Este router no tiene planes disponibles».** Agrega el plan al router desde la ficha del plan (**Red → Planes**) o elige otro router.

**La IP, el prefijo o el usuario ya están en uso.** El error sale junto al campo. Si dice que todavía lo usa una sesión abierta de otro cliente, espera: se libera en cuanto el router cierre esa sesión (máximo 5 minutos).

**El router no tiene credenciales de la API.** Un router sin RADIUS necesita usuario y contraseña de la API para crear usuarios PPPoE. Complétalos en «Editar» del router.

**«El plan es solo IPv6 y … necesita IPv4».** Con IP estática o DHCP fija elige un plan con IPv4.

**«Hay datos por corregir».** El alta te lleva al primer paso con un campo en rojo. Corrígelo y vuelve a crear el servicio.

## Relacionado

- [Servicios](servicios.md)
- [Clientes](clientes.md)
- [Ficha del router: pools e IPs](../red/ficha-del-router.md#pools-e-ips)
- [Planes](../red/planes.md)
