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
- **Reintento:** con la misma `Idempotency-Key` devuelve la misma respuesta. Una clave nueva sobre un servicio ya activo devuelve 422 `servicio_no_pendiente`.
- **Fecha:** `instalado_en` no puede ser futura ni anterior a la creación del servicio (422).
- **Origen:** `origen_tipo` y `origen_id` quedan en la auditoría y en el evento, para enlazar con la orden de Iris.
- **Planta (pedido A9 de Iris, contrato 0.2.0):** `planta` es opcional y todos sus campos también. Los textos van hasta 100 caracteres y `potencia_dbm` es decimal (numeric(6,2), entre −60 y 10). Se guarda tal cual en `core.servicios.planta jsonb null` y se muestra en la ficha del servicio. Es solo una referencia de lectura: la planta de fibra vive en OZmap, que Iris integra, y Argos no la valida ni la recalcula.

## 3. Qué hace cada parte con un servicio pendiente

| Parte | Regla |
| --- | --- |
| AAA (A2) | El registro de Redis lleva `estado: "pendiente_instalacion"` y `aaa` responde **Access-Reject**, igual que con un servicio retirado. El servicio no navega aunque el CPE ya esté configurado. |
| RouterOS (A2) | `routeros.aplicar_servicio` no crea colas, amarres ni address-list hasta que el servicio esté `activo`. |
| Facturación (A3) | La generación por periodo omite los servicios pendientes. El primer periodo se cuenta desde `instalado_en`: con prorrateo, se prorratea desde ese día; en ciclo aniversario, el aniversario es `instalado_en`. Los cargos únicos sí se pueden emitir mientras está pendiente (por ejemplo, el cobro de instalación anticipado). |
| Corte, mora y recordatorios (A3/A6) | No aplican mientras está pendiente. |
| Promesas (A3) | No se pueden crear sobre un pendiente (422). |
| Panel (A4) | Muestra el estado «Pendiente de instalación» con icono y texto, el botón «Activar instalación» (con su permiso) y el filtro por estado. |
| Portal (A5) | El cliente ve «Instalación pendiente» y sus cargos únicos, sin corte ni velocidad. |
| Iris | Llama a la activación cuando cierra la orden de instalación con éxito (`Idempotency-Key = iris:instalacion:<orden_id>`). |

## 4. Migración

- **Columnas nuevas:** `core.servicios.instalado_en timestamptz null` y `core.servicios.planta jsonb null` (A9).
- **Servicios existentes:** se rellena con la fecha en que se creó cada uno, así que nada cambia para ellos.
- **Constraint de `estado`:** suma `pendiente_instalacion`.
