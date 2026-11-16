---
orden: 3
pantallas:
    - /routers/migracion
---

# Migración al nuevo RADIUS

Para el paso de cada router al nuevo servidor RADIUS de ArgosIsp: marcas desde cuándo el router apunta al servidor nuevo y la pantalla te dice qué clientes ya se conectaron, cuáles no y qué falló en la red.

## Quién la usa

- Abrir la pantalla: `routers.ver`.
- Marcar o desmarcar la fecha: `routers.marcar_migrado` (`admin`, `tecnico`).
- El resumen de sesiones pide `sesiones.ver`, y los fallos de red, `red.ver`.

## Qué ves

Elige el **Router** arriba (cada opción muestra su NAS, o «sin RADIUS»).

- **Fecha de migración:** desde cuándo el router usa el servidor nuevo, o «Sin marcar», con el motivo y la primera sesión registrada.
- **Resumen de sesiones** (solo con fecha marcada):
    - **Servicios PPPoE:** sin retirados; los de IP estática o DHCP no usan RADIUS.
    - **Con sesión activa:** cuántas sesiones abiertas hay en el router.
    - **Conectados desde el cambio.**
    - **Sin sesión desde el cambio:** ni abierta ni cerrada después de la fecha.
- **Servicios PPPoE que no se han conectado desde el cambio:** cada uno con su usuario, el cliente y su última sesión (o «nunca tuvo sesión»). Son los primeros a revisar.
- **Fallos de red** desde el cambio (o de los últimos 7 días si no hay fecha): cada CoA, Disconnect o comando a RouterOS que falló, con qué se mandó y la respuesta del equipo. Se filtra por tipo de evento.

Si una lectura falla, la pantalla muestra el error con «Reintentar» y no muestra números.

## Acciones

### Marcar migrado

- **Permiso:** `routers.marcar_migrado`
- **Dónde:** «Marcar migrado» (o «Cambiar fecha» si ya tiene una).
- **Qué pasa:** guardas **Desde** (hora de Guatemala; vacía es ahora) y un **Motivo**. No toca el router ni las sesiones: solo sirve para medir.

### Desmarcar

- «Desmarcar» deja el router sin fecha de migración (vuelta atrás). Tampoco toca el router ni las sesiones.

## Preguntas frecuentes

**Muchos clientes salen «sin sesión desde el cambio».** Puede que tengan el equipo apagado, o que el router todavía no apunte al servidor nuevo. Revisa los fallos de red y usa «Probar conexión» en la ficha del router.

## Relacionado

- [Ficha del router](ficha-del-router.md)
