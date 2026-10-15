# billing · Facturación (A3)

Plantillas de facturación, facturas, pagos, promesas, `evaluarEstadoServicio` y crons. Todo lo que mueve dinero termina en el libro (`app/ledger`).

## Plantillas de facturación

| Acción | Archivo | Permiso |
| --- | --- | --- |
| `plantillas.crear` | `actions/crear_plantilla.ts` | `plantillas.crear` |
| `plantillas.editar` | `actions/editar_plantilla.ts` | `plantillas.editar` (con `version`, 409 si cambió) |

Campos: `ciclo` (`dia_fijo` con `dia` 1–28, o `aniversario` = día de instalación), `prorrateo`, `dias_gracia`, `facturas_para_limitar` (0 = nunca limitar), `facturas_para_cortar`, `mora_tipo`/`mora_valor`/`mora_recurrente`, `hora_corte` (HH:MM Guatemala), `certificar_al`, `reglas_promesa`.

Coherencia (`plantillas.ts`, 422 con el campo exacto): `dia_fijo` exige `dia`; `facturas_para_limitar ≤ facturas_para_cortar`; mora `ninguna` ⇒ 0, `fija`/`porcentaje` ⇒ > 0, porcentaje ≤ 100; máximo de promesas con buen historial ≥ máximo base.

Las facturas ya emitidas no cambian al editar la plantilla: cada una guarda `reglas_snapshot`. Cada cambio queda en `audit.cambios` (`entidad_tipo = plantilla_facturacion`).

### Reglas de promesa (`reglas_promesa.ts`)

Se guardan normalizadas (todas las claves). Ver el comentario del archivo y el schema `ReglasPromesa` del OpenAPI: máximo por periodo (y con buen historial), plazo máximo, no exceder la siguiente facturación, deuda máxima, abono inicial, antigüedad mínima, cumplimiento mínimo, bloqueo tras incumplida, y límites por canal (`portal`, `ia`, `operador`, `supervisor`: `permitido`, `requiere_aprobacion`, y overrides de plazo, máximo y deuda).

### Excepciones por servicio (`excepciones.ts`)

`core.servicios_excepciones (servicio_id, campo, valor jsonb)` es de A1; A3 define los campos:

| `campo` | `valor` |
| --- | --- |
| `dia` | entero 1–28 (solo aplica en `dia_fijo`) |
| `prorrateo` | boolean |
| `dias_gracia` | entero 0–90 |
| `facturas_para_limitar` | entero 0–24 |
| `facturas_para_cortar` | entero 1–24 |
| `mora_tipo` | `ninguna` \| `fija` \| `porcentaje` |
| `mora_valor` | string decimal `"15.00"` |
| `mora_recurrente` | boolean |
| `hora_corte` | `"HH:MM"` |
| `certificar_al` | `emitir` \| `pagar` \| `nunca` |
| `reglas_promesa` | objeto parcial; se combina clave a clave (y por canal) sobre el de la plantilla |

No exceptuables: `nombre`, `ciclo`. `validarExcepcion(campo, valor)` valida (422) y `aplicarExcepciones(plantilla, filas)` devuelve la `ConfiguracionFacturacion` efectiva con la lista `excepciones` aplicadas.

## Endpoints

| Método | Ruta | Permiso |
| --- | --- | --- |
| GET | `/api/v1/plantillas-facturacion` | `plantillas.ver` |
| POST | `/api/v1/plantillas-facturacion` | `plantillas.crear` |
| GET | `/api/v1/plantillas-facturacion/:id` | `plantillas.ver` |
| PUT | `/api/v1/plantillas-facturacion/:id` | `plantillas.editar` |

## Eventos

Emite (próximas tareas): `factura.emitida`, `factura.vencida`, `factura.anulada`, `pago.registrado`, `pago.anulado`, `promesa.*`. Consume (A1): `servicio.creado`, `servicio.estado_cambiado`.
