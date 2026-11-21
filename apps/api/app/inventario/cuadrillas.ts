import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import type { Transaccion } from '#shared/domain_action'
import { Problema, ValidacionFallida } from '#shared/errores'
import { hoyGuatemala } from '#ledger/fechas'
import { bodegasDelUsuario, type TecnicoExterno } from '#inventario/tecnicos'
import { fijarActorTecnico } from '#inventario/actor_tecnico'

/**
 * Bodega de cuadrilla (contrato Iris 0.11.0 §3.9, A47; decisiones del PM §10.6 a–m) y la ventana de la
 * fecha del teléfono (0.12.0 §3.10).
 *
 * - **Membresía en el tiempo.** Un técnico es miembro de una cuadrilla en un instante si tiene un
 *   vínculo aceptado con `desde ≤ instante` y `hasta` nulo o posterior. El instante es la `fecha` del
 *   teléfono (o ahora). Un técnico que fue miembro pero no en ese instante queda `fuera_de_membresia`
 *   (403 `no_es_miembro` con esa regla en `errors[]`).
 * - **Qué bodega, antes de mirar existencias.** Con `bodega_id` y `tecnico`, solo su bodega personal o
 *   una cuadrilla de la que es miembro, en la empresa de la operación (403 `no_es_miembro`). Sin
 *   `bodega_id`: primero sus cuadrillas, después la personal.
 * - **Actor obligatorio** sobre una bodega de cuadrilla: `X-Iris-Actor: usuario:<id en Iris>` (400
 *   `cabecera_iris_requerida`), miembro y con el mismo usuario de Argos que `tecnico.id_externo` (403
 *   `actor_no_coincide`); `tecnico` solo por `id_externo` (422).
 */

/** Ventana de §3.10: `recibido_en_iris − 72 h ≤ fecha ≤ recibido_en_iris + 5 min`. */
export const VENTANA_ATRAS_MS = 72 * 3600 * 1000
export const VENTANA_ADELANTE_MS = 5 * 60 * 1000

const FORMATO_ACTOR = /^usuario:([A-Za-z0-9_-]{1,64})$/

/** Lo que llega de Iris para decidir la bodega del técnico. */
export interface PeticionTecnico {
    tecnico?: TecnicoExterno | null
    bodega_id?: number | null
    /** `X-Iris-Actor` (la pone la ruta desde la cabecera, nunca del cuerpo) */
    iris_actor?: string | null
    /** la fecha del teléfono (fecha o instante RFC 3339) */
    fecha?: string | Date | null
    /** la hora del servidor de Iris al aceptar el lote */
    recibido_en_iris?: string | Date | null
}

export function esInstante(valor: string | Date | null | undefined): boolean {
    return valor instanceof Date || (typeof valor === 'string' && valor.includes('T'))
}

function aFecha(valor: string | Date): Date {
    return valor instanceof Date ? valor : new Date(valor)
}

/**
 * Instante de la operación (para la membresía) y la fecha del kardex. Con `recibido_en_iris`, `fecha`
 * debe ser un instante dentro de la ventana (422 `validacion`) y el kardex lleva la fecha de hoy (como
 * la recepción de traslados, D.9: ningún movimiento queda antes de otro). Con `fecha` instante sin
 * `recibido_en_iris`: su fecha en Guatemala. Con `fecha` de día: esa fecha (lo de siempre).
 */
