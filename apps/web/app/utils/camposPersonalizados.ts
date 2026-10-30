import * as z from 'zod'
import type { Schema, paths } from '@argosisp/contracts'

type Tipo = Schema<'CampoPersonalizado'>['tipo']

/** Tipos de campo personalizado (A1) con su texto y el control que usa la ficha del cliente. */
export const TIPOS_CAMPO_PERSONALIZADO: Record<Tipo, { etiqueta: string, descripcion: string, icono: string }> = {
    texto: { etiqueta: 'Texto', descripcion: 'Hasta 500 caracteres.', icono: 'i-lucide-type' },
    numero: { etiqueta: 'Número', descripcion: 'Un número, con o sin decimales.', icono: 'i-lucide-hash' },
    fecha: { etiqueta: 'Fecha', descripcion: 'Día, mes y año.', icono: 'i-lucide-calendar' },
    booleano: { etiqueta: 'Sí o no', descripcion: 'Un interruptor.', icono: 'i-lucide-toggle-left' },
    opcion: { etiqueta: 'Lista de opciones', descripcion: 'Uno de los valores de la lista.', icono: 'i-lucide-list' },
}

export const OPCIONES_TIPO_CAMPO = (Object.keys(TIPOS_CAMPO_PERSONALIZADO) as Tipo[])
    .map(tipo => ({ label: TIPOS_CAMPO_PERSONALIZADO[tipo].etiqueta, value: tipo }))

/** Clave sugerida desde la etiqueta: minúsculas sin tildes, `_` entre palabras, hasta 40. */
export function claveDesdeEtiqueta(etiqueta: string): string {
    const base = etiqueta
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^[^a-z]+/, '')
        .replace(/_+$/, '')
    return base.slice(0, 40).replace(/_+$/, '')
}

/**
 * Espejo de los validadores de `POST` y `PUT /campos-personalizados` (A1): clave
 * `^[a-z][a-z0-9_]{0,39}$`, etiqueta 1–80, opciones solo con `opcion` (al menos una, sin vacías
 * ni repetidas, hasta 50 de 80 caracteres), orden 0–10000.
 */
export const esquemaCampoPersonalizado = z.object({
    clave: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/, 'Empieza con minúscula; solo minúsculas, números y guion bajo (hasta 40)'),
    etiqueta: z.string().trim().min(1, 'Escribe la etiqueta').max(80, 'Máximo 80 caracteres'),
    tipo: z.enum(['texto', 'numero', 'fecha', 'booleano', 'opcion']),
    opciones: z.array(z.string().trim().min(1).max(80, 'Cada opción, máximo 80 caracteres')).max(50, 'Máximo 50 opciones'),
    requerido: z.boolean(),
    orden: z.number({ message: 'Escribe el orden' }).int('Solo enteros').min(0, 'Desde 0').max(10000, 'Hasta 10000'),
}).superRefine((valor, ctx) => {
    if (valor.tipo === 'opcion' && valor.opciones.length === 0) {
        ctx.addIssue({ code: 'custom', path: ['opciones'], message: 'Agrega al menos una opción' })
    }
    if (valor.tipo !== 'opcion' && valor.opciones.length > 0) {
        ctx.addIssue({ code: 'custom', path: ['opciones'], message: 'Solo un campo de tipo lista lleva opciones' })
    }
    if (new Set(valor.opciones.map(o => o.trim())).size !== valor.opciones.length) {
        ctx.addIssue({ code: 'custom', path: ['opciones'], message: 'Hay opciones repetidas' })
    }
})

export type EstadoCampoPersonalizado = z.input<typeof esquemaCampoPersonalizado>

/*
 * Valores de los campos personalizados en la ficha y el formulario del cliente
 * (`Cliente.campos_personalizados`, espejo de `validarCamposPersonalizados` de A1).
 */

type Campo = Schema<'CampoPersonalizado'>

/** Valor de un campo en el formulario: texto, fecha y opción como texto (`''` = vacío). */
export type ValorCampoFormulario = string | number | boolean | null | undefined

/** Valor que viaja a la API: `null` = vacío. */
export type ValorCampoApi = string | number | boolean | null

export const valoresCamposFormulario = z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null(), z.undefined()]))

function vacio(valor: ValorCampoFormulario): boolean {
    return valor === undefined || valor === null || (typeof valor === 'string' && valor.trim() === '')
}

/** `AAAA-MM-DD` que existe en el calendario. */
function fechaValida(valor: string): boolean {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(valor)) {
        return false
    }
    const fecha = new Date(`${valor}T00:00:00Z`)
    return !Number.isNaN(fecha.getTime()) && fecha.toISOString().startsWith(valor)
}

