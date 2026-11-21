# Decisiones del PM sobre el diseño (21 nov 2026)

Respuestas del PM a las 31 preguntas de los diseños de reportes y contabilidad (1–12), operación (13–26) y red (27–31). Son reglas para el código: lo «configurable» se construye como ajuste con ese valor de fábrica.
1. Menú: Finanzas agrupa Panel, Libro, Cierres, Impuestos, Compras, Cartera, Bancos, Cajas; Reportes aparte.
2. Inicio por rol, configurable (dueño/admin: panel financiero; demás: Día a día; cambiable por rol y usuario).
3. Ingreso mensual recurrente CON IVA (activos + limitados, resta descuentos y precio temporal).
4. Baja = retirado o suspendido > 60 días (configurable); si reactiva deja de contar.
5. Ganancia/ingreso por zona, plan y router: más adelante (nada por ahora).
6. Envíos programados: usuarios con permiso + correos externos de lista aprobada por admin, solo reportes contables sin datos personales.
7. PDF: todos los reportes (Excel y PDF con logo, empresa, filtros y fecha).
8. Gestiones de cobro: viven en Argos (prueba para castigo); Iris las anota solas (llamadas/visitas).
9. Teléfono finanzas: consulta + aprobar (castigos, cobros de equipo, promesas pendientes) con confirmación; reabrir mes y cierres solo escritorio.
10. Asiento manual: botón visible con permiso (contabilidad); ajuste opcional de aprobación por segundo usuario.
11. Lenguaje: sencillo, término técnico en ayuda «?» y en columna exportada.
12. Límite pequeño contribuyente: aviso en panel del dueño al 80 % y 95 % (configurable).
13. Comprobantes en una sola pantalla (lista + foto + decisión; pasa al siguiente).
14. Comprobante con menos dinero: abono a facturas más viejas y aviso de cuánto falta; ajuste por plantilla para rechazar.
15. Cajero puede dar reconexión temporal: mismas reglas y cupo que Iris; permiso propio (cajero y soporte de fábrica).
16. Pausa sin cobro: de fábrica sigue facturando; «pausa sin cobro» con permiso, motivo y tope 90 días (configurable), reactivación automática.
17. Retiro: de fábrica crea orden de retiro en Iris y equipo «por recuperar»; casilla para omitir si ya se entregó; ajuste global.
18. Plan temporal: dentro de «Cambiar plan» Y ADEMÁS promociones por cliente/servicio (ej. gamers): duplicar velocidad del plan por días, o en horas específicas de cada día, durante un periodo. NUEVO: diseñar y construir «Promociones de velocidad» (multiplicador o plan destino, por días o franja horaria diaria, con fecha de inicio y fin; aplica por CoA sin cortar la sesión).
19. Código de corte: 15 min de fábrica, configurable 5–60.
20. Impresión por caja: ticket 80 mm para recibos, carta para facturas; cada caja recuerda.
21. Facturas de meses pasados: los días de gracia antes del corte los escribe quien emite (campo al emitir).
22. Login: botones Iris/Horus solo si están conectados; recuperar contraseña por correo (enlace de un solo uso), el admin lo puede apagar.
23. Bancos de origen: catálogo único del sistema; admin agrega; cada empresa oculta los que no usa.
24. Importar Mikrowisp: pantalla con pasos, vista previa, cuadre y bitácora de corridas; solo admin.
25. Bitácora: nombre técnico siempre visible debajo del texto en español.
26. Plantillas de WhatsApp: solo en Iris; Argos muestra estado, vista previa y enlace. Correo y Telegram en Argos.
27. Uso del router (CPU, memoria, clientes 24 h): lo mide Horus; Argos muestra el enlace (no guarda historial propio).
28. Buscar quién tenía una IP en fecha pasada: sí, por IP + fecha/hora; permiso propio, consulta auditada; retención 2 años configurable.
29. Menú Red: Routers, Planes, Direcciones IP, Red de acceso y Conectados ahora.
30. IP pública: ambas — adicional cobrado (precio en catálogo; se libera al quitar o retirar) y también incluida en algunos planes empresariales.
31. Caídas repetidas: alerta en Argos Y ticket en Iris (uno por servicio mientras siga abierto; umbral 3 en 60 min configurable). Si es una falla general o corte (muchos servicios del mismo router, OLT, PON o zona a la vez), se abre UN ticket general en Iris que agrupa a los afectados, para que técnicos y atención al cliente sepan qué pasa; no un ticket por servicio.
32. GenieACS va en un servidor aparte. Regla principal del PM: el crecimiento es horizontal (CLAUDE.md §14).
