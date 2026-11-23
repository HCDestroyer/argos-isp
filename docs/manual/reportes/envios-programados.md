---
orden: 2
pantallas:
    - /reportes/envios
---

# Envíos programados

Los reportes que llegan solos por correo y la lista de correos de fuera de la empresa (contador, socios, auditoría) que el admin aprobó para recibirlos.

## Quién la usa

- **Ver la pantalla:** `reportes.programar_envio`; **pausar y reanudar** un envío con `reportes.editar_envio`.
- **Aprobar un correo externo:** `reportes.aprobar_correo_externo`; **retirarlo:** `reportes.retirar_correo_externo` (solo `admin`).

Se llega desde **Reportes → Envíos programados**, o desde el catálogo de reportes con **Ver envíos programados**.

## Qué ves

- **Envíos programados:** cada envío con su reporte y empresa (o «Consolidado (todas)»), cada cuánto llega, el formato (Excel, PDF o CSV), para quién, el próximo envío y su estado (Activo o Pausado). Al elegir uno, a la derecha (en el teléfono, debajo) ves:
    - **Para quién:** cada usuario y correo externo. Un correo que el admin retiró aparece tachado con «Retirado de la lista» y ya no recibe.
    - **Últimas corridas:** cuándo se envió y qué pasó con cada destinatario (enviado, omitido con su motivo o falló).
- **Correos externos aprobados:** cada correo con de quién es, quién lo aprobó y cuándo (o quién lo retiró), en cuántos envíos programados está (**Envíos**) y su estado (Aprobado o Retirado). Reciben solo reportes contables, sin datos personales de clientes.

El buscador filtra por nombre del envío, reporte, destinatario o correo.

## Acciones

- **Pausar** o **Reanudar** un envío: en pausa no se envía hasta que lo reanudes.
- **Ver el reporte:** abre el reporte del envío con sus filtros.
- **Aprobar un correo:** escribe el correo y de quién es. Si ya estaba retirado, vuelve a quedar aprobado.
- **Retirar** un correo: deja de recibir desde el próximo envío. No se borra; los envíos que lo tenían siguen para los demás destinatarios y lo muestran como «Retirado de la lista».

Los envíos se programan desde cada reporte con **Programar envío**.

## Preguntas frecuentes y errores

| Mensaje | Qué hacer |
| --- | --- |
| «Omitido: el correo se retiró de la lista» | Quita ese correo del envío o pide al admin que lo vuelva a aprobar. |
| «Falló: el servidor de correo no respondió» | Revisa la configuración de correo en Configuración → Notificaciones. |
| Conflicto de versión al pausar | Otra persona cambió el envío: toca **Recargar**. |

## Relacionado

- [Catálogo de reportes](catalogo.md)
- [Ajustes de reportes](../configuracion/ajustes-de-reportes.md)
