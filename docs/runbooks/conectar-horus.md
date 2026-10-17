# Runbook · Conectar Argos con Horus Flow

Contrato: `.claude/integration/contratos/horus.md`. Código: `apps/api/app/integraciones/horus`.
Argos funciona igual sin Horus: si algo falla aquí, ni RADIUS, ni la facturación ni el corte se
enteran.

## Antes de empezar

1. `API_PUBLIC_URL` en `infra/.env` es la URL **https** con la que Horus llega a la API de Argos
   (receptor de webhooks y enlace de conexión). Reinicia `api` si la cambias.
2. El servicio `horus-worker` corre (`docker compose ps horus-worker`).
3. Laboratorio sin TLS: `HORUS_PERMITIR_HTTP=true` en `infra/.env`. **Nunca** en producción.
4. Necesitas un usuario con rol `admin` en Argos y un administrador de Horus.

## Opción A · Enlace de conexión (recomendada)

Un solo paste: cada lado emite su token y su secreto y se los intercambian de servidor a servidor.

### A1. El enlace sale de Argos

1. Argos → Configuración → Integraciones → Horus → **Generar enlace de conexión**. Copia el enlace
   `https://<argos>/conectar#…`; vence en **15 min** y sirve **una vez**. No se vuelve a mostrar.
2. Horus → Administración → Integraciones → ArgosISP → **Conectar con enlace** → pega el enlace.
3. En Argos, recarga la pantalla: URL de Horus, `hf_pat_` (`***`), receptor de Horus y secretos ya
   están. El conector sigue **apagado**.
4. Si Horus dice "enlace vencido" (410): genera otro.

### A2. El enlace sale de Horus

1. Horus → **Generar enlace de conexión**. Copia `https://<horus>/conectar#…`.
2. Argos → Integraciones → Horus → **Conectar con enlace de Horus** → pega el enlace.
3. Si Argos responde `enlace_vencido`, genera otro en Horus. Si responde `horus_error`, el
   mensaje es el error real de Horus (red, TLS, 4xx/5xx) y no se guardó nada.

## Opción B · Manual

1. En Horus genera el código de conexión (`hf_pat_…`, plantilla ArgosISP, con `sso.issue` si
   quieres "Ver en Horus") y copia la URL de su receptor y su secreto.
2. En Argos (Integraciones → Horus) pega: URL base de Horus, código `hf_pat_`, URL del receptor de
   Horus y su secreto. Guarda.
3. El primer guardado muestra **una sola vez** el secreto del receptor de Argos y su URL
   (`<API_PUBLIC_URL>/api/v1/integraciones/horus/webhook`): pégalos en Horus (canal `webhook`).
   Si lo pierdes: **Regenerar secreto** y vuelve a pegarlo en Horus.
4. En Argos → Integraciones → Horus → Tokens genera el token `atk_` de Horus
   (`POST /integraciones/horus/tokens`, permiso `horus.generar_token`; o `node ace
   integraciones:horus-token`): usuario técnico `horus@integraciones.argosisp.local`, rol
   `integracion_horus` (`ip.resolver`, `clientes.ver`, `servicios.ver`, `sso.emitir`). Pégalo en Horus.

## Encender y verificar

1. **Probar conexión**: debe decir `ok`. Si no, el mensaje es el error real:
   - `ECONNREFUSED` / `ENOTFOUND`: URL o red; `Horus respondió 401`: código revocado o vencido.
   - `webhook: HTTP 401`: el secreto del receptor de Horus no coincide.
2. Enciende el interruptor y guarda.
3. Abre la ficha de un servicio activo: el bloque Horus muestra consumo, salud y seguridad, sin
   la marca "desactualizado".
4. Suspende y reactiva un servicio de prueba: en Integraciones → Horus → Envíos aparecen dos
   `servicio.estado_cambiado` en `enviado`.
5. En Horus, "Enviar prueba" del canal webhook: en Recibidos aparece un `test` procesado.

## Problemas

| Síntoma | Qué mirar |
| --- | --- |
| La ficha dice "desactualizado" | `salud` del conector: `ultimo_error` y `pausa_hasta`. Argos reintenta solo, con espera hasta 15 min. Nada que hacer en Argos si Horus está caído |
| Envíos en `pendiente` con `HTTP 401` | Secreto del receptor de Horus cambiado: pega el nuevo. Los pendientes se reintentan solos (1 min, 5 min, 30 min, 2 h, 12 h) |
| Envíos `fallido` | Pasaron los 5 reintentos. Horus se resincroniza con su barrido de 6 h; no hace falta reenviar |
| Envíos `descartado` | Estaban pendientes cuando se apagó el conector |
| Horus recibe 401 `firma_invalida` | El secreto de Argos en Horus no es el actual (¿se regeneró?) |
| Horus recibe 401 `timestamp_fuera_de_ventana` | Relojes desfasados más de 5 min: NTP en ambos servidores |
| Horus recibe 503 `horus_apagado` | El conector de Argos está apagado |
| "Ver en Horus" responde `horus_error` | El `hf_pat_` no tiene `sso.issue` o Horus aún no tiene §1.5 |

## Desconectar

Apaga el interruptor (deja de llamar, de enviar y de aceptar webhooks). Para cortar del todo:
revoca el token `atk_` de Horus en Argos (Integraciones → Horus → Tokens, `horus.revocar_token`) y el `hf_pat_` en Horus.
