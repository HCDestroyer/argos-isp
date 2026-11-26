/**
 * Asientos de ajuste a mano y su aprobación (A3, decisión 10 del PM): `POST /libro/asientos`
 * registra el asiento o, con `asientos_requieren_aprobacion` en los ajustes de la empresa, deja un
 * borrador que otra persona aprueba o rechaza (`/libro/borradores`). Como la API: quien lo creó no
 * puede aprobarlo (403 `autoaprobacion`), un borrador decidido no se decide otra vez (409
 * `borrador_decidido`), Σ debe = Σ haber (422 `descuadre`) y cada línea lleva debe o haber.
 */
import type { Schema } from '@argosisp/contracts'
import Decimal from 'decimal.js'
import type { RutasFixture } from '~/utils/fetchFixtures'
import { bd, siguienteId } from '../bd'
import { conflicto, invalido, regla422 } from '../cobros/rutas'
import { ahora, conIdempotencia, conPermiso, cuerpoObjeto, deLaEmpresa, empresaActivaDe, idDe, noEncontrado, paginar, problemaTipado, registrarAccion, usuariosPorToken } from '../comun'
import { fechaGuatemala, movimiento } from './datos'

type Borrador = Schema<'BorradorAsiento'>
type Cuerpo = Record<string, unknown>

const MONTO = /^\d{1,12}(\.\d{1,2})?$/
const FECHA = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/

/** Borradores de la semilla (los del tablero ContaLibro): dos pendientes de otras personas, uno rechazado. */
export function borradoresIniciales(): Borrador[] {
    const base = {
        empresa_id: 1,
        decidido_por: null,
        decidido_por_nombre: null,
        decidido_en: null,
        motivo_rechazo: null,
        asiento_id: null,
    }
    return [
        {
            ...base,
            id: 1,
            fecha: '2026-11-20',
            descripcion: 'Reclasificar depósito sin identificar a cliente Comercial El Roble',
            movimientos: [
                { cuenta: '2.1.01', debe: '1290.00', haber: '0.00', cliente_id: 1, proveedor_id: null },
                { cuenta: '1.1.03', debe: '0.00', haber: '1290.00', cliente_id: 1, proveedor_id: null },
            ],
            total: '1290.00',
            estado: 'pendiente',
            creado_por: 3,
            creado_por_nombre: 'Sofía Soporte',
            created_at: '2026-11-20T15:12:00.000Z',
        },
        {
            ...base,
            id: 2,
            fecha: '2026-11-19',
            descripcion: 'Ajuste de redondeo en caja 2 · octubre',
            movimientos: [
                { cuenta: '5.3.05', debe: '0.35', haber: '0.00', cliente_id: null, proveedor_id: null },
                { cuenta: '1.1.01.02', debe: '0.00', haber: '0.35', cliente_id: null, proveedor_id: null },
            ],
            total: '0.35',
            estado: 'pendiente',
            creado_por: 4,
            creado_por_nombre: 'Pedro Técnico',
            created_at: '2026-11-19T21:40:00.000Z',
        },
        {
            ...base,
            id: 3,
            fecha: '2026-11-12',
            descripcion: 'Traslado entre bancos sin boleta',
            movimientos: [
                { cuenta: '1.1.02.02', debe: '10000.00', haber: '0.00', cliente_id: null, proveedor_id: null },
                { cuenta: '1.1.02.01', debe: '0.00', haber: '10000.00', cliente_id: null, proveedor_id: null },
            ],
            total: '10000.00',
            estado: 'rechazado',
            creado_por: 4,
            creado_por_nombre: 'Pedro Técnico',
            created_at: '2026-11-12T16:00:00.000Z',
            decidido_por: 1,
            decidido_por_nombre: 'Ana Administradora',
            decidido_en: '2026-11-13T14:00:00.000Z',
            motivo_rechazo: 'falta la boleta',
        },
    ]
}

function usuarioDe(solicitud: { token: string | null }): { id: number, nombre: string } | null {
    const usuario = solicitud.token ? usuariosPorToken[solicitud.token] : undefined
    return usuario ? { id: usuario.id, nombre: usuario.nombre } : null
}

interface LineaEntrada {
    cuenta: string
    debe: string | null
    haber: string | null
    cliente_id: number | null
    proveedor_id: number | null
}

function lineasDe(cuerpo: Cuerpo): LineaEntrada[] | null {
    if (!Array.isArray(cuerpo.movimientos)) {
        return null
    }
    return cuerpo.movimientos.map((m) => {
        const linea = (typeof m === 'object' && m !== null ? m : {}) as Record<string, unknown>
        return {
            cuenta: typeof linea.cuenta === 'string' ? linea.cuenta : '',
            debe: typeof linea.debe === 'string' ? linea.debe : null,
            haber: typeof linea.haber === 'string' ? linea.haber : null,
            cliente_id: typeof linea.cliente_id === 'number' ? linea.cliente_id : null,
            proveedor_id: typeof linea.proveedor_id === 'number' ? linea.proveedor_id : null,
        }
    })
}

