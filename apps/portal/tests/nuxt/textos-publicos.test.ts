import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * El cliente final nunca ve notas internas del equipo: ni menciones al PM, a los agentes (A1…A6),
 * fases, PRs o contratos, ni avisos de «aún no» / «llega en…». Se revisa el texto que llega a la
 * pantalla: la plantilla de cada `.vue` (sin comentarios HTML) y las cadenas de su `<script>` y de
 * `app/utils` (sin comentarios de código). Los comentarios sí pueden hablar del equipo.
 */

const APP = resolve(process.cwd(), 'app')

/** Solo para desarrollo con fixtures; nunca se muestra en producción. */
const EXCLUIDOS = new Set(['utils/fetchFixtures.ts'])

const SIN_LETRA_ANTES = '(?<![\\p{L}\\p{N}_-])'
const SIN_LETRA_DESPUES = '(?![\\p{L}\\p{N}_-])'

/** Siglas internas: con mayúsculas exactas (`pm` o `a1` sueltos no son notas). */
const SIGLAS = new RegExp(`${SIN_LETRA_ANTES}(?:PM|A[1-6]|PRs?|TODO|FIXME)${SIN_LETRA_DESPUES}`, 'u')

/** Frases de nota interna, sin importar mayúsculas ni tildes. */
const FRASES = new RegExp(
    `${SIN_LETRA_ANTES}(?:fases?|contratos?|decisi[oó]n del|a[uú]n no|todav[ií]a no|llegar?[aá]?n? en|`
    + `semana \\d+|pr[oó]xima fase|brief|backend|endpoint|walled garden|no implementad[oa]s?)${SIN_LETRA_DESPUES}`,
    'iu',
)

function notaInterna(linea: string): string | null {
    return linea.match(SIGLAS)?.[0] ?? linea.match(FRASES)?.[0] ?? null
}

/** Quita comentarios de TypeScript respetando las cadenas (una URL `https://` no es comentario). */
function sinComentarios(codigo: string): string {
    let salida = ''
    let comilla: string | null = null
    for (let i = 0; i < codigo.length; i++) {
        const c = codigo[i]!
        const siguiente = codigo[i + 1]
        if (comilla) {
            salida += c
            if (c === '\\') {
                salida += siguiente ?? ''
                i++
            }
            else if (c === comilla) {
                comilla = null
            }
            continue
        }
        if (c === '\'' || c === '"' || c === '`') {
            comilla = c
            salida += c
            continue
        }
        if (c === '/' && siguiente === '*') {
            const fin = codigo.indexOf('*/', i + 2)
            const trozo = codigo.slice(i, fin === -1 ? codigo.length : fin + 2)
            salida += trozo.replace(/[^\n]/g, ' ')
            i += trozo.length - 1
            continue
        }
        if (c === '/' && siguiente === '/') {
            const fin = codigo.indexOf('\n', i)
            i = (fin === -1 ? codigo.length : fin) - 1
            continue
        }
        salida += c
    }
    return salida
}

