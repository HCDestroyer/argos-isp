import type { Schema } from '@argosisp/contracts'

/**
 * Promociones de velocidad (decisiones del PM 18 y 34; A1, `core.promociones_velocidad` y
 * `core.promociones_velocidad_servicios`). Las fechas van relativas a «ahora» para que cada
 * pestaña (vigentes, programadas, terminadas, canceladas) tenga algo en cualquier día que corran
 * las pruebas. `vigencia`, `tramo_actual`, `proximo_tramo` y `servicios` los calcula la ruta,
 * como la API; aquí se guardan con valores de relleno que la ruta sobrescribe.
 */

type Promocion = Schema<'PromocionVelocidad'>
type Asignacion = Schema<'PromocionServicio'>

const DIA = 86_400_000

/** Medianoche de Guatemala (UTC−6) de hoy + `dias`, como instante UTC. */
function medianoche(dias: number, ahora: number): string {
    const local = new Date(ahora - 6 * 3_600_000)
    const base = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) + 6 * 3_600_000
    return new Date(base + dias * DIA).toISOString()
}

function promocion(datos: Partial<Promocion> & Pick<Promocion, 'id' | 'nombre' | 'inicio' | 'fin'>): Promocion {
    return {
        empresa_id: 1,
        descripcion: null,
        tipo_velocidad: 'multiplicador',
        multiplicador: '2.00',
        plan_destino_id: null,
        plan_destino_nombre: null,
        modo: 'dias',
        franja_inicio: null,
        franja_fin: null,
        dias_semana: null,
        precio: null,
        estado: 'activa',
        vigencia: 'vigente',
        tramo_actual: null,
        proximo_tramo: null,
        motivo_cancelacion: null,
        cancelada_en: null,
        creado_por: 1,
        servicios: 0,
        version: 1,
        created_at: datos.inicio,
        updated_at: datos.inicio,
        ...datos,
    }
}

export function promocionesIniciales(ahora: number = Date.now()): Promocion[] {
    return [
        promocion({
            id: 1,
            nombre: 'Gamer nocturno',
            descripcion: 'Para los que juegan en línea de noche',
            modo: 'franja',
            franja_inicio: '18:00',
            franja_fin: '23:00',
            dias_semana: [1, 2, 3, 4, 5],
            inicio: medianoche(-5, ahora),
            fin: medianoche(60, ahora),
        }),
        promocion({
            id: 2,
            nombre: 'Navidad x2',
            descripcion: 'Todo diciembre al doble para clientes al día',
            inicio: medianoche(-2, ahora),
            fin: medianoche(30, ahora),
        }),
        promocion({
            id: 3,
            nombre: 'Pyme turbo fin de mes',
            descripcion: 'Más subida para cierres contables',
            tipo_velocidad: 'plan_destino',
            multiplicador: null,
            plan_destino_id: 3,
            plan_destino_nombre: 'Pyme 50 Mbps',
            modo: 'franja',
            franja_inicio: '08:00',
            franja_fin: '18:00',
            precio: '900.00',
            inicio: medianoche(-1, ahora),
            fin: medianoche(40, ahora),
        }),
        promocion({
            id: 4,
            nombre: 'Vacaciones escolares',
            descripcion: 'Más velocidad para estudiantes',
            multiplicador: '1.50',
            inicio: medianoche(50, ahora),
            fin: medianoche(80, ahora),
        }),
        promocion({
            id: 5,
            nombre: 'Mundial 2026',
            descripcion: 'Partidos sin cortes',
            modo: 'franja',
            franja_inicio: '10:00',
            franja_fin: '22:00',
            inicio: medianoche(-90, ahora),
            fin: medianoche(-50, ahora),
        }),
        promocion({
            id: 6,
            nombre: 'Prueba Torre San Juan',
            multiplicador: '3.00',
            estado: 'cancelada',
            inicio: medianoche(-20, ahora),
            fin: medianoche(-13, ahora),
            motivo_cancelacion: 'el router no aguanta',
            cancelada_en: medianoche(-19, ahora),
            version: 2,
        }),
    ]
}

function asignacion(id: number, promocion: Promocion, servicioId: number, extra: Partial<Asignacion> = {}): Asignacion {
    return {
        id,
        promocion_id: promocion.id,
        promocion_nombre: promocion.nombre,
        servicio_id: servicioId,
        empresa_id: promocion.empresa_id,
        estado: 'vigente',
        agregada_por: 1,
        quitada_en: null,
        motivo: null,
        created_at: promocion.inicio,
        tramo_abierto: null,
        ...extra,
    }
}

/** Gamer nocturno con 3 servicios y uno quitado; Navidad x2 con uno; Mundial terminada con uno. */
export function asignacionesIniciales(promociones: Promocion[]): Asignacion[] {
    const [gamer, navidad, , , mundial] = promociones
    return [
        asignacion(1, gamer!, 1),
        asignacion(2, gamer!, 3),
        asignacion(3, gamer!, 4),
        asignacion(4, gamer!, 6, { estado: 'quitada', quitada_en: gamer!.inicio, motivo: 'la pidió quitar' }),
        asignacion(5, navidad!, 7),
        asignacion(6, mundial!, 1),
    ]
}
