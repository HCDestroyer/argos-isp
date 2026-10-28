/**
 * Render del script `.rsc` de conexión (`contratos/conexion-routers.md` §3).
 *
 * Formato de plantilla (acordado con A6 en `a6.md`):
 *
 * - `{{nombre}}`: el valor escapado para ir **dentro de comillas dobles** de RouterOS
 *   (`:local x "{{nombre}}"`). También en comentarios: el escape quita los saltos de línea, así un
 *   valor nunca agrega una línea de comandos.
 * - `{{lista:nombre}}`: arreglo literal de RouterOS ya armado (`{"a";"b"}`, o `{}` vacío), con cada
 *   elemento escapado. Va sin comillas: `:local admin {{lista:admin_ips}}`.
 * - `{{#seccion}} … {{/seccion}}`: se incluye si la sección es verdadera; `{{^seccion}} … {{/seccion}}`
 *   si es falsa. No se anidan secciones con el mismo nombre.
 *
 * Un marcador que no esté en las variables es un error (nunca se deja `{{x}}` en el script).
 */

export interface VariablesScript {
    textos: Record<string, string>
    listas: Record<string, string[]>
    secciones: Record<string, boolean>
}

export class PlantillaInvalida extends Error {}

/**
 * Escapa un valor para un string de RouterOS entre comillas dobles: `\`, `"`, `$` (variables) y `?`
 * (la ayuda de la terminal al pegar) llevan `\`; los caracteres de control salen como `\HH`.
 */
export function escaparRouterOS(valor: string): string {
    let salida = ''
    for (const caracter of valor) {
        const codigo = caracter.codePointAt(0)!
        if (caracter === '\\' || caracter === '"' || caracter === '$' || caracter === '?') {
            salida += `\\${caracter}`
        } else if (codigo < 0x20 || codigo === 0x7f) {
            salida += `\\${codigo.toString(16).toUpperCase().padStart(2, '0')}`
        } else {
            salida += caracter
        }
    }
    return salida
}

export function listaRouterOS(valores: string[]): string {
    return `{${valores.map((valor) => `"${escaparRouterOS(valor)}"`).join(';')}}`
}

const SECCION = /\{\{([#^])([a-z_][a-z0-9_]*)\}\}([\s\S]*?)\{\{\/\2\}\}/g
const MARCADOR = /\{\{(lista:)?([a-z_][a-z0-9_]*)\}\}/g

export function renderScript(plantilla: string, variables: VariablesScript): string {
    let texto = plantilla
    // Las secciones se resuelven de adentro hacia afuera hasta que no quede ninguna.
    for (let previo = ''; previo !== texto;) {
        previo = texto
        texto = texto.replace(SECCION, (_todo, tipo: string, nombre: string, cuerpo: string) => {
            if (!(nombre in variables.secciones)) {
                throw new PlantillaInvalida(`Sección desconocida: ${nombre}`)
            }
            const activa = variables.secciones[nombre] === (tipo === '#')
            return activa ? cuerpo : ''
        })
    }
    if (/\{\{[#^/]/.test(texto)) throw new PlantillaInvalida('Sección sin cerrar en la plantilla')
    return texto.replace(MARCADOR, (_todo, lista: string | undefined, nombre: string) => {
        if (lista) {
            const valores = variables.listas[nombre]
            if (!valores) throw new PlantillaInvalida(`Lista desconocida: ${nombre}`)
            return listaRouterOS(valores)
        }
        const valor = variables.textos[nombre]
        if (valor === undefined) throw new PlantillaInvalida(`Variable desconocida: ${nombre}`)
        return escaparRouterOS(valor)
    })
}
