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
- Al aprobar se agrega `aprobacion = { por, en, nota }`. Al cerrarse se agrega `cierre`:
    - rechazada o cancelada por un supervisor: `{ estado, en, motivo, por }`;
    - cancelada sola al vencer sin aprobación: `{ estado: 'cancelada', en, motivo: 'venció sin aprobación' }`;
    - cumplida o incumplida: `{ estado, en, pagado, deuda_vencida }`.

### Tipo estable en el OpenAPI (decisión, semana 3)

La forma de `resultado_evaluacion` es el componente `EvaluacionPromesa` de `packages/contracts`. Úsenlo con `Schema<'EvaluacionPromesa'>` y sus piezas: `ReglaEvaluada`, `DeudaEvaluada`, `HistorialPromesas`, `AprobacionPromesa`, `CierrePromesa`.

- Transición: el campo `Promesa.resultado_evaluacion` sigue declarado como objeto abierto (su descripción apunta a `EvaluacionPromesa`) porque los fixtures y `leerEvaluacion` del panel usan otra forma y el typecheck del workspace se rompería. Cuando A4 los migre (fila en `a3.md`), A3 cambia el campo a `EvaluacionPromesa | null` sin cambiar nada de la respuesta: la API ya responde exactamente esta forma.

- Obligatorios: `resultado`, `regla`, `motivo`, `canal`, `evaluada_en`, `reglas`, `deuda`, `historial`, `siguiente_facturacion`. Opcionales: `aprobacion`, `cierre`.
- `regla` y `reglas[].regla` son el enum `NOMBRES_REGLA` (`app/billing/promesas.ts`), en el orden de abajo. `reglas[].origen`: `general` o un canal.
- La forma es cerrada: no aparecen claves fuera del esquema. `tests/billing/promesas_contrato.spec.ts` valida contra el OpenAPI cada respuesta real (aprobada, rechazada, pendiente, aprobada y rechazada por el supervisor, cancelada y cumplida).
- Cambios: solo aditivos y opcionales; una regla nueva se agrega al final del enum y se avisa en `a3.md`.
- `null` solo en promesas sin evaluación guardada (no existen hoy; el tipo lo admite por seguridad).

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
