---
orden: 2
pantallas:
    - /servicios
    - /servicios/[id]#ficha-del-servicio
---

# Servicios

Cada servicio es una conexión a internet de un cliente. Aquí lo buscas, ves cómo está configurado y si está conectado, y haces las acciones del día a día: cambiar de plan, suspender, reactivar, limitar, retirar o pasarlo a otra empresa.

## Quién la usa

- Ver la lista y la ficha: `servicios.ver` (todos los roles base).
- Cada botón de la ficha pide su propio permiso, con el mismo nombre de la acción. Los que no puedes usar no aparecen.

## Lista de servicios

Abre **Servicios** en el menú.

### Qué ves

| Columna     | Qué muestra                                                                                                                                                                   |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Servicio    | Usuario PPP o nombre del servicio (enlace a la ficha), número, plan, empresa (si hay varias), tipo de conexión si no es PPPoE, precio especial si lo tiene y el tipo de plan. |
| Cliente     | Nombre (enlace a su ficha) y zona.                                                                                                                                            |
| Router      | Dónde se conecta.                                                                                                                                                             |
| Direcciones | IPv4 (o «Sin IPv4») y el prefijo IPv6 delegado.                                                                                                                               |
| Estado      | El estado con su color, «Promesa activa», «Suspendido manualmente» con su motivo y, si la integración con Horus está activa, el estado de seguridad.                          |

### Buscar y filtrar

- **Accesos rápidos:** «Todos», «Cortados», «Limitados», «Por instalar», «Con deuda» y «Retirados».
- **Buscador:** usuario PPP, IP o nombre del cliente.
- **Filtros:** estado, router, plan, cliente, zona, tipo de conexión, tipo de plan y el interruptor «Con deuda vencida». «Limpiar filtros» los quita todos.

::: tip Los retirados van aparte
Sin filtro de estado, la lista no muestra los servicios retirados. Están en «Retirados». Si en una página se escondió alguno, lo dice debajo de la tabla.
:::

El botón «Nuevo servicio» (`servicios.crear`) abre el [alta de servicio](alta-de-servicio.md).

## Ficha del servicio

Haz clic en el servicio en la lista o en la ficha del cliente.

### Cabecera y avisos

Arriba ves el usuario, el estado, el tipo de conexión, «Promesa activa» si la tiene, la empresa (si hay varias), el cliente, el router y la zona.

- **Suspendido manualmente:** alguien lo cortó a mano y aparece el motivo. Ni el corte automático ni los pagos lo reactivan, y no se puede limitar ni quitar el límite: solo «Reactivar».
- **Pendiente de instalación:** todavía no navega ni se factura. Mientras tanto no se puede suspender, limitar, reactivar, desconectar ni programar un plan temporal; sí editarlo o retirarlo si la venta se cae.
- **Servicio retirado: ya no admite acciones.**

### Secciones

