# PLAN.md — Plan de trabajo de ArgosIsp

Primera versión operable con clientes reales el **13 de noviembre de 2026**; fase 1 completa, con FEL, el **20 de noviembre de 2026**. Cinco semanas desde el lunes 19 de octubre de 2026.

## Equipo

| Rol                | Persona | Agentes | Frentes                                                                                                          |
| ------------------ | ------- | ------- | ---------------------------------------------------------------------------------------------------------------- |
| Líder backend      | —       | 3       | A1 núcleo + acciones + ACL · A2 RADIUS + accounting + CoA · A3 libro + facturación + pagos + promesas            |
| Líder frontend     | —       | 2       | A4 panel de administración · A5 portal del cliente, página de corte, plantillas                                  |
| PM (perfil de red) | —       | 1       | A6 infra, MikroTik, notificaciones, importación; contrato del día 1; integración; credenciales INFILE y pasarela |

Cada agente corre en una sesión de Claude Code propia, en una rama `agente/aN-<frente>`, y solo toca las carpetas que indica su agente en `.claude/agents/`. Los líderes revisan cada PR; el agente no hace merge.

Reglas para los líderes:

- Un líder supervisa como máximo 3 agentes. Si no te da tiempo de leer lo que apruebas, pausa un agente.
- Los agentes no toman tareas de la ruta crítica de otro agente. Si A2 necesita algo de A1, lo pide en su archivo de `.claude/integration/` y el líder decide.
- Al final de cada día, cada líder deja en `.claude/STATUS.md` tres líneas por agente: hecho, bloqueado, siguiente.

## Calendario

| Semana                   | Fechas       | Objetivo                                                                                               | Cierre                                                                            |
| ------------------------ | ------------ | ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| 1 · Construcción         | 19 al 23 oct | Ruta crítica completa y pantallas, integradas en laboratorio el día 5                                  | Alta → PPPoE → factura → corte → pago → reactivación funciona en el laboratorio   |
| 2 · Validación           | 26 al 30 oct | Carga, IPv6 completo, notificaciones, reportes y dashboard, corrección de lo roto                      | 200 reconexiones dual-stack sin timeout; cartera vencida y cierre de caja cuadran |
| 3 · Importación y piloto | 2 al 6 nov   | Importar Mikrowisp en seco dos veces, importar en real, 20 a 50 clientes en el nuevo sistema           | Piloto operando; el sistema actual sigue emitiendo FEL                            |
| 4 · Piloto y cierre      | 9 al 13 nov  | Corregir incidencias del piloto, ampliar a 200 clientes, cerrar primera versión                        | **Primera versión operable · 13 nov**                                             |
| 5 · FEL                  | 16 al 20 nov | Adaptador INFILE en sandbox y producción, configuración del emisor, certificación al emitir o al pagar | **Fase 1 completa · 20 nov**                                                      |

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

| Quién espera | Qué                                                                  | De quién | Cuándo debe estar                   |
| ------------ | -------------------------------------------------------------------- | -------- | ----------------------------------- |
| A2, A3       | Tablas y acciones de servicios, planes, plantillas                   | A1       | Fin del día 2                       |
| A2           | MikroTik del laboratorio funcionando                                 | A6       | Fin del día 1                       |
| A3           | Evento `servicio.estado_cambiado` y `evaluarEstadoServicio` acordada | A1       | Fin del día 2                       |
| A4, A5       | Endpoints reales en lugar de 501                                     | A1, A3   | Progresivo; mientras tanto fixtures |
| A5           | Address-list `suspendidos` y walled garden                           | A2, A6   | Día 4                               |
| A6           | Modelo estable para importación                                      | A1       | Fin del día 3                       |

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

