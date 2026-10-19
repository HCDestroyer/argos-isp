import vine, { symbols } from '@vinejs/vine'

/**
 * Corrección de un bug de VineJS 4.4.0: `.meta()` sobre un tipo literal (`string`, `number`,
 * `boolean`, `enum`, `date`…) compila el campo con `allowNull = true`, como si fuera `.nullable()`.
 * Un campo obligatorio con `.meta({ description })` acepta entonces `null`; el bodyparser convierte
 * `""` en `null` y la acción recibe `null` donde esperaba un valor: 500 en vez de 422.
 *
 * Aquí se corrige una sola vez para todo el repositorio: el `MetaModifier` de los tipos literales
 * conserva el `allowNull` del esquema que envuelve (true solo si hay `.nullable()` debajo). El
 * OpenAPI no cambia: `toJSONSchema()` de VineJS ya calculaba `required` con ese mismo valor, así
 * que las descripciones y los `required` del contrato quedan iguales.
 *
 * - Se aplica al importar este módulo; lo importan `start/validator.ts` (primer preload, antes de
 *   que se compile cualquier validador) y `#shared/validadores` y `#shared/paginacion` (por si un
 *   validador se compila fuera de la aplicación, p. ej. en una prueba unitaria).
 * - Es idempotente. Si una versión nueva de VineJS cambia la clase, `metaConservaRequerido()` lo
 *   detecta y la prueba `tests/shared/vine_meta.spec.ts` falla.
 */

const PARSE = symbols.PARSE

type Parse = (...args: unknown[]) => { allowNull?: boolean }
type Parseable = { allowNull?: boolean; [PARSE]: Parse }

/** Prototipos ya corregidos (la corrección es idempotente aunque el módulo se cargue dos veces). */
const corregidos: WeakSet<object> = ((globalThis as Record<string, unknown>).__argosVineMeta ??=
    new WeakSet<object>()) as WeakSet<object>

function corregir() {
    const prototipo = Object.getPrototypeOf(vine.string().meta({})) as Parseable
    if (corregidos.has(prototipo)) return
    const original = prototipo[PARSE] as Parse
    prototipo[PARSE] = function (this: Parseable, ...args: unknown[]) {
        const salida = original.apply(this, args)
        // el getter `allowNull` del modificador devuelve el del esquema envuelto
        salida.allowNull = this.allowNull === true
        return salida
    }
    corregidos.add(prototipo)
}

corregir()

/** ¿Un campo obligatorio con `.meta()` rechaza `null`? (verificación de la corrección) */
export async function metaConservaRequerido(): Promise<boolean> {
    const validador = vine.compile(vine.object({ campo: vine.string().meta({ description: 'prueba' }) }))
    const [error] = await validador.tryValidate({ campo: null })
    return error !== null
}
