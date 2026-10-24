import type { Problem, Schema } from '@argosisp/contracts'
import type { RutasFixture, SolicitudFixture } from '~/utils/fetchFixtures'
import { bd, siguienteId } from '../bd'
import { ahora, conPermiso, cuerpoObjeto, datosInvalidos, idDe, noEncontrado, problemaTipado, registrarAccion, versionCambiada } from '../comun'

type Campo = Schema<'CampoPersonalizado'>

const CLAVE = /^[a-z][a-z0-9_]{0,39}$/
const TIPOS: readonly Campo['tipo'][] = ['texto', 'numero', 'fecha', 'booleano', 'opcion']

function ordenados(): Campo[] {
    return [...bd.camposPersonalizados].sort((a, b) => a.orden - b.orden || a.etiqueta.localeCompare(b.etiqueta) || a.id - b.id)
}

/** Como `normalizarOpciones` (A1): solo `opcion` lleva opciones, al menos una, sin vacías ni repetidas. */
function opcionesDe(tipo: Campo['tipo'], valor: unknown, actuales: string[] = []): string[] | NonNullable<Problem['errors']> {
    const lista = (Array.isArray(valor) ? valor.map(o => String(o)) : actuales).map(o => o.trim())
    if (tipo !== 'opcion') {
        return lista.length ? [{ field: 'opciones', message: 'Solo un campo de tipo opcion lleva opciones', rule: 'prohibido' }] : []
    }
    if (!lista.length || lista.some(o => o === '')) {
        return [{ field: 'opciones', message: 'Un campo de tipo opcion necesita al menos una opción no vacía', rule: 'required' }]
    }
    if (new Set(lista).size !== lista.length) {
        return [{ field: 'opciones', message: 'Hay opciones repetidas', rule: 'unico' }]
    }
    return lista
}

function esErrores(valor: string[] | NonNullable<Problem['errors']>): valor is NonNullable<Problem['errors']> {
    return valor.some(v => typeof v !== 'string')
}

function ordenValido(valor: unknown): boolean {
    return valor === undefined || (Number.isInteger(valor) && Number(valor) >= 0 && Number(valor) <= 10000)
}

/** `activar` y `desactivar`: control por `version`, idempotente si ya estaba así. */
function cambiarActivo(accion: 'activar' | 'desactivar') {
    return conPermiso(`campos_personalizados.${accion}`, (solicitud: SolicitudFixture) => {
        const campo = bd.camposPersonalizados.find(c => c.id === idDe(solicitud))
        if (!campo) {
            return noEncontrado('el campo personalizado')
        }
        if (cuerpoObjeto(solicitud).version !== campo.version) {
            return versionCambiada()
        }
        const activo = accion === 'activar'
        if (campo.activo !== activo) {
            campo.activo = activo
            campo.version += 1
            campo.updated_at = ahora()
        }
        registrarAccion(solicitud, `campos_personalizados.${accion}`, { tipo: 'campo_personalizado', id: campo.id }, { version: campo.version })
        return { status: 200, cuerpo: campo }
    })
}

