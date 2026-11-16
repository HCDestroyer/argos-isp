---
orden: 2
---

# Atender un «no tengo internet»

Al terminar, sabes si el problema es de pago, de la sesión o del equipo del cliente, y ya hiciste lo que toca desde el panel.

## Antes de empezar

- Permisos: `servicios.ver` y `sesiones.ver` para ver el servicio y su sesión (rol `soporte`). Para actuar: `servicios.desconectar`, `servicios.sincronizar_router`, `servicios.reactivar`, `promesas.crear` (todos en el rol `soporte`).

## Pasos

1. [Busca al cliente](./buscar-cliente.md) y abre la pestaña **Servicios**. Toca el servicio que falla.
2. Mira el **estado** junto al nombre del servicio:

    | Estado                                               | Qué significa                                     | Qué hacer                                                                                                                                 |
    | ---------------------------------------------------- | ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
    | **Activo** (verde)                                   | Debería navegar                                   | Sigue con el paso 3                                                                                                                       |
    | **Limitado** (ámbar)                                 | Navega lento por falta de pago                    | Que pague (en caja, por banco o en el portal) o [crea una promesa de pago](./crear-promesa.md)                                            |
    | **Suspendido** (rojo)                                | Está cortado; al navegar ve la página de corte    | Revisa el **Estado de cuenta** del cliente. Si debe, que pague o promete; el servicio se reactiva solo al pagar o al aprobarse la promesa |
    | **Suspendido** con el aviso «Suspendido manualmente» | Alguien lo cortó a mano (el aviso dice el motivo) | Ni el pago ni el corte automático lo quitan. Si ya se resolvió el motivo, toca «Reactivar» y escribe el motivo                            |
    | **Pendiente de instalación** (azul)                  | Aún no se instala: no navega                      | El técnico debe [activar la instalación](../tecnico/activar-instalacion.md)                                                               |
    | **Retirado** (gris)                                  | Dado de baja                                      | No navega; habría que darle un servicio nuevo                                                                                             |

3. Si está **Activo**, mira la tarjeta **Sesión activa**:
    - **En línea** con su IPv4 y sus prefijos IPv6: el equipo está conectado. El problema puede estar en la casa (wifi, cables, el equipo). Si quieres que el equipo se vuelva a conectar, toca «Desconectar sesión», escribe el motivo y confirma: se reconecta solo en unos segundos.
    - **Sin sesión PPPoE abierta**: el equipo no se está conectando. Pregunta si el equipo está encendido y con luces. Revisa en el **Historial de sesiones** cuándo fue la última conexión.
4. Si sospechas que el router no tiene bien la configuración del cliente (velocidad, corte), toca «Sincronizar con el router» y luego «Sincronizar». Te dice lo que corrigió o «Ya estaba sincronizado».
5. Si nada de esto lo resuelve, levanta la visita técnica en el sistema de campo de tu empresa.

## Qué pasa después

- Cada acción queda en la **Línea de tiempo** del cliente y en la [bitácora](../../manual/general/bitacora.md) con tu motivo.
- «Desconectar sesión» no cambia el estado del servicio: solo hace que el equipo se vuelva a conectar.

## Si algo sale mal

| Mensaje                                                    | Causa                                           | Qué hacer                                        |
| ---------------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------ |
| «El router no respondió como se esperaba» (al sincronizar) | No se pudo hablar con el router                 | Avisa a un técnico; la ventana muestra el motivo |
| No aparece «Limitar» o «Quitar límite»                     | El servicio tiene suspensión manual             | Solo «Reactivar» quita la marca                  |
| No aparece «Desconectar sesión»                            | El servicio no es PPPoE, o no tienes el permiso | Pide ayuda a un técnico                          |
| Aviso de error con «Reintentar» en **Sesión activa**       | No se pudo leer la sesión                       | Reintenta; no supongas que está desconectado     |

## Relacionado

- [Crear una promesa de pago](./crear-promesa.md)
- [Revisar la bitácora del cliente](./bitacora-del-cliente.md)
- [Manual de clientes y servicios](../../manual/clientes-y-servicios/)