| Tarea                                                                                                                                                                                                                                                                                                                        | Dueño                                                                                                                                                                   | Criterio                                                                                                                                                                                        |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Corregir la lista del día 5                                                                                                                                                                                                                                                                                                  | Todos                                                                                                                                                                   | Lista vacía el miércoles                                                                                                                                                                        |
| Prueba de carga: 200 reconexiones PPPoE simultáneas dual-stack                                                                                                                                                                                                                                                               | A2 + PM                                                                                                                                                                 | Cero rechazos por timeout; p95 de autorización < 100 ms                                                                                                                                         |
| IPv6 por DUID (DHCPv6-PD estático) y prefijo estático ruteado vía API RouterOS                                                                                                                                                                                                                                               | A6                                                                                                                                                                      | Un cliente sin PPPoE recibe su /56 y navega                                                                                                                                                     |
| **Servicios WISP sin PPPoE** (decisión del PM, día 4): conexión `ip_estatica` y `dhcp_fija` (lease por MAC), velocidad por cola simple, corte por address-list `suspendidos` vía API REST de RouterOS, amarre IP-MAC opcional. Contrato en `.claude/integration/contratos/routeros.md`                                       | A1 (modelo) + A2 (control del router) + A4 (alta) + A6 (`lab.rsc`)                                                                                                      | Un cliente con IP estática y otro con DHCP fijo se limitan, cortan (llegan a `/corte`) y reactivan por evento en menos de 30 s; el reconciliador corrige una cola o address-list borrada a mano |
| **Control de velocidad** (decisión del PM, día 4): por router `simple` (cola por servicio) o `arbol_pcq` (queue tree + PCQ por plan), reuso `1:N` por plan con colas padre recalculadas por evento, CIR/MIR, ráfaga y prioridad, IPv6 incluido, FastTrack excluido. Contrato en `.claude/integration/contratos/velocidad.md` | A1 (plan, router, función de rate-limit) + A2 (`aaa`, perfiles PPP y dispatcher) + A4 (formularios de plan y router, vista del árbol) + A6 (`lab.rsc`, alerta de colas) | En el laboratorio, 4 clientes de un plan 1:4 de 20 Mbps comparten 20 Mbps; uno solo alcanza 20 Mbps; el límite aplica también por IPv6; cambiar el modo del router no deja colas huérfanas      |
| Modo pool del router para IPv6 (`Framed-IPv6-Pool`, `Delegated-IPv6-Pool`)                                                                                                                                                                                                                                                   | A2                                                                                                                                                                      | El accounting registra el prefijo que entregó el router                                                                                                                                         |
| Telegram: bot, vinculación desde el portal, avisos al cliente y alertas internas                                                                                                                                                                                                                                             | A6                                                                                                                                                                      | Cliente vinculado recibe su recordatorio; el equipo recibe alerta si `aaa` no responde                                                                                                          |
| Reportes: cartera vencida por antigüedad, ingresos por periodo y método, facturado vs cobrado, cobranza y cierre de caja, IVA del periodo, promesas, altas y bajas, egresos; exportación Excel y CSV                                                                                                                         | A3                                                                                                                                                                      | Cada reporte cuadra contra el libro con datos de prueba                                                                                                                                         |
| Dashboard con gráficas y pantallas de reportes con filtros                                                                                                                                                                                                                                                                   | A4                                                                                                                                                                      | Vistas materializadas se refrescan por evento, no por intervalo                                                                                                                                 |
| Pasarela en línea: adaptador, webhook firmado, asiento con comisión, conciliación diaria                                                                                                                                                                                                                                     | A3                                                                                                                                                                      | Pago de prueba reactiva el servicio y queda conciliado                                                                                                                                          |
| Depósito con comprobante y cola de verificación                                                                                                                                                                                                                                                                              | A3 + A5                                                                                                                                                                 | Comprobante subido desde el portal, aprobado en el panel, reactiva                                                                                                                              |
| Cierre mensual del libro                                                                                                                                                                                                                                                                                                     | A3                                                                                                                                                                      | Asientos del mes cerrado no admiten reverso con fecha dentro del periodo                                                                                                                        |
| Reglas de promesas por canal y simulador                                                                                                                                                                                                                                                                                     | A3 + A4                                                                                                                                                                 | Simulador explica qué regla aplica a un cliente                                                                                                                                                 |

## Semana 3 · Importación y piloto

