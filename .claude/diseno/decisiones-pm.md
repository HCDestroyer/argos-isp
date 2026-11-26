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

## Contabilidad (pendiente de aprobación del PM)

Propuesta del 26 nov 2026. Nada de esto es regla todavía. Análisis completo, errores encontrados y plan por lotes: `.claude/integration/contratos/plan-contabilidad.md`. Tableros: `PlanContaInicio`, `PlanContaConciliar`, `PlanClienteFiscal`, `PlanIndicadorAyuda` y sus versiones de teléfono (generador `generadores/conta_plan.py`). Imágenes: `capturas/contabilidad/propuesta/`; el panel de hoy, en `capturas/contabilidad/antes/`.

Lo que se propone:

- **Inicio de contabilidad:** «Qué toca hoy» (tareas con contador y un botón), «Pasos del mes» (facturar, cobrar y cerrar cajas, compras y gastos, conciliar, revisar, declarar, cerrar), «Crear» y cuatro indicadores.
- **Menú Finanzas en 7 entradas:** Inicio, Ventas y cobros, Compras y pagos, Bancos y cajas, Impuestos, Cierre y libro, Panel del dueño. Cambia la decisión 1.
- **«Nueva factura» a la vista** en la ficha del cliente, en Facturas y en la ficha del servicio (hoy es «Cargo único» dentro de «Más»).
- **Tipo de impuesto del cliente:** Normal, Agente retenedor de IVA, Exento y «me retiene ISR». La factura y el cobro se comportan según el tipo.
- **Conciliación guiada:** cuatro pasos, parejas seguras que se aceptan juntas, diferencia explicada en el mismo paso y cuatro salidas para lo que no tiene pareja.
- **Indicador con ayuda:** nombre en simple, «?» con qué es, cómo se calcula, qué hacer y nombre contable. Amplía la decisión 11.
- **Palabras:** «Dinero en camino al banco» (fondos en tránsito), «Gasto sin factura» (egreso), «Gastos pagados por adelantado» (diferidos), «Te deben» y «Debes a proveedores».

Por decidir (cada una con su recomendación en el plan, §8):

1. Menú Finanzas en 7 entradas con Inicio primero.
2. «Cargo único» pasa a «Nueva factura».
3. Tipos de impuesto del cliente.
4. «Exento» apagado hasta tener la frase de exención del contador.
5. Efectivo entregado al cerrar la caja a nombre de quien lo recibe.
6. Tope de diferencia al conciliar.
7. Una sola puerta para gastos.
8. Anular depósito, devolver saldo a favor y anticipo a proveedor.
9. Gastos que se repiten cada mes.
10. Aprobación de compras y pagos a proveedores.
11. Subcuentas de gasto e ingreso creadas por contabilidad.
12. Conciliación en el teléfono (amplía la decisión 9).
13. Revisión de los textos de ayuda por el contador.
14. Pasos del mes automáticos.


### Respuestas del PM (26 nov 2026)

- **Aprobado:** menú Finanzas en 7 entradas con «Inicio» primero (cambia la decisión 1).
- **Aprobado:** «Cargo único» pasa a llamarse «Nueva factura» y queda a la vista.
- **Aprobado:** tipos de impuesto del cliente: Normal, Agente retenedor de IVA y Exento, más la casilla «me retiene ISR». «Exento» queda apagado hasta tener la frase del contador.
- **Conciliación.** Texto del PM: «En la conciacion es segun lo que se configure, pero no se puede definir un tope? Ademas del tipo de cliente (retención de iva) se debe poder tambien tomar en cuenta en dicha conciación, ademas de otros». Queda así (plan §5.8, tableros `PlanConciliarConfig` y `PlanContaConciliar`):
  - la diferencia aceptable se configura por empresa: tope por línea y por día, y quién aprueba por encima;
  - la conciliación entiende las retenciones: con un cliente agente retenedor de IVA o que retiene ISR, el depósito esperado es el total menos la retención, y esa parte va a la cuenta de retención, no a «diferencia»;
  - cada diferencia conocida es un motivo configurable con su cuenta y su límite: comisión del banco, comisión de pasarela o agente, redondeo, faltante de depósito y «otra razón».
- **Cajas.** Texto del PM: «Debe existir 2 tipos de cajas 1 para cobros y 1 para gastos(mejora esto, y analisa algo que se adapte y se eficiente, consiso y que el flujo de efectivo que se maneja no se pueda perder o dejar de tener el control)». Queda así (plan §5.7, tableros `PlanCajas` y `PlanCajasMovil`):
  - dos tipos de caja: **de cobros** (turno, cierre y entrega) y **de gastos o caja chica** (fondo fijo que se repone contra comprobantes);
  - entre la caja y el banco está la **custodia**: el efectivo siempre está a nombre de una persona;
  - el efectivo se mueve solo de cuatro formas: entrega, depósito, reposición y gasto, cada una con su número y su movimiento en el libro.
- **Preguntas 7 a 14:** quedan como se recomendaron. El gasto en efectivo sale de la caja chica.

Por decidir ahora (plan §8.2): N1 caja sin factura con dos tipos; N2 quitar el retiro del cajero; N3 plazo y tope de custodia; N4 quién recibe entregas; N5 reponer la caja chica desde la custodia; N6 retención sin constancia; N7 tope de diferencias de fábrica; N8 diferencia al recibir una entrega; N9 fondos fijos de fábrica.

### Respuestas del PM (26 nov 2026, segunda tanda): cajas y conciliación