export const rutasCamposPersonalizados: RutasFixture = {
    /** `clientes.ver`; `?activo=true` para el formulario del cliente. */
    'GET /api/v1/campos-personalizados': conPermiso('clientes.ver', (solicitud) => {
        const activo = solicitud.query.get('activo')
        const lista = ordenados().filter(c => activo === null || String(c.activo) === activo)
        return { status: 200, cuerpo: lista }
    }),

    /** Como `CrearCampoPersonalizado` (A1): 409 `campo_duplicado` si la clave ya existe. */
    'POST /api/v1/campos-personalizados': conPermiso('campos_personalizados.crear', (solicitud) => {
        const cuerpo = cuerpoObjeto(solicitud)
        const clave = typeof cuerpo.clave === 'string' ? cuerpo.clave : ''
        const etiqueta = typeof cuerpo.etiqueta === 'string' ? cuerpo.etiqueta.trim() : ''
        const tipo = TIPOS.find(t => t === cuerpo.tipo)
        const errores = [
            ...(!CLAVE.test(clave) ? [{ field: 'clave', message: 'La clave debe empezar con minúscula y llevar solo minúsculas, números y guion bajo (hasta 40)', rule: 'regex' }] : []),
            ...(!etiqueta || etiqueta.length > 80 ? [{ field: 'etiqueta', message: 'La etiqueta es obligatoria (hasta 80 caracteres)', rule: 'required' }] : []),
            ...(!tipo ? [{ field: 'tipo', message: 'El tipo no es válido', rule: 'enum' }] : []),
            ...(!ordenValido(cuerpo.orden) ? [{ field: 'orden', message: 'El orden va de 0 a 10000', rule: 'range' }] : []),
        ]
        if (errores.length || !tipo) {
            return datosInvalidos(errores)
        }
        if (bd.camposPersonalizados.some(c => c.clave === clave)) {
            return problemaTipado(409, 'campo_duplicado', 'Conflicto', `Ya existe el campo ${clave}`)
        }
        const opciones = opcionesDe(tipo, cuerpo.opciones)
        if (esErrores(opciones)) {
            return datosInvalidos(opciones)
        }
        const momento = ahora()
        const campo: Campo = {
            id: siguienteId(bd.camposPersonalizados),
            clave,
            etiqueta,
            tipo,
            opciones,
            requerido: cuerpo.requerido === true,
            orden: typeof cuerpo.orden === 'number' ? cuerpo.orden : 0,
            activo: true,
            version: 1,
            created_at: momento,
            updated_at: momento,
        }
        bd.camposPersonalizados.push(campo)
        registrarAccion(solicitud, 'campos_personalizados.crear', { tipo: 'campo_personalizado', id: campo.id }, cuerpo)
        return { status: 201, cuerpo: campo }
    }),

    /** Como `EditarCampoPersonalizado`: etiqueta, opciones, requerido y orden; `clave` y `tipo` fijos. */
    'PUT /api/v1/campos-personalizados/:id': conPermiso('campos_personalizados.editar', (solicitud) => {
        const campo = bd.camposPersonalizados.find(c => c.id === idDe(solicitud))
        if (!campo) {
            return noEncontrado('el campo personalizado')
        }
        const cuerpo = cuerpoObjeto(solicitud)
        const etiqueta = typeof cuerpo.etiqueta === 'string' ? cuerpo.etiqueta.trim() : undefined
        const errores = [
            ...(etiqueta !== undefined && (!etiqueta || etiqueta.length > 80) ? [{ field: 'etiqueta', message: 'La etiqueta es obligatoria (hasta 80 caracteres)', rule: 'required' }] : []),
            ...(!ordenValido(cuerpo.orden) ? [{ field: 'orden', message: 'El orden va de 0 a 10000', rule: 'range' }] : []),
        ]
        if (errores.length) {
            return datosInvalidos(errores)
        }
        if (cuerpo.version !== campo.version) {
            return versionCambiada()
        }
        const opciones = cuerpo.opciones === undefined ? campo.opciones : opcionesDe(campo.tipo, cuerpo.opciones, campo.opciones)
        if (esErrores(opciones)) {
            return datosInvalidos(opciones)
        }
        campo.etiqueta = etiqueta ?? campo.etiqueta
        campo.opciones = opciones
        campo.requerido = typeof cuerpo.requerido === 'boolean' ? cuerpo.requerido : campo.requerido
        campo.orden = typeof cuerpo.orden === 'number' ? cuerpo.orden : campo.orden
        campo.version += 1
        campo.updated_at = ahora()
        registrarAccion(solicitud, 'campos_personalizados.editar', { tipo: 'campo_personalizado', id: campo.id }, cuerpo)
        return { status: 200, cuerpo: campo }
    }),

    'POST /api/v1/campos-personalizados/:id/desactivar': cambiarActivo('desactivar'),
    'POST /api/v1/campos-personalizados/:id/activar': cambiarActivo('activar'),
}