export function momentoDeLaOperacion(p: PeticionTecnico): {
    instante: Date
    ocurridoEn: Date | null
    /** fecha para el kardex y el asiento (null = la de hoy / la que decida la acción) */
    fechaKardex: string | null
} {
    if (p.recibido_en_iris) {
        const recibido = aFecha(p.recibido_en_iris)
        if (Number.isNaN(recibido.getTime())) {
            throw new ValidacionFallida([
                { field: 'recibido_en_iris', message: 'Instante RFC 3339 inválido', rule: 'date' },
            ])
        }
        if (!p.fecha || !esInstante(p.fecha)) {
            throw new ValidacionFallida([
                {
                    field: 'fecha',
                    message: 'Con recibido_en_iris, fecha es la hora del teléfono (RFC 3339)',
                    rule: 'required',
                },
            ])
        }
        const fecha = aFecha(p.fecha)
        if (
            Number.isNaN(fecha.getTime()) ||
            fecha.getTime() < recibido.getTime() - VENTANA_ATRAS_MS ||
            fecha.getTime() > recibido.getTime() + VENTANA_ADELANTE_MS
        ) {
            throw new ValidacionFallida([
                {
                    field: 'fecha',
                    message:
                        'La fecha del teléfono debe estar entre 72 h antes y 5 min después de recibido_en_iris',
                    rule: 'ventana',
                },
            ])
        }
        return { instante: fecha, ocurridoEn: fecha, fechaKardex: hoyGuatemala() }
    }
    if (p.fecha && esInstante(p.fecha)) {
        const fecha = aFecha(p.fecha)
        if (Number.isNaN(fecha.getTime())) {
            throw new ValidacionFallida([{ field: 'fecha', message: 'Fecha inválida', rule: 'date' }])
        }
        return { instante: fecha, ocurridoEn: fecha, fechaKardex: hoyGuatemala(fecha) }
    }
    return {
        instante: new Date(),
        ocurridoEn: null,
        fechaKardex: typeof p.fecha === 'string' && p.fecha ? p.fecha : null,
    }
}

export function noEsMiembro(detalle: string, regla = 'no_es_miembro', campo = 'bodega_id'): Problema {
    return new Problema(403, 'no_es_miembro', 'No es miembro', detalle, [
        { field: campo, message: detalle, rule: regla },
    ])
}

export function actorNoCoincide(detalle: string): Problema {
    return new Problema(403, 'actor_no_coincide', 'El actor no coincide', detalle, [
        { field: 'X-Iris-Actor', message: detalle, rule: 'actor_no_coincide' },
    ])
}

export function cabeceraIrisRequerida(): Problema {
    return new Problema(
        400,
        'cabecera_iris_requerida',
        'Faltan las cabeceras de Iris',
        'X-Iris-Actor (`usuario:<id en Iris>`) es obligatoria sobre una bodega de cuadrilla',
        [{ field: 'X-Iris-Actor', message: 'Obligatoria', rule: 'cabecera_iris_requerida' }],
    )
}

/** Id de Iris del actor (`usuario:<id>`) o null si falta o no tiene ese formato. */
export function idIrisDelActor(actor: string | null | undefined): string | null {
    const m = actor ? FORMATO_ACTOR.exec(actor.trim()) : null
    return m ? m[1]! : null
}

export interface CuadrillaVista {
    id: number
    empresa_id: number
    nombre: string
    cuadrilla_id_iris: string
    jefe_id: number | null
    activo: boolean
}

/** ¿Es miembro aceptado en ese instante? */
async function vinculoEn(
    cliente: QueryClientContract,
    bodegaId: number,
    usuarioId: number,
    instante: Date,
): Promise<{ iris_usuario_id: string } | null> {
    const fila = (await cliente
        .from('inventario.cuadrilla_miembros')
        .where({ bodega_id: bodegaId, usuario_id: usuarioId, aceptado: true })
        .where('desde', '<=', instante)
        .where((q) => q.whereNull('hasta').orWhere('hasta', '>', instante))
        .select('iris_usuario_id')
        .first()) as { iris_usuario_id: string } | null
    return fila
}

/** ¿Tuvo alguna vez un vínculo aceptado? (para distinguir `fuera_de_membresia`) */
async function fueMiembro(
    cliente: QueryClientContract,
    bodegaId: number,
    usuarioId: number,
): Promise<boolean> {
    const fila = await cliente
        .from('inventario.cuadrilla_miembros')
        .where({ bodega_id: bodegaId, usuario_id: usuarioId, aceptado: true })
        .select('id')
        .first()
    return Boolean(fila)
}

/** Cuadrillas (bodegas activas) de la empresa de las que el usuario es miembro en el instante. */
export async function cuadrillasDelTecnico(
    cliente: QueryClientContract,
    usuarioId: number,
    empresaId: number,
    instante: Date = new Date(),
): Promise<number[]> {
    const filas = (await cliente
        .from('inventario.cuadrilla_miembros as m')
        .join('inventario.bodegas as b', 'b.id', 'm.bodega_id')
        .where('b.tipo', 'cuadrilla')
        .where('b.activo', true)
        .where('b.empresa_id', empresaId)
        .where('m.usuario_id', usuarioId)
        .where('m.aceptado', true)
        .where('m.desde', '<=', instante)
        .where((q) => q.whereNull('m.hasta').orWhere('m.hasta', '>', instante))
        .distinct('b.id')
        .orderBy('b.id')) as Array<{ id: number }>
    return filas.map((f) => Number(f.id))
}

