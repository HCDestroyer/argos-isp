---
orden: 8
pantallas:
    - /sistema/tareas
---

# Tareas programadas

Muestra todas las tareas que el sistema hace solo, a su hora: generar facturas, vencer y aplicar mora, el corte por hora, cerrar promesas vencidas, sellar el libro, el calendario fiscal y la facturación electrónica, los puntos de lealtad, las sesiones colgadas, el sondeo y la reconciliación de los routers, los recordatorios de pago, las particiones de la bitácora, el cálculo de almacenamiento y los procesos que corren todo el tiempo (relay de eventos, vigía de RADIUS, envíos a Iris y Horus).

## Quién la usa

- **Ver:** `sistema.ver_crons` (solo `admin`).
- **Ejecutar ahora:** `sistema.ejecutar_cron`. Algunas tareas piden además el permiso de lo que hacen: generar facturas pide `facturas.generar`; el corte, `servicios.suspender`; la cola de facturación electrónica, `fel.certificar`; reconciliar y recuperar routers, `routers.reconciliar`; conciliar la pasarela, `cobros.liquidar`; calcular el almacenamiento, `sistema.recalcular_almacenamiento`.

## Qué muestra cada tarea

- **Horario**: «Cada 5 min», «Cada hora» o «Todos los días a las 02:15» (hora de Guatemala).
- **Última corrida**: cuándo, cuánto tardó, qué hizo en una frase («24 facturas emitidas») y, si falló, el error. Las corridas seguidas que no tuvieron nada que hacer se agrupan («Nada pendiente · ×58»).
- **Próxima corrida**: la que tiene agendada el sistema; si Redis no responde, se calcula del horario y arriba sale un aviso.
- **Estado**, con ícono, texto y color: **Correcta**, **Sin cambios**, **En curso**, **Con error**, **Atrasada**, **Apagada** o **Sin datos**. El punto de la derecha solo crece cuando la tarea está atrasada o con error.
- **Lock**: qué copia del sistema la está corriendo. Con varios servidores cada tarea corre en una sola copia a la vez.

Una tarea está **atrasada** cuando no corrió en su periodo más la tolerancia (30 minutos de fábrica), o, si es diaria, cuando pasó su hora y no corrió. Es la misma regla con la que el equipo recibe el aviso por Telegram. Casi siempre significa que el proceso que la corre (por ejemplo `billing:worker`) está detenido.

## Historial

Al elegir una tarea se ve su historial de corridas, de la más nueva a la más vieja, con quién la pidió si se ejecutó a mano y en qué copia corrió. Se guardan 90 días; lo que hizo cada corrida (cada factura, cada corte) sigue en la **Bitácora** para siempre.

## Ejecutar ahora

**Ejecutar ahora** pide una confirmación corta y pone la tarea en la cola de su proceso: corre en cuanto el proceso la toma, con las mismas reglas que la corrida automática. Si la tarea ya se está ejecutando responde «Ya se está ejecutando» y no la repite. Los procesos que corren todo el tiempo y las tareas apagadas no se ejecutan a mano.

Ejecutarla a mano nunca hace nada distinto: procesa lo pendiente hasta ese momento, igual que la corrida automática, así que repetirla no duplica facturas ni cortes.