- **Modelo de cajas aprobado:**
  - Hay dos tipos de caja: cobros y caja chica.
  - El efectivo recorre caja de cobros → custodia (quien recibe marca «Recibí») → banco.
  - La caja chica se repone solo por lo gastado.
  - La caja sin factura también se divide en dos: cobros sin factura y caja chica sin factura (N1).
  - El cajero ya no saca gastos de su caja de cobros (N2).
- **Montos de fábrica**, configurables por empresa:
  - fondo de cambio: Q 200 por caja de cobros;
  - caja chica: Q 2,000;
  - custodia: 1 día hábil y Q 5,000 por persona; si se pasa, solo avisa (N3);
  - diferencia al conciliar: Q 10 por línea y Q 50 por día (N7).
- **Sin tope por gasto en la caja chica.** El PM: «El tope de gastos no se puede definir, ya que no es algo que se sepa cuanto se puede gastar». El único límite es el saldo del fondo, y cada gasto lleva su comprobante (N9 ajustada).
- **Constancias (N6):** si el cliente retiene y aún no entrega la constancia, la factura queda pagada y la constancia «por recibir». Al cerrar el mes se avisa, y la constancia no se usa en la declaración hasta tenerla.
- **Reglas aprobadas:**
  - recibir una entrega tiene permiso propio; de fábrica lo tienen admin y contabilidad;
  - «lo deposito yo» está permitido y cada empresa lo puede apagar (N4);
  - la caja chica se repone desde la custodia o desde el banco (N5);
  - el faltante o sobrante al recibir queda a nombre de quien entregó, y Argos no lo descuenta de planilla (N8).

## Menú lateral, Ajustes y perfil (pendiente de aprobación del PM)

Propuesta del 26 nov 2026 al pedido del PM sobre el menú lateral cortado, el menú de Ajustes y el menú del perfil en el teléfono. Tableros `MenuLateral`, `AjustesEscritorio`, `AjustesMovil` y `PerfilDrawer`; imágenes en `imagenes/menu-ajustes/`; diagnóstico, auditoría y lotes en `plan-menu-ajustes.md`. **Nada de esto es regla hasta que el PM lo apruebe**, salvo el primer punto, que es un arreglo.

- **Menú lateral cortado (arreglo, no espera aprobación):** la isla del menú queda a 16 px de los cuatro bordes en cualquier alto de pantalla y «Ajustes» se ve entero.
- **Propuesto, por aprobar:**
  - «Ajustes» es una sola entrada fija abajo del menú. Ya no despliega su lista dentro del menú.
  - Ajustes se ordena en 8 grupos por tarea, y cada pantalla aparece una sola vez: Empresa y fiscal; Facturación y cobro; Clientes y portal; Red y equipos; Comunicación e integraciones; Usuarios y seguridad; Apariencia y reportes; Sistema.
  - Dentro de Ajustes hay una lista propia con todos los grupos y un solo buscador, que también encuentra por lo que hay dentro («correo», «NIT», «mora», «logo»). En el teléfono, esa lista es la pantalla de Ajustes y cada ajuste se abre a pantalla completa con «‹ Ajustes».
  - Lo que un usuario no puede abrir no aparece, y un grupo sin nada permitido tampoco.
  - En la computadora, «Ajustes» abre la última pantalla usada; desaparece la página de tarjetas.
  - Todo se llama «Ajustes» (hoy el menú dice «Ajustes» y la pantalla «Configuración»).
  - En el teléfono, el círculo de la cuenta abre un panel desde abajo (drawer) con la cuenta, la empresa activa, el tema, Mi cuenta, Ayuda, Qué cambió y Cerrar sesión. El menú «Más» sigue a pantalla completa y lleva arriba una fila de la cuenta que abre ese mismo panel.
- **Cambia respecto a lo aprobado el 21 nov:** en los tableros `OperConfig*`, la isla de la izquierda listaba secciones y sus pantallas iban en pestañas. Con esta propuesta la isla lista las pantallas por grupo y esas pestañas desaparecen (quedan las que dividen una misma pantalla).
- **Preguntas al PM:**
  1. ¿Aprueba los 8 grupos y los nombres nuevos («Datos de la empresa», «Régimen e impuestos», «Conceptos y adicionales», «Corte, caídas y retiro», «Canales de aviso», «Registro de fallos»)?
  2. ¿«Ajustes» en todas partes en lugar de «Configuración»?
  3. ¿Que «Ajustes» abra directo la última pantalla usada, sin la página de tarjetas?
  4. ¿El panel de la cuenta desde abajo y, además, la fila de la cuenta arriba de «Más»?
  5. ¿«Sistema» (salud, registro, almacenamiento, tareas) se queda dentro de Ajustes?

### Respuestas del PM (26 nov 2026): menú lateral, Ajustes y perfil

- **Aprobado:** los 8 grupos de Ajustes, con sus nombres: Empresa y fiscal · Facturación y cobro · Clientes y portal · Red y equipos · Comunicación e integraciones · Usuarios y seguridad · Apariencia y reportes · Sistema. «Sistema» queda dentro de Ajustes.
- **Nombre:** «Ajustes» en todas partes (menú, migas y títulos), en lugar de «Configuración».
- **Entrada en computadora:** «Ajustes» abre una **página de tarjetas** por grupo. No abre la última pantalla usada (el PM descartó esa opción).
  - La página de tarjetas es el índice: una tarjeta por grupo, con sus ajustes y el buscador arriba.
  - Dentro de cada ajuste se mantiene la lista de grupos a la izquierda.
- **Teléfono:** el menú de la cuenta es un panel que sube desde abajo (`UDrawer`). Arriba del menú «Más» hay además una fila de la cuenta que abre ese mismo panel.
