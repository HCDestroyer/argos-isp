import type { Problem, Schema } from '@argosisp/contracts'
import type { RutasFixture } from '~/utils/fetchFixtures'
import { bd } from '../bd'
import { conPermiso, cuerpoObjeto, datosInvalidos, noEncontrado, registrarAccion, versionCambiada } from '../comun'
import { pdfFixture, plantillasFabrica } from './datos'

type TipoPlantilla = Schema<'PlantillaDocumento'>['tipo']

function esTipo(valor: string | undefined): valor is TipoPlantilla {
    return valor === 'aviso_cobro' || valor === 'nota_credito'
}

function plantillaDe(tipo: TipoPlantilla): Schema<'PlantillaDocumento'> {
    return tipo === 'aviso_cobro' ? bd.plantillaAvisoCobro : bd.plantillaNotaCredito
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
        return esTipo(tipo) ? { status: 200, cuerpo: plantillaDe(tipo) } : noEncontrado('la plantilla')
    }),

    /** La plantilla de esta versión (con el bloque FEL), aunque la empresa haya guardado otra. No guarda nada. */
    'GET /api/v1/documentos/plantillas/:tipo/fabrica': conPermiso('documentos.ver', (solicitud) => {
        const tipo = solicitud.params.tipo
        return esTipo(tipo) ? { status: 200, cuerpo: structuredClone(plantillasFabrica[tipo]) } : noEncontrado('la plantilla')
    }),

    /** PDF de la nota de crédito (el mismo del portal), respetando el alcance sobre su factura. */
    'GET /api/v1/documentos/nota-credito/:notaId': conPermiso('facturas.ver', (solicitud) => {
        const nota = bd.notasCredito.find(n => n.id === Number(solicitud.params.notaId))
        return nota ? { status: 200, cuerpo: pdfFixture(`Nota de credito ${nota.id}`), contentType: 'application/pdf' } : noEncontrado('la nota de crédito')
    }),

    'PUT /api/v1/documentos/plantillas/:tipo': conPermiso('documentos.editar', (solicitud) => {
        const tipo = solicitud.params.tipo
        if (!esTipo(tipo)) {
            return noEncontrado('la plantilla')
        }
        const actual = plantillaDe(tipo)
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
        const guardada = { ...actual, html: String(cuerpo.html), version: actual.version + 1 }
        if (tipo === 'aviso_cobro') {
            bd.plantillaAvisoCobro = guardada
        }
        else {
            bd.plantillaNotaCredito = guardada
        }
        registrarAccion(solicitud, 'documentos.editar', { tipo: 'plantilla_documento', id: tipo === 'aviso_cobro' ? 1 : 2 }, { tipo })
        return { status: 200, cuerpo: guardada }
    }),

    'POST /api/v1/documentos/plantillas/:tipo/vista-previa': conPermiso('documentos.editar', (solicitud) => {
        if (!esTipo(solicitud.params.tipo)) {
            return noEncontrado('la plantilla')
        }
        const errores = validarPlantilla(cuerpoObjeto(solicitud).html)
        return errores.length
            ? datosInvalidos(errores)
            : { status: 200, cuerpo: pdfFixture('Vista previa del aviso de cobro'), contentType: 'application/pdf' }
    }),

    'GET /api/v1/documentos/aviso-cobro/:facturaId': conPermiso('facturas.ver', (solicitud) => {
        const factura = bd.facturas.find(f => f.id === Number(solicitud.params.facturaId))
        return factura
            ? { status: 200, cuerpo: pdfFixture(`Aviso de cobro ${factura.id}`), contentType: 'application/pdf' }
            : noEncontrado('la factura')
    }),
}
