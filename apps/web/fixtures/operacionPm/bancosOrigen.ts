import type { Schema } from '@argosisp/contracts'
import type { RutasFixture, SolicitudFixture } from '~/utils/fetchFixtures'
import { bd, siguienteId } from '../bd'
import { conIdempotencia, conPermiso, cuerpoObjeto, datosInvalidos, empresaActivaDe, idDe, noEncontrado, normalizar, problemaTipado, registrarAccion, versionCambiada } from '../comun'
import { empresaRequerida, texto } from './comun'

type BancoOrigen = Schema<'BancoOrigen'>

function metaDe(id: number, indice: number): { orden: number, version: number } {
    return bd.operacionPm.bancosMeta[id] ?? { orden: (indice + 1) * 10, version: 1 }
}

/** Como `GET /bancos-origen` (A3, decisión 23): todos los del catálogo, con `oculto` de la empresa activa. */
function bancoOrigen(banco: Schema<'Banco'>, empresaId: number | null): BancoOrigen {
    const indice = bd.bancos.findIndex(b => b.id === banco.id)
    const meta = metaDe(banco.id, indice)
    return {
        id: banco.id,
        nombre: banco.nombre,
        orden: meta.orden,
        activo: banco.activo,
        oculto: empresaId !== null && (bd.operacionPm.bancosOcultos[empresaId] ?? []).includes(banco.id),
        version: meta.version,
    }
}

function catalogo(empresaId: number | null): BancoOrigen[] {
    return bd.bancos.map(b => bancoOrigen(b, empresaId)).sort((a, b) => a.orden - b.orden || a.id - b.id)
}

function duplicado(nombre: string, excepto?: number): boolean {
    return bd.bancos.some(b => b.id !== excepto && normalizar(b.nombre) === normalizar(nombre))
}

function cambiarOculto(solicitud: SolicitudFixture, ocultar: boolean) {
    const empresa = empresaRequerida(solicitud)
    if (!empresa.ok) {
        return empresa.falla
    }
    const banco = bd.bancos.find(b => b.id === idDe(solicitud))
    if (!banco) {
        return noEncontrado('el banco')
    }
    const ocultos = new Set(bd.operacionPm.bancosOcultos[empresa.id] ?? [])
    if (ocultar) {
        ocultos.add(banco.id)
    }
    else {
        ocultos.delete(banco.id)
    }
    bd.operacionPm.bancosOcultos[empresa.id] = [...ocultos]
    registrarAccion(solicitud, ocultar ? 'bancos_origen.ocultar' : 'bancos_origen.mostrar', { tipo: 'banco_origen', id: banco.id }, {})
    return { status: 200, cuerpo: bancoOrigen(banco, empresa.id) }
}

/** Bancos que la empresa activa ocultó (`GET /bancos` ya no los trae). */
export function bancosOcultosDe(solicitud: SolicitudFixture): number[] {
    const empresa = empresaActivaDe(solicitud)
    return empresa ? bd.operacionPm.bancosOcultos[empresa] ?? [] : []
}

export const rutasBancosOrigen: RutasFixture = {
    'GET /api/v1/bancos-origen': conPermiso('cuentas_bancarias.ver', solicitud => ({ status: 200, cuerpo: catalogo(empresaActivaDe(solicitud)) })),

    'POST /api/v1/bancos-origen': conPermiso('bancos_origen.crear', conIdempotencia((solicitud) => {
        const cuerpo = cuerpoObjeto(solicitud)
        const nombre = texto(cuerpo.nombre)
        if (nombre.length < 2 || nombre.length > 100) {
            return datosInvalidos([{ field: 'nombre', message: 'El nombre debe tener entre 2 y 100 caracteres', rule: 'minLength' }])
        }
        if (duplicado(nombre)) {
            return problemaTipado(409, 'banco_duplicado', 'Banco duplicado', `Ya existe un banco llamado ${nombre}`)
        }
        const id = siguienteId(bd.bancos)
        // Por defecto, después de los demás y antes de «Otro».
        const otro = bd.bancos.find(b => normalizar(b.nombre) === 'otro')
        const ordenOtro = otro ? metaDe(otro.id, bd.bancos.indexOf(otro)).orden : Number.POSITIVE_INFINITY
        const ordenes = bd.bancos.filter(b => b !== otro).map((b, i) => metaDe(b.id, i).orden)
        const orden = typeof cuerpo.orden === 'number' ? cuerpo.orden : Math.min(Math.max(0, ...ordenes) + 1, ordenOtro - 1)
        bd.bancos.push({ id, nombre, activo: true })
        bd.operacionPm.bancosMeta[id] = { orden, version: 1 }
        registrarAccion(solicitud, 'bancos_origen.crear', { tipo: 'banco_origen', id }, cuerpo)
        const banco = bd.bancos.find(b => b.id === id)
        return banco ? { status: 201, cuerpo: bancoOrigen(banco, empresaActivaDe(solicitud)) } : noEncontrado('el banco')
    })),

    'PUT /api/v1/bancos-origen/:id': conPermiso('bancos_origen.editar', conIdempotencia((solicitud) => {
        const banco = bd.bancos.find(b => b.id === idDe(solicitud))
        if (!banco) {
            return noEncontrado('el banco')
        }
        const cuerpo = cuerpoObjeto(solicitud)
        const indice = bd.bancos.indexOf(banco)
        const meta = metaDe(banco.id, indice)
        if (cuerpo.version !== meta.version) {
            return versionCambiada()
        }
        const nombre = cuerpo.nombre === undefined ? banco.nombre : texto(cuerpo.nombre)
        if (nombre.length < 2 || nombre.length > 100) {
            return datosInvalidos([{ field: 'nombre', message: 'El nombre debe tener entre 2 y 100 caracteres', rule: 'minLength' }])
        }
        if (duplicado(nombre, banco.id)) {
            return problemaTipado(409, 'banco_duplicado', 'Banco duplicado', `Ya existe un banco llamado ${nombre}`)
        }
        banco.nombre = nombre
        if (typeof cuerpo.activo === 'boolean') {
            banco.activo = cuerpo.activo
        }
        bd.operacionPm.bancosMeta[banco.id] = { orden: typeof cuerpo.orden === 'number' ? cuerpo.orden : meta.orden, version: meta.version + 1 }
        registrarAccion(solicitud, 'bancos_origen.editar', { tipo: 'banco_origen', id: banco.id }, cuerpo)
        return { status: 200, cuerpo: bancoOrigen(banco, empresaActivaDe(solicitud)) }
    })),

    'POST /api/v1/bancos-origen/:id/ocultar': conPermiso('bancos_origen.ocultar', conIdempotencia(solicitud => cambiarOculto(solicitud, true))),
    'POST /api/v1/bancos-origen/:id/mostrar': conPermiso('bancos_origen.mostrar', conIdempotencia(solicitud => cambiarOculto(solicitud, false))),
}
