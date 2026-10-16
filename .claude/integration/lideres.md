# Pedidos de los líderes y del PM

| Fecha | Quién | A quién | Qué | Estado |
| --- | --- | --- | --- | --- |
| 2026-10-15 | PM | A2 | Reactivar con **Disconnect-Request**, no con CoA: probado en RouterOS 7.24.5, un CoA de reactivación deja IPv6 cortado. Suspender por CoA sí funciona (`Mikrotik-Address-List=suspendidos` + `Filter-Id="argos-corte.in"` + rate-limit). Detalle en `infra/mikrotik/README.md` | Abierto (día 3) |
| 2026-10-15 | PM | A2, A5, A6 | Un suspendido por IPv6 queda bloqueado pero no llega a `/corte` (TCP recibe reset). Criterio del día 5: "aterriza en `/corte` por IPv6". Proponer y probar la solución en `lab.rsc` | Abierto |
| 2026-10-15 | PM | A2 | El accounting del MikroTik no trae `Delegated-IPv6-Prefix`; afecta el modo `radius_pool` (semana 2) | Abierto |
| 2026-10-15 | Líder BE | A6 | Cron mensual que llame `audit.crear_particiones` | Abierto |
| 2026-10-15 | Líder BE | A6 | Producción: un usuario de Postgres dueño para migraciones y otro miembro de `argosisp_app` para la API; hoy el compose usa el mismo `DB_USER` | Abierto |
| 2026-10-15 | Líder BE | A5 | `GET /portal/quien-soy` es público: límite de peticiones por IP antes del piloto | Abierto (día 3) |
| 2026-10-15 | Líder FE | Líder FE | `formato.ts`, `fetchFixtures.ts` y `EstadoServicioBadge` están duplicados en web y portal; decidir si van a `packages/` | Abierto |
| 2026-10-15 | Líder FE | A4 | **Fallo (captura 06):** con `GET /clientes/:id/estado-cuenta` en error, la pestaña muestra igual "Saldo Q 0.00 · Al día". Con error no se muestran totales ni tablas, solo el aviso y "Reintentar" | Abierto (día 3) |
| 2026-10-15 | Líder FE | A4, A5 | **Fallo (captura 07):** la línea de tiempo del cliente se llena de `portal.quien_soy` (una por cada visita a `/corte`) y muestra el nombre técnico de la acción. El panel oculta las lecturas del portal y traduce los nombres de acción; A1 agrega `actor_nombre` (fila de A4 en `a4.md`) | Abierto (día 3) |
| 2026-10-15 | Líder FE | A5 | **Fallo (captura 13):** "Pagar en línea" está deshabilitado pero se ve activo (azul). Debe verse apagado hasta la semana 2 | Abierto (día 3) |
| 2026-10-15 | PM | A1, A4 | Filtros avanzados de clientes y servicios: router, estado del servicio (activo, limitado, **cortado** = suspendido, retirado), plan, zona, con deuda vencida, con promesa activa | Abierto (día 3) |
| 2026-10-15 | PM | A3, A4 | **Cobro rápido** (tipo caja, más simple): buscar cliente → ver pendiente → monto, método y referencia → registrar → recibo. Debe reactivar el servicio por evento | Abierto (día 3) |
| 2026-10-16 | PM | A1, A2, A4, A6 | **WISP sin PPPoE** (semana 2): tipos de conexión `ip_estatica` y `dhcp_fija` además de `pppoe`; control por API REST de RouterOS (cola simple, address-list `suspendidos`, lease DHCP); amarre IP-MAC opcional por servicio. Contrato en `contratos/routeros.md` | Abierto (semana 2) |
| 2026-10-16 | PM | A1, A2, A4, A6 | **Control de velocidad** (semana 2): por router `simple` o `arbol_pcq` (queue tree + PCQ), reuso 1:N por plan, CIR/MIR, ráfaga, prioridad, IPv6 y buenas prácticas de RouterOS. Contrato en `contratos/velocidad.md` | Abierto (semana 2) |