/** El mismo texto de error que la API (422 `campos_personalizados.<clave>`), o `null`. */
export function errorValorCampo(campo: Campo, valor: ValorCampoFormulario): string | null {
    if (vacio(valor)) {
        return campo.requerido ? `Completa «${campo.etiqueta}»: es obligatorio` : null
    }
    switch (campo.tipo) {
        case 'texto':
            if (typeof valor !== 'string') {
                return `${campo.etiqueta}: debe ser texto`
            }
            return valor.trim().length <= 500 ? null : `${campo.etiqueta}: máximo 500 caracteres`
        case 'numero':
            return typeof valor === 'number' && Number.isFinite(valor) ? null : `${campo.etiqueta}: debe ser un número`
        case 'fecha':
            return typeof valor === 'string' && fechaValida(valor) ? null : `${campo.etiqueta}: debe ser una fecha AAAA-MM-DD`
        case 'booleano':
            return typeof valor === 'boolean' ? null : `${campo.etiqueta}: debe ser verdadero o falso`
        case 'opcion':
            return typeof valor === 'string' && campo.opciones.includes(valor) ? null : `${campo.etiqueta}: debe ser una de ${campo.opciones.join(', ')}`
    }
}

/** Valor para la API: texto sin espacios de más; vacío = `null`. */
export function valorCampoApi(valor: ValorCampoFormulario): ValorCampoApi {
    if (vacio(valor) || valor === undefined) {
        return null
    }
    return typeof valor === 'string' ? valor.trim() : valor
}

/**
 * Estado inicial de los campos activos: el valor guardado si es del tipo del control; si no
 * (un dato viejo o de otro tipo), vacío y la API pide uno válido al guardar. Un booleano sin
 * valor arranca en `false` (el interruptor no tiene «vacío»).
 */
export function entradaCampos(campos: Campo[], valores: Record<string, unknown> = {}): Record<string, ValorCampoFormulario> {
    const entrada: Record<string, ValorCampoFormulario> = {}
    for (const campo of campos) {
        const valor = valores[campo.clave]
        if (campo.tipo === 'booleano') {
            entrada[campo.clave] = typeof valor === 'boolean' ? valor : false
        }
        else if (campo.tipo === 'numero') {
            entrada[campo.clave] = typeof valor === 'number' ? valor : null
        }
        else {
            entrada[campo.clave] = typeof valor === 'string' ? valor : typeof valor === 'number' ? String(valor) : ''
        }
    }
    return entrada
}

/** Valor de `campos_personalizados` en el cuerpo de `POST/PUT /clientes` (contrato). */
export type ValorCampoCuerpo = NonNullable<paths['/api/v1/clientes']['post']['requestBody']['content']['application/json']['campos_personalizados']>[string]

/**
 * Un valor guardado tal como lo acepta el cuerpo. El contrato tipa un objeto JSON como
 * `Record<string, never>` (sin propiedades declaradas); un objeto guardado (del importador) se
 * devuelve igual, sin tocarlo.
 */
function esValorCuerpo(valor: unknown): valor is ValorCampoCuerpo {
    return valor === null || ['string', 'number', 'boolean', 'object'].includes(typeof valor)
}

/**
 * `campos_personalizados` del cuerpo: los activos del catálogo con su valor y, al editar, las
 * claves que el formulario no muestra (inactivas, del importador) tal cual, porque la API
 * reemplaza el objeto completo.
 */
export function cuerpoCampos(campos: Campo[], entrada: Record<string, ValorCampoFormulario>, guardados: Record<string, unknown> = {}): Record<string, ValorCampoCuerpo> {
    const cuerpo: Record<string, ValorCampoCuerpo> = {}
    for (const [clave, valor] of Object.entries(guardados)) {
        if (esValorCuerpo(valor)) {
            cuerpo[clave] = valor
        }
    }
    for (const campo of campos) {
        cuerpo[campo.clave] = valorCampoApi(entrada[campo.clave])
    }
    return cuerpo
}

/** Texto de un valor guardado para la ficha: Sí/No, fecha en Guatemala, número o texto. */
export function valorCampoLegible(campo: Pick<Campo, 'tipo'> | null, valor: unknown): string | null {
    if (valor === undefined || valor === null || valor === '') {
        return null
    }
    if (typeof valor === 'boolean') {
        return valor ? 'Sí' : 'No'
    }
    if (campo?.tipo === 'fecha' && typeof valor === 'string' && fechaValida(valor)) {
        return formatearFecha(valor)
    }
    if (typeof valor === 'number') {
        return valor.toLocaleString('es-GT')
    }
    return typeof valor === 'string' ? valor : JSON.stringify(valor)
}
