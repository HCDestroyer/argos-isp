---
orden: 2
---

# Conceptos básicos

Las palabras que vas a ver en todo el panel: qué es un cliente y un servicio, en qué estados puede estar un servicio y quién los cambia, cómo funcionan las empresas, los routers, los planes y los permisos.

## Clientes y servicios

- El **cliente** es la persona o la empresa: nombre, teléfono, correo, dirección y sus datos fiscales (NIT, CUI o consumidor final). Un cliente no navega por sí mismo.
- El **servicio** es cada conexión a internet que tiene el cliente: en qué router se conecta, con qué plan, qué dirección IP recibe y cómo se le cobra. Un cliente puede tener varios servicios (por ejemplo, la casa y el negocio).

Las facturas, los cortes y las reactivaciones son **por servicio**. Si un cliente tiene dos servicios y solo uno tiene facturas vencidas, solo ese se corta.

El saldo de un cliente no se escribe a mano en ningún lado: es la suma de sus facturas, pagos y notas de crédito. Por eso no vas a encontrar un campo «saldo» para editar.

## Estados del servicio

Un servicio siempre está en uno de estos estados. En el panel cada uno tiene su color, su icono y su nombre.

| Estado                              | Qué significa                                                                                                        | Navega        | Se factura |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------- | ---------- |
| **Pendiente de instalación** (azul) | Ya se vendió y tiene usuario, contraseña e IP, pero el técnico todavía no lo instala.                                | No            | No         |
| **Activo** (verde)                  | Funciona normal, con la velocidad completa del plan.                                                                 | Sí            | Sí         |
| **Limitado** (ámbar)                | Tiene facturas vencidas: navega, pero a la velocidad limitada del plan.                                              | Sí, más lento | Sí         |
| **Suspendido** o **cortado** (rojo) | Tiene más facturas vencidas o alguien lo cortó a mano. Lo que abre en el navegador se redirige a la página de corte. | No            | Sí         |
| **Retirado** (gris)                 | Baja definitiva. Su IP y sus prefijos IPv6 quedan libres para otro cliente.                                          | No            | No         |

En las listas, «Cortado» es el mismo estado que «Suspendido».

**Promesa activa** no es un estado, es una marca que se suma al estado. Indica que el cliente prometió pagar en una fecha. Mientras la promesa está vigente, el servicio se mantiene activo aunque tenga facturas vencidas.

### Qué cambia el estado

Hay dos caminos, y conviene no confundirlos:

1. **Automático, por facturas.** ArgosIsp revisa cada servicio contra las reglas de su plantilla de facturación: cuántas facturas vencidas lo limitan y cuántas lo cortan. Esa revisión corre en el corte programado, al registrar o anular un pago y al crear o incumplir una promesa. Si el cliente paga, el servicio vuelve a activo en ese momento, sin esperar al siguiente corte. Bajar de estado (limitar o cortar) respeta la hora de corte de la plantilla; subir (reactivar) es inmediato.
2. **Manual, por una persona.** Desde la ficha del servicio, con su permiso:
    - «Suspender» corta el servicio y le pone la marca **Suspendido manualmente**. Con esa marca, ni el corte automático ni los pagos lo reactivan: solo «Reactivar» la quita.
    - «Limitar» y «Quitar límite» cambian la velocidad.
    - «Reactivar» devuelve un servicio suspendido a activo.
    - «Activar instalación» pasa un pendiente de instalación a activo y arranca la facturación.
    - «Retirar» da de baja el servicio para siempre.

::: danger Retirar no se deshace
Un servicio retirado ya no admite acciones. Si el cliente vuelve, se le crea un servicio nuevo.
:::

## Empresas (multiempresa)

Una instalación de ArgosIsp puede facturar con varios NIT. Cada NIT es una **empresa**, con sus datos fiscales, su logo, sus cajas y su catálogo de adicionales.

