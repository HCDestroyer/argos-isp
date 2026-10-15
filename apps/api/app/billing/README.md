# billing · Facturación (A3)

Plantillas de facturación, facturas, pagos, promesas, `evaluarEstadoServicio` y crons. Todo lo que mueve dinero termina en el libro (`app/ledger`).

## Plantillas de facturación

| Acción              | Archivo                       | Permiso                                            |
| ------------------- | ----------------------------- | -------------------------------------------------- |
| `plantillas.crear`  | `actions/crear_plantilla.ts`  | `plantillas.crear`                                 |
| `plantillas.editar` | `actions/editar_plantilla.ts` | `plantillas.editar` (con `version`, 409 si cambió) |

Campos: `ciclo` (`dia_fijo` con `dia` 1–28, o `aniversario` = día de instalación), `prorrateo`, `dias_gracia`, `facturas_para_limitar` (0 = nunca limitar), `facturas_para_cortar`, `mora_tipo`/`mora_valor`/`mora_recurrente`, `hora_corte` (HH:MM Guatemala), `certificar_al`, `reglas_promesa`.

Coherencia (`plantillas.ts`, 422 con el campo exacto): `dia_fijo` exige `dia`; `facturas_para_limitar ≤ facturas_para_cortar`; mora `ninguna` ⇒ 0, `fija`/`porcentaje` ⇒ > 0, porcentaje ≤ 100; máximo de promesas con buen historial ≥ máximo base.

Las facturas ya emitidas no cambian al editar la plantilla: cada una guarda `reglas_snapshot`. Cada cambio queda en `audit.cambios` (`entidad_tipo = plantilla_facturacion`).

### Reglas de promesa (`reglas_promesa.ts`)

Se guardan normalizadas (todas las claves). Ver el comentario del archivo y el schema `ReglasPromesa` del OpenAPI: máximo por periodo (y con buen historial), plazo máximo, no exceder la siguiente facturación, deuda máxima, abono inicial, antigüedad mínima, cumplimiento mínimo, bloqueo tras incumplida, y límites por canal (`portal`, `ia`, `operador`, `supervisor`: `permitido`, `requiere_aprobacion`, y overrides de plazo, máximo y deuda).

### Excepciones por servicio (`excepciones.ts`)

`core.servicios_excepciones (servicio_id, campo, valor jsonb)` es de A1; A3 define los campos:

| `campo`                 | `valor`                                                                         |
| ----------------------- | ------------------------------------------------------------------------------- |
| `dia`                   | entero 1–28 (solo aplica en `dia_fijo`)                                         |
| `prorrateo`             | boolean                                                                         |
| `dias_gracia`           | entero 0–90                                                                     |
| `facturas_para_limitar` | entero 0–24                                                                     |
| `facturas_para_cortar`  | entero 1–24                                                                     |
| `mora_tipo`             | `ninguna` \| `fija` \| `porcentaje`                                             |
| `mora_valor`            | string decimal `"15.00"`                                                        |
| `mora_recurrente`       | boolean                                                                         |
| `hora_corte`            | `"HH:MM"`                                                                       |
| `certificar_al`         | `emitir` \| `pagar` \| `nunca`                                                  |
| `reglas_promesa`        | objeto parcial; se combina clave a clave (y por canal) sobre el de la plantilla |

No exceptuables: `nombre`, `ciclo`. `validarExcepcion(campo, valor)` valida (422) y `aplicarExcepciones(plantilla, filas)` devuelve la `ConfiguracionFacturacion` efectiva con la lista `excepciones` aplicadas.

## Facturas (tarea 4)

| Acción             | Archivo                       | Qué hace                                                                                                                                                                                                            |
| ------------------ | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `facturas.generar` | `actions/generar_facturas.ts` | Cron y `POST /facturas/generar`. Todo lo pendiente hasta `hasta` (hoy por defecto), servicios `activo`/`limitado`/`suspendido` con plantilla, por lotes de 500. Repetirla no duplica.                               |
| `facturas.emitir`  | `actions/emitir_factura.ts`   | Una factura de un periodo, en su transacción: `clave_unica = servicio_id-YYYY-MM-DD` con `ON CONFLICT DO NOTHING`, líneas, `reglas_snapshot`, asiento y `factura.emitida`. Aplica el anticipo del cliente si tiene. |

