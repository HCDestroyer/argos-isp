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
| 2026-10-15 | A5 | Líder FE | `DatosCorte` reemplazado por `Schema<'QuienSoy'>` del contrato en `useCorte()` (tarea 1). Puede cerrarse la fila del Líder FE | Resuelto (A5) |
| 2026-10-15 | A5 | A6, PM | Decisión acceso portal → API: **proxy en el mismo origen**. El navegador llama a `/api/v1/portal/**` del portal y Nitro reenvía a `NUXT_API_BASE_INTERNAL` con `X-Forwarded-For` (solo ese prefijo; el resto de la API no se expone). En `infra/docker-compose.yml`: `NUXT_PUBLIC_API_BASE` vacío (hoy toma `API_PUBLIC_URL`), `NUXT_API_BASE_INTERNAL=http://api:3333`. Sin CORS ni API en el walled garden. Ver `apps/portal/README.md` | Abierto (A6: compose) |
| 2026-10-15 | A5 | A6 | Publicar el puerto del portal conservando la IP real del cliente (dst-nat del MikroTik + iptables de Docker; sin `userland-proxy`, que en IPv6 la reemplaza por la del puente, o `network_mode: host`). Sin eso `quien-soy` no identifica a nadie | Abierto |
| 2026-10-15 | A5 | A6 | `/corte` para cualquier Host y ruta ya está en el portal (tarea 2, `server/middleware/portal-cautivo.ts`): pruebas de conectividad de Android/Apple/Windows/Firefox/Linux y Hosts ajenos → 302 a `/corte`. En compose/lab: `NUXT_PORTAL_URL_PUBLICA=http://<portalFqdn>`, `NUXT_PORTAL_HOSTS=<portalV4>,<portalV6>` y `PORTAL_PORT_HOST=<portalCortePuerto>` (80) hacia el 3001 del contenedor. Cierra la fila del PM sobre `portalCortePuerto` | Abierto (A6: compose) |
| 2026-10-15 | A5 | A6 | Walled garden del portal hoy: solo el propio portal (`portalFqdn`, `portalV4`, `portalV6`) y DNS. Sin fuentes, iconos ni CDNs externos (verificado con Playwright: 0 peticiones fuera del host). La pasarela de pago se agrega en la semana 2. Quitar `pagos.argosisp.example` y `pasarela.example` de `walledGarden` en `lab.rsc` hasta entonces | Abierto |
| 2026-10-15 | A5 | A1 | `GET /ip/{ip}`: hoy `portal.quien_soy` (`apps/api/app/portal/actions/identificar_por_ip.ts`) resuelve la IP contra `network.sesiones` activas (ipv4, `prefijo_enlace_v6`/`prefijo_delegado_v6` por contención) y asignaciones vigentes IPv4/IPv6. Cuando A1 publique la acción, el portal la llama y se borra `resolverServicio` | Abierto |
| 2026-10-15 | A5 | Líder BE | Agregar a `apps/api/start/env.ts` y `.env.example`: `PORTAL_PROXIES_CONFIABLES` (IPs/CIDR del portal y proxies delante; vacía = ignora `X-Forwarded-For`) y `PORTAL_CABECERA_IP` (defecto `x-forwarded-for`). Hoy se leen de `process.env` en `app/portal/ip_origen.ts`. Las pruebas viven en `apps/api/tests/portal/` (el glob de Japa solo mira `tests/`) | Abierto |
| 2026-10-15 | A5 | A6 | Compose: `PORTAL_PROXIES_CONFIABLES` de la API = red del contenedor del portal (y del proxy inverso si hay). Sin esa variable `quien-soy` ve la IP del portal y no identifica a nadie | Abierto |
| 2026-10-15 | A5 | A1, Líder BE | `GET /portal/quien-soy` es público y sin límite de tasa; proponer rate limit por IP (middleware compartido) antes del piloto | Abierto |
