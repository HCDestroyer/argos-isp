# Contrato: control de velocidad (simple queue, queue tree con PCQ y reuso)

Decisión del PM (día 4): el control de velocidad se configura **por router** y aplica igual a PPPoE y a WISP (`ip_estatica`, `dhcp_fija`). El plan define velocidades, garantía, ráfaga, prioridad y **reuso** (sobresuscripción `1:N`); ArgosIsp traduce eso a colas de RouterOS 7 con buenas prácticas.

## Datos

**Plan** (`network.planes`, además de lo que ya existe: `bajada_kbps`, `subida_kbps`, `*_limitada_kbps`, `reuso`):

| Campo | Significado | Por defecto |
| --- | --- | --- |
| `reuso` | N de `1:N`. 1 = dedicado; 4 = cuatro clientes comparten la capacidad de uno | 1 |
| `garantizado_pct` | CIR (`limit-at`) como % del MIR. Si no viene, se calcula como `100 / reuso` | `100 / reuso` |
| `rafaga_bajada_kbps`, `rafaga_subida_kbps` | `burst-limit`; null = sin ráfaga | null |
| `rafaga_umbral_pct` | `burst-threshold` como % del MIR | 75 |
| `rafaga_segundos` | `burst-time` | 16 |
| `prioridad` | 1 (alta) a 8 (baja) | 8 |

Las excepciones por router (`planes_routers`) pueden sobrescribir cualquiera de estos campos, igual que hoy.

**Router** (`network.routers`): `control_velocidad` = `simple` (por defecto) | `arbol_pcq`, más `capacidad_bajada_kbps` y `capacidad_subida_kbps` del enlace (techo de la cola padre global; null = sin techo).

## Modo `simple` (por defecto; hasta unos cientos de clientes por router)

- **Una cola simple por servicio**:
  - **PPPoE:** la dinámica que crea RouterOS con `Mikrotik-Rate-Limit` desde `aaa`.
  - **WISP:** estática, creada por el dispatcher de `contratos/routeros.md`.
- **Formato completo del rate-limit:** `rx/tx burst-rx/burst-tx umbral-rx/umbral-tx tiempo-rx/tiempo-tx prioridad limit-at-rx/limit-at-tx`. Lo calcula **una sola función compartida** en `apps/api/app/network/velocidad.ts` (A1), y la usan `aaa`, el endpoint interno y el dispatcher, para que PPPoE y WISP nunca difieran.
- **Reuso en este modo:** una cola padre por plan y router (`argosisp:plan:<plan_id>`) con `max-limit = MIR × servicios_activos / reuso`, y las colas de los servicios como hijas (`parent`).
  - **WISP:** el dispatcher fija `parent` en cada cola.
  - **PPPoE:** `aaa` manda `Mikrotik-Group = plan-<plan_id>`, y ese perfil PPP tiene `parent-queue` apuntando a la cola padre. ArgosIsp mantiene los perfiles y las colas padre por la API REST.
- **Recálculo del padre:** el `max-limit` del padre se recalcula **por evento** (`servicio.creado`, `servicio.estado_cambiado`, `servicio.config_cambiada` con plan o router, retiro), nunca por intervalo. Los suspendidos no cuentan.

## Modo `arbol_pcq` (recomendado para muchos clientes por router)

- **Árbol en `global`:**
  - Padre de descarga y padre de subida con la capacidad del enlace.
  - Debajo, un hijo por plan con `max-limit = MIR × activos / reuso` y `limit-at = CIR × activos`, más la `prioridad` del plan.
- **Tipos de cola PCQ por plan:** `argosisp-plan-<id>-bajada` (`pcq-classifier=dst-address`) y `-subida` (`src-address`), con `pcq-rate = MIR` del plan y `pcq-dst-address6-mask=64` / `pcq-src-address6-mask=64` para que IPv6 cuente por cliente y no por dirección. Con eso cada cliente tiene su tope y el reuso lo pone el padre.
- **Marcado:**
  - Address-list `argosisp-plan-<id>` con la IPv4, el /64 y el /56 de cada servicio activo del plan.
  - Reglas mangle (`mark-packet` sin `passthrough`) que usan esa lista como origen o como destino.
  - **WISP:** el dispatcher mantiene la lista con la API.
  - **PPPoE:** el dispatcher agrega o quita la entrada al recibir `sesion.iniciada` / `sesion.terminada` o `asignacion.cambiada`.
- **Estado limitado:** el servicio pasa a la lista del plan limitado `argosisp-plan-<id>-limitado`, con su propio PCQ a la velocidad limitada. Nunca se edita el PCQ del plan para un solo cliente.

## Buenas prácticas que aplica ArgosIsp (y documenta en `infra/mikrotik/README.md`)

- **FastTrack:** desactivado o excluido para el tráfico de clientes con colas. Con FastTrack las colas no se aplican; `lab.rsc` lo deja sin FastTrack para esas redes y lo verifica.
- **Colas simples:** pocas y en orden. Primero las padres por plan; ArgosIsp no deja colas sueltas sin `comment = argosisp:…`. Más de ~1000 colas simples en un router es una alerta del monitoreo y se recomienda `arbol_pcq`.
- **IPv6 incluido:** el `target` de las colas simples lleva la IPv4, el /64 y el /56; el árbol marca IPv6 con las mismas listas. Un cliente dual-stack nunca queda sin límite en IPv6.
- **Garantía coherente:** `limit-at` ≤ `max-limit`, y la suma de los `limit-at` de un padre ≤ el `max-limit` del padre. Si no se cumple, la acción responde 422 con el detalle.
- **Ráfaga sana:** `burst-threshold` < MIR < `burst-limit`.
- **Prioridades:** 1 a 8 según el plan. Corporativos con prioridad alta, residenciales con 8.
- **Cambios auditados e idempotentes:** cada escritura de cola, perfil, lista o mangle queda en `audit.red`; el reconciliador de `contratos/routeros.md` también corrige colas, listas y padres.
- **Cambio de modo de un router:** acción explícita `routers.cambiar_control_velocidad` con vista previa de lo que se crea y lo que se borra. Ejecuta por lotes y es reversible.
