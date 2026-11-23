---
orden: 7
pantallas:
    - /configuracion/reportes
---

# Ajustes de reportes

Cómo se cuentan las bajas en los reportes y en el panel del dueño, y a qué correos externos pueden ir los reportes programados.

## Quién la usa

- **Ver la pantalla:** `reportes.ver`.
- **Altas y bajas:** ver con `panel_financiero.ver`, guardar con `panel_financiero.configurar`.
- **Correos externos aprobados:** ver con `reportes.programar_envio`; **aprobar** con `reportes.aprobar_correo_externo` y **retirar** con `reportes.retirar_correo_externo` (solo `admin`).

Se llega desde **Configuración → Reportes**.

## Qué ves

- **Altas y bajas · Días suspendido para contar una baja:** un servicio retirado, o suspendido más de estos días, cuenta como baja; si se reactiva deja de contar. De 1 a 365 (60 de fábrica). Es de cada empresa: con «Todas las empresas» pide elegir una arriba.
- **Correos externos aprobados:** la lista de correos de fuera de la empresa (contador, socios, auditoría) que pueden recibir reportes programados, con quién es, cuándo se aprobó o se retiró y su estado (Aprobado o Retirado). Reciben solo reportes contables, sin datos personales de clientes.

## Acciones

- **Guardar** los días de baja.
- **Aprobar un correo:** escribe el correo y de quién es. Si ya estaba retirado, vuelve a quedar aprobado.
- **Retirar:** deja de recibir desde el siguiente envío. No se borra: queda en la lista como retirado.

## Preguntas frecuentes y errores

| Mensaje | Qué hacer |
| --- | --- |
| «Elige una empresa» | Los días de baja son de cada empresa: elige una arriba. |
| «Escribe un correo válido» | Revisa el correo. |
| Conflicto de versión | Otra persona guardó mientras editabas: toca **Recargar**. |

## Relacionado

- [Catálogo de reportes](../reportes/catalogo.md)