export interface AccesoTecnico {
    usuarioId: number
    instante: Date
    /** bodegas que puede usar, en orden: primero sus cuadrillas, después la personal */
    bodegas: number[]
    cuadrillas: number[]
    personal: number | null
}

/** Bodegas que el técnico puede usar en la empresa en el instante (cuadrillas y personal). */
export async function accesoDelTecnico(
    cliente: QueryClientContract,
    usuarioId: number,
    empresaId: number,
    instante: Date,
): Promise<AccesoTecnico> {
    const cuadrillas = await cuadrillasDelTecnico(cliente, usuarioId, empresaId, instante)
    const [personal] = await bodegasDelUsuario(cliente, usuarioId, [empresaId])
    return {
        usuarioId,
        instante,
        cuadrillas,
        personal: personal?.id ?? null,
        bodegas: [...cuadrillas, ...(personal ? [personal.id] : [])],
    }
}

/**
 * Exige que el técnico pueda usar la bodega (`bodega_id` explícita con `tecnico`): su personal o una
 * cuadrilla de la que es miembro en el instante, en la empresa; si no, 403 `no_es_miembro` (con
 * `fuera_de_membresia` si lo fue). Se llama **antes** de mirar existencias.
 */
export async function exigirBodegaDelTecnico(
    t: Transaccion,
    bodegaId: number,
    acceso: AccesoTecnico,
    empresaId: number,
    campo = 'bodega_id',
): Promise<void> {
    if (acceso.bodegas.includes(bodegaId)) return
    const bodega = (await t.trx
        .from('inventario.bodegas')
        .where('id', bodegaId)
        .select('tipo', 'empresa_id')
        .first()) as { tipo: string; empresa_id: number } | null
    if (bodega?.tipo === 'cuadrilla' && Number(bodega.empresa_id) === empresaId) {
        if (await fueMiembro(t.trx, bodegaId, acceso.usuarioId)) {
            throw noEsMiembro(
                `El técnico no era miembro de la cuadrilla de la bodega ${bodegaId} en ${acceso.instante.toISOString()}`,
                'fuera_de_membresia',
                campo,
            )
        }
    }
    throw noEsMiembro(
        `La bodega ${bodegaId} no es la personal del técnico ni de una cuadrilla de la que sea miembro en la empresa ${empresaId}`,
        'no_es_miembro',
        campo,
    )
}

/**
 * Sobre una bodega de cuadrilla: `tecnico` por `id_externo` (422), `X-Iris-Actor` presente (400) y
 * miembro con el mismo usuario de Argos que el técnico (403 `actor_no_coincide`). Devuelve el actor.
 */
export async function exigirActorDeCuadrilla(
    t: Transaccion,
    bodegaId: number,
    peticion: PeticionTecnico,
    acceso: AccesoTecnico,
): Promise<string> {
    const idExterno = peticion.tecnico?.id_externo
    if (idExterno === null || idExterno === undefined || String(idExterno).trim() === '') {
        throw new ValidacionFallida([
            {
                field: 'tecnico.id_externo',
                message: 'Sobre una bodega de cuadrilla el técnico se identifica solo por id_externo',
                rule: 'required',
            },
        ])
    }
    const idIris = idIrisDelActor(peticion.iris_actor)
    if (!idIris) throw cabeceraIrisRequerida()
    const vinculo = await vinculoEn(t.trx, bodegaId, acceso.usuarioId, acceso.instante)
    if (!vinculo || vinculo.iris_usuario_id !== idIris) {
        throw actorNoCoincide(
            `X-Iris-Actor (${peticion.iris_actor}) no es el miembro de la cuadrilla vinculado al técnico ${acceso.usuarioId}`,
        )
    }
    return `usuario:${idIris}`
}