| Tarea                                                                                                    | Dueño         | Criterio                                                |
| -------------------------------------------------------------------------------------------------------- | ------------- | ------------------------------------------------------- |
| Script de importación desde Mikrowisp: clientes, servicios, planes, routers, facturas pendientes, saldos | A6            | Importación en seco con reporte de diferencias          |
| Corregir datos de origen y repetir en seco                                                               | PM            | Reporte sin diferencias en saldos pendientes            |
| Importación real a producción                                                                            | PM + líder BE | Suma de saldos importados = suma de saldos en Mikrowisp |
| Migrar 20 a 50 clientes al nuevo RADIUS (su router apunta al nuevo `aaa`)                                | PM            | Todos con sesión activa dual-stack en una hora          |
| Operar el piloto: caja, cortes, pagos, promesas, notificaciones                                          | ISP           | Bitácora de incidencias diaria en `.claude/STATUS.md`   |
| Monitoreo: logs con request_id, métricas de `aaa`, colas y crons, alertas por Telegram                   | A6            | Alerta de prueba llega en menos de un minuto            |

## Semana 4 · Piloto y cierre

| Tarea                                                                              | Dueño    | Criterio                                                       |
| ---------------------------------------------------------------------------------- | -------- | -------------------------------------------------------------- |
| Corregir incidencias del piloto                                                    | Todos    | Cero incidencias abiertas de severidad alta                    |
| Ampliar el piloto a 200 clientes                                                   | PM       | Cortes y reactivaciones del ciclo real sin intervención manual |
| Backups automáticos de Postgres y restauración probada                             | A6       | Restaurar en un entorno limpio y levantar el sistema           |
| Documentación de operación: runbook de `aaa` caído, cierre de caja, cierre mensual | PM       | Un operador nuevo sigue el runbook sin ayuda                   |
| Revisión de seguridad: ACL por pantalla, tokens, rate limit, secretos              | Líder BE | Checklist firmado                                              |
| **Cierre de la primera versión operable**                                          | PM       | Viernes 13 de noviembre                                        |

## Semana 5 · FEL con INFILE

| Tarea                                                                                                                                                                  | Dueño   | Criterio                                                                    |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | --------------------------------------------------------------------------- |
| Adaptador INFILE: XML FACT con IVA desglosado por línea, firma y certificación, anulación, consulta de NIT, identificador único por envío, reintentos                  | A3      | Factura certificada en sandbox con UUID, serie, número, XML y PDF guardados |
| Configuración del emisor: NIT, nombre, código de establecimiento, régimen ISR (frases), credenciales por ambiente, regla de Consumidor Final, momento de certificación | A3 + A4 | Pantalla completa; credenciales cifradas                                    |
| Cambiar "aviso de cobro" a "factura" en plantillas cuando el documento tiene UUID                                                                                      | A5      | El PDF muestra los datos FEL                                                |
| Pase a producción con INFILE y primera factura real                                                                                                                    | PM      | Factura real válida en el portal de la SAT                                  |
| **Fase 1 completa**                                                                                                                                                    | PM      | Viernes 20 de noviembre                                                     |

## Multiempresa (decisión del PM, 17 oct)

Varios NIT en una instalación: contabilidad separada por NIT, servicio → empresa, usuarios acotados por empresa y marca de la empresa en portal, avisos y documentos. Contrato en `.claude/integration/contratos/multiempresa.md`. Orden: A1 (modelo, contexto, ACL) → A3 (libro, cobros y reportes por empresa) + A4 (selector y CRUD) + A5 (portal por empresa) + A6 (notify e importación) → A2 si algún evento de red lo necesita.

## Localización fiscal (Guatemala)

Decisión del PM (17 oct): al elegir el país de una empresa se instala su localización versionada (plan de cuentas, impuestos, libros, cierres, tipos de DTE y calendario fiscal), con parámetros editables por empresa con vigencia y auditoría; FEL multiproveedor con modo obligatorio, opcional o desactivado; compras, libros legales con folio, cierre anual, bloqueos, declaraciones como borradores y tablero fiscal con comparador de regímenes. El sistema nunca presenta nada a la SAT ni cambia el régimen. Contrato en `.claude/integration/contratos/localizacion-fiscal.md`; los datos legales salen de la investigación del líder y lo no verificado queda marcado "confirmar con contador".