- **Plan y facturación:** plan, precio mensual, velocidad, velocidad limitada, plantilla de facturación y fecha de instalación.
- **Red:** router, tipo de conexión, servidor PPPoE y gateway, IPv4, prefijo de enlace y prefijo delegado IPv6, modo IPv6, DUID, MAC, amarre IP-MAC (sin PPPoE) y si está excluido del firewall de corte.
- **Credenciales PPPoE:** el usuario con «Copiar». La contraseña solo se muestra al pulsar «Mostrar» y con el permiso `servicios.ver_credenciales`; cada consulta queda registrada en la bitácora.
- **Sesión activa** (con `sesiones.ver`, solo PPPoE): si está en línea, desde cuándo, el NAS, la IPv4 y los prefijos de la sesión y el tráfico. Se actualiza sola cada 30 segundos.
- **Código de corte:** si el servicio suspendido tiene código para la página de corte y desde cuándo. El código nunca se muestra.
- **Ubicación y contacto en sitio:** dirección, referencia, coordenadas (con mapa), contacto en sitio, fecha de instalación y los datos de planta (caja, puerto, OLT, PON, potencia) si se cargaron.
- **Configuración efectiva:** lo que de verdad aplica: el plan como queda en su router y la plantilla de cobro con las excepciones del servicio, marcadas como «Excepción».
- **Planes temporales:** mejoras de plan por unos días.
- **Adicionales:** streaming, IPTV y otros que acompañan al internet.
- **Promociones** (pestaña): la promoción de velocidad que tiene ahora, con «Quitar», y las anteriores; «Agregar a una promoción» y «Nueva promoción». Ver [Promociones de velocidad](../red/promociones-de-velocidad.md#en-la-ficha-del-servicio).
- **Equipos** (con `inventario.ver`), **Historial de sesiones**, **Historial de asignaciones** (cada tramo con router, plan, IPv4 y prefijos, desde y hasta cuándo), facturas, promesas e **Historial del servicio** (bitácora).

## Acciones

Las acciones de estado piden siempre un **motivo** (de 3 a 500 caracteres) que queda en la bitácora. Si el cliente tiene encendidos los avisos de corte en Notificaciones, recibe el aviso del cambio por su canal.

### Suspender

- **Permiso:** `servicios.suspender` (`admin`, `soporte`; el `cajero` no lo tiene).
- **Cuándo aparece:** servicio activo o limitado.
- **Qué pasa:** el cliente queda cortado y su navegación se redirige a la página de corte. Queda la marca **Suspendido manualmente**: aunque pague, sigue suspendido hasta que alguien use «Reactivar».
- **Se deshace con:** «Reactivar».

### Reactivar

- **Permiso:** `servicios.reactivar`
- **Cuándo aparece:** servicio suspendido.
- **Qué pasa:** el servicio vuelve a activo y se quita la suspensión manual. La sesión se desconecta para que el equipo vuelva a conectarse con navegación completa (unos segundos sin internet).

::: tip No hace falta reactivar a mano después de un pago
Si el servicio se cortó por falta de pago (no a mano), al registrar el pago se reactiva solo, en ese momento.
:::

### Limitar y Quitar límite

- **Permisos:** `servicios.limitar` y `servicios.quitar_limite`
- **Cuándo aparecen:** «Limitar» con el servicio activo; «Quitar límite» con el servicio limitado. No aparecen si está suspendido a mano.
- **Qué pasa:** la velocidad baja a la limitada del plan, o vuelve a la completa. El cliente no se desconecta.

### Desconectar sesión

- **Permiso:** `servicios.desconectar`
- **Cuándo aparece:** servicios PPPoE activos, limitados o suspendidos.
- **Qué pasa:** se cierra la sesión en el router y el equipo del cliente vuelve a conectarse solo. Sirve para que tome un cambio o para destrabar una conexión.

### Activar instalación

- **Permiso:** `servicios.activar_instalacion` (`admin`, `soporte`, `tecnico`).
- **Cuándo aparece:** servicio pendiente de instalación.
- **Qué pasa:** el servicio pasa a activo, el router le da navegación completa y la facturación arranca desde la fecha de instalación. En «Instalado el» va la fecha y hora (hora de Guatemala, por defecto ahora; no puede ser futura ni anterior al alta). Puedes cargar los datos de planta (caja, puerto, OLT, slot, PON y potencia óptica). Si las notificaciones están encendidas, el cliente recibe la bienvenida.

### Cambiar el plan y otros datos

- **Permiso:** `servicios.editar`
- **Dónde:** botón «Editar» en la cabecera.
- **Qué se cambia:** plan (solo los del mismo router), servidor PPPoE, IPv4 fija (cambiarla, o en PPPoE «Quitar IP fija (usar el pool)»), usuario y contraseña PPPoE, MAC, amarre IP-MAC, modo IPv6, DUID, prefijo delegado, precio especial, fecha de instalación, exclusión del firewall de corte, ubicación y contacto en sitio. Solo se guarda lo que cambiaste.
- **Qué pasa al cambiar el plan:** la velocidad nueva se aplica a la sesión del cliente, normalmente sin desconectarlo (en algunos routers el equipo se reconecta unos segundos). El precio nuevo rige en las facturas siguientes. Los adicionales incluidos se ajustan a los del plan nuevo; los de cortesía y los cobrados se conservan.
- **Qué pasa al cambiar usuario o contraseña PPPoE:** el cliente se desconecta y vuelve a conectarse con los nuevos. Avísale antes, porque hay que cambiarlos también en su equipo.
- **Qué pasa al cambiar la IP o el prefijo:** el cliente se reconecta para tomar la dirección nueva. El tramo anterior queda en el historial de asignaciones.

El tipo de conexión lo define el router y no se elige aquí. Si el servicio es de antes de esa regla y usa otro tipo que su router, el formulario ofrece pasarlo al tipo del router.

Para mover un servicio a otro router se mueve la red IPv4 o el bloque IPv6 que usa, con sus servicios, desde la [ficha del router](../red/ficha-del-router.md#pools-e-ips).

### Programar una mejora de plan (plan temporal)

- **Permisos:** `servicios.programar_plan_temporal` para programar y `servicios.cancelar_plan_temporal` para cancelar (`admin`, `soporte`).
- **Dónde:** sección **Planes temporales**, botón «Programar mejora».
- **Qué pasa:** eliges un plan del mismo router, cuándo empieza (vacío es ahora), por cuántos días y el motivo. Al terminar, el servicio vuelve solo a su plan. «Cancelar» lo detiene antes; si ya estaba activo, el servicio vuelve a su plan base.
- Mientras hay un plan temporal activo no se puede cambiar el plan con «Editar»: primero cancélalo.

### Adicionales del servicio

En la sección **Adicionales**:

- «Agregar» (`servicios.agregar_adicional`): elige un adicional del catálogo de la empresa del servicio, la modalidad y el identificador (usuario de IPTV, correo de la cuenta de streaming…).
    - **Incluido:** viene con el plan, sin cobro aparte.
    - **Cortesía:** se regala con un motivo; pide además `servicios.adicional_cortesia`.
    - **Cobrado:** se cobra aparte cada mes con su precio. Para el mes en curso eliges «Cobrar proporcional este mes» o «Sin costo este mes».
- Editar (`servicios.editar_adicional`) y quitar (`servicios.quitar_adicional`). Quitar es una baja con fecha: nunca se borra, y «Mostrar bajas» la muestra.
- «Ver credencial» (`servicios.ver_credencial_adicional`): cada consulta queda en la bitácora.
- Con el servicio suspendido, los adicionales aparecen como «Bloqueado» y se desbloquean solos al reactivarlo. «Bloqueos» muestra su historial.

### Cambiar empresa

- **Permiso:** `servicios.cambiar_empresa`
- **Cuándo aparece:** solo si trabajas con más de una empresa y el servicio no está retirado.
- **Qué pasa:** eliges la empresa nueva y el motivo. Las facturas ya emitidas se quedan con el NIT que las emitió; las siguientes salen con el nuevo. No afecta la red: el cliente no se desconecta.
- **Requisitos:** el servicio no puede tener saldo pendiente. Si lo tiene, verás «Primero hay que dejar el servicio sin saldo» con «Ir a cobrar»: cobra o anula sus facturas pendientes y vuelve a intentarlo. Además necesitas acceso a las dos empresas, y no puede tener adicionales de cortesía o cobrados vigentes (quítalos antes). Los incluidos se cambian por los que trae el plan en la empresa nueva.

### Sincronizar con el router

- **Permiso:** `servicios.sincronizar_router` (`admin`, `soporte`, `tecnico`).
- **Qué pasa:** revisa en el MikroTik la cola, la address-list, el lease y el ARP de este servicio y corrige lo que no coincida con ArgosIsp. Al terminar muestra lo que se corrigió o «Ya estaba sincronizado». Si el router no responde, muestra el motivo.

### Promesa de pago, Simular promesa y Cargo único

Son acciones de cobranza que aparecen en la misma barra: «Promesa de pago» (`promesas.crear`), «Simular promesa» (`promesas.ver`) y «Cargo único» (`facturas.emitir_cargo_unico`). Un servicio pendiente de instalación no admite promesas. Ver [Cobros](../cobros/index.md) y [Facturación](../facturacion/index.md).

### Retirar

- **Permiso:** `servicios.retirar` (`admin`).
- **Cuándo aparece:** en cualquier estado menos retirado. Un pendiente de instalación se retira si la venta se cae.
- **Qué pasa:** baja definitiva. Se liberan la IPv4 y los prefijos IPv6 (quedan en el historial), el cliente ya no puede conectarse, un plan temporal programado o activo se cancela y sus adicionales se dan de baja. El servicio queda en «Retirados» con toda su historia.

::: danger Retirar no se puede deshacer
Si el cliente regresa, crea un servicio nuevo.
:::

### Eliminar

- **Permiso:** `servicios.eliminar` (solo `admin`).
- **Cuándo se puede:** solo si el servicio **nunca se usó**: sin facturas, notas de crédito, pagos, promesas, bonificaciones, cargos, comprobantes, sesiones, equipos, movimientos de inventario, puntos de lealtad, datos de Horus ni filas de una importación. El estado no importa.
- **Dónde:** si se puede, la ficha muestra «Eliminar» con la nota «Nunca se usó: se puede borrar del todo». Si no se puede, dice por qué (por ejemplo, «No se puede eliminar: tiene 3 facturas. Puedes retirarlo.»).
- **Qué pasa:** el servicio se borra del todo y su usuario PPPoE, su IP y sus prefijos quedan libres. Lo que ArgosIsp creó en el router se limpia.

::: danger Eliminar no se puede deshacer
Úsalo para corregir un servicio creado por error. Si el servicio tiene cualquier historia, se retira: así se conservan las facturas, la contabilidad y la bitácora.
:::

## Preguntas frecuentes y errores

**No aparece el botón «Suspender».** El servicio no está activo ni limitado, o no tienes `servicios.suspender` (el rol `cajero` no lo trae).

**El cliente pagó y sigue cortado.** Revisa si tiene la marca «Suspendido manualmente»: entonces solo «Reactivar» lo saca.

**Al guardar sale un error de conflicto con el botón «Recargar».** Otra persona guardó cambios en el servicio mientras tenías la ventana abierta. Tu cambio no se guardó: pulsa «Recargar» y vuelve a aplicarlo.

**«Esa IP todavía la usa una sesión abierta de otro cliente».** Se libera en cuanto el router cierre esa sesión (máximo 5 minutos). Lo mismo con un prefijo IPv6 o un usuario PPPoE.

**No veo la contraseña PPPoE.** Hace falta `servicios.ver_credenciales`.

**«Servicio no encontrado».** El número de servicio no existe; si lo eliminaron, ya no aparece en ningún lado.

## Relacionado

- [Conceptos: estados del servicio](../../guia/conceptos.md#estados-del-servicio)
- [Alta de un servicio](alta-de-servicio.md)
- [Adicionales](adicionales.md)
- [Planes](../red/planes.md)
