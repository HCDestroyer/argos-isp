---
orden: 5
pantallas:
    - /inventario/por-recuperar/[id]
---

# Declarar no recuperado

Los intentos de recuperación de un equipo, cada uno con su verificación con Iris, y si ya se puede declarar no recuperado. El técnico nunca decide pérdidas ni cobros: la declaración la hace una persona aquí.

## Quién la usa

- **Ver:** `inventario.ver`.
- **Volver a verificar con Iris:** `inventario.verificar_operacion_iris` (sin él, la lista se lee sin consultar a Iris).
- **Decidir** un intento anterior a la verificación: `inventario.decidir_intento_recuperacion`.
- **Registrar un contacto:** `inventario.registrar_contacto_recuperacion`.
- **Declarar no recuperado:** `inventario.cobrar_equipo`.

Se llega desde **Inventario → Por recuperar**, tocando el equipo o con «Intentos y declaración» en su menú «⋯».

## Qué ves

- Arriba, el equipo con su serie o MAC, el servicio y su estado.
- **Intentos de recuperación**, del más nuevo al más viejo: el número, el motivo (cliente ausente, se negó…), la fecha, el técnico y la ubicación con su precisión; «Ver foto en Iris» (abre la orden en Iris sin contraseña) y «Ver en el mapa». A la derecha, la verificación y si **Cuenta** o **No cuenta**:
    - **Verificado por Iris:** foto y ubicación confirmadas; cuenta.
    - **No verificado:** Iris no lo confirmó, con el motivo; no cuenta.
    - **Verificando con Iris:** Argos lo vuelve a consultar.
    - **Lo decide una persona:** se registró antes de la verificación (Iris anterior a 0.14); no cuenta hasta que alguien lo acepte.
    - **Aceptado** o **Descartado:** lo decidió una persona, con su motivo.
    - **Registrado en Argos:** lo registró una persona en el panel; cuenta.
- Al abrir la pantalla, Argos vuelve a verificar con Iris los intentos pendientes. La ubicación y la autoría de cada intento las afirma Iris.
- **¿Se puede declarar?:** técnicos distintos que cuentan contra el mínimo (2 de fábrica), contactos con el cliente registrados en el panel (basta 1) y el aviso «Todavía no» con lo que falta, o «Ya se puede declarar».

## Acciones

- **Decidir** un intento «Lo decide una persona»: «Aceptar: cuenta» o «Descartar: no cuenta», con motivo. Revisa antes la foto y la ubicación en Iris.
- **Registrar un contacto** con el cliente (llamada, mensaje, visita).
- **Declarar no recuperado:** se habilita cuando se cumple el mínimo. Pide el motivo y si se cobra al cliente «Equipo no devuelto». Al terminar vuelves a Por recuperar.

## Preguntas frecuentes y errores

| Mensaje | Qué hacer |
| --- | --- |
| «Intento ya decidido» | Otra persona lo decidió antes: la lista se actualiza sola. |
| Error de Iris al verificar | La lista guardada se ve igual; toca «Reintentar» o «Volver a verificar con Iris» más tarde. |
| «Iris apagado» al ver la foto | El conector de Iris está apagado: pídele a un administrador que lo revise. |

## Relacionado

- [Equipos por serie y comodato](./equipos.md#equipos-por-recuperar)
- [Técnicos de Iris](./tecnicos-de-iris.md)