| Fase | PR                                                                                                                                                                        | Dueño        | Criterio                                                                      |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | ----------------------------------------------------------------------------- |
| 1    | `core.empresas.pais`, datos fiscales del cliente, permisos nuevos                                                                                                         | A1           | Empresas existentes en GT; ninguna prueba cambia                              |
| 2    | Módulo `fiscal`: paquete `gt-2026.1`, instalador, parámetros con vigencia, cuentas GT (tipo `patrimonio`), régimen, establecimientos y frases; pantallas de configuración | A3 + A4      | Instalar dos veces no agrega nada; un parámetro nuevo no cambia el pasado     |
| 3    | FEL: `ProveedorFel` con INFILE y proveedor falso, `fiscal.dte`, modos, cola, contingencia, consumidor final, anulación, NCRE y NDEB; PDF FEL en el portal                 | A3 + A4 + A5 | Reemplaza la semana 5: factura certificada en sandbox por el modo obligatorio |
| 4    | Proveedores, compras (también desde egresos), constancias de retención y retenciones en pagos; importación de compras                                                     | A3 + A4 + A6 | Libro de compras cuadra con `1.1.04`                                          |
| 5    | Libros con folio, bloqueos normal y duro, cierre anual con reserva legal                                                                                                  | A3 + A4      | Libros emitidos solo bajo bloqueo; cierre anual deja resultados en cero       |
| 6    | Calendario, declaraciones (IVA, ISR, ISO, PC, retenciones) y alertas de vencimiento                                                                                       | A3 + A4 + A6 | IVA del borrador = libro de ventas − libro de compras − retenciones           |
| 7    | Tablero fiscal, comparador de regímenes y consejos                                                                                                                        | A3 + A4      | Cada bloque muestra su error en lugar de un cero                              |

Decisión del PM (17 oct): **la contabilidad es el corazón del sistema y se entrega al 100 %**. Las 7 fases están en el alcance actual, ninguna pasa a fase 2. Cada fase lleva, además de sus pruebas, las del **auditor contable** (`apps/api/tests/contabilidad/`), un agente independiente de quien implementa: invariantes de todo el sistema (Debe = Haber por asiento y por empresa, saldo del cliente = auxiliar, CxC = facturas pendientes, libros = mayor, IVA del borrador = ventas − compras − retenciones, cierre anual deja resultados en cero, nada se edita en `ledger`). Una fase no se fusiona con un invariante en rojo. Antes de pasar una empresa a FEL obligatoria, el contador revisa la tabla "Confirmar con contador" del contrato.

## Programa de lealtad

Decisión del PM (17 oct): programa por empresa en el que los clientes ganan puntos o premios por pagar a tiempo, antigüedad, referidos y pago adelantado, y los canjean por descuentos en la factura, mejoras de plan temporales, premios del catálogo o boletos de sorteos. Puntos como indicador por defecto; cada empresa decide si los contabiliza como pasivo (NIIF 15) y fija su vencimiento (12 meses por defecto o sin vencimiento); sorteos con bases selladas, semilla con compromiso previo, algoritmo reproducible, acta y checklist legal que el usuario marca. Contrato en `.claude/integration/contratos/lealtad.md`.

| Fase | PR                                                                                               | Dueño             | Criterio                                                                                                       |
| ---- | ------------------------------------------------------------------------------------------------ | ----------------- | -------------------------------------------------------------------------------------------------------------- |
| 1    | Programa, reglas, movimientos por lotes, consumidor `lealtad`, vencimiento y asientos del pasivo | A3                | Un evento repetido no da puntos dos veces; `2.1.10` = valor de los lotes vivos                                 |
| 2    | Canjes: descuento en la factura, NCRE sobre factura emitida, plan temporal; pantallas y portal   | A3 + A1 + A4 + A5 | La factura lleva la línea de descuento con el IVA del neto; el plan temporal cambia la velocidad y vuelve solo |
| 3    | Sorteos: bases, corte, algoritmo `argos-sorteo-v1`, acta, checklist, ruleta y avisos             | A3 + A4 + A5 + A6 | El script de verificación reproduce los ganadores; sin checklist no se ejecuta                                 |

Depende de las fases 2 (cuentas) y 3 (NCRE en FEL) de la localización fiscal.

## Distribución e instalación (al cerrar los sprints)

