---
orden: 5
---

# Cambiar las credenciales PPPoE o la IP de un servicio

Al terminar, el servicio tiene el usuario, la contraseña o la IP nuevos y el equipo del cliente se vuelve a conectar con ellos.

## Antes de empezar

- Permiso: `servicios.editar` (roles `tecnico` y `soporte`). Para ver la contraseña actual, `servicios.ver_credenciales`.
- Ten a mano el equipo del cliente (o acceso remoto) para ponerle las credenciales nuevas.

## Ver las credenciales actuales

En la ficha del servicio, tarjeta **Credenciales PPPoE**: el usuario se ve siempre; la contraseña, al tocar «Mostrar». Cada vez que la muestras queda anotado en la bitácora. Los botones de copiar sirven para pegarlas en el equipo.

## Cambiar el usuario o la contraseña

1. En la ficha del servicio toca «Editar».
2. Cambia el **Usuario PPPoE** o escribe una **Contraseña nueva** (puedes usar el botón de generar y el ojo para verla).
3. Toca «Guardar cambios».
4. Pon las credenciales nuevas en el equipo del cliente.

**Qué pasa:** al guardar, el cliente se desconecta y vuelve a conectarse con el usuario y la contraseña nuevos. Hasta que el equipo tenga las nuevas, no navega.

## Cambiar la IP

1. En «Editar», en la parte de IPv4:
    - «Cambiar IP» para elegir otra IP fija de una red del router.
    - «Quitar IP fija (usar el pool)» para que tome una IP del pool del router en la próxima conexión.
    - «Mantener la actual» para dejarla como está.
2. Toca «Guardar cambios».

**Qué pasa:** la IP anterior se libera y el equipo se vuelve a conectar con la nueva.

## Otros datos que se cambian en «Editar»

**Plan**, **Servidor PPPoE**, **MAC del equipo** y «Amarrar la IP a la MAC», **Modo IPv6**, **DUID** y **Prefijo delegado**, **Precio especial**, **Fecha de instalación**, «Excluir del firewall de corte» y **Ubicación y contacto en sitio**.

::: warning Cambiar de router
La edición del servicio en el panel no tiene campo para pasarlo a otro router. Si un cliente se cambia de router, pídelo al administrador.
:::

## Si algo sale mal

| Mensaje                                    | Causa                                                     | Qué hacer                                                    |
| ------------------------------------------ | --------------------------------------------------------- | ------------------------------------------------------------ |
| El usuario PPPoE ya existe                 | Otro servicio usa ese usuario                             | Elige otro o genera uno                                      |
| La IP está ocupada o en uso por una sesión | Otro servicio la tiene                                    | Elige otra IP                                                |
| El router no tiene credenciales de la API  | En un router sin RADIUS, PPPoE necesita la API del router | Pide al administrador que cargue las credenciales del router |
| Conflicto de versión                       | Otra persona editó el servicio                            | Recarga la ficha y repite el cambio                          |
| No aparece «Mostrar»                       | No tienes `servicios.ver_credenciales`                    | Pide el permiso                                              |

## Relacionado

- [Dar de alta un servicio nuevo](./instalar-servicio-nuevo.md)
- [Manual de clientes y servicios](../../manual/clientes-y-servicios/)