export const rutasBorradoresLibro: RutasFixture = {
    'POST /api/v1/libro/asientos': conPermiso('libro.registrar_asiento', conIdempotencia((solicitud) => {
        const cuerpo = cuerpoObjeto(solicitud)
        const descripcion = typeof cuerpo.descripcion === 'string' ? cuerpo.descripcion.trim() : ''
        const lineas = lineasDe(cuerpo)
        const errores: { field: string, message: string, rule: string }[] = []
        if (descripcion.length < 3 || descripcion.length > 500) {
            errores.push({ field: 'descripcion', message: 'La descripción debe tener entre 3 y 500 caracteres', rule: 'minLength' })
        }
        if (cuerpo.fecha !== undefined && (typeof cuerpo.fecha !== 'string' || !FECHA.test(cuerpo.fecha))) {
            errores.push({ field: 'fecha', message: 'La fecha no es válida', rule: 'date' })
        }
        if (!lineas || lineas.length < 2) {
            errores.push({ field: 'movimientos', message: 'Un asiento tiene al menos 2 movimientos', rule: 'minLength' })
        }
        if (errores.length || !lineas) {
            return invalido(errores)
        }
        let debe = new Decimal(0)
        let haber = new Decimal(0)
        for (const [i, linea] of lineas.entries()) {
            const cuenta = bd.cuentas.find(c => c.codigo === linea.cuenta)
            if (!cuenta || !cuenta.imputable || !cuenta.activa) {
                return regla422('cuenta_invalida', 'Regla de negocio', `La cuenta ${linea.cuenta || '(vacía)'} no existe o no recibe movimientos`)
            }
            const montos = [linea.debe, linea.haber].filter((m): m is string => m !== null && m !== '')
            if (montos.length !== 1 || !MONTO.test(montos[0]!) || new Decimal(montos[0]!).lte(0)) {
                return regla422('debe_o_haber', 'Regla de negocio', `La línea ${i + 1} lleva debe o haber, mayor que cero`)
            }
            if (cuenta.auxiliar_cliente && !linea.cliente_id) {
                return regla422('cliente_requerido', 'Regla de negocio', `La cuenta ${cuenta.codigo} pide el cliente`)
            }
            if (linea.debe) {
                debe = debe.plus(linea.debe)
            }
            else if (linea.haber) {
                haber = haber.plus(linea.haber)
            }
        }
        if (!debe.equals(haber)) {
            return regla422('descuadre', 'Regla de negocio', `El debe (${debe.toFixed(2)}) y el haber (${haber.toFixed(2)}) no cuadran`)
        }
        const empresaId = empresaActivaDe(solicitud) ?? 1
        const usuario = usuarioDe(solicitud)
        const fecha = typeof cuerpo.fecha === 'string' ? cuerpo.fecha : null
        const requiere = bd.operacionPm.ajustesCobro[empresaId]?.asientos_requieren_aprobacion ?? false
        if (requiere) {
            const borrador: Borrador = {
                id: siguienteId(bd.borradoresAsiento),
                empresa_id: empresaId,
                fecha,
                descripcion,
                movimientos: lineas.map(l => ({ cuenta: l.cuenta, debe: l.debe ?? '0.00', haber: l.haber ?? '0.00', cliente_id: l.cliente_id, proveedor_id: l.proveedor_id })),
                total: debe.toFixed(2),
                estado: 'pendiente',
                creado_por: usuario?.id ?? null,
                creado_por_nombre: usuario?.nombre ?? null,
                created_at: ahora(),
                decidido_por: null,
                decidido_por_nombre: null,
                decidido_en: null,
                motivo_rechazo: null,
                asiento_id: null,
            }
            bd.borradoresAsiento.push(borrador)
            registrarAccion(solicitud, 'libro.registrar_asiento', { tipo: 'borrador_asiento', id: borrador.id }, cuerpo)
            return { status: 201, cuerpo: { estado: 'pendiente_aprobacion', asiento_id: null, borrador } satisfies Schema<'AsientoManual'> }
        }
        const instante = ahora()
        const asiento: Schema<'Asiento'> = {
            id: siguienteId(bd.asientos),
            empresa_id: empresaId,
            fecha: fecha ?? fechaGuatemala(instante),
            descripcion,
            origen_tipo: 'ajuste',
            origen_id: null,
            diario: 'VAR',
            reversa_de: null,
            created_by: usuario?.id ?? null,
            created_at: instante,
            movimientos: lineas.map(l => movimiento(
                bd.cuentas.find(c => c.codigo === l.cuenta)!.id,
                l.debe ? 'debe' : 'haber',
                (l.debe ?? l.haber)!,
                l.cliente_id,
            )),
        }
        bd.asientos.push(asiento)
        registrarAccion(solicitud, 'libro.registrar_asiento', { tipo: 'asiento', id: asiento.id }, cuerpo)
        return { status: 201, cuerpo: { estado: 'registrado', asiento_id: asiento.id, borrador: null } satisfies Schema<'AsientoManual'> }
    })),

    'GET /api/v1/libro/borradores': conPermiso('libro.ver', (solicitud) => {
        const estado = solicitud.query.get('estado')
        const filas = deLaEmpresa(bd.borradoresAsiento, solicitud)
            .filter(b => !estado || b.estado === estado)
            .sort((a, b) => b.id - a.id)
        return { status: 200, cuerpo: paginar(filas, solicitud) }
    }),

    'GET /api/v1/libro/borradores/:id': conPermiso('libro.ver', (solicitud) => {
        const borrador = bd.borradoresAsiento.find(b => b.id === idDe(solicitud))
        return borrador ? { status: 200, cuerpo: borrador } : noEncontrado('el borrador')
    }),

    'POST /api/v1/libro/borradores/:id/aprobar': conPermiso('libro.aprobar_asiento', conIdempotencia((solicitud) => {
        const borrador = bd.borradoresAsiento.find(b => b.id === idDe(solicitud))
        if (!borrador) {
            return noEncontrado('el borrador')
        }
        const usuario = usuarioDe(solicitud)
        if (borrador.estado !== 'pendiente') {
            return conflicto('borrador_decidido', 'Conflicto', 'Este borrador ya se aprobó o se rechazó')
        }
        if (usuario && borrador.creado_por === usuario.id) {
            return problemaTipado(403, 'autoaprobacion', 'Sin permiso', 'Quien creó el asiento no puede aprobarlo')
        }
        const instante = ahora()
        const asiento: Schema<'Asiento'> = {
            id: siguienteId(bd.asientos),
            empresa_id: borrador.empresa_id,
            fecha: borrador.fecha ?? fechaGuatemala(instante),
            descripcion: borrador.descripcion,
            origen_tipo: 'ajuste',
            origen_id: null,
            diario: 'VAR',
            reversa_de: null,
            created_by: borrador.creado_por,
            created_at: instante,
            movimientos: borrador.movimientos.map(m => movimiento(
                bd.cuentas.find(c => c.codigo === m.cuenta)?.id ?? 0,
                new Decimal(m.debe).gt(0) ? 'debe' : 'haber',
                new Decimal(m.debe).gt(0) ? m.debe : m.haber,
                m.cliente_id,
            )),
        }
        bd.asientos.push(asiento)
        Object.assign(borrador, { estado: 'aprobado', decidido_por: usuario?.id ?? null, decidido_por_nombre: usuario?.nombre ?? null, decidido_en: instante, asiento_id: asiento.id })
        registrarAccion(solicitud, 'libro.aprobar_asiento', { tipo: 'borrador_asiento', id: borrador.id }, {})
        return { status: 200, cuerpo: borrador }
    })),

    'POST /api/v1/libro/borradores/:id/rechazar': conPermiso('libro.rechazar_asiento', conIdempotencia((solicitud) => {
        const borrador = bd.borradoresAsiento.find(b => b.id === idDe(solicitud))
        if (!borrador) {
            return noEncontrado('el borrador')
        }
        const { motivo } = cuerpoObjeto(solicitud)
        const texto = typeof motivo === 'string' ? motivo.trim() : ''
        if (texto.length < 3 || texto.length > 500) {
            return invalido([{ field: 'motivo', message: 'El motivo debe tener entre 3 y 500 caracteres', rule: 'minLength' }])
        }
        if (borrador.estado !== 'pendiente') {
            return conflicto('borrador_decidido', 'Conflicto', 'Este borrador ya se aprobó o se rechazó')
        }
        const usuario = usuarioDe(solicitud)
        Object.assign(borrador, { estado: 'rechazado', decidido_por: usuario?.id ?? null, decidido_por_nombre: usuario?.nombre ?? null, decidido_en: ahora(), motivo_rechazo: texto })
        registrarAccion(solicitud, 'libro.rechazar_asiento', { tipo: 'borrador_asiento', id: borrador.id }, { motivo: texto })
        return { status: 200, cuerpo: borrador }
    })),
}