/** Solo las cadenas de cada línea (lo demás es código, no texto de pantalla). */
function soloCadenas(codigo: string): string {
    return codigo
        .split('\n')
        .map(linea => (linea.match(/(['"`])(?:\\.|(?!\1).)*\1/g) ?? []).join(' '))
        .join('\n')
}

/** Texto visible de un `.vue`: plantilla sin `<!-- -->` + cadenas del script sin comentarios. */
function textoDeVue(fuente: string): string {
    const inicio = fuente.indexOf('<template>')
    const fin = fuente.lastIndexOf('</template>')
    const plantilla = inicio === -1 ? '' : fuente.slice(inicio, fin === -1 ? undefined : fin)
    const script = fuente.match(/<script[^>]*>([\s\S]*?)<\/script>/)?.[1] ?? ''
    return [
        plantilla.replace(/<!--[\s\S]*?-->/g, comentario => comentario.replace(/[^\n]/g, ' ')),
        soloCadenas(sinComentarios(script)),
    ].join('\n')
}

function archivos(dir: string, acumulado: string[] = []): string[] {
    for (const entrada of readdirSync(dir, { withFileTypes: true })) {
        const ruta = join(dir, entrada.name)
        if (entrada.isDirectory()) {
            archivos(ruta, acumulado)
        }
        else if (/\.(vue|ts)$/.test(entrada.name)) {
            acumulado.push(ruta)
        }
    }
    return acumulado
}

/** `ruta:línea: coincidencia · texto` de cada nota interna encontrada. */
function hallazgos(): string[] {
    const encontrados: string[] = []
    for (const ruta of archivos(APP)) {
        const nombre = relative(APP, ruta)
        const esVue = ruta.endsWith('.vue')
        if (EXCLUIDOS.has(nombre) || (!esVue && !nombre.startsWith('utils/'))) {
            continue
        }
        const fuente = readFileSync(ruta, 'utf8')
        const texto = esVue ? textoDeVue(fuente) : soloCadenas(sinComentarios(fuente))
        texto.split('\n').forEach((linea, i) => {
            const nota = notaInterna(linea)
            if (nota) {
                encontrados.push(`${nombre}:${i + 1}: «${nota}» · ${linea.trim()}`)
            }
        })
    }
    return encontrados
}

describe('textos públicos del portal', () => {
    it('el detector reconoce notas internas y deja pasar el texto del cliente', () => {
        for (const nota of [
            'Pago en línea (llega en la semana 2)',
            'Pendiente de A3',
            'decisión del PM',
            'Disponible en la fase 4',
            'ver contratos/telegram.md',
            'La vinculación aún no está disponible',
            'Todavía no hay cuentas',
        ]) {
            expect(notaInterna(nota), nota).not.toBeNull()
        }
        for (const texto of [
            'Tu servicio está suspendido',
            'Se aplicará en tu próxima factura.',
            'Próximo sorteo',
            'i-lucide-hand-coins',
            'Paga antes del 30 de octubre',
        ]) {
            expect(notaInterna(texto), texto).toBeNull()
        }
    })

    it('los comentarios pueden hablar del equipo; el texto de la plantilla no', () => {
        const vue = [
            '<script setup lang="ts">',
            '// A3 decide (decisión del PM)',
            '/* llega en la semana 2 */',
            'const enlace = \'https://t.me/bot\'',
            '</script>',
            '<template>',
            '    <!-- contrato de A6 -->',
            '    <p>Hola</p>',
            '</template>',
        ].join('\n')
        expect(textoDeVue(vue).split('\n').map(notaInterna).filter(Boolean)).toEqual([])
        expect(notaInterna(textoDeVue('<template><p>Llega en la fase 2</p></template>'))).not.toBeNull()
    })

    it('ninguna plantilla, script ni utilidad del portal muestra notas internas', () => {
        expect(hallazgos()).toEqual([])
    })
})

/** Formularios del portal: todo dato obligatorio se marca con `required`. */
const OBLIGATORIOS: Record<string, string[]> = {
    'components/promesa/Solicitar.vue': ['vence_el'],
    'components/comprobante/Subir.vue': ['metodo', 'cuenta_bancaria_id', 'banco_origen_id', 'monto', 'fecha_deposito', 'referencia', 'archivo'],
    'pages/entrar.vue': ['identificador', 'codigo'],
    'components/cuenta/Contacto.vue': ['canal_preferido'],
    'components/puntos/ConfirmarCanje.vue': ['servicio_id'],
}

/** Atributos de cada `<UFormField …>` por su `name` (un `>` dentro de comillas no cierra la etiqueta). */
function camposDe(ruta: string): Map<string, string> {
    const fuente = readFileSync(join(APP, ruta), 'utf8')
    const campos = new Map<string, string>()
    for (const [, atributos] of fuente.matchAll(/<UFormField\b((?:[^>"]|"[^"]*")*)>/g)) {
        const nombre = atributos!.match(/\bname="([^"]+)"/)?.[1]
        if (nombre) {
            campos.set(nombre, atributos!)
        }
    }
    return campos
}

describe('campos obligatorios', () => {
    for (const [ruta, nombres] of Object.entries(OBLIGATORIOS)) {
        it(`${ruta}: ${nombres.join(', ')} llevan required`, () => {
            const campos = camposDe(ruta)
            for (const nombre of nombres) {
                expect(campos.get(nombre), `${ruta} · ${nombre}`).toMatch(/\srequired(\s|$)/)
            }
        })
    }

    it('donde no es obvio, el campo dice por qué se pide', () => {
        const conAyuda: [string, string][] = [
            ['components/promesa/Solicitar.vue', 'vence_el'],
            ['components/comprobante/Subir.vue', 'cuenta_bancaria_id'],
            ['components/comprobante/Subir.vue', 'banco_origen_id'],
            ['components/comprobante/Subir.vue', 'referencia'],
            ['pages/entrar.vue', 'identificador'],
            ['pages/entrar.vue', 'codigo'],
        ]
        for (const [ruta, nombre] of conAyuda) {
            expect(camposDe(ruta).get(nombre), `${ruta} · ${nombre}`).toMatch(/\shelp="[^"]{10,}"/)
        }
    })
})
