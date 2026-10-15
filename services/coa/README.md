# @argosisp/coa

coa-dispatcher: consumirá `servicio.estado_cambiado` y `servicio.config_cambiada` (Redis Streams) y enviará CoA o Disconnect-Request al `nas_ip` de la sesión activa (UDP 3799, `/radius incoming` del MikroTik), registrando cada respuesta en `audit.red` y emitiendo `coa.fallido` tras 3 reintentos. Dueño: A2 (`.claude/agents/a2-radius.md`).

Hoy es el esqueleto del día 1: solo `GET /health` → 200 en el puerto 3200.

```
pnpm --filter @argosisp/coa dev
pnpm --filter @argosisp/coa test
docker build -f services/coa/Dockerfile .   # contexto = raíz del repo
```

Variables en `.env.example`. Qué atributos acepta el MikroTik por CoA y cómo probarlo con `radclient`: `infra/mikrotik/README.md`.