Decisión del PM (17 oct): al terminar la fase 1, ArgosIsp se entrega como producto instalable, no como repositorio que se compila en cada servidor.

| Requisito                                        | Cómo                                                                                                                                                                                                                                                                                                            | Criterio                                                                 |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| **Imágenes ya compiladas**                       | CI construye y publica las imágenes (`api`, `web`, `portal`, `aaa`, `coa`, `backup`) en GitHub Container Registry, multi-arquitectura (amd64 y arm64), etiquetadas con la versión. El servidor solo descarga; nunca compila                                                                                     | Un servidor limpio levanta el sistema sin Node, pnpm ni código fuente    |
| **Autoinstalable**                               | Script `instalar.sh` (Ubuntu/Debian): verifica requisitos, instala Docker si falta, pide los datos mínimos (dominio, correo del admin, contraseñas generadas), escribe `.env`, descarga el `docker-compose` de la versión y levanta                                                                             | Un operador instala desde cero con un solo comando y sin editar archivos |
| **Actualización automática según sea necesario** | Comando `argosisp actualizar` (y opción de revisión periódica): compara la versión instalada con la última publicada, hace backup, descarga imágenes, corre migraciones, verifica salud y revierte a la versión anterior si falla. Canal `estable`; parches automáticos y cambios mayores solo con confirmación | Actualizar y revertir probados en CI con un backup real                  |
| **Versiones y cambios**                          | Versionado semántico (`MAYOR.MENOR.PARCHE`) a partir de Conventional Commits; `CHANGELOG.md` en español generado por versión y notas de la versión en GitHub Releases; el panel muestra la versión instalada y "qué cambió"                                                                                     | Cada versión publicada tiene etiqueta, imágenes y notas de cambios       |

## Fase 2 (después del 20 de noviembre, por prioridad)

1. SmartOLT: olt-gateway con interfaz genérica; autorizar ONU, señal, reinicio, habilitar/deshabilitar; catálogos en caché; ONU vinculada al servicio.
2. Horus: `GET /ip/{ip}` con prefijo más largo (IPv4 e IPv6), mapa completo, invalidaciones desde accounting, lectura de consumo por servicio, webhooks firmados.
3. WhatsApp como canal (API oficial o proveedor) y preferencia por cliente.
4. MCP e IA: tools `buscar_cliente`, `estado_cuenta`, `validar_servicio`, `crear_promesa_pago`, `crear_ticket`, `agendar_visita`; tokens por agente; promesas pendientes de aprobación; línea de tiempo del cliente.
5. Operaciones de campo: órdenes de trabajo (instalación, visita, retiro), agenda, técnicos, saga de instalación completada, tickets y departamentos.
6. Migraciones masivas entre routers: plan, vista previa con conflictos, lotes con pausas, verificación, reversión.
7. Contabilidad avanzada: estado de resultados, balance general, conciliación bancaria, centros de costo, exportación al software del contador. Notas de crédito NCRE en FEL.
8. Cobro: agentes y bancos externos, débito automático con tarjeta tokenizada. App de técnicos (PWA sin conexión). (El reuso 1:N pasó a la semana 2.)

## Riesgos

| Riesgo                                     | Mitigación                                                                                                                           |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| Seis agentes producen código inconsistente | Día 1 completo antes de arrancar; `.claude/CLAUDE.md` como ley; pruebas de integración como condición de merge; líderes leen cada PR |
| RADIUS inestable en producción             | Laboratorio desde el día 1; carga en semana 2; dos nodos `aaa` desde el piloto; runbook de failover a secrets locales del MikroTik   |
| Credenciales de INFILE o pasarela tarde    | Pedirlas el día 1; FEL ya está al final; la pasarela puede pasar a fase 2 sin tocar la fecha del 13                                  |
| Datos de Mikrowisp inconsistentes          | Dos importaciones en seco con reporte de diferencias antes de la real                                                                |
| Redirección HTTPS en página de corte       | Detección de portal cautivo del sistema operativo + enlace por correo y Telegram                                                     |
| Reglas de Consumidor Final cambian         | Regla configurable; confirmar con el contador en la semana 4                                                                         |
| Un líder con más de 3 agentes              | Pausar agentes antes que aprobar sin leer                                                                                            |
