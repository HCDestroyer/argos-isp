import type { Problem, Schema } from '@argosisp/contracts'
import type { RutasFixture } from '~/utils/fetchFixtures'
import { bd } from '../bd'
import { conPermiso, cuerpoObjeto, datosInvalidos, noEncontrado, problemaTipado, registrarAccion, versionCambiada } from '../comun'
import { pdfFixture, plantillaFabrica, variablesDe } from './datos'

type Plantilla = Schema<'PlantillaDocumento'>
type TipoPlantilla = Plantilla['tipo']
type Formato = Plantilla['formato']

function esTipo(valor: unknown): valor is TipoPlantilla {
    return valor === 'aviso_cobro' || valor === 'nota_credito' || valor === 'recibo_cobro'
}

function esFormato(valor: unknown): valor is Formato {
    return valor === 'carta' || valor === 'pos_80'
}

/** La predeterminada del tipo o, sin ninguna guardada, la de fábrica en carta (id null, versión 0). */
function predeterminadaDe(tipo: TipoPlantilla): Plantilla {
    return bd.plantillasDocumentos.find(p => p.tipo === tipo && p.predeterminada) ?? {
        ...plantillaFabrica(tipo),
        id: null,
        nombre: 'Carta',
        predeterminada: true,
        activa: true,
        de_fabrica: true,
        version: 0,
        updated_at: null,
    }
}

function resumen(p: Plantilla): Schema<'PlantillaDocumentoResumen'> {
    return { id: p.id ?? 0, tipo: p.tipo, nombre: p.nombre, formato: p.formato, predeterminada: p.predeterminada, activa: p.activa, de_fabrica: p.de_fabrica, version: p.version, updated_at: p.updated_at ?? '' }
}

function guardarFila(plantilla: Plantilla): Plantilla {
    const indice = bd.plantillasDocumentos.findIndex(p => p.id === plantilla.id)
    if (indice >= 0) {
        bd.plantillasDocumentos[indice] = plantilla
    }
    else {
        bd.plantillasDocumentos.push(plantilla)
    }
    return plantilla
}

function siguientePlantilla(): number {
    return Math.max(0, ...bd.plantillasDocumentos.map(p => p.id ?? 0)) + 1
}

function nombreOcupado(tipo: TipoPlantilla, nombre: string, excepto: number | null): boolean {
    return bd.plantillasDocumentos.some(p => p.tipo === tipo && p.id !== excepto && p.nombre.toLowerCase() === nombre.toLowerCase())
}

/** `?plantilla_id=` de un PDF: activa y del mismo tipo (422 si no); sin él, la predeterminada. */
function plantillaParaImprimir(tipo: TipoPlantilla, query: URLSearchParams): Plantilla | Errores {
    const crudo = query.get('plantilla_id')
    if (!crudo) {
        return predeterminadaDe(tipo)
    }
    const plantilla = bd.plantillasDocumentos.find(p => p.id === Number(crudo))
    const motivo = !plantilla
        ? 'La plantilla no existe'
        : plantilla.tipo !== tipo ? `La plantilla es de otro documento (${plantilla.tipo}), no de ${tipo}` : !plantilla.activa ? 'La plantilla está desactivada' : null
    return motivo ? [{ field: 'plantilla_id', message: motivo, rule: 'plantilla' }] : plantilla!
}

function pdfCon(tipo: TipoPlantilla, query: URLSearchParams, titulo: string) {
    const plantilla = plantillaParaImprimir(tipo, query)
    if (Array.isArray(plantilla)) {
        return datosInvalidos(plantilla)
    }
    return { status: 200, cuerpo: pdfFixture(`${titulo} ${plantilla.nombre}`), contentType: 'application/pdf' }
}

