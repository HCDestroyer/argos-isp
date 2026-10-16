# PLAN.md — Plan de trabajo de ArgosIsp

Primera versión operable con clientes reales el **13 de noviembre de 2026**; fase 1 completa, con FEL, el **20 de noviembre de 2026**. Cinco semanas desde el lunes 19 de octubre de 2026.

## Equipo

| Rol | Persona | Agentes | Frentes |
| --- | --- | --- | --- |
| Líder backend | — | 3 | A1 núcleo + acciones + ACL · A2 RADIUS + accounting + CoA · A3 libro + facturación + pagos + promesas |
| Líder frontend | — | 2 | A4 panel de administración · A5 portal del cliente, página de corte, plantillas |
| PM (perfil de red) | — | 1 | A6 infra, MikroTik, notificaciones, importación; contrato del día 1; integración; credenciales INFILE y pasarela |

Cada agente corre en una sesión de Claude Code propia, en una rama `agente/aN-<frente>`, y solo toca las carpetas que indica su agente en `.claude/agents/`. Los líderes revisan cada PR; el agente no hace merge.

Reglas para los líderes:

- Un líder supervisa como máximo 3 agentes. Si no te da tiempo de leer lo que apruebas, pausa un agente.
- Los agentes no toman tareas de la ruta crítica de otro agente. Si A2 necesita algo de A1, lo pide en su archivo de `.claude/integration/` y el líder decide.
- Al final de cada día, cada líder deja en `.claude/STATUS.md` tres líneas por agente: hecho, bloqueado, siguiente.

## Calendario

| Semana | Fechas | Objetivo | Cierre |
| --- | --- | --- | --- |
| 1 · Construcción | 19 al 23 oct | Ruta crítica completa y pantallas, integradas en laboratorio el día 5 | Alta → PPPoE → factura → corte → pago → reactivación funciona en el laboratorio |
| 2 · Validación | 26 al 30 oct | Carga, IPv6 completo, notificaciones, reportes y dashboard, corrección de lo roto | 200 reconexiones dual-stack sin timeout; cartera vencida y cierre de caja cuadran |
| 3 · Importación y piloto | 2 al 6 nov | Importar Mikrowisp en seco dos veces, importar en real, 20 a 50 clientes en el nuevo sistema | Piloto operando; el sistema actual sigue emitiendo FEL |
| 4 · Piloto y cierre | 9 al 13 nov | Corregir incidencias del piloto, ampliar a 200 clientes, cerrar primera versión | **Primera versión operable · 13 nov** |
| 5 · FEL | 16 al 20 nov | Adaptador INFILE en sandbox y producción, configuración del emisor, certificación al emitir o al pagar | **Fase 1 completa · 20 nov** |

FEL va al final a propósito: la factura interna mueve cobro, corte y libro; FEL solo la certifica. Hasta la semana 5, el documento al cliente se llama "aviso de cobro" y la FEL se sigue emitiendo desde el sistema actual. No se certifica acumulado hacia atrás.

## Semana 1, día a día

### Día 1 · lunes 19 · solo líderes y PM, sin agentes construyendo

Nada de código de negocio hoy. El día 1 decide si los seis agentes producen un sistema o seis.

- [ ] PM: monorepo con pnpm workspaces y `.claude/` con `CLAUDE.md`, `PLAN.md`, `agents/`, `integration/` y `STATUS.md`
- [ ] PM: `infra/docker-compose.yml` con Postgres 16, Redis 7, FreeRADIUS 3.2, api, web, portal, aaa, coa; CI que corre lint, typecheck y pruebas
- [ ] Líder BE: migraciones del modelo de datos base (`.claude/modelo-datos.md`) y clase `DomainAction` con auditoría y outbox
- [ ] Líder BE: OpenAPI base con los recursos y acciones de la semana, aunque devuelvan 501; `packages/contracts` generado
- [ ] Líder FE: esqueleto de `apps/web` y `apps/portal` con Nuxt 4 + Nuxt UI, layout, login contra el ACL, cliente HTTP desde contracts, fixtures de prueba
- [ ] PM: MikroTik del laboratorio con PPPoE server, VPN al servidor, `radius incoming`, perfil `suspendido`, DHCPv6-PD; documentado en `infra/mikrotik/README.md`
- [ ] PM: pedir sandbox de INFILE y credenciales de la pasarela (se usan en semanas 2 y 5)
- [ ] Todos: lanzar las seis sesiones de Claude Code con su brief al final del día

### Días 2 a 4 · martes 20 a jueves 22 · agentes construyendo

Cada agente sigue las tareas de su brief en orden. Los líderes revisan PRs al menos dos veces al día. Regla de merge: pruebas verdes, OpenAPI regenerado, auditoría y eventos presentes.

