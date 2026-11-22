import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import { NoEncontrado } from '#shared/errores'
import type { EstadoServicioConPendiente } from '#shared/eventos'
import { ZONA_NEGOCIO } from '#ledger/fechas'
import { aTexto, dec } from '#ledger/dinero'
import { obtenerPlantilla } from '#billing/plantillas'
import { aplicarExcepciones, type ConfiguracionFacturacion } from '#billing/excepciones'
import { sqlPlanFacturablePromocion } from '#core/promociones_velocidad'

/**
 * Lo que facturación necesita de un servicio, leído en solo lectura de `core.servicios` y
 * `network.planes` (columnas acordadas en `app/core/README.md`) más la plantilla con las
 * excepciones del servicio aplicadas.
 */

export interface ServicioFacturable {
    id: number
    /** empresa (NIT) que factura el servicio */
    empresa_id: number
    cliente_id: number
    /**
     * plan que se factura (`sqlPlanFacturablePromocion`): `plan_id`, salvo durante un tramo de
     * promoción de velocidad en un router PCQ o árbol, que es el plan original del tramo
     */
    plan_id: number
    plan_nombre: string
    estado: EstadoServicioConPendiente
    /**
     * precio efectivo (`precioEfectivo`): `costo_override` o el precio del plan que se factura (IVA
     * incluido). Una promoción de velocidad con `precio` no lo cambia: suma su diferencia proporcional
     * en una línea propia (`#billing/promociones_velocidad`)
     */
    precio: string
    /** primer día facturable (`inicioFacturacionSql`): instalación, o el día de alta en Guatemala */
    inicio: string
    /** el plan tiene velocidad limitada (> 0 en bajada y subida) */
    limitable: boolean
    plantilla_id: number | null
    /** suspendido a mano por un operador: `evaluarEstadoServicio` no lo toca */
    suspension_manual: boolean
}

interface FilaServicio {
    id: number
    empresa_id: number
    cliente_id: number
    plan_id: number
    plan_nombre: string
    estado: EstadoServicioConPendiente
    costo_override: string | null
    precio: string
    inicio: string
    bajada_limitada_kbps: number | null
    subida_limitada_kbps: number | null
    plantilla_facturacion_id: number | null
    suspension_manual: boolean
}

/**
 * Primer día facturable del servicio (`date`, Guatemala), en SQL para leerlo igual en todas partes
 * (`contratos/instalacion.md` §3):
 *
 * - **Activado desde `pendiente_instalacion`** (`instalado_en` posterior a `created_at`): el día de
 *   `instalado_en`. El prorrateo del primer periodo arranca ese día y, en ciclo aniversario, el
 *   aniversario es ese día. Una `fecha_instalacion` prevista al vender no cuenta.
 * - **Nacido activo** (`instalado_en = created_at`: el valor por defecto `now()` del mismo INSERT, o
 *   el relleno de la migración): como siempre, `fecha_instalacion` (puede ser retroactiva, p. ej. un
 *   servicio importado) o el día de alta.
 * - **Pendiente** (`instalado_en` null): no se factura por periodo; la expresión da el día de alta
 *   solo para que las lecturas no fallen.
 */
export function inicioFacturacionSql(alias = 's'): string {
    const a = alias
    const dia = (columna: string) => `(${a}.${columna} AT TIME ZONE '${ZONA_NEGOCIO}')::date`
    return `(CASE WHEN ${activadoDesdePendienteSql(a)} THEN ${dia('instalado_en')} ELSE coalesce(${a}.fecha_instalacion, ${dia('created_at')}) END)`
}

/**
 * ¿El servicio `alias` (fila de `core.servicios`) se activó desde `pendiente_instalacion`? Un
 * servicio nacido activo tiene `instalado_en = created_at` (el `now()` por defecto del mismo INSERT o
 * el relleno de la migración); la activación siempre es posterior al alta. Un pendiente (null), no.
 * Lo comparten el primer día facturable y el vencimiento efectivo (`#billing/vencimiento`).
 */
export function activadoDesdePendienteSql(alias = 's'): string {
    return `(${alias}.instalado_en IS NOT NULL AND ${alias}.instalado_en > ${alias}.created_at)`
}

/**
 * **Precio efectivo mensual** del servicio, en SQL: la única definición de «cuánto cuesta el plan
 * de este servicio» (contrato Iris 0.8.0, `precio_mensual`; revisión punto 19). Es el precio con
 * el que `generarFacturas` factura la línea del plan, **IVA incluido**, como `numeric(14,2)`
 * (Postgres lo devuelve como string con 2 decimales, p. ej. `"250.00"`): `costo_override` si lo
 * tiene; si no, el `precio` del **plan que se factura** (`sqlPlanFacturablePromocion` de A1):
 * `plan_id`, salvo durante un tramo de promoción de velocidad en un router PCQ o árbol (decisión del
 * PM 34), que cambia `plan_id` al plan destino; ahí se cobra el plan original del tramo (la promoción
 * es gratis). Un plan temporal activo cuenta, porque `plan_id` ya es el temporal.
 *
 * **No** incluye adicionales, descuentos o bonificaciones, mora, prorrateo, cargos únicos ni la
 * diferencia de una promoción con `precio` (línea propia: `#billing/promociones_velocidad`).
 *
 * - `servicio`: alias de `core.servicios` en la consulta. El precio del plan se lee siempre con una
 *   subconsulta escalar por el plan que se factura (un join por `plan_id` daría el plan destino).
 *
 * ```ts
 * import { precioEfectivoSql } from '#billing/configuracion'
 * consulta.select(db.raw(`${precioEfectivoSql('s')} as precio_mensual`))
 * ```
 */
