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
33. Historial de quién tenía cada IP: la retención la controla Horus. Argos no purga ni archiva por su cuenta; su búsqueda cubre sus propias sesiones (retención configurable) y para lo histórico remite a Horus.
34. Promociones de velocidad en routers con control por plan (PCQ o árbol): se aplican moviendo al servicio al plan destino mientras dura la promoción (días o franja) y regresándolo al terminar; con multiplicador exigen plan destino.
35. Conectar router: «Por código» viene preseleccionado para identificar a los clientes en la página de corte (como el diseño).

## Aclaraciones al diseñar lo pendiente del backend (23 nov 2026)

Sin cambiar ninguna decisión; así quedaron en los tableros y lo que falta confirmar.

- **16:** la ventana «Suspender» ya no ofrece «Seguir facturando»: la suspensión siempre factura y la pausa sin cobro es su propia acción, con permiso, motivo y tope.
- **21:** los días de gracia antes del corte son un campo de «Emitir por periodo», no un ajuste de Configuración.
- **31:** los textos de caídas repetidas dicen 3 caídas en 60 minutos (el valor de fábrica del backend); antes decían 5 en 30.
- **Por confirmar con el PM:**
  - Promociones de velocidad como pestaña de Red › Planes (el menú Red de la decisión 29 no cambia).
  - Las promociones «programadas» y «terminadas» se calculan con sus fechas; la API solo filtra por `activa` o `cancelada`.
  - El detalle de una falla general muestra código, cliente y conexión de cada afectado; la API de afectados hoy solo da los ids.
  - Argos no guarda el número del ticket general de Iris: el botón abre Iris por el número de la falla.
  - «Técnicos de Iris» vive en Inventario; podría ir en Configuración › Integraciones.
  - El visor de reportes programa en Excel o PDF; la API también acepta CSV.


## Respuestas del PM a los pendientes del backend (23 nov 2026)

- Diseños de «Pendientes del backend» aprobados tal como están en los tableros.
- Promociones de velocidad: pestaña dentro de Red › Planes (no entrada propia en el menú).
- Días de gracia (decisión 21): campo al emitir facturas de meses pasados, no ajuste fijo de cobro.


## SmartOLT y ACS (aprobado por el PM el 25 nov 2026)

Tableros de la página «Pendientes del backend» (generador `generadores/pend_olt_acs.py`), según el contrato `contratos/equipos-olt-acs.md`. Todos en claro y oscuro, escritorio y teléfono. Partimos de las decisiones ya tomadas por el PM: SmartOLT y ACS son independientes (una empresa puede tener uno, otro, los dos o ninguno); SmartOLT admite varias instancias (subdominios), una puede ser compartida y solo la administra quien tiene acceso a todas las empresas; cada instancia trae varias OLT que se ligan a las OLT de la red de Argos; un ACS por empresa; Wi-Fi y PPPoE de la ONU solo con ACS; las credenciales nunca se ven (`***` con «Cambiar»).

- `PendSmartoltLista` (+ `PendSmartoltMovil`): Configuración › Integraciones › SmartOLT. Lista con subdominio, empresa o «Compartida», estado (probada, falla, sin probar, más «Apagada»), número de OLT y última prueba; «Agregar instancia»; vacía; error con «Reintentar» sin números inventados.
- `PendSmartoltDetalle`: datos, token `***`, «Probar conexión» (también trae las OLT), «Sincronizar OLT», encender o apagar, empresas que la usan, eliminar; sus OLT con selector para ligar cada una a una OLT de Argos (las ya ligadas o de otra empresa salen deshabilitadas con el motivo). Vista de solo lectura para una instancia compartida sin acceso global.
- `PendSmartoltForm` (+ móvil): formulario en página (más de 3 campos): nombre, subdominio, token, una empresa o compartida, nota, encender al guardar; errores 409 (subdominio repetido, otra persona editó) y 403 (compartida sin acceso global).
- `PendAcs` (+ móvil): ACS de la empresa activa: probado, falla, apagado, sin configurar y edición en página (URL, usuario, clave `***`, CA, PPPoE por ACS). Siempre el aviso «Sin ACS no se configuran Wi-Fi ni PPPoE de la ONU».
- `PendEquipoServicio` (+ móvil): ficha del servicio › Equipo: cuenta y OLT de SmartOLT que usa el servicio, Wi-Fi y PPPoE por ACS, y qué pasa si no hay ACS, si la OLT no está ligada (se busca la serie en las cuentas de la empresa) o si SmartOLT no responde (el ACS sigue mostrándose).

Respuestas del PM (25 nov 2026):
1. **Empresas de una instancia:** una empresa o compartida con todas, como en el tablero.
2. **Nota:** el campo «Nota» del formulario se mantiene (columna nueva `nota` en la instancia).
3. Tableros aprobados tal como están para construirlos.
