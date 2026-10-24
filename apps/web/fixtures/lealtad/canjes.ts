import type { Problem, Schema } from '@argosisp/contracts'
import type { RutasFixture, SolicitudFixture } from '~/utils/fetchFixtures'
import { bd, siguienteId } from '../bd'
import { ahora, conIdempotencia, conPermiso, cuerpoObjeto, datosInvalidos, deLaEmpresa, empresaActivaDe, idDe, noEncontrado, paginar, problemaTipado, registrarAccion, versionCambiada } from '../comun'

type Premio = Schema<'PremioLealtad'>
type Canje = Schema<'CanjeLealtad'>
type Errores = NonNullable<Problem['errors']>

const MONTO = /^\d{1,12}(\.\d{1,2})?$/
const TIPOS = ['descuento_factura', 'mes_gratis', 'mejora_plan', 'bien', 'boletos'] as const

/** Como `camposDelTipo` (A3): valida los campos del tipo y deja en null los que no usa. */
function camposDelTipo(tipo: Premio['tipo'], c: Record<string, unknown>): { campos: Partial<Premio> } | { errores: Errores } {
    const errores: Errores = []
    const texto = (v: unknown) => (typeof v === 'string' && v !== '' ? v : null)
    const entero = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) ? v : null)
    const vacio: Partial<Premio> = { descuento_tipo: null, descuento_valor: null, tope: null, plan_destino_id: null, dias: null, costo_unitario: null, existencias: entero(c.existencias), sorteo_id: null, boletos: null }
    for (const campo of ['descuento_valor', 'tope', 'costo_unitario']) {
        if (texto(c[campo]) && !MONTO.test(String(c[campo]))) {
            errores.push({ field: campo, message: 'Monto inválido', rule: 'regex' })
        }
    }
    if (tipo === 'descuento_factura') {
        if (!c.descuento_tipo) {
            errores.push({ field: 'descuento_tipo', message: 'Obligatorio en un descuento', rule: 'required' })
        }
        if (!texto(c.descuento_valor)) {
            errores.push({ field: 'descuento_valor', message: 'Obligatorio en un descuento', rule: 'required' })
        }
        if (c.descuento_tipo === 'porcentaje' && Number(c.descuento_valor) > 100) {
            errores.push({ field: 'descuento_valor', message: 'Un porcentaje no pasa de 100', rule: 'range' })
        }
        return errores.length ? { errores } : { campos: { ...vacio, descuento_tipo: c.descuento_tipo as Premio['descuento_tipo'], descuento_valor: texto(c.descuento_valor), tope: c.descuento_tipo === 'porcentaje' ? texto(c.tope) : null } }
    }
    if (tipo === 'mejora_plan') {
        if (!entero(c.plan_destino_id) || !bd.planes.some(p => p.id === c.plan_destino_id)) {
            errores.push({ field: 'plan_destino_id', message: 'Obligatorio en una mejora de plan', rule: 'exists' })
        }
        if (!entero(c.dias)) {
            errores.push({ field: 'dias', message: 'Obligatorio en una mejora de plan', rule: 'required' })
        }
        return errores.length ? { errores } : { campos: { ...vacio, plan_destino_id: entero(c.plan_destino_id), dias: entero(c.dias) } }
    }
    if (tipo === 'boletos') {
        if (!entero(c.sorteo_id)) {
            errores.push({ field: 'sorteo_id', message: 'Obligatorio en un premio de boletos', rule: 'required' })
        }
        if (!entero(c.boletos)) {
            errores.push({ field: 'boletos', message: 'Obligatorio en un premio de boletos', rule: 'required' })
        }
        return errores.length ? { errores } : { campos: { ...vacio, sorteo_id: entero(c.sorteo_id), boletos: entero(c.boletos) } }
    }
    if (errores.length) {
        return { errores }
    }
    return { campos: tipo === 'bien' ? { ...vacio, costo_unitario: texto(c.costo_unitario) } : vacio }
}

function saldoDe(clienteId: number, empresaId: number): number {
    return bd.movimientosPuntos.filter(m => m.cliente_id === clienteId && m.empresa_id === empresaId).reduce((suma, m) => suma + m.puntos, 0)
}

