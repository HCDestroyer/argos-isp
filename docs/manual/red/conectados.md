---
orden: 8
pantallas:
    - /red/conectados
---

# Conectados ahora

Quién está navegando en este momento, desde cuándo y por cuál router.

## Quién la usa

- Ver la pantalla: `sesiones.ver` (`admin`, `soporte`, `tecnico`).
- Desconectar una sesión: `servicios.desconectar`.

## Qué ves

- **Contadores:** conectados, sin servicio por router caído, caídas repetidas y servicios activos sin conexión.
- **Pestañas, buscador y filtro por router.** La lista carga de 50 en 50 con «Cargar más».
- Cada sesión con su cliente, plan, estado del servicio, IP y desde cuándo está conectada. Al elegir una se abre su detalle al lado (en el teléfono, a pantalla completa) con «Abrir cliente» y «Desconectar».

«Caídas repetidas» todavía no tiene lista: la pestaña lo dice, sin números inventados.

## Acciones

### Desconectar

- **Permiso:** `servicios.desconectar`.
- Corta la sesión en el router; el equipo del cliente vuelve a conectarse solo. Sirve para que tome un cambio de plan o de IP al instante.

## Relacionado

- [Ficha del router](ficha-del-router.md)
- [Direcciones IP](direcciones-ip.md)
