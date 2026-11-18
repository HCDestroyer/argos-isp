---
orden: 0
---

# Importar desde otro sistema

Cómo traer clientes, servicios, planes, routers, facturas y saldos desde Mikrowisp, SmartISP o archivos CSV.

Los servicios importados **nunca se facturan hacia atrás**: ArgosIsp les factura desde el siguiente inicio de ciclo después del día de la importación, o desde el ciclo siguiente a la última factura que entró del sistema anterior si esa es posterior. Lo de antes llega como facturas pendientes y saldo inicial. Sin `--plantilla`, los servicios entran con la plantilla por defecto (en una instalación nueva, «Genera 1 · vence 15»). Paso a paso en el [runbook de importación](../runbooks/importacion.md).