Dependencias entre agentes durante estos días (el PM las vigila):

| Quién espera | Qué | De quién | Cuándo debe estar |
| --- | --- | --- | --- |
| A2, A3 | Tablas y acciones de servicios, planes, plantillas | A1 | Fin del día 2 |
| A2 | MikroTik del laboratorio funcionando | A6 | Fin del día 1 |
| A3 | Evento `servicio.estado_cambiado` y `evaluarEstadoServicio` acordada | A1 | Fin del día 2 |
| A4, A5 | Endpoints reales en lugar de 501 | A1, A3 | Progresivo; mientras tanto fixtures |
| A5 | Address-list `suspendidos` y walled garden | A2, A6 | Día 4 |
| A6 | Modelo estable para importación | A1 | Fin del día 3 |

### Día 5 · viernes 23 · integración en laboratorio

Los tres humanos en el laboratorio con los agentes en espera para corregir. Se pausa toda construcción nueva.

- [ ] Alta de cliente con servicio PPPoE dual-stack desde el panel
- [ ] El cliente conecta; sesión visible en el panel con IPv4, prefijo de enlace y prefijo delegado
- [ ] Generar factura manualmente para ese servicio; aparece en el libro diario cuadrado
- [ ] Forzar vencimiento; el cron de corte lo suspende; el cliente ve la página de corte por IPv4 y por IPv6
- [ ] Registrar pago en caja; el servicio vuelve en menos de 30 segundos sin tocar nada
- [ ] Crear promesa desde la página de corte; reactiva; forzar vencimiento; vuelve a cortar
- [ ] Notificación por correo de factura emitida y de corte
- [ ] Bitácora muestra todas las acciones con actor y canal
- [ ] Lista de todo lo que falló en `.claude/integration/lideres.md` con dueño y prioridad

## Semana 2 · Validación

| Tarea | Dueño | Criterio |
| --- | --- | --- |
| Corregir la lista del día 5 | Todos | Lista vacía el miércoles |
| Prueba de carga: 200 reconexiones PPPoE simultáneas dual-stack | A2 + PM | Cero rechazos por timeout; p95 de autorización < 100 ms |
| IPv6 por DUID (DHCPv6-PD estático) y prefijo estático ruteado vía API RouterOS | A6 | Un cliente sin PPPoE recibe su /56 y navega |
| **Servicios WISP sin PPPoE** (decisión del PM, día 4): conexión `ip_estatica` y `dhcp_fija` (lease por MAC), velocidad por cola simple, corte por address-list `suspendidos` vía API REST de RouterOS, amarre IP-MAC opcional. Contrato en `.claude/integration/contratos/routeros.md` | A1 (modelo) + A2 (control del router) + A4 (alta) + A6 (`lab.rsc`) | Un cliente con IP estática y otro con DHCP fijo se limitan, cortan (llegan a `/corte`) y reactivan por evento en menos de 30 s; el reconciliador corrige una cola o address-list borrada a mano |
| Modo pool del router para IPv6 (`Framed-IPv6-Pool`, `Delegated-IPv6-Pool`) | A2 | El accounting registra el prefijo que entregó el router |
| Telegram: bot, vinculación desde el portal, avisos al cliente y alertas internas | A6 | Cliente vinculado recibe su recordatorio; el equipo recibe alerta si `aaa` no responde |
| Reportes: cartera vencida por antigüedad, ingresos por periodo y método, facturado vs cobrado, cobranza y cierre de caja, IVA del periodo, promesas, altas y bajas, egresos; exportación Excel y CSV | A3 | Cada reporte cuadra contra el libro con datos de prueba |
| Dashboard con gráficas y pantallas de reportes con filtros | A4 | Vistas materializadas se refrescan por evento, no por intervalo |
| Pasarela en línea: adaptador, webhook firmado, asiento con comisión, conciliación diaria | A3 | Pago de prueba reactiva el servicio y queda conciliado |
| Depósito con comprobante y cola de verificación | A3 + A5 | Comprobante subido desde el portal, aprobado en el panel, reactiva |
| Cierre mensual del libro | A3 | Asientos del mes cerrado no admiten reverso con fecha dentro del periodo |
| Reglas de promesas por canal y simulador | A3 + A4 | Simulador explica qué regla aplica a un cliente |

## Semana 3 · Importación y piloto