/** Jefe de la cuadrilla en un instante (historial), o null. */
export async function jefeEn(
    cliente: QueryClientContract,
    bodegaId: number,
    instante: Date,
): Promise<{ usuario_id: number; iris_usuario_id: string } | null> {
    const fila = (await cliente
        .from('inventario.cuadrilla_jefes')
        .where('bodega_id', bodegaId)
        .where('desde', '<=', instante)
        .where((q) => q.whereNull('hasta').orWhere('hasta', '>', instante))
        .orderBy('desde', 'desc')
        .select('usuario_id', 'iris_usuario_id')
        .first()) as { usuario_id: number; iris_usuario_id: string } | null
    return fila ? { usuario_id: Number(fila.usuario_id), iris_usuario_id: fila.iris_usuario_id } : null
}

/** ¿Es miembro aceptado ahora? */
export async function esMiembroAhora(
    cliente: QueryClientContract,
    bodegaId: number,
    usuarioId: number,
): Promise<boolean> {
    return Boolean(await vinculoEn(cliente, bodegaId, usuarioId, new Date()))
}

/** Miembros vigentes (y rechazados vigentes) de una cuadrilla, para el panel y `mi-bodega`. */
export async function miembrosDeCuadrilla(bodegaId: number, cliente: QueryClientContract = db.connection()) {
    return (await cliente
        .from('inventario.cuadrilla_miembros as m')
        .leftJoin('core.usuarios as u', 'u.id', 'm.usuario_id')
        .where('m.bodega_id', bodegaId)
        .whereNull('m.hasta')
        .orderBy('m.id')
        .select(
            'm.iris_usuario_id',
            'm.usuario_id',
            'u.nombre',
            'm.aceptado',
            'm.motivo',
            'm.desde',
        )) as Array<{
        iris_usuario_id: string
        usuario_id: number | null
        nombre: string | null
        aceptado: boolean
        motivo: string | null
        desde: Date
    }>
}

/**
 * Bodega de la que sale una unidad pedida por un técnico (comodato, cambio de equipo; §3.9 i): la
 * unidad no lleva `bodega_id`: vale la bodega donde está, que debe ser la personal del técnico o una
 * cuadrilla de la que es miembro (si no, se devuelve su personal y `unidadesDeBodega` responde 409
 * `unidad_en_otra_bodega`). Con `bodega_id` explícita, la regla de siempre (403 `no_es_miembro` antes
 * de mirar la unidad). Sobre una cuadrilla, el actor; fija quién la usó.
 */
export async function bodegaDeUnidadDelTecnico(
    t: Transaccion,
    unidadId: number,
    peticion: PeticionTecnico,
    empresaId: number,
    resolver: (t: Transaccion, tecnico: TecnicoExterno) => Promise<number>,
    sinBodega: (usuarioId: number) => Promise<unknown>,
): Promise<{ bodegaId: number; usuarioId: number; acceso: AccesoTecnico }> {
    const usuarioId = await resolver(t, peticion.tecnico!)
    const momento = momentoDeLaOperacion(peticion)
    const acceso = await accesoDelTecnico(t.trx, usuarioId, empresaId, momento.instante)
    let bodegaId: number
    if (peticion.bodega_id) {
        await exigirBodegaDelTecnico(t, peticion.bodega_id, acceso, empresaId)
        bodegaId = peticion.bodega_id
    } else {
        if (acceso.bodegas.length === 0) await sinBodega(usuarioId)
        const fila = await t.trx.from('inventario.unidades').where('id', unidadId).select('bodega_id').first()
        const donde =
            fila?.bodega_id === null || fila?.bodega_id === undefined ? null : Number(fila.bodega_id)
        bodegaId =
            donde !== null && acceso.bodegas.includes(donde) ? donde : (acceso.personal ?? acceso.bodegas[0]!)
    }
    let actor: string | null = null
    if (acceso.cuadrillas.includes(bodegaId)) {
        actor = await exigirActorDeCuadrilla(t, bodegaId, peticion, acceso)
    }
    const idIris = idIrisDelActor(peticion.iris_actor)
    fijarActorTecnico(t, {
        actor: actor ?? (idIris ? `usuario:${idIris}` : null),
        usuarioId,
        ocurridoEn: momento.ocurridoEn,
    })
    return { bodegaId, usuarioId, acceso }
}

/** Fecha del kardex de una petición que puede traer la hora del teléfono (Iris 0.12.0). */
export function fechaKardexDe(p: PeticionTecnico): string | null {
    if (p.recibido_en_iris || esInstante(p.fecha)) return momentoDeLaOperacion(p).fechaKardex
    return typeof p.fecha === 'string' && p.fecha ? p.fecha : null
}
