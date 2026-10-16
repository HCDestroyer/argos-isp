# Contrato · Evaluación de promesas de pago (A3)

Lo exponen `POST /promesas` (en `Promesa.resultado_evaluacion`) y `POST /promesas/simular` (`SimulacionPromesa`). Lo leen el panel (A4: pantalla de promesas y simulador) y el portal (A5: motivo para el cliente). La fuente es `evaluarReglas` en `apps/api/app/billing/promesas.ts`; el simulador usa la misma función en modo completo.

## `resultado_evaluacion` (promesa guardada)

```json
{
    "resultado": "aprobada | rechazada | pendiente_aprobacion",
    "regla": "plazo_max_dias",
    "motivo": "Vence en 10 días; el máximo es 5 días",
    "canal": "operador",
    "evaluada_en": "2026-10-16T15:00:00.000Z",
    "reglas": [
        { "regla": "habilitadas", "ok": true, "valor": null, "limite": true, "origen": "general", "detalle": "La plantilla admite promesas" }
    ],
    "deuda": { "pendiente": "300.00", "vencida": "300.00", "pagado_pendientes": "0.00", "facturas_vencidas": 2 },
    "historial": { "ventana": 6, "resueltas": 0, "cumplidas": 0, "cumplimiento_pct": null },
    "siguiente_facturacion": "2026-11-01"
}
```

- `regla`: la **primera** que falló (rechazada), `requiere_aprobacion` (pendiente) o `null` (aprobada). `reglas[]` termina en esa regla: la creación se detiene en la primera que falla.
- Al aprobar se agrega `aprobacion`; al rechazar o cancelar, `cierre = { estado, en, motivo, por }`.

## Nombres de regla, en orden

`habilitadas`, `canal_permitido`, `sin_deuda`, `plazo_max_dias`, `no_exceder_siguiente_facturacion`, `deuda_maxima`, `abono_inicial_pct`, `antiguedad_minima_dias`, `cumplimiento_minimo_pct`, `bloqueo_tras_incumplida_dias`, `max_por_periodo` y, si todo pasa y el canal la exige, `requiere_aprobacion`.

- `valor`: lo medido (días, monto `"0.00"`, cantidad, %); `limite`: el límite aplicado (null = sin límite); `origen`: `general` o el canal cuyo límite reemplazó al general; `detalle`: texto para la pantalla.
- Una regla nueva se agrega al final de esta lista y se avisa en `.claude/integration/a3.md` (A5 le da texto para el cliente).

## Simulación (`POST /promesas/simular`)

Misma forma que `resultado_evaluacion` más:

- `reglas[]` con **todas** las reglas (no se detiene) y `aplica: false` en las que la configuración no exige (p. ej. `deuda_maxima` sin límite).
- `resultado` y `regla`: exactamente lo que daría `POST /promesas` con los mismos datos.
- `validaciones[]`: `{ campo, ok, regla, detalle }` con `monto` (`monto`, `monto_maximo`), `vence_en` (`futuro`) y `servicio_id` (`promesa_abierta`). Si alguna falla, `resultado_creacion = "error"` (crear respondería 422 o 409).
- `limites`: `habilitadas`, `permitido`, `requiere_aprobacion`, `plazo_max_dias`, `fecha_maxima` (último día en que puede vencer), `siguiente_facturacion`, `deuda_pendiente`, `deuda_vencida`, `deuda_maxima`, `abono_requerido`, `abono_pagado`, `max_por_periodo`, `en_periodo`.
- `suspension_manual: true`: la promesa quedaría activa pero no reactivaría el servicio.

No crea nada ni deja auditoría. Para el portal, `limitesPromesa(servicioId, canal)` de `#billing/simulador_promesas` devuelve solo `limites`.