export function precioEfectivoSql(servicio = 's'): string {
    const precioPlan = `(SELECT pe.precio FROM network.planes pe WHERE pe.id = ${sqlPlanFacturablePromocion(servicio)})`
    return `(coalesce(${servicio}.costo_override, ${precioPlan})::numeric(14, 2))`
}

/**
 * Versión TS de `precioEfectivoSql`, para una fila ya leída
 * (`costo_override` del servicio y `precio` del plan que se factura, como strings decimales): mismo
 * resultado, con 2 decimales.
 */
export function precioEfectivo(fila: { costo_override: string | null; precio: string }): string {
    return aTexto(dec(fila.costo_override ?? fila.precio))
}

/** Precio efectivo de un servicio por id (404 si no existe). */
export async function leerPrecioEfectivo(cliente: QueryClientContract, servicioId: number): Promise<string> {
    const fila = (await cliente
        .from('core.servicios as s')
        .where('s.id', servicioId)
        .select(cliente.raw(`${precioEfectivoSql('s')}::text as precio`))
        .first()) as { precio: string } | null
    if (!fila) throw new NoEncontrado(`El servicio ${servicioId} no existe`)
    return fila.precio
}

export async function leerServicio(
    cliente: QueryClientContract,
    servicioId: number,
): Promise<ServicioFacturable> {
    // `pf`: el plan que se factura (el original durante un tramo de promoción PCQ/árbol); `p`: el
    // plan vigente en la red (`plan_id`), del que sale si se puede limitar la velocidad
    const consulta = cliente
        .from('core.servicios as s')
        .join('network.planes as p', 'p.id', 's.plan_id')
        .joinRaw(`JOIN network.planes AS pf ON pf.id = ${sqlPlanFacturablePromocion('s')}`)
        .where('s.id', servicioId)
        .select(
            's.id',
            's.empresa_id',
            's.cliente_id',
            'pf.id as plan_id',
            'pf.nombre as plan_nombre',
            's.estado',
            's.costo_override',
            'pf.precio',
            cliente.raw(`to_char(${inicioFacturacionSql('s')}, 'YYYY-MM-DD') as inicio`),
            'p.bajada_limitada_kbps',
            'p.subida_limitada_kbps',
            's.plantilla_facturacion_id',
            's.suspension_manual',
        )
    const fila = (await consulta.first()) as FilaServicio | null
    if (!fila) throw new NoEncontrado(`El servicio ${servicioId} no existe`)
    return {
        id: fila.id,
        empresa_id: Number(fila.empresa_id),
        cliente_id: fila.cliente_id,
        plan_id: Number(fila.plan_id),
        plan_nombre: fila.plan_nombre,
        estado: fila.estado,
        precio: precioEfectivo(fila),
        inicio: fila.inicio,
        limitable: (fila.bajada_limitada_kbps ?? 0) > 0 && (fila.subida_limitada_kbps ?? 0) > 0,
        plantilla_id: fila.plantilla_facturacion_id,
        suspension_manual: fila.suspension_manual,
    }
}

/** Plantilla del servicio con sus excepciones aplicadas; null si no tiene plantilla. */
export async function configuracionDeServicio(
    cliente: QueryClientContract,
    servicio: Pick<ServicioFacturable, 'id' | 'plantilla_id'>,
): Promise<ConfiguracionFacturacion | null> {
    if (!servicio.plantilla_id) return null
    const plantilla = await obtenerPlantilla(servicio.plantilla_id, cliente)
    const excepciones = (await cliente
        .from('core.servicios_excepciones')
        .where('servicio_id', servicio.id)
        .orderBy('campo')
        .select('campo', 'valor')) as Array<{ campo: string; valor: unknown }>
    return aplicarExcepciones(
        {
            plantilla_id: plantilla.id,
            nombre: plantilla.nombre,
            ciclo: plantilla.ciclo,
            dia: plantilla.dia,
            prorrateo: plantilla.prorrateo,
            dias_gracia: plantilla.dias_gracia,
            facturas_para_limitar: plantilla.facturas_para_limitar,
            facturas_para_cortar: plantilla.facturas_para_cortar,
            mora_tipo: plantilla.mora_tipo,
            mora_valor: plantilla.mora_valor,
            mora_recurrente: plantilla.mora_recurrente,
            hora_corte: plantilla.hora_corte,
            certificar_al: plantilla.certificar_al,
            reglas_promesa: plantilla.reglas_promesa,
        },
        excepciones,
    )
}
