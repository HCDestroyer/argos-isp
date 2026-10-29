import { describe, expect, it } from 'vitest'
import * as z from 'zod'

/**
 * Todo campo que el esquema del formulario exige muestra el indicador `required` de UFormField
 * (fijo o con `:required` cuando depende de otro dato), y los mensajes por defecto de zod están en
 * español y dicen qué hacer. Se revisan los formularios cuyo `:schema` es un esquema de `utils/`
 * (o se arma desde uno); los esquemas escritos dentro del componente se revisan a mano.
 */
const modulos = import.meta.glob<Record<string, unknown>>('~/utils/*.ts', { eager: true })
const vistas = import.meta.glob<string>('~/**/*.vue', { eager: true, query: '?raw', import: 'default' })

type Definicion = { _zod?: { def?: { type?: string, in?: unknown, innerType?: unknown, schema?: unknown } }, shape?: Record<string, z.ZodType> }

/** El `z.object` de un esquema aunque venga envuelto en refine, transform o pipe. */
function objeto(esquema: unknown): Record<string, z.ZodType> | null {
    let actual = esquema as Definicion | undefined
    for (let i = 0; i < 6 && actual; i++) {
        if (actual.shape) {
            return actual.shape
        }
        const def = actual._zod?.def
        actual = (def?.in ?? def?.innerType ?? def?.schema) as Definicion | undefined
    }
    return null
}

/** Obligatorio: no acepta vacío de ninguna forma. Interruptores, listas y opciones siempre tienen valor. */
function obligatorio(campo: z.ZodType): boolean {
    const tipo = (campo as unknown as Definicion)._zod?.def?.type
    if (tipo === 'boolean' || tipo === 'enum' || tipo === 'literal' || tipo === 'array' || tipo === 'record' || tipo === 'object') {
        return false
    }
    return [undefined, '', null, 0].every(valor => !campo.safeParse(valor).success)
}

function esquemasDeUtils(): Map<string, Record<string, z.ZodType>> {
    const esquemas = new Map<string, Record<string, z.ZodType>>()
    for (const modulo of Object.values(modulos)) {
        for (const [nombre, valor] of Object.entries(modulo)) {
            let esquema: unknown = valor
            if (typeof valor === 'function' && nombre.startsWith('esquema')) {
                try {
                    esquema = (valor as (...argumentos: unknown[]) => unknown)([], {})
                }
                catch {
                    continue
                }
            }
            const forma = objeto(esquema)
            if (forma) {
                esquemas.set(nombre, forma)
            }
        }
    }
    return esquemas
}

describe('campos obligatorios con indicador', () => {
    it('cada campo exigido por el esquema de utils/ lleva required en su UFormField', () => {
        const esquemas = esquemasDeUtils()
        const faltan: string[] = []
        let revisados = 0
        for (const [ruta, fuente] of Object.entries(vistas)) {
            for (const uso of fuente.matchAll(/:schema="([A-Za-z0-9_]+)(?:\([^"]*\))?"/g)) {
                let nombre = uso[1]!
                if (!esquemas.has(nombre)) {
                    // `const esquema = computed(() => esquemaX.superRefine(…))` o `const esquema = esquemaX(…)`
                    nombre = fuente.match(new RegExp(`const ${nombre} = (?:computed\\(\\(\\) => )?([A-Za-z0-9_]+)`))?.[1] ?? nombre
                }
                const forma = esquemas.get(nombre)
                if (!forma) {
                    continue
                }
                revisados++
                const etiquetas = [...fuente.matchAll(/<UFormField\b[^>]*>/g)].map(e => e[0])
                for (const [campo, regla] of Object.entries(forma)) {
                    if (!obligatorio(regla)) {
                        continue
                    }
                    const etiqueta = etiquetas.find(e => new RegExp(`\\bname="${campo}"`).test(e))
                    if (etiqueta && !/\srequired\b|:required=/.test(etiqueta)) {
                        faltan.push(`${ruta.replace(/^.*\/app\//, '')}: ${campo}`)
                    }
                }
            }
        }
        expect(revisados).toBeGreaterThan(40)
        expect(faltan).toEqual([])
    })
})

describe('mensajes de validación por defecto', () => {
    it('dicen qué hacer, en español', () => {
        const esquema = z.object({
            nombre: z.string().min(2),
            corto: z.string().max(3),
            cantidad: z.number().positive(),
            plan: z.number(),
            correo: z.email(),
            tipo: z.enum(['a', 'b']),
        })
        const resultado = esquema.safeParse({ nombre: 'x', corto: 'abcd', cantidad: 0, plan: undefined, correo: 'no', tipo: 'c' })
        const mensajes = Object.fromEntries((resultado.error?.issues ?? []).map(i => [i.path.join('.'), i.message]))
        expect(mensajes).toEqual({
            nombre: 'Escribe al menos 2 caracteres',
            corto: 'Acorta el texto: máximo 3 caracteres',
            cantidad: 'Escribe un número mayor que 0',
            plan: 'Este dato es obligatorio: elige una opción o escribe un número',
            correo: 'Escribe un correo válido, como nombre@dominio.com',
            tipo: 'Elige una de las opciones de la lista',
        })
    })

    it('el mensaje propio del esquema gana', () => {
        const resultado = z.string().min(1, 'Escribe el nombre').safeParse('')
        expect(resultado.error?.issues[0]?.message).toBe('Escribe el nombre')
    })
})
