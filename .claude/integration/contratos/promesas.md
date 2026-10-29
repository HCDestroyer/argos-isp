# Contrato · Evaluación de promesas de pago (A3)

Lo exponen `POST /promesas` (en `Promesa.resultado_evaluacion`) y `POST /promesas/simular` (`SimulacionPromesa`). Lo leen el panel (A4: pantalla de promesas y simulador) y el portal (A5: motivo para el cliente). La fuente es `evaluarReglas` en `apps/api/app/billing/promesas.ts`; el simulador usa la misma función en modo completo.

## Monto y cumplimiento: la promesa cubre todo lo vencido (decisión del PM, 29 oct)

- **Nadie escribe el monto.** Al crear la promesa Argos calcula `monto` = total vencido del servicio en ese momento: las facturas `vencida` con saldo (servicio, mora y cargos), la más antigua primero. `POST /promesas` y `POST /promesas/simular` aceptan `monto` solo por transición: está marcado `deprecated` en el OpenAPI y **se ignora**; la respuesta trae el monto calculado.
- `Promesa.facturas[]` (`FacturaPromesa`): `factura_id`, `tipo`, `periodo`, `vence_en`, `monto` (saldo al crearla, lo que cubre), `saldo` (hoy; `0.00` si ya no está pendiente) y `estado`. Vacía con la regla `monto`.
- `Promesa.regla_cumplimiento`:
    - `facturas` (todas las creadas desde el cambio): se cumple **solo** cuando todas sus facturas quedan saldadas (pagadas, o acreditadas/anuladas/castigadas). Un pago parcial no la cumple. Una factura que vence después de crearla no entra en la promesa: la evalúa el corte normal.
    - `monto` (legado): las que estaban abiertas al migrar y las importadas conservan su monto y su regla: se cumplen cuando lo pagado a las facturas del servicio desde la promesa llega al monto, o no queda deuda vencida.
- `sin_deuda` mide ahora lo **vencido** (`valor` = total vencido): sin facturas vencidas se rechaza con `monto = "0.00"` y `facturas = []`.
- El abono inicial (`abono_inicial_pct`) sigue igual: se exige antes de prometer, y la promesa cubre lo que queda vencido después del abono.
- Transición del OpenAPI: `regla_cumplimiento` y `facturas` vienen **siempre** en la respuesta, pero el esquema `Promesa` los declara opcionales hasta que A4 migre sus fixtures (fila en `a3.md`); luego A3 los vuelve obligatorios sin cambiar la respuesta.
- La promesa no genera asientos.

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
    - cumplida o incumplida: `{ estado, en, pagado, deuda_vencida }` y, con `regla_cumplimiento = facturas`, `saldo_cubierto` (lo que les quedaba a las facturas cubiertas; `pagado` = lo aplicado a ellas desde la promesa).

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
- `monto` y `facturas[]` (`FacturaCubierta`): el total vencido y las facturas que cubriría la promesa si se crea ahora.
- `validaciones[]`: `{ campo, ok, regla, detalle }` con `vence_en` (`futuro`) y `servicio_id` (`promesa_abierta`). Desde el 29 oct ya no hay validaciones de `monto` (el enum conserva el valor por compatibilidad). Si alguna falla, `resultado_creacion = "error"` (crear respondería 422 o 409).
- `limites`: `habilitadas`, `permitido`, `requiere_aprobacion`, `plazo_max_dias`, `fecha_maxima` (último día en que puede vencer), `siguiente_facturacion`, `deuda_pendiente`, `deuda_vencida`, `deuda_maxima`, `abono_requerido`, `abono_pagado`, `max_por_periodo`, `en_periodo`, `monto_promesa` (total que cubriría) y `facturas` (las que cubriría).
- `suspension_manual: true`: la promesa quedaría activa pero no reactivaría el servicio.

No crea nada ni deja auditoría. Para el portal, `limitesPromesa(servicioId, canal)` de `#billing/simulador_promesas` devuelve solo `limites` (con `monto_promesa` y `facturas`).
