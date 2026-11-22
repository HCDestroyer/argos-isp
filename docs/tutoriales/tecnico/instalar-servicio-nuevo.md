---
orden: 1
---

# Dar de alta un servicio nuevo

Al terminar, el cliente tiene un servicio con su router, su plan, su IP, su usuario y contraseña PPPoE y su plantilla de cobro, listo para configurar el equipo.

## Antes de empezar

- Permiso: `servicios.crear` (roles `tecnico` y `soporte`).
- El cliente ya existe (si no, que soporte lo cree en **Clientes → Nuevo cliente**).
- El router está registrado y tiene el plan disponible y redes IPv4 (**Red → Routers** y **Red → Planes**).

## Pasos

1. Abre la ficha del cliente y toca «Nuevo servicio». También puedes ir a **Servicios → Nuevo servicio** y elegir al cliente en el primer paso.
2. **Conexión:**
    - **Router:** toca uno de los sugeridos (los de la zona del cliente y los últimos que usaste) o búscalo por nombre, zona o tipo en la lista (en el teléfono se abre a pantalla completa). Cada router dice su tipo de conexión, si está en línea y cuántas IP le quedan; uno sin IP libres no se puede elegir y dice por qué.
    - **Plan:** solo aparecen los planes de ese router. El **Tipo de conexión** lo define el router. Con varias empresas, revisa la **Empresa que factura**.
    - **IP del servicio:** «Automática» (de fábrica) toma la siguiente IP libre de las redes del router; «Elegir red» te deja escoger la red, con cuántas IP le quedan (una llena no se puede elegir); «Escribir IP» es para una IP fija: dice si está «Libre» u «Ocupada por S-…» antes de guardar. En routers de IP estática o DHCP fija la IP es obligatoria: «Automática» la reserva al guardar.
    - **Avanzado: IPv6:** viene lo recomendado según el plan. «Cambiar» te deja elegir el **Modo IPv6** y, si hace falta, el **DUID del equipo** o el **Prefijo delegado**.
3. **Acceso PPPoE** (o **Equipo** sin PPPoE):
    - **Servidor** PPPoE del router, si tiene varios.
    - **Usuario PPP** y **Contraseña PPP**: vienen generados. Puedes editarlos, generar otros o copiar la contraseña para configurar el equipo.
4. **Instalación y cobro:**
    - Activa «Pendiente de instalación» si todavía no instalas el equipo (ver [Activar un servicio pendiente](./activar-instalacion.md)). Si ya lo dejas instalado hoy, déjalo apagado.
    - **Fecha de instalación** y **MAC del equipo**, opcionales.
    - **Dirección de instalación**, **Referencia**, **Coordenadas**, **Contacto en sitio** y su **Teléfono**.
    - **Plantilla de facturación** (viene la primera) y, en «Excepciones», un **Precio especial** o «Excluir del firewall» si el cliente lo tiene.
5. **Resumen:** revisa todo. «Cambiar» en cada grupo te regresa a ese paso.
6. Toca «Crear servicio».

![Alta de servicio en pasos: Cliente, Conexión, Acceso PPPoE, Instalación y cobro, y Resumen](/capturas/tecnico/nuevo-servicio.png)

## Qué pasa después

- Vuelves a la ficha del cliente, pestaña **Servicios**, con el servicio nuevo.
- Si nació **Activo**: el equipo ya puede conectarse con su usuario y contraseña, y se factura según la plantilla.
- Si nació **Pendiente de instalación**: ya tiene todo para configurar el equipo, pero no navega ni se factura hasta activarlo.
- Configura el equipo del cliente con el usuario y la contraseña. Puedes volver a verlos en la ficha del servicio, en **Credenciales PPPoE**, con «Mostrar» (pide `servicios.ver_credenciales` y queda en la bitácora).
- Si dejaste un equipo del ISP en la casa, [asígnalo en comodato](./equipo-en-comodato.md).

## Si algo sale mal

| Mensaje                                   | Causa                                           | Qué hacer                                                                     |
| ----------------------------------------- | ----------------------------------------------- | ----------------------------------------------------------------------------- |
| «No hay routers activos»                  | No hay routers registrados o activos            | Regístralo en **Red → Routers**                                               |
| «Este router no tiene planes disponibles» | El plan no está en ese router                   | Agrégalo en **Red → Planes** o elige otro router                              |
| «…: la IPv4 es obligatoria»               | En IP estática o DHCP fija la IP es obligatoria | Elige una red o escribe la IP                                                 |
| «El router no tiene bloques IPv6»         | Faltan bloques IPv6                             | Funcionará solo con IPv4 hasta que registres un bloque en **Red → Routers**   |
| «… no usa RADIUS»                         | El router se maneja por su API                  | Normal: PPPoE va como secret en el MikroTik y los cambios rigen al reconectar |
| La IP o el usuario PPP ya están ocupados  | Otro servicio los usa                           | Elige otra IP o genera otro usuario                                           |
| «Hay datos por corregir»                  | Algún campo tiene error                         | El panel te lleva al paso con el campo marcado en rojo                        |

## Relacionado

- [Activar un servicio pendiente de instalación](./activar-instalacion.md)
- [Manual de clientes y servicios](../../manual/clientes-y-servicios/)
- [Manual de red](../../manual/red/)
