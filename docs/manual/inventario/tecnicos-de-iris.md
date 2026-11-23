---
orden: 6
pantallas:
    - /inventario/tecnicos-iris
---

# Técnicos de Iris

Cómo se vincula cada técnico de Iris con su usuario de Argos para mover su bodega. Los vínculos llegan solos desde Iris y solo sirven para inventario: nunca autorizan cobros ni atención.

## Quién la usa

- **Ver:** `inventario.ver`.
- **Conciliar:** `inventario.sincronizar_vinculo_tecnico`.

Está en **Inventario → Catálogos y kardex → Técnicos de Iris**.

## Qué ves

Tres pestañas con su cantidad: **Rechazados**, **Vinculados** y **Desvinculados**, y un buscador por técnico o usuario. Cada fila trae el usuario de Iris con su id externo, el usuario de Argos, el estado, **por qué** (para un rechazo: el usuario de Argos no existe, está desactivado, no tiene rol de técnico, no es de esta empresa o ese id ya lo usa otro técnico) y de dónde vino (webhook o conciliación) con la fecha.

## Acciones

- **Conciliar:** Argos lee el técnico en Iris y aplica las mismas reglas que al recibirlo. Arriba sale el resultado: si quedó vinculado, si sigue igual y por qué, o si Iris no lo encontró o no respondió (sin cambiar nada).

Si un técnico quedó rechazado, corrige primero el usuario en Argos (rol de técnico, empresa, activo) o en Iris (el id externo) y luego concílialo.

## Preguntas frecuentes y errores

| Mensaje | Qué hacer |
| --- | --- |
| «Iris no está conectado» | Revisa el conector de Iris en Configuración → Integraciones. |
| «Iris no lo encontró» | El técnico ya no existe en Iris: no se cambió nada. |

## Relacionado

- [Declarar no recuperado](./declarar-no-recuperado.md)
- [Bodegas](./bodegas.md)