- Periodos (`periodos.ts`): `dia_fijo` empieza el `dia` de cada mes; `aniversario`, el día de instalación (29–31 → 28). El primer periodo va de la instalación (o del alta si no hay `fecha_instalacion`) al siguiente ciclo; con `prorrateo` se cobra `días / días del ciclo`, sin prorrateo el precio completo.
- Líneas: plan al precio efectivo (`costo_override` o `planes.precio`) y conceptos recurrentes activos (> 0), ambos por el factor de prorrateo. IVA 12 % incluido, desglosado por línea (`lineaConIva`: `iva = total − total/1.12`, redondeo al final); `subtotal = total − Σ iva`.
- `vence_en = periodo + dias_gracia`. Asiento: `CxC (cliente) / Ingresos por internet + Otros ingresos + IVA débito`.
- `facturas.tipo`: `servicio` (periodo) o `mora` (recargo, ver tarea 5). Solo `servicio` cuenta para limitar/cortar.
- Estado según lo pagado (`estadoSegunPago`): `pagada` si `pagado = total`; si ya pasó por `vencerFacturas` (`vencida_en`), `vencida`; si no, `parcial` o `emitida`.

## Vencimiento y mora (tarea 5)

| Acción                       | Archivo                      | Qué hace                                                                                                                                                  |
| ---------------------------- | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `facturas.vencer_pendientes` | `actions/vencer_facturas.ts` | Cron y `POST /facturas/vencer`. Todo lo pendiente hasta `hasta` (hoy por defecto), por lotes de 500.                                                      |
| `facturas.vencer`            | `actions/vencer_factura.ts`  | Una factura de servicio `emitida`/`parcial` con `vence_en < hoy` → `vencida` (`vencida_en`), evento `factura.vencida`, y los recargos de mora pendientes. |

- Mora (`mora.ts`) según el `reglas_snapshot` de la factura: `fija` (`mora_valor` Q) o `porcentaje` (del total). Es una factura `tipo = 'mora'` con `factura_origen_id`, sin IVA, asiento `CxC / Recargos por mora` (`origen_tipo = 'mora'`). Nace `vencida` (se debe ya) pero no cuenta para el corte.
- `mora_recurrente`: un recargo más por cada mes cumplido después del vencimiento. Clave `mora-<factura>-<n>`: repetir no duplica.
- Vencer no cambia el estado del servicio: lo hace el cron de corte a la `hora_corte`.

## evaluarEstadoServicio (tarea 6)

`actions/evaluar_estado_servicio.ts` (`servicios.evaluar_estado`) es la **única** que decide el estado del servicio. Entrada `{ servicio_id, ahora?, ignorarHoraCorte? }`; salida `{ estado, motivo, de, cambiado, deseado, vencidas, promesa_activa }`. Se llama anidada (`{ trx }`) desde el cron de corte, `registrarPago`, `anularPago` y (tarea 10) promesas.

1. Retirado o sin plantilla: no se toca.
2. Promesa `activa` → `activo`.
3. Facturas de servicio vencidas ≥ `facturas_para_cortar` → `suspendido`.
4. Vencidas ≥ `facturas_para_limitar` (> 0) → `limitado` si el plan tiene velocidad limitada > 0 (bajada y subida); si no, `activo`.
5. Si no → `activo`.

Con la configuración efectiva (plantilla + excepciones). Bajar de estado espera a la `hora_corte` del día (Guatemala); subir es inmediato. Si cambia, llama `CambiarEstadoServicio` de A1 (evento `servicio.estado_cambiado`).

## Endpoints

| Método | Ruta                                 | Permiso             |
| ------ | ------------------------------------ | ------------------- |
| GET    | `/api/v1/plantillas-facturacion`     | `plantillas.ver`    |
| POST   | `/api/v1/plantillas-facturacion`     | `plantillas.crear`  |
| GET    | `/api/v1/plantillas-facturacion/:id` | `plantillas.ver`    |
| PUT    | `/api/v1/plantillas-facturacion/:id` | `plantillas.editar` |

## Eventos

Emite: `factura.emitida`, `factura.vencida`. Próximas tareas: `factura.anulada`, `pago.registrado`, `pago.anulado`, `promesa.*`. Consume (A1): `servicio.creado`, `servicio.estado_cambiado`.
