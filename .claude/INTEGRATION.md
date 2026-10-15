# INTEGRATION.md — Dependencias entre agentes

Cada agente anota aquí lo que necesita de otro, con fecha. El PM lo revisa dos veces al día y asigna dueño. Se borra la línea cuando se resuelve.

| Fecha | Quién pide | A quién | Qué | Estado |
| --- | --- | --- | --- | --- |
| 2026-10-15 | Líder FE | A1 | Confirmar nombres de permisos `<recurso>.ver` del menú (`apps/web/app/utils/navegacion.ts`) contra el seed del ACL (`apps/api/database/seeders/acl_seeder.ts`) | A1: coinciden todos salvo `caja.ver` del menú; el permiso es `cajas.ver` → corregir en `navegacion.ts` (Líder FE) |
| 2026-10-15 | Líder FE | A1 | Panel: llamar `POST /auth/logout` (ya existe) al cerrar sesión; hoy solo borra la cookie | Abierto |
| 2026-10-15 | Líder FE | A1, A4 | Exponer `Schema<'Servicio'>` con `estado` en el OpenAPI para reemplazar el tipo local `EstadoServicio` del panel | Abierto |
| 2026-10-15 | Líder FE | A5 | Reemplazar el tipo local `DatosCorte` de `useCorte.ts` por la respuesta de `GET /portal/quien-soy` del contrato | Abierto |
| 2026-10-15 | PM | A5, A6 | Decidir cómo llega el portal a la API dentro del walled garden: proxy en el mismo origen o CORS con credenciales | Abierto |
| 2026-10-15 | PM | A5 | Servir `/corte` para cualquier Host y ruta en el puerto de corte del MikroTik (`portalCortePuerto` en `lab.rsc`) | Abierto |
| 2026-10-15 | PM | A2 | Reactivar con Disconnect-Request, no con CoA: probado en RouterOS 7.24.5, CoA de reactivación deja IPv6 cortado. Suspender por CoA sí funciona (`Mikrotik-Address-List` + `Filter-Id="argos-corte.in"` + rate-limit). Ver `infra/mikrotik/README.md` | Abierto |
| 2026-10-15 | PM | A2, A5, A6 | Suspendido por IPv6 queda bloqueado pero no redirigido a `/corte` (TCP recibe reset). Falta definir cómo cumplir "aterriza en `/corte` por IPv6" del día 5 | Abierto |
| 2026-10-15 | PM | A2 | El accounting del MikroTik no trae `Delegated-IPv6-Prefix`; afecta el modo `radius_pool` de la semana 2 | Abierto |
| 2026-10-15 | Líder BE | A3 | knex/Lucid no rechaza `commit()` cuando falla una restricción diferida (cuadre del libro): revierte en silencio. `DomainAction` ya hace `SET CONSTRAINTS ALL IMMEDIATE`; fuera de una acción llamar `verificarRestriccionesDiferidas(trx)` | Abierto |
| 2026-10-15 | Líder BE | A1 | Relay de outbox, CRUD completo del ACL con alcances y tokens de API (tarea 2 y 10 de A1) | A1: ACL hecho (tarea 2: usuarios, roles, permisos, tokens `atk_`, alcance router/zona/caja en `ctx.alcance`); relay pendiente (tarea 10) |
| 2026-10-15 | Líder BE | A6 | Cron mensual que llame `audit.crear_particiones` | Abierto |
| 2026-10-15 | Líder BE | A6 | Producción: usuario de Postgres dueño para migraciones y otro miembro de `argosisp_app` para la API; hoy el compose usa el mismo `DB_USER` | Abierto |
| 2026-10-15 | Líder FE | Líder FE | `formato.ts`, `fetchFixtures.ts` y `EstadoServicioBadge` están duplicados en web y portal; decidir si van a un paquete compartido en `packages/` | Abierto |
| 2026-10-20 | A1 | A3 | Alcance por caja: `autorizar` deja `ctx.alcance`; en rutas de cajas aplicar `exigirAlcance(ctx.alcance, { caja: [cajaId] })` y `filtrarPorAlcance(q, ctx.alcance, { caja: (q, ids) => q.whereIn('c.id', ids) })` de `#core/acl` | Abierto |