/** Cambio de estado por id con `version` (predeterminar, desactivar, activar). */
function conVersion(solicitud: Parameters<Parameters<typeof conPermiso>[1]>[0], cambiar: (p: Plantilla) => Plantilla | ReturnType<typeof problemaTipado>, accion: string) {
    const plantilla = bd.plantillasDocumentos.find(p => p.id === Number(solicitud.params.id))
    if (!plantilla) {
        return noEncontrado('la plantilla')
    }
    const cuerpo = cuerpoObjeto(solicitud)
    if (cuerpo.version !== plantilla.version) {
        return versionCambiada()
    }
    const resultado = cambiar(plantilla)
    if ('status' in resultado) {
        return resultado
    }
    registrarAccion(solicitud, accion, { tipo: 'plantilla_documento', id: plantilla.id ?? 0 }, cuerpo)
    return { status: 200, cuerpo: guardarFila(resultado) }
}

type Errores = NonNullable<Problem['errors']>
type Empresa = Schema<'Empresa'>

const TELEFONO = /^\+?[\d\s()-]{7,30}$/
const CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Campos editables con su máximo, como `editarEmpresaValidator` (A5). */
const TEXTOS: Partial<Record<keyof Empresa, number>> = { nit: 20, direccion: 300, horario: 200, instrucciones_pago: 1000 }
const TELEFONOS: (keyof Empresa)[] = ['telefono', 'telefono_alterno', 'whatsapp']

function validarEmpresa(cuerpo: Record<string, unknown>): Errores {
    const errores: Errores = []
    if (cuerpo.nombre !== undefined) {
        const nombre = typeof cuerpo.nombre === 'string' ? cuerpo.nombre.trim() : ''
        if (nombre.length < 1 || nombre.length > 200) {
            errores.push({ field: 'nombre', message: 'El nombre debe tener entre 1 y 200 caracteres', rule: 'minLength' })
        }
    }
    for (const [campo, maximo] of Object.entries(TEXTOS)) {
        const valor = cuerpo[campo]
        if (valor !== undefined && valor !== null && (typeof valor !== 'string' || valor.trim().length > (maximo ?? 0))) {
            errores.push({ field: campo, message: `Máximo ${maximo} caracteres`, rule: 'maxLength' })
        }
    }
    for (const campo of TELEFONOS) {
        const valor = cuerpo[campo]
        if (valor !== undefined && valor !== null && (typeof valor !== 'string' || !TELEFONO.test(valor.trim()))) {
            errores.push({ field: campo, message: 'Teléfono inválido', rule: 'regex' })
        }
    }
    if (cuerpo.correo !== undefined && cuerpo.correo !== null && (typeof cuerpo.correo !== 'string' || !CORREO.test(cuerpo.correo.trim()))) {
        errores.push({ field: 'correo', message: 'Correo inválido', rule: 'email' })
    }
    return errores
}

