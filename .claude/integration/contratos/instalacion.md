# Contrato · Servicio pendiente de instalación

Este contrato cubre el pedido A1 de Iris (`contratos/iris.md` §5.1). Decisión del PM (28 oct): un servicio vendido desde Iris nace `pendiente_instalacion` y la facturación arranca el día en que se activa la instalación. Lo cumplen A1 (estado y acción), A2 (AAA y RouterOS), A3 (facturación y corte), A4 (panel) y A5 (portal). Cada uno se cambia en la misma PR que su código.

## 1. Estado

- Estados posibles: `pendiente_instalacion` → `activo` → `limitado` → `suspendido` → `retirado`. Desde `pendiente_instalacion` solo se puede pasar a `activo`, con `servicios.activar_instalacion`, o a `retirado`, con `servicios.retirar`, si la venta se cae.
- `evaluarEstadoServicio` **no** toca un servicio `pendiente_instalacion`: no tiene facturas, y ni el pago ni la promesa ni el corte lo mueven. La regla «única que decide el estado» sigue valiendo para los demás estados.
- `servicios.crear` acepta `estado_inicial: "activo" | "pendiente_instalacion"`, con `activo` por defecto. Así, todo lo que hoy crea servicios se comporta igual.
- Un servicio `pendiente_instalacion` ya tiene `user_ppp` y credenciales, router, plan e IP asignada (IPAM). El técnico configura el CPE con esos datos antes de activar.

## 2. Activar la instalación

`POST /api/v1/servicios/:id/activar-instalacion` con el permiso `servicios.activar_instalacion`, `Idempotency-Key` y `version`.

```
{ "version": 3, "instalado_en": "2026-11-03T15:20:00Z"?, "origen_tipo": "iris_orden"?, "origen_id": "…"?,
  "planta": { "caja": "…"?, "puerto": "…"?, "olt": "…"?, "slot": "…"?, "pon": "…"?, "potencia_dbm": "-19.40"? }? }
→ 200 Servicio (estado activo, instalado_en)
→ 409 version · 422 servicio_no_pendiente (estado distinto de pendiente_instalacion)
```

- **Efectos:**
    - pasa el servicio de `pendiente_instalacion` a `activo` y fija `core.servicios.instalado_en`, que es `instalado_en` o, si no viene, `now()`;
    - emite `servicio.estado_cambiado` con `de = pendiente_instalacion`, `a = activo` y `motivo = instalacion`;
    - refresca Redis AAA y RouterOS como cualquier cambio de estado.
- **Reintento:** con la misma `Idempotency-Key` devuelve la misma respuesta. Una clave nueva sobre un servicio ya activo devuelve 422 `servicio_no_pendiente` (se revisa antes que la `version`, así no llega un 409). Sin la cabecera: 400 `idempotency_key_requerida`.
- **Fecha:** `instalado_en` no puede ser futura ni anterior a la creación del servicio (422 en `instalado_en`). Se toleran 5 minutos de reloj adelantado; un instante dentro de esa tolerancia se guarda como la hora de Argos. Si `fecha_instalacion` estaba vacía, toma el día de `instalado_en` en Guatemala.
- **Permiso:** `servicios.activar_instalacion` lo tienen `admin`, `soporte` (que ya reactiva) y `tecnico` (que ya crea servicios e instala), y el usuario técnico «Iris».
- **Transiciones prohibidas:** sobre un pendiente, suspender, reactivar, limitar, quitar límite, desconectar, programar un plan temporal y la transición de `evaluarEstadoServicio` (`CambiarEstadoServicio`) responden 422 `servicio_pendiente_instalacion`. Editarlo (plan, router, IPs) y cambiarlo de empresa sí se puede.
- **Origen:** `origen_tipo` y `origen_id` quedan en la auditoría y en el evento, para enlazar con la orden de Iris.
- **Planta (pedido A9 de Iris, contrato 0.2.0):** `planta` es opcional y todos sus campos también. Los textos van hasta 100 caracteres y `potencia_dbm` es decimal (numeric(6,2), entre −60 y 10). Se guarda tal cual en `core.servicios.planta jsonb null` y se muestra en la ficha del servicio. Es solo una referencia de lectura: la planta de fibra vive en OZmap, que Iris integra, y Argos no la valida ni la recalcula.

