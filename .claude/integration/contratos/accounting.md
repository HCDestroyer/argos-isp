# Contrato accounting: `aaa` → `sesiones:worker`

Lo expone A2 (los dos extremos son suyos). Interesa a A6 (compose) y a quien lea `network.sesiones` (A4, A5). Cambios: en `a2.md` y en la misma PR que el código.

## Cola

- BullMQ, cola **`aaa-accounting`**, prefijo `COLAS_PREFIJO` (por defecto `argosisp`), mismo Redis (`REDIS_HOST`, `REDIS_PORT`, base `REDIS_DB` de `aaa` = base 0 de la API).
- Productor: `services/aaa` (`POST /aaa/accounting`, `src/accounting.ts`). Responde 204 al encolar; 503 si no pudo (FreeRADIUS no contesta Accounting-Response y el NAS reintenta).
- Consumidor: `node ace sesiones:worker` en `apps/api` (`app/network/sesiones/cola.ts`), un proceso aparte en el compose.
- Opciones del job: `attempts: 8`, backoff exponencial desde 1 s, `removeOnComplete` 1 h / 10 000, `removeOnFail` 7 días. Nombre del job = `tipo`.

## Datos del job

```json
{
  "tipo": "Start",
  "nas_ip": "192.0.2.1",
  "acct_session_id": "81a00003",
  "user_ppp": "cliente-101",
  "ipv4": "10.10.1.10",
  "prefijo_enlace_v6": "2001:db8:101:1::/64",
  "prefijo_delegado_v6": null,
  "bytes_in": "0",
  "bytes_out": "0",
  "duracion_s": null,
  "causa_fin": null,
  "evento_en": "2026-10-15T20:00:00.000Z"
}
```

| Campo | Origen RADIUS |
| --- | --- |
| `tipo` | `Acct-Status-Type`: `Start`, `Interim-Update`, `Stop`, `Accounting-On`, `Accounting-Off` (otros se descartan con 204) |
| `nas_ip` | `NAS-IP-Address` (o `NAS-IPv6-Address`) |
| `acct_session_id`, `user_ppp` | `Acct-Session-Id`, `User-Name`; `""` en Accounting-On/Off |
| `ipv4` | `Framed-IP-Address` (null si no es IPv4) |
| `prefijo_enlace_v6` | `Framed-IPv6-Prefix` |
| `prefijo_delegado_v6` | `Delegated-IPv6-Prefix` (RouterOS 7.24.5 no lo manda: el worker usa la asignación vigente en modo `radius_servicio`) |
| `bytes_in` / `bytes_out` | `Acct-Input-Octets` + `Acct-Input-Gigawords`·2³² / `Acct-Output-*`, texto decimal |
| `duracion_s` | `Acct-Session-Time` |
| `causa_fin` | `Acct-Terminate-Cause` (solo Stop) |
| `evento_en` | `Event-Timestamp`, o recepción en `aaa` − `Acct-Delay-Time` (ISO 8601 UTC) |