/** Como `validarPlantilla` de la API: sin `{{{ }}}` ni `{{& }}` y secciones bien cerradas. */
function validarPlantilla(html: unknown): Errores {
    if (typeof html !== 'string' || html.length < 1 || html.length > 100_000) {
        return [{ field: 'html', message: 'La plantilla debe tener entre 1 y 100000 caracteres', rule: 'minLength' }]
    }
    if (/\{\{\{|\{\{\s*&/.test(html)) {
        return [{ field: 'html', message: 'No se permite {{{ }}} ni {{& }}: usa {{variable}}', rule: 'plantilla' }]
    }
    const abiertas: string[] = []
    for (const marca of html.matchAll(/\{\{\s*([#^/])\s*([\w.]+)\s*\}\}/g)) {
        const [, tipo, nombre = ''] = marca
        if (tipo === '/') {
            const ultima = abiertas.pop()
            if (ultima !== nombre) {
                return [{ field: 'html', message: `La plantilla no es válida: Unclosed section "${ultima ?? nombre}"`, rule: 'plantilla' }]
            }
        }
        else {
            abiertas.push(nombre)
        }
    }
    if (abiertas.length) {
        return [{ field: 'html', message: `La plantilla no es válida: Unclosed section "${abiertas.at(-1) ?? ''}"`, rule: 'plantilla' }]
    }
    if ((html.match(/\{\{/g) ?? []).length !== (html.match(/\}\}/g) ?? []).length) {
        return [{ field: 'html', message: 'La plantilla no es válida: Unclosed tag', rule: 'plantilla' }]
    }
    return []
}

function limpiar(valor: unknown): string | null {
    if (typeof valor !== 'string') {
        return null
    }
    const texto = valor.trim()
    return texto === '' ? null : texto
}

export const rutasDocumentos: RutasFixture = {
    'GET /api/v1/empresa': conPermiso('empresa.ver', () => ({ status: 200, cuerpo: bd.empresa })),

    'PUT /api/v1/empresa': conPermiso('empresa.editar', (solicitud) => {
        const cuerpo = cuerpoObjeto(solicitud)
        if (typeof cuerpo.version !== 'number') {
            return datosInvalidos([{ field: 'version', message: 'La versión es obligatoria', rule: 'required' }])
        }
        const errores = validarEmpresa(cuerpo)
        if (errores.length) {
            return datosInvalidos(errores)
        }
        if (cuerpo.version !== bd.empresa.version) {
            return versionCambiada()
        }
        const cambios: Partial<Empresa> = {}
        if (typeof cuerpo.nombre === 'string') {
            cambios.nombre = cuerpo.nombre.trim()
        }
        for (const campo of ['nit', 'direccion', 'telefono', 'telefono_alterno', 'whatsapp', 'correo', 'horario', 'instrucciones_pago'] as const) {
            if (campo in cuerpo) {
                cambios[campo] = limpiar(cuerpo[campo])
            }
        }
        bd.empresa = { ...bd.empresa, ...cambios, version: bd.empresa.version + 1 }
        registrarAccion(solicitud, 'empresa.editar', { tipo: 'empresa', id: 1 }, cuerpo)
        return { status: 200, cuerpo: bd.empresa }
    }),

    'GET /api/v1/documentos/plantillas/:tipo': conPermiso('documentos.ver', (solicitud) => {
        const tipo = solicitud.params.tipo
        return esTipo(tipo) ? { status: 200, cuerpo: predeterminadaDe(tipo) } : noEncontrado('la plantilla')
    }),

    /** La plantilla de esta versión en el formato pedido (con el bloque FEL), aunque la empresa haya guardado otra. */
    'GET /api/v1/documentos/plantillas/:tipo/fabrica': conPermiso('documentos.ver', (solicitud) => {
        const tipo = solicitud.params.tipo
        const formato = solicitud.query.get('formato') ?? 'carta'
        return esTipo(tipo) && esFormato(formato) ? { status: 200, cuerpo: structuredClone(plantillaFabrica(tipo, formato)) } : noEncontrado('la plantilla')
    }),

    /** PDF de la nota de crédito (el mismo del portal), respetando el alcance sobre su factura. */
    'GET /api/v1/documentos/nota-credito/:notaId': conPermiso('facturas.ver', (solicitud) => {
        const nota = bd.notasCredito.find(n => n.id === Number(solicitud.params.notaId))
        return nota ? pdfCon('nota_credito', solicitud.query, `Nota de credito ${nota.id}`) : noEncontrado('la nota de crédito')
    }),

    /** Compatibilidad: guarda el HTML de la predeterminada (versión 0 = guardar la de fábrica como «Carta»). */
    'PUT /api/v1/documentos/plantillas/:tipo': conPermiso('documentos.editar', (solicitud) => {
        const tipo = solicitud.params.tipo
        if (!esTipo(tipo)) {
            return noEncontrado('la plantilla')
        }
        const actual = predeterminadaDe(tipo)
        const cuerpo = cuerpoObjeto(solicitud)
        const errores = validarPlantilla(cuerpo.html)
        if (typeof cuerpo.version !== 'number') {
            errores.push({ field: 'version', message: 'La versión es obligatoria', rule: 'required' })
        }
        if (errores.length) {
            return datosInvalidos(errores)
        }
        if (cuerpo.version !== actual.version) {
            return versionCambiada()
        }
        const guardada = guardarFila({ ...actual, id: actual.id ?? siguientePlantilla(), html: String(cuerpo.html), de_fabrica: false, version: actual.version + 1, updated_at: new Date().toISOString() })
        registrarAccion(solicitud, 'documentos.editar', { tipo: 'plantilla_documento', id: guardada.id ?? 0 }, { tipo })
        return { status: 200, cuerpo: guardada }
    }),

    'POST /api/v1/documentos/plantillas/:tipo/vista-previa': conPermiso('documentos.editar', (solicitud) => {
        if (!esTipo(solicitud.params.tipo)) {
            return noEncontrado('la plantilla')
        }
        const errores = validarPlantilla(cuerpoObjeto(solicitud).html)
        return errores.length
            ? datosInvalidos(errores)
            : { status: 200, cuerpo: pdfFixture('Vista previa del documento'), contentType: 'application/pdf' }
    }),

    'GET /api/v1/documentos/aviso-cobro/:facturaId': conPermiso('facturas.ver', (solicitud) => {
        const factura = bd.facturas.find(f => f.id === Number(solicitud.params.facturaId))
        return factura ? pdfCon('aviso_cobro', solicitud.query, `Aviso de cobro ${factura.id}`) : noEncontrado('la factura')
    }),

    'GET /api/v1/documentos/recibo-cobro/:cobroId': conPermiso('pagos.ver', (solicitud) => {
        const cobro = bd.cobros.find(c => c.id === Number(solicitud.params.cobroId))
        return cobro ? pdfCon('recibo_cobro', solicitud.query, `Recibo de cobro ${cobro.id}`) : noEncontrado('el cobro')
    }),

    'GET /api/v1/plantillas-documentos': conPermiso('documentos.ver', (solicitud) => {
        const tipo = solicitud.query.get('tipo')
        const activa = solicitud.query.get('activa')
        const data = bd.plantillasDocumentos
            .filter(p => (!tipo || p.tipo === tipo) && (activa === null || String(p.activa) === activa))
            .sort((a, b) => a.tipo.localeCompare(b.tipo) || Number(b.predeterminada) - Number(a.predeterminada) || a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' }))
            .map(resumen)
        return { status: 200, cuerpo: { data, nextCursor: null } }
    }),

    'GET /api/v1/plantillas-documentos/:id': conPermiso('documentos.ver', (solicitud) => {
        const plantilla = bd.plantillasDocumentos.find(p => p.id === Number(solicitud.params.id))
        return plantilla ? { status: 200, cuerpo: plantilla } : noEncontrado('la plantilla')
    }),

    'POST /api/v1/plantillas-documentos': conPermiso('documentos.crear', (solicitud) => {
        const cuerpo = cuerpoObjeto(solicitud)
        const errores: Errores = []
        const nombre = typeof cuerpo.nombre === 'string' ? cuerpo.nombre.trim() : ''
        if (!esTipo(cuerpo.tipo)) {
            errores.push({ field: 'tipo', message: 'Elige un documento', rule: 'enum' })
        }
        if (nombre.length < 1 || nombre.length > 80) {
            errores.push({ field: 'nombre', message: 'El nombre debe tener entre 1 y 80 caracteres', rule: 'minLength' })
        }
        if (errores.length || !esTipo(cuerpo.tipo)) {
            return datosInvalidos(errores)
        }
        const tipo = cuerpo.tipo
        const origen = typeof cuerpo.copiar_de_id === 'number' ? bd.plantillasDocumentos.find(p => p.id === cuerpo.copiar_de_id) : undefined
        if (typeof cuerpo.copiar_de_id === 'number' && (!origen || origen.tipo !== tipo)) {
            return datosInvalidos([{ field: 'copiar_de_id', message: origen ? 'Solo se puede copiar una plantilla del mismo documento' : 'La plantilla a copiar no existe', rule: 'plantilla' }])
        }
        if (nombreOcupado(tipo, nombre, null)) {
            return datosInvalidos([{ field: 'nombre', message: 'Ya hay una plantilla de este documento con ese nombre', rule: 'unico' }])
        }
        const formato: Formato = esFormato(cuerpo.formato) ? cuerpo.formato : (origen?.formato ?? 'carta')
        const html = typeof cuerpo.html === 'string' ? cuerpo.html : origen && !(origen.de_fabrica && origen.formato === formato) ? origen.html : null
        const creada = guardarFila({
            id: siguientePlantilla(),
            tipo,
            nombre,
            formato,
            predeterminada: false,
            activa: true,
            de_fabrica: html === null,
            html: html ?? plantillaFabrica(tipo, formato).html,
            version: 1,
            updated_at: new Date().toISOString(),
            variables: variablesDe(tipo),
        })
        registrarAccion(solicitud, 'documentos.crear', { tipo: 'plantilla_documento', id: creada.id ?? 0 }, cuerpo)
        return { status: 201, cuerpo: creada }
    }),

    'PUT /api/v1/plantillas-documentos/:id': conPermiso('documentos.editar', (solicitud) => {
        const plantilla = bd.plantillasDocumentos.find(p => p.id === Number(solicitud.params.id))
        if (!plantilla) {
            return noEncontrado('la plantilla')
        }
        const cuerpo = cuerpoObjeto(solicitud)
        const nombre = typeof cuerpo.nombre === 'string' ? cuerpo.nombre.trim() : plantilla.nombre
        const formato = esFormato(cuerpo.formato) ? cuerpo.formato : plantilla.formato
        const errores = cuerpo.html === null || cuerpo.html === undefined ? [] : validarPlantilla(cuerpo.html)
        if (nombre.length < 1 || nombre.length > 80) {
            errores.push({ field: 'nombre', message: 'El nombre debe tener entre 1 y 80 caracteres', rule: 'minLength' })
        }
        if (errores.length) {
            return datosInvalidos(errores)
        }
        if (cuerpo.version !== plantilla.version) {
            return versionCambiada()
        }
        if (nombreOcupado(plantilla.tipo, nombre, plantilla.id)) {
            return datosInvalidos([{ field: 'nombre', message: 'Ya hay una plantilla de este documento con ese nombre', rule: 'unico' }])
        }
        const deFabrica = cuerpo.html === null || (cuerpo.html === undefined && plantilla.de_fabrica)
        const html = deFabrica ? plantillaFabrica(plantilla.tipo, formato).html : typeof cuerpo.html === 'string' ? cuerpo.html : plantilla.html
        registrarAccion(solicitud, 'documentos.editar', { tipo: 'plantilla_documento', id: plantilla.id ?? 0 }, cuerpo)
        return { status: 200, cuerpo: guardarFila({ ...plantilla, nombre, formato, html, de_fabrica: deFabrica, version: plantilla.version + 1, updated_at: new Date().toISOString() }) }
    }),

    'POST /api/v1/plantillas-documentos/:id/predeterminar': conPermiso('documentos.predeterminar', solicitud => conVersion(solicitud, (plantilla) => {
        if (plantilla.predeterminada) {
            return plantilla
        }
        if (!plantilla.activa) {
            return problemaTipado(422, 'plantilla_inactiva', 'Regla de negocio', 'Una plantilla desactivada no puede ser la predeterminada: actívala primero')
        }
        const anterior = bd.plantillasDocumentos.find(p => p.tipo === plantilla.tipo && p.predeterminada)
        if (anterior) {
            guardarFila({ ...anterior, predeterminada: false, version: anterior.version + 1 })
        }
        return { ...plantilla, predeterminada: true, version: plantilla.version + 1 }
    }, 'documentos.predeterminar')),

    'POST /api/v1/plantillas-documentos/:id/desactivar': conPermiso('documentos.desactivar', solicitud => conVersion(solicitud, (plantilla) => {
        if (plantilla.predeterminada) {
            return problemaTipado(422, 'plantilla_predeterminada', 'Regla de negocio', 'La plantilla predeterminada no se puede desactivar: marca otra como predeterminada primero')
        }
        return plantilla.activa ? { ...plantilla, activa: false, version: plantilla.version + 1 } : plantilla
    }, 'documentos.desactivar')),

    'POST /api/v1/plantillas-documentos/:id/activar': conPermiso('documentos.activar', solicitud => conVersion(solicitud, (plantilla) => {
        return plantilla.activa ? plantilla : { ...plantilla, activa: true, version: plantilla.version + 1 }
    }, 'documentos.activar')),
}