function movimientoCanje(canje: Canje, puntos: number, solicitud: SolicitudFixture, tipo: 'canje' | 'reverso'): void {
    const id = siguienteId(bd.movimientosPuntos)
    bd.movimientosPuntos.push({
        id,
        empresa_id: canje.empresa_id,
        programa_id: canje.programa_id,
        cliente_id: canje.cliente_id,
        servicio_id: canje.servicio_id,
        tipo,
        puntos,
        regla_id: null,
        origen_tipo: 'canje',
        origen_id: canje.id,
        clave_unica: `canje:${canje.id}${tipo === 'reverso' ? ':reverso' : ''}`,
        vence_en: null,
        valor: '0.00',
        asiento_id: null,
        reversa_de: null,
        motivo: tipo === 'reverso' ? canje.motivo : null,
        creado_por: solicitud.token ? 1 : null,
        created_at: ahora(),
    })
}

export const rutasCanjesLealtad: RutasFixture = {
    'POST /api/v1/lealtad/premios': conPermiso('lealtad.configurar', conIdempotencia((solicitud) => {
        const cuerpo = cuerpoObjeto(solicitud)
        const programa = bd.programasLealtad.find(p => p.id === cuerpo.programa_id)
        if (!programa) {
            return noEncontrado('el programa')
        }
        const tipo = (TIPOS as readonly unknown[]).includes(cuerpo.tipo) ? cuerpo.tipo as Premio['tipo'] : null
        const nombre = typeof cuerpo.nombre === 'string' ? cuerpo.nombre.trim() : ''
        const errores: Errores = [
            ...(!tipo ? [{ field: 'tipo', message: 'Tipo inválido', rule: 'enum' }] : []),
            ...(!nombre ? [{ field: 'nombre', message: 'El nombre es obligatorio', rule: 'required' }] : []),
            ...(typeof cuerpo.costo_puntos !== 'number' || cuerpo.costo_puntos < 1 ? [{ field: 'costo_puntos', message: 'Al menos 1 punto', rule: 'min' }] : []),
        ]
        const resultado = tipo ? camposDelTipo(tipo, cuerpo) : null
        if (errores.length || !tipo || !resultado || 'errores' in resultado) {
            return datosInvalidos([...errores, ...(resultado && 'errores' in resultado ? resultado.errores : [])])
        }
        const creado = ahora()
        const premio: Premio = {
            id: siguienteId(bd.premiosLealtad),
            empresa_id: programa.empresa_id,
            programa_id: programa.id,
            tipo,
            nombre,
            costo_puntos: cuerpo.costo_puntos as number,
            descuento_tipo: null,
            descuento_valor: null,
            tope: null,
            plan_destino_id: null,
            dias: null,
            costo_unitario: null,
            existencias: null,
            sorteo_id: null,
            boletos: null,
            ...resultado.campos,
            en_portal: cuerpo.en_portal === true,
            activo: cuerpo.activo !== false,
            version: 1,
            created_at: creado,
            updated_at: creado,
        }
        bd.premiosLealtad.push(premio)
        registrarAccion(solicitud, 'lealtad.crear_premio', { tipo: 'premio_lealtad', id: premio.id }, cuerpo)
        return { status: 201, cuerpo: premio }
    })),

    'PUT /api/v1/lealtad/premios/:id': conPermiso('lealtad.configurar', (solicitud) => {
        const premio = bd.premiosLealtad.find(p => p.id === idDe(solicitud))
        if (!premio) {
            return noEncontrado('el premio')
        }
        const cuerpo = cuerpoObjeto(solicitud)
        if (cuerpo.version !== premio.version) {
            return versionCambiada()
        }
        const resultado = camposDelTipo(premio.tipo, { ...premio, ...cuerpo })
        if ('errores' in resultado) {
            return datosInvalidos(resultado.errores)
        }
        Object.assign(premio, {
            nombre: typeof cuerpo.nombre === 'string' ? cuerpo.nombre.trim() : premio.nombre,
            costo_puntos: typeof cuerpo.costo_puntos === 'number' ? cuerpo.costo_puntos : premio.costo_puntos,
            ...resultado.campos,
            en_portal: typeof cuerpo.en_portal === 'boolean' ? cuerpo.en_portal : premio.en_portal,
            activo: typeof cuerpo.activo === 'boolean' ? cuerpo.activo : premio.activo,
            version: premio.version + 1,
            updated_at: ahora(),
        })
        registrarAccion(solicitud, 'lealtad.editar_premio', { tipo: 'premio_lealtad', id: premio.id }, cuerpo)
        return { status: 200, cuerpo: premio }
    }),

    'GET /api/v1/lealtad/canjes': conPermiso('lealtad.ver', (solicitud) => {
        const estado = solicitud.query.get('estado')
        const cliente = Number(solicitud.query.get('cliente_id')) || null
        const filas = deLaEmpresa(bd.canjesLealtad, solicitud)
            .filter(c => !estado || c.estado === estado)
            .filter(c => cliente === null || c.cliente_id === cliente)
            .sort((a, b) => b.id - a.id)
        return { status: 200, cuerpo: paginar(filas, solicitud) }
    }),

    /**
     * Como `Canjear` (A3), simplificado: premio activo, servicio del cliente, saldo suficiente
     * (422 `saldo_insuficiente`) y existencias; el canje queda reservado (se aplica al facturar).
     */
    'POST /api/v1/lealtad/canjes': conPermiso('lealtad.canjear', conIdempotencia((solicitud) => {
        const cuerpo = cuerpoObjeto(solicitud)
        const premio = bd.premiosLealtad.find(p => p.id === cuerpo.premio_id)
        const servicio = bd.servicios.find(s => s.id === cuerpo.servicio_id)
        if (!premio || !premio.activo) {
            return problemaTipado(422, 'premio_inactivo', 'Regla de negocio', `El premio ${String(cuerpo.premio_id)} no está activo en el programa`)
        }
        if (!servicio || servicio.cliente_id !== cuerpo.cliente_id) {
            return datosInvalidos([{ field: 'servicio_id', message: 'El servicio no es del cliente', rule: 'servicio' }])
        }
        const empresa = premio.empresa_id ?? empresaActivaDe(solicitud) ?? 1
        const saldo = saldoDe(servicio.cliente_id, empresa)
        if (saldo < premio.costo_puntos) {
            return problemaTipado(422, 'saldo_insuficiente', 'Saldo insuficiente', `El cliente tiene ${saldo} puntos y el premio pide ${premio.costo_puntos}`)
        }
        if (premio.existencias !== null && premio.existencias <= 0) {
            return problemaTipado(422, 'sin_existencias', 'Sin existencias', `El premio ${premio.id} no tiene existencias`)
        }
        const creado = ahora()
        const canje: Canje = {
            id: siguienteId(bd.canjesLealtad),
            empresa_id: empresa,
            programa_id: premio.programa_id,
            cliente_id: servicio.cliente_id,
            servicio_id: servicio.id,
            premio_id: premio.id,
            premio_nombre: premio.nombre,
            tipo: premio.tipo,
            puntos: premio.costo_puntos,
            estado: 'reservado',
            descuento: null,
            factura_id: typeof cuerpo.factura_id === 'number' ? cuerpo.factura_id : null,
            bonificacion_id: null,
            nota_credito_id: null,
            plan_temporal_id: null,
            movimiento_id: null,
            canal: 'panel',
            aplicado_en: null,
            revertido_en: null,
            motivo: null,
            creado_por: 1,
            version: 1,
            created_at: creado,
            updated_at: creado,
        }
        bd.canjesLealtad.push(canje)
        if (premio.existencias !== null) {
            premio.existencias -= 1
        }
        movimientoCanje(canje, -premio.costo_puntos, solicitud, 'canje')
        canje.movimiento_id = bd.movimientosPuntos.at(-1)?.id ?? null
        registrarAccion(solicitud, 'lealtad.canjear', { tipo: 'canje_lealtad', id: canje.id }, cuerpo)
        return { status: 201, cuerpo: canje }
    })),

    /** Como `RevertirCanje` (A3): solo un reservado; devuelve los puntos con un movimiento de reverso. */
    'POST /api/v1/lealtad/canjes/:id/revertir': conPermiso('lealtad.revertir_canje', conIdempotencia((solicitud) => {
        const canje = bd.canjesLealtad.find(c => c.id === idDe(solicitud))
        if (!canje) {
            return noEncontrado('el canje')
        }
        const motivo = String(cuerpoObjeto(solicitud).motivo ?? '').trim()
        if (motivo.length < 3) {
            return datosInvalidos([{ field: 'motivo', message: 'El campo motivo debe tener al menos 3 caracteres', rule: 'minLength' }])
        }
        if (canje.estado !== 'reservado') {
            return problemaTipado(409, 'canje_no_reversible', 'Conflicto', `El canje ${canje.id} está ${canje.estado}`)
        }
        Object.assign(canje, { estado: 'revertido', motivo, revertido_en: ahora(), version: canje.version + 1, updated_at: ahora() })
        movimientoCanje(canje, canje.puntos, solicitud, 'reverso')
        registrarAccion(solicitud, 'lealtad.revertir_canje', { tipo: 'canje_lealtad', id: canje.id }, { motivo })
        return { status: 200, cuerpo: canje }
    })),
}
