import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import { NoEncontrado } from '#shared/errores'
import type { EstadoServicioConPendiente } from '#shared/eventos'
import { ZONA_NEGOCIO } from '#ledger/fechas'
import { obtenerPlantilla } from '#billing/plantillas'
import { aplicarExcepciones, type ConfiguracionFacturacion } from '#billing/excepciones'

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
    plan_id: number
    plan_nombre: string
    estado: EstadoServicioConPendiente
    /** precio efectivo: `costo_override` o el precio del plan (IVA incluido) */
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
    return `(CASE WHEN ${a}.instalado_en > ${a}.created_at THEN ${dia('instalado_en')} ELSE coalesce(${a}.fecha_instalacion, ${dia('created_at')}) END)`
}

export async function leerServicio(
    cliente: QueryClientContract,
    servicioId: number,
): Promise<ServicioFacturable> {
    const consulta = cliente
        .from('core.servicios as s')
        .join('network.planes as p', 'p.id', 's.plan_id')
        .where('s.id', servicioId)
        .select(
            's.id',
            's.empresa_id',
            's.cliente_id',
            's.plan_id',
            'p.nombre as plan_nombre',
            's.estado',
            's.costo_override',
            'p.precio',
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
        plan_id: fila.plan_id,
        plan_nombre: fila.plan_nombre,
        estado: fila.estado,
        precio: fila.costo_override ?? fila.precio,
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