- Cada servicio pertenece a una empresa: sus facturas salen con el NIT de esa empresa. Al crear un servicio, ArgosIsp sugiere la empresa de la zona del cliente; si la zona no tiene, la del router; si tampoco, tu empresa activa.
- La **empresa activa** es la que eliges en el selector de la barra superior. El panel te muestra y te deja trabajar con los datos de esa empresa. Si solo hay una empresa, el selector no aparece.
- «Todas las empresas» (vista consolidada) solo aparece para los usuarios con alcance global.
- Cada usuario trabaja en las empresas que le asignaron. Su rol es el mismo en todas; la empresa acota dónde lo puede usar.
- Para pasar un servicio a otra empresa se usa «Cambiar empresa» en su ficha, y solo se puede si el servicio no tiene saldo pendiente.

## Routers y tipo de conexión

El **router** es el MikroTik donde se conectan los clientes. ArgosIsp habla con él por un túnel WireGuard: por ahí van la autenticación de los clientes (RADIUS), los cambios de velocidad y de corte, y los comandos de su API.

Cada router tiene un **tipo de conexión**, y todos sus servicios lo usan:

| Tipo                 | Cómo se conecta el cliente                                                                                                                    |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| **PPPoE**            | Con usuario y contraseña. El router los valida contra ArgosIsp, que le dice la velocidad, la IP y si está cortado. Es el modo recomendado.    |
| **IP estática**      | Sin credenciales: el equipo del cliente usa la IPv4 que le asignaste. ArgosIsp crea su cola de velocidad y su corte en el router.             |
| **DHCP con IP fija** | El router le entrega siempre la misma IP según la MAC del equipo (por eso la MAC es obligatoria). ArgosIsp crea el lease, la cola y el corte. |

Algunos routers funcionan **sin RADIUS**: ArgosIsp configura, limita y corta todo por la API del MikroTik, y los usuarios PPPoE quedan guardados en el propio router.

## Planes

El **plan** define la velocidad de bajada y de subida, la velocidad cuando está limitado, el precio mensual y cómo se reparte el enlace (reuso, garantía, ráfaga y prioridad). Un plan puede ser:

- **Global:** disponible en todos los routers.
- **Por router:** solo en los routers donde lo implementaste.

El tipo de plan (residencial, empresarial o dedicado) solo cambia avisos y reportes, nunca la velocidad.

Al crear un servicio solo aparecen los planes disponibles en el router elegido.

## Permisos y roles

Cada botón del panel tiene un **permiso** con el nombre de la acción, por ejemplo `servicios.suspender` o `pagos.registrar`. Si no tienes el permiso, el botón no aparece. Los **roles** agrupan permisos, y a cada usuario se le asignan uno o varios.

Roles base que trae ArgosIsp:

| Rol            | Para quién          | Qué puede, en resumen                                                                                                                                                                                |
| -------------- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `admin`        | Administración      | Todo. Algunas acciones son solo suyas: eliminar servicios o routers que nunca se usaron, unir routers, cambiar el control de velocidad o el tipo de conexión de un router, configurar integraciones. |
| `cajero`       | Caja                | Ver clientes y servicios, cobrar, abrir y cerrar turno, crear promesas, revisar comprobantes de depósito. No toca routers ni suspende servicios.                                                     |
| `soporte`      | Atención al cliente | Crear y editar clientes y servicios, suspender, reactivar, limitar, desconectar, activar instalaciones, ver credenciales PPPoE, crear promesas.                                                      |
| `tecnico`      | Red e instalaciones | Routers, redes IPv4 e IPv6, red de acceso, QoS, crear y editar servicios, activar instalaciones, inventario de campo.                                                                                |
| `contabilidad` | Contabilidad        | Facturación, pagos, libro contable, cierres, bancos, impuestos e inventario.                                                                                                                         |
| `lectura`      | Consulta            | Solo ver, sin cambiar nada.                                                                                                                                                                          |

Al asignar un rol se le puede dar un **alcance**: un router, una zona o una caja. Por ejemplo, un técnico con alcance en el router «Torre Norte» solo trabaja con ese router y sus servicios.

Los **tokens de API** (para integraciones y agentes de IA) actúan como un usuario y pasan por los mismos permisos.

## Relacionado

- [Clientes](../manual/clientes-y-servicios/clientes.md)
- [Servicios](../manual/clientes-y-servicios/servicios.md)
- [Routers](../manual/red/routers.md)
- [Planes](../manual/red/planes.md)
- [Usuarios](../manual/usuarios/usuarios.md) y [roles](../manual/usuarios/roles.md)
- [Empresas](../manual/configuracion/empresas.md)
