# INTEGRATION.md — Dependencias entre agentes

Cada agente anota aquí lo que necesita de otro, con fecha. El PM lo revisa dos veces al día y asigna dueño. Se borra la línea cuando se resuelve.

| Fecha | Quién pide | A quién | Qué | Estado |
| --- | --- | --- | --- | --- |
| 2026-10-15 | Líder FE | A1 | Confirmar nombres de permisos `<recurso>.ver` del menú (`apps/web/app/utils/navegacion.ts`) contra el seed del ACL (`apps/api/database/seeders/acl_seeder.ts`) | Abierto |
| 2026-10-15 | Líder FE | A1 | Panel: llamar `POST /auth/logout` (ya existe) al cerrar sesión; hoy solo borra la cookie | Abierto |
| 2026-10-15 | Líder FE | A1, A4 | Exponer `Schema<'Servicio'>` con `estado` en el OpenAPI para reemplazar el tipo local `EstadoServicio` del panel | Abierto |
| 2026-10-15 | Líder FE | A5 | Reemplazar el tipo local `DatosCorte` de `useCorte.ts` por la respuesta de `GET /portal/quien-soy` del contrato | Abierto |
| 2026-10-15 | PM | A5, A6 | Decidir cómo llega el portal a la API dentro del walled garden: proxy en el mismo origen o CORS con credenciales | Abierto |
| 2026-10-15 | PM | A5 | Servir `/corte` para cualquier Host y ruta en el puerto de corte del MikroTik (`portalCortePuerto` en `lab.rsc`) | Abierto |
| 2026-10-15 | PM | A2 | Reactivar con Disconnect-Request, no con CoA: probado en RouterOS 7.24.5, CoA de reactivación deja IPv6 cortado. Suspender por CoA sí funciona (`Mikrotik-Address-List` + `Filter-Id="argos-corte.in"` + rate-limit). Ver `infra/mikrotik/README.md` | Abierto |
| 2026-10-15 | PM | A2, A5, A6 | Suspendido por IPv6 queda bloqueado pero no redirigido a `/corte` (TCP recibe reset). Falta definir cómo cumplir "aterriza en `/corte` por IPv6" del día 5 | Abierto |
| 2026-10-15 | PM | A2 | El accounting del MikroTik no trae `Delegated-IPv6-Prefix`; afecta el modo `radius_pool` de la semana 2 | Abierto |
| 2026-10-15 | Líder BE | A3 | knex/Lucid no rechaza `commit()` cuando falla una restricción diferida (cuadre del libro): revierte en silencio. `DomainAction` ya hace `SET CONSTRAINTS ALL IMMEDIATE`; fuera de una acción llamar `verificarRestriccionesDiferidas(trx)` | Abierto |
| 2026-10-15 | Líder BE | A1 | Relay de outbox, CRUD completo del ACL con alcances y tokens de API (tarea 2 y 10 de A1) | Abierto |
| 2026-10-15 | Líder BE | A6 | Cron mensual que llame `audit.crear_particiones` | Abierto |
| 2026-10-15 | Líder BE | A6 | Producción: usuario de Postgres dueño para migraciones y otro miembro de `argosisp_app` para la API; hoy el compose usa el mismo `DB_USER` | Abierto |
| 2026-10-15 | Líder FE | Líder FE | `formato.ts`, `fetchFixtures.ts` y `EstadoServicioBadge` están duplicados en web y portal; decidir si van a un paquete compartido en `packages/` | Abierto |
| 2026-10-15 | A6 | A1 | Relay del outbox: por cada evento llamar `ConsumidorNotify.procesar({ id, evento, payload, requestId })` (`apps/api/app/notify/consumidor.ts`, ejemplo en `app/notify/README.md`); reintentar si lanza. Si el relay define su propia interfaz de consumidor, mover `ConsumidorEventos`/`EventoEntrante` a `app/shared` | Abierto |
| 2026-10-15 | A6 | A3 | Agregar `comprobante.aprobado` y `comprobante.rechazado` al catálogo (`app/shared/eventos.ts`) con al menos `comprobante_id`, `pago_id`, `cliente_id` y `motivo` (rechazo). notify ya tiene plantillas y los acepta por prefijo | Abierto |
| 2026-10-15 | A6 | PM | Criterio "cliente con Telegram vinculado recibe el mismo aviso": implementado como canal preferido con fallback a correo (un aviso por evento, no ambos canales). Confirmar o pedir envío doble | Abierto |
| 2026-10-15 | A6 | Líder BE | Tarea 5 toca archivos compartidos (mínimo): `app/core/permisos.ts` (`notificaciones.ver`, `notificaciones.editar`; `ver` en soporte), `start/env.ts` (SMTP_*, TELEGRAM_*, NOTIFY_*, COLAS_PREFIJO), `start/routes/index.ts`, alias `#notify/*` en `package.json`, migraciones `1760910000001_notify_entrega` y `1760910000002_notify_recordatorios` (tarea 6), seeder `notify_plantillas_seeder`, comando `commands/notify_worker.ts` | Abierto |
| 2026-10-15 | A6 | A1 | Vincular Telegram: flujo del bot (`/start <código>`) que llene `core.clientes.telegram_chat_id` por una acción de A1 (`clientes.vincular_telegram`); A6 hace el webhook del bot si A1 expone la acción | Abierto |