| Tarea | Dueño | Criterio |
| --- | --- | --- |
| Script de importación desde Mikrowisp: clientes, servicios, planes, routers, facturas pendientes, saldos | A6 | Importación en seco con reporte de diferencias |
| Corregir datos de origen y repetir en seco | PM | Reporte sin diferencias en saldos pendientes |
| Importación real a producción | PM + líder BE | Suma de saldos importados = suma de saldos en Mikrowisp |
| Migrar 20 a 50 clientes al nuevo RADIUS (su router apunta al nuevo `aaa`) | PM | Todos con sesión activa dual-stack en una hora |
| Operar el piloto: caja, cortes, pagos, promesas, notificaciones | ISP | Bitácora de incidencias diaria en `.claude/STATUS.md` |
| Monitoreo: logs con request_id, métricas de `aaa`, colas y crons, alertas por Telegram | A6 | Alerta de prueba llega en menos de un minuto |

## Semana 4 · Piloto y cierre

| Tarea | Dueño | Criterio |
| --- | --- | --- |
| Corregir incidencias del piloto | Todos | Cero incidencias abiertas de severidad alta |
| Ampliar el piloto a 200 clientes | PM | Cortes y reactivaciones del ciclo real sin intervención manual |
| Backups automáticos de Postgres y restauración probada | A6 | Restaurar en un entorno limpio y levantar el sistema |
| Documentación de operación: runbook de `aaa` caído, cierre de caja, cierre mensual | PM | Un operador nuevo sigue el runbook sin ayuda |
| Revisión de seguridad: ACL por pantalla, tokens, rate limit, secretos | Líder BE | Checklist firmado |
| **Cierre de la primera versión operable** | PM | Viernes 13 de noviembre |

## Semana 5 · FEL con INFILE

| Tarea | Dueño | Criterio |
| --- | --- | --- |
| Adaptador INFILE: XML FACT con IVA desglosado por línea, firma y certificación, anulación, consulta de NIT, identificador único por envío, reintentos | A3 | Factura certificada en sandbox con UUID, serie, número, XML y PDF guardados |
| Configuración del emisor: NIT, nombre, código de establecimiento, régimen ISR (frases), credenciales por ambiente, regla de Consumidor Final, momento de certificación | A3 + A4 | Pantalla completa; credenciales cifradas |
| Cambiar "aviso de cobro" a "factura" en plantillas cuando el documento tiene UUID | A5 | El PDF muestra los datos FEL |
| Pase a producción con INFILE y primera factura real | PM | Factura real válida en el portal de la SAT |
| **Fase 1 completa** | PM | Viernes 20 de noviembre |

## Fase 2 (después del 20 de noviembre, por prioridad)

1. SmartOLT: olt-gateway con interfaz genérica; autorizar ONU, señal, reinicio, habilitar/deshabilitar; catálogos en caché; ONU vinculada al servicio.
2. Horus: `GET /ip/{ip}` con prefijo más largo (IPv4 e IPv6), mapa completo, invalidaciones desde accounting, lectura de consumo por servicio, webhooks firmados.
3. WhatsApp como canal (API oficial o proveedor) y preferencia por cliente.
4. MCP e IA: tools `buscar_cliente`, `estado_cuenta`, `validar_servicio`, `crear_promesa_pago`, `crear_ticket`, `agendar_visita`; tokens por agente; promesas pendientes de aprobación; línea de tiempo del cliente.
5. Operaciones de campo: órdenes de trabajo (instalación, visita, retiro), agenda, técnicos, saga de instalación completada, tickets y departamentos.
6. Migraciones masivas entre routers: plan, vista previa con conflictos, lotes con pausas, verificación, reversión.
7. Contabilidad avanzada: estado de resultados, balance general, conciliación bancaria, centros de costo, exportación al software del contador. Notas de crédito NCRE en FEL.
8. Cobro: agentes y bancos externos, débito automático con tarjeta tokenizada. App de técnicos (PWA sin conexión). Reuso 1:N con colas estáticas.

## Riesgos

| Riesgo | Mitigación |
| --- | --- |
| Seis agentes producen código inconsistente | Día 1 completo antes de arrancar; `.claude/CLAUDE.md` como ley; pruebas de integración como condición de merge; líderes leen cada PR |
| RADIUS inestable en producción | Laboratorio desde el día 1; carga en semana 2; dos nodos `aaa` desde el piloto; runbook de failover a secrets locales del MikroTik |
| Credenciales de INFILE o pasarela tarde | Pedirlas el día 1; FEL ya está al final; la pasarela puede pasar a fase 2 sin tocar la fecha del 13 |
| Datos de Mikrowisp inconsistentes | Dos importaciones en seco con reporte de diferencias antes de la real |
| Redirección HTTPS en página de corte | Detección de portal cautivo del sistema operativo + enlace por correo y Telegram |
| Reglas de Consumidor Final cambian | Regla configurable; confirmar con el contador en la semana 4 |
| Un líder con más de 3 agentes | Pausar agentes antes que aprobar sin leer |
