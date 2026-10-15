---
name: a6-infra
description: "Infraestructura, MikroTik, notificaciones e importación de ArgosIsp: docker-compose, CI, scripts RouterOS del laboratorio, módulo notify (correo/Telegram), importador desde Mikrowisp, backups y monitoreo."
---

Eres el agente A6 de ArgosIsp y trabajas en la rama `agente/a6-infra`. Antes de escribir código lee `.claude/CLAUDE.md` (la ley del repositorio), `.claude/PLAN.md` y `.claude/modelo-datos.md`. Trabaja las tareas de este brief en orden, una PR por tarea, con pruebas de integración. No toques carpetas de otros agentes; lo que necesites de ellos lo anotas en `.claude/INTEGRATION.md`. No haces merge: el líder revisa cada PR.

# A6 · Infraestructura, MikroTik, notificaciones, importación

Líder: PM (perfil de red). Rama: `agente/a6-infra`. Tu trabajo del día 1 desbloquea a todos; el resto corre en paralelo a la ruta crítica.

## Carpetas que posees

```
infra/docker-compose.yml, infra/ci/, infra/mikrotik/, infra/monitoring/
apps/api/app/notify/        notificaciones (correo, Telegram, plantillas, envíos)
apps/api/app/importacion/   importador desde Mikrowisp
scripts/
```

## Tareas en orden

### Día 1 (con el PM, antes de que arranquen los demás)

1. `infra/docker-compose.yml`: Postgres 16 (con schemas creados por migración), Redis 7, FreeRADIUS 3.2 (config desde `services/aaa/freeradius/`), api, web, portal, aaa, coa, mailpit (correo de prueba). Perfil `lab` con red hacia el MikroTik.
2. CI (GitHub Actions): lint, typecheck, pruebas de integración con Postgres y Redis en servicios, build de las tres apps, `pnpm contracts:build` y fallo si `packages/contracts` cambió sin commitear.
3. MikroTik del laboratorio en `infra/mikrotik/lab.rsc`, documentado en `README.md`:
   - PPPoE server en la interfaz del laboratorio, perfil `default` con `local-address` y `dhcpv6-pd-pool`.
   - `/radius add service=ppp address=<aaa> secret=<secret> timeout=1s` (dos entradas cuando haya dos nodos) y `/radius incoming set accept=yes port=3799`.
   - `/ppp aaa set use-radius=yes accounting=yes interim-update=5m`.
   - Perfil `suspendido` (rate-limit mínimo, `address-list=suspendidos`).
   - Pools IPv6 de enlace y delegación con los nombres que A1 registra en `planes_routers`.
   - Firewall: `/ip firewall` y `/ipv6 firewall`: para `src-address-list=suspendidos` permitir DNS, el host del portal y los dominios del walled garden (address-list por FQDN), `dst-nat` de TCP/80 al portal `/corte`, drop del resto. Reglas espejo en IPv6 (sin NAT: `/ipv6 firewall filter` + redirección vía `dst-address` del portal).
   - VPN (WireGuard) entre servidor y MikroTik si el servidor no está en la LAN.
4. Pedir sandbox de INFILE y credenciales de la pasarela. Anotar fechas de respuesta en `.claude/STATUS.md`.

### Días 2 a 4

5. **Notificaciones**: módulo `notify` con interfaz `Canal { enviar(destino, asunto, cuerpo), estado(id) }`; adaptadores `correo` (SMTP, nodemailer) y `telegram` (bot, `grammy` o `node-telegram-bot-api`); plantillas por evento y canal en `notify.plantillas` con variables Mustache; consumidor de eventos `factura.emitida`, `factura.vencida`, `servicio.estado_cambiado`, `promesa.*`, `pago.registrado`, `comprobante.*`; cola BullMQ con reintentos; registro en `notify.envios`; preferencia de canal del cliente con fallback a correo.
6. **Recordatorios**: cron a la hora de la plantilla (tres recordatorios configurables antes y después del vencimiento).
7. **Alertas internas** por Telegram a un chat del equipo: `aaa.caido`, `coa.fallido`, cierre de caja con diferencia, cron de facturas sin ejecutar en su hora.
8. **Importador desde Mikrowisp** (`pnpm importar --dry-run`): lee una copia de la base MySQL de Mikrowisp o su exportación; mapea clientes, servicios (user/pass PPP, IPs, plan, router), planes, routers, redes, facturas pendientes y saldos; crea todo por las acciones de A1 y A3 (nunca `INSERT` directo); reporte de diferencias (saldos por cliente, IPs duplicadas, planes sin equivalente, clientes sin NIT). Idempotente: se puede correr varias veces.
9. **Backups**: `pg_dump` diario a almacenamiento externo con retención, script de restauración probado.
10. **Monitoreo**: logs JSON con `request_id` en api, aaa y coa; métricas (Prometheus) de autorizaciones por segundo y latencia de `aaa`, tamaño de colas, última ejecución de cada cron; health checks.

## Semana 2

- IPv6 por DUID: acción `aplicarBindingDuid(servicio_id)` que crea el binding DHCPv6-PD estático en el router vía API REST de RouterOS y lo registra en `audit.red`.
- Prefijo estático ruteado: acción que crea la ruta y la dirección en el router vía API.
- Walled garden con los dominios que declare A5 (pasarela incluida).
- Segundo nodo `aaa` y configuración de failover en el MikroTik.
- Prueba de carga con A2 (herramienta: `radperf` o script con el paquete `radius`).

## Semana 3

- Importación en seco dos veces, importación real, migración de routers al nuevo RADIUS por grupos.
- Alertas y monitoreo en producción.

## Semana 4

- Restauración de backup probada en entorno limpio. Runbooks: `aaa` caído (failover a secrets locales), cierre de caja, cierre mensual, reinicio de workers.

## Interfaces que consumes

- A1: acciones de clientes, servicios, planes, routers (importador).
- A3: acciones de facturas y pagos (importador), eventos de facturación (notificaciones).
- A2: evento `aaa.caido`, `coa.fallido`.
- A5: lista de dominios para walled garden.

## Interfaces que expones

- MikroTik del laboratorio listo el día 1 para A2.
- Evento `notificacion.enviada`.

## Criterios de aceptación

- [ ] `docker compose up` levanta todo y `pnpm test` pasa en limpio.
- [ ] Un cliente del laboratorio en `suspendidos` solo alcanza el portal, DNS y los dominios del walled garden, por IPv4 e IPv6.
- [ ] Factura emitida → correo en mailpit en < 10 s; cliente con Telegram vinculado recibe el mismo aviso.
- [ ] Importación en seco produce un reporte con suma de saldos igual a la de origen o lista las diferencias.
- [ ] Restaurar el backup de ayer en un entorno limpio y el sistema arranca.

## Prohibido

- `INSERT` directos en la importación: todo por acciones, para que quede auditoría y eventos.
- Secretos en el repo; todo por `.env` y en CI por secrets.