## 3. Qué hace cada parte con un servicio pendiente

| Parte | Regla |
| --- | --- |
| AAA (A2) | El registro de Redis lleva `estado: "pendiente_instalacion"` y `aaa` responde **Access-Reject**, igual que con un servicio retirado. El servicio no navega aunque el CPE ya esté configurado. |
| RouterOS (A2) | `routeros.aplicar_servicio` y `routeros.reconciliar` no crean colas, amarres, leases ni address-list (tampoco entradas del árbol ni cuenta para el padre del plan) hasta que el servicio esté `activo`; el reconciliador borra lo que encuentre de un pendiente. Se crean con `servicio.estado_cambiado` (`motivo: instalacion`). `coa` acepta `de: pendiente_instalacion` (Disconnect si quedara una sesión; normalmente no hay). |
| Facturación (A3) | La generación por periodo omite los servicios pendientes. El primer periodo se cuenta desde `instalado_en`: con prorrateo, se prorratea desde ese día; en ciclo aniversario, el aniversario es `instalado_en`. Los cargos únicos sí se pueden emitir mientras está pendiente (por ejemplo, el cobro de instalación anticipado) y pagarlos no mueve el estado (`ServicioEvaluado` del pago lo trae con `estado: pendiente_instalacion`). Regla exacta (`inicioFacturacionSql`): activado desde pendiente (`instalado_en > created_at`) → día de `instalado_en` en Guatemala, aunque `fecha_instalacion` tenga otra fecha prevista; nacido activo (`instalado_en = created_at`) → `fecha_instalacion` o el día de alta, como siempre. |
| Corte, mora y recordatorios (A3/A6) | No aplican mientras está pendiente. A3: el corte no lo evalúa y `vencerFacturas` no vence ni pone mora a sus facturas (sin `factura.vencida`); al activarse, una factura emitida mientras estaba pendiente (`emitida_en < instalado_en`, p. ej. el cobro de instalación anticipado) vence, para el vencimiento, la mora y el corte, en `max(vence_en, día de instalado_en en Guatemala + dias_gracia)` (decisión del líder, 28 oct: instalar nunca limita el servicio el mismo día; `venceEfectivoSql` de `app/billing/vencimiento.ts`). El documento no cambia: `vence_en`, lo certificado por FEL y el `vence` de `factura.vencida` quedan como se emitieron. Las facturas emitidas después de activar vencen en su `vence_en`. A6: los recordatorios (`ProgramarRecordatorios`) deben omitir las facturas de un servicio pendiente. |
| Promesas (A3) | No se pueden crear sobre un pendiente: `CrearPromesaPago` (`POST /promesas`), `POST /promesas/simular` y `limitesPromesa` (portal) responden 422 `servicio_pendiente_instalacion` (`E_SERVICIO_PENDIENTE_INSTALACION`). |
| Panel (A4) | Muestra el estado «Pendiente de instalación» con icono y texto, el botón «Activar instalación» (con su permiso) y el filtro por estado. |
| Portal (A5) | El cliente ve «Instalación pendiente» y sus cargos únicos, sin corte ni velocidad. |
| Iris | Llama a la activación cuando cierra la orden de instalación con éxito (`Idempotency-Key = iris:instalacion:<orden_id>`). |

## 4. Migración

- **Columnas nuevas:** `core.servicios.instalado_en timestamptz null` y `core.servicios.planta jsonb null` (A9).
- **Servicios existentes:** se rellena con la fecha en que se creó cada uno, así que nada cambia para ellos.
- **Constraint de `estado`:** suma `pendiente_instalacion`.
- **Valor por defecto** de `instalado_en`: `now()`, así quien inserta un servicio activo no cambia; `servicios.crear` lo deja en null solo para un pendiente. CHECK `servicios_pendiente_sin_instalar`: un pendiente nunca tiene `instalado_en`.
- **OpenAPI:** `EstadoServicio` suma `pendiente_instalacion` y `Servicio.instalado_en` (date-time o null) es obligatorio. Los tipos de `packages/contracts` cambian: A4 y A5 deben cubrir el estado nuevo en sus `Record<EstadoServicio, …>` y sus fixtures de `Servicio`.
