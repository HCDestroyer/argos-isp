#!/usr/bin/env node
// Referencia de la API para el sitio de documentación, generada del código en cada compilación.
//
// Lee (sin dependencias, Node puro):
//   - packages/contracts/openapi.json      → una página por etiqueta con cada endpoint y la de esquemas
//   - apps/api/app/core/permisos.ts        → tabla de permisos con los roles base que los traen
//   - apps/api/app/shared/eventos.ts       → catálogo de eventos con su payload
// y escribe docs/desarrolladores/referencia/. Lo generado no se commitea (.gitignore de la raíz).
//
// Todo el texto que viene del código va dentro de un contenedor `::: v-pre` (VitePress no interpreta
// `{{ … }}`) y se escapa: `<` fuera de los bloques de código, `|` en las tablas y los saltos de línea.
//
// Uso: node scripts/generar-api.mjs   (lo corren `pnpm build` y `pnpm dev` de @argosisp/docs)
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as modulo from 'node:module'

const raiz = fileURLToPath(new URL('../../../', import.meta.url))
const salida = join(raiz, 'docs/desarrolladores/referencia')
const rutaOpenApi = join(raiz, 'packages/contracts/openapi.json')
const rutaPermisos = join(raiz, 'apps/api/app/core/permisos.ts')
const rutaEventos = join(raiz, 'apps/api/app/shared/eventos.ts')

/** Nombre legible de cada etiqueta del OpenAPI; una etiqueta nueva sin nombre aquí usa la suya. */
const TITULOS_ETIQUETA = {
    acl: 'Usuarios, roles y tokens',
    activos: 'Activos fijos',
    adicionales: 'Servicios adicionales',
    anuncios: 'Anuncios',
    auth: 'Autenticación',
    bancos: 'Bancos',
    bitacora: 'Bitácora',
    cajas: 'Cajas',
    cartera: 'Cartera',
    clientes: 'Clientes',
    compras: 'Compras',
    documentos: 'Documentos',
    egresos: 'Egresos',
    empresa: 'Empresa',
    empresas: 'Empresas',
    facturacion: 'Facturación',
    fel: 'FEL',
    fiscal: 'Fiscal',
    integraciones: 'Integraciones',
    interno: 'Interno',
    inventario: 'Inventario',
    ipam: 'IPAM',
    lealtad: 'Lealtad',
    libro: 'Libro contable',
    libros: 'Libros fiscales',
    notificaciones: 'Notificaciones',
    pagos: 'Pagos',
    planes: 'Planes',
    portal: 'Portal del cliente',
    promesas: 'Promesas de pago',
    qos: 'QoS',
    red: 'Red',
    red_acceso: 'Red de acceso',
    reportes: 'Reportes',
    routers: 'Routers',
    servicios: 'Servicios',
    sesiones: 'Sesiones',
    sistema: 'Sistema',
}

const SEGURIDAD = {
    bearer: 'Bearer (token de sesión `oat_…` o token de API `atk_…`)',
    panel: 'cookie del panel',
    nodo_portal: 'token de nodo portal',
    interno: 'token interno',
    portal: 'sesión del portal del cliente',
}

const ROLES_BASE = ['admin', 'cajero', 'soporte', 'tecnico', 'contabilidad', 'lectura']

// ---------------------------------------------------------------------------------------------
// Escape

/** Aplica `fn` solo a lo que está fuera de los `código` en línea. */
function fueraDeCodigo(texto, fn) {
    return texto
        .split(/(`[^`]*`)/)
        .map((parte, i) => (i % 2 === 1 ? parte : fn(parte)))
        .join('')
}

/** Texto en una línea, seguro para markdown de VitePress. */
function texto(valor) {
    if (valor === undefined || valor === null) return ''
    const plano = String(valor)
        .replace(/\s*\n\s*/g, ' ')
        .trim()
    return fueraDeCodigo(plano, (s) =>
        s.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\*/g, '\\*').replace(/\{\{/g, '{&#8203;{'),
    )
}

/** Texto para una celda de tabla (además escapa `|`). */
function celda(valor) {
    return texto(valor).replace(/\|/g, '\\|')
}

/** Código en línea con el valor tal cual (las comillas invertidas internas se evitan). */
function codigo(valor) {
    const s = String(valor)
    return s.includes('`') ? `\`\` ${s} \`\`` : `\`${s}\``
}

function slug(nombre) {
    return nombre
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
}

function pagina({ orden, titulo, intro, cuerpo }) {
    return [
        '---',
        `orden: ${orden}`,
        'editLink: false',
        'lastUpdated: false',
        '---',
        '',
        `# ${texto(titulo)}`,
        '',
        '::: v-pre',
        '',
        intro ? `${intro}\n` : '',
        cuerpo.trim(),
        '',
        ':::',
        '',
    ].join('\n')
}

// ---------------------------------------------------------------------------------------------
// OpenAPI

const openapi = JSON.parse(readFileSync(rutaOpenApi, 'utf8'))
const esquemas = openapi.components?.schemas ?? {}

function nombreRef(ref) {
    return ref.replace('#/components/schemas/', '')
}

function enlaceEsquema(nombre, desde = '') {
    return `[${nombre}](${desde}esquemas#${slug(nombre)})`
}

/** Tipo de un esquema en pocas palabras, con enlace a los esquemas con nombre. */
function tipo(esquema, desde = './') {
    if (!esquema || typeof esquema !== 'object') return 'cualquiera'
    if (esquema.$ref) return enlaceEsquema(nombreRef(esquema.$ref), desde)
    if (esquema.enum) {
        const valores = esquema.enum.map((v) => codigo(JSON.stringify(v)))
        return valores.length > 8 ? `uno de ${valores.length} valores` : valores.join(', ')
    }
    if (esquema.const !== undefined) return codigo(JSON.stringify(esquema.const))
    for (const clave of ['anyOf', 'oneOf']) {
        if (Array.isArray(esquema[clave])) return esquema[clave].map((s) => tipo(s, desde)).join(' o ')
    }
    if (Array.isArray(esquema.allOf)) return esquema.allOf.map((s) => tipo(s, desde)).join(' + ')
    const tipos = Array.isArray(esquema.type) ? esquema.type : esquema.type ? [esquema.type] : []
    const partes = tipos.map((t) => {
        if (t === 'array') return `${tipo(esquema.items, desde)}[]`
        if (t === 'object') {
            const props = esquema.properties ?? {}
            if (props.data && 'nextCursor' in props) {
                return `página de ${tipo(props.data.items, desde)} (\`{ data, nextCursor }\`)`
            }
            return 'objeto'
        }
        if (t === 'string' && esquema.format) return `string (${esquema.format})`
        return t
    })
    return partes.length > 0 ? partes.join(' o ') : 'cualquiera'
}

function restricciones(esquema) {
    if (!esquema || typeof esquema !== 'object' || esquema.$ref) return []
    const r = []
    if (esquema.minLength !== undefined) r.push(`mín. ${esquema.minLength} caracteres`)
    if (esquema.maxLength !== undefined) r.push(`máx. ${esquema.maxLength} caracteres`)
    if (esquema.minimum !== undefined) r.push(`mín. ${esquema.minimum}`)
    if (esquema.maximum !== undefined) r.push(`máx. ${esquema.maximum}`)
    if (esquema.maxItems !== undefined) r.push(`máx. ${esquema.maxItems} elementos`)
    if (esquema.pattern) r.push(`patrón ${codigo(esquema.pattern)}`)
    if (esquema.default !== undefined) r.push(`por defecto ${codigo(JSON.stringify(esquema.default))}`)
    return r
}

/** Tabla de propiedades de un objeto (primer nivel). */
function tablaPropiedades(esquema, desde) {
    const props = esquema?.properties ?? {}
    const nombres = Object.keys(props)
    if (nombres.length === 0) return ''
    const requeridos = new Set(esquema.required ?? [])
    const filas = nombres.map((n) => {
        const p = props[n]
        const extra = restricciones(p)
        const descripcion = [p.description, extra.length ? `(${extra.join(', ')})` : '']
            .filter(Boolean)
            .join(' ')
        return `| ${codigo(n)} | ${celda(tipo(p, desde))} | ${requeridos.has(n) ? 'sí' : 'no'} | ${celda(descripcion)} |`
    })
    return ['| Campo | Tipo | Obligatorio | Descripción |', '| --- | --- | --- | --- |', ...filas].join('\n')
}

function describirSeguridad(seguridad) {
    if (!seguridad || seguridad.length === 0) return 'pública (sin credencial)'
    return seguridad
        .map((alternativa) =>
            Object.keys(alternativa)
                .map((k) => SEGURIDAD[k] ?? k)
                .join(' + '),
        )
        .join(' o ')
}

function describirCuerpo(cuerpo, desde) {
    if (!cuerpo?.content) return ''
    const lineas = []
    for (const [tipoContenido, contenido] of Object.entries(cuerpo.content)) {
        const esquema = contenido.schema ?? {}
        const obligatorio = cuerpo.required ? 'obligatorio' : 'opcional'
        if (esquema.$ref || !esquema.properties) {
            lineas.push(`**Cuerpo** (${codigo(tipoContenido)}, ${obligatorio}): ${tipo(esquema, desde)}`)
        } else {
            lineas.push(
                `**Cuerpo** (${codigo(tipoContenido)}, ${obligatorio}):`,
                '',
                tablaPropiedades(esquema, desde),
            )
        }
        lineas.push('')
    }
    return lineas.join('\n')
}

function describirParametros(parametros, desde) {
    if (!parametros?.length) return ''
    const filas = parametros.map((p) => {
        const extra = restricciones(p.schema)
        const descripcion = [p.description, extra.length ? `(${extra.join(', ')})` : '']
            .filter(Boolean)
            .join(' ')
        return `| ${codigo(p.name)} | ${p.in} | ${celda(tipo(p.schema, desde))} | ${p.required ? 'sí' : 'no'} | ${celda(descripcion)} |`
    })
    return [
        '**Parámetros:**',
        '',
        '| Nombre | En | Tipo | Obligatorio | Descripción |',
        '| --- | --- | --- | --- | --- |',
        ...filas,
        '',
    ].join('\n')
}

function describirRespuestas(respuestas, desde) {
    const lineas = ['**Respuestas:**', '']
    for (const [status, r] of Object.entries(respuestas ?? {})) {
        const contenido = r.content ? Object.entries(r.content)[0] : undefined
        let detalle = ''
        if (contenido) {
            const [tipoContenido, { schema }] = contenido
            detalle =
                tipoContenido === 'application/problem+json'
                    ? ' (`application/problem+json`)'
                    : schema
                      ? `: ${tipo(schema, desde)}`
                      : ''
        }
        lineas.push(`- ${codigo(status)} ${texto(r.description)}${detalle}`)
    }
    return lineas.join('\n') + '\n'
}

function operaciones() {
    const lista = []
    for (const [ruta, metodos] of Object.entries(openapi.paths ?? {})) {
        for (const [metodo, op] of Object.entries(metodos)) {
            if (!op || typeof op !== 'object' || !op.responses) continue
            lista.push({ ruta, metodo, op, etiqueta: op.tags?.[0] ?? 'otros' })
        }
    }
    return lista
}

function paginaEtiqueta(etiqueta, ops, orden) {
    const titulo = TITULOS_ETIQUETA[etiqueta] ?? etiqueta
    const indice = ops
        .map(
            ({ metodo, ruta, op }) =>
                `- [${codigo(`${metodo.toUpperCase()} ${ruta}`)}](#${slug(op.operationId)}) ${texto(op.summary)}`,
        )
        .join('\n')
    const bloques = ops.map(({ metodo, ruta, op }) => {
        const datos = [
            `**Permiso:** ${op['x-permiso'] ? codigo(op['x-permiso']) : 'ninguno (basta la credencial)'}`,
            `**Autenticación:** ${describirSeguridad(op.security)}`,
        ]
        const cabeceras = (op.parameters ?? []).filter((p) => p.in === 'header').map((p) => p.name)
        if (cabeceras.includes('Idempotency-Key')) {
            const obligatoria = op.parameters.find((p) => p.name === 'Idempotency-Key')?.required
            datos.push(`**Idempotencia:** ${obligatoria ? 'obligatoria' : 'acepta'} \`Idempotency-Key\``)
        }
        if (op['x-implementado'] === false) datos.push('**Estado:** no implementada (responde `501`)')
        return [
            // El id de la operación es estable: sirve de ancla aunque cambie el resumen.
            `## ${texto(op.summary ?? op.operationId)} {#${slug(op.operationId)}}`,
            '',
            codigo(`${metodo.toUpperCase()} ${ruta}`),
            '',
            datos.join(' · '),
            '',
            op.description ? `${texto(op.description)}\n` : '',
            describirParametros(op.parameters, './'),
            describirCuerpo(op.requestBody, './'),
            describirRespuestas(op.responses, './'),
        ].join('\n')
    })
    return pagina({
        orden,
        titulo,
        intro: `${ops.length} operaciones de la etiqueta ${codigo(etiqueta)}. Las rutas son absolutas (incluyen \`/api/v1\`). Los esquemas enlazados están en [Esquemas](./esquemas).\n\n${indice}\n`,
        cuerpo: bloques.join('\n'),
    })
}

function paginaEsquemas(orden) {
    const nombres = Object.keys(esquemas).sort((a, b) => a.localeCompare(b, 'en'))
    const bloques = nombres.map((nombre) => {
        const e = esquemas[nombre]
        const partes = [`## ${nombre} {#${slug(nombre)}}`, '']
        if (e.description) partes.push(texto(e.description), '')
        if (e.properties) {
            partes.push(tablaPropiedades(e, ''), '')
        } else if (Array.isArray(e.allOf)) {
            partes.push(`Combina: ${e.allOf.map((s) => tipo(s, '')).join(' + ')}`, '')
            for (const parte of e.allOf.filter((s) => s.properties))
                partes.push(tablaPropiedades(parte, ''), '')
        } else {
            const extra = restricciones(e)
            partes.push(
                `Tipo: ${e.enum ? e.enum.map((v) => codigo(JSON.stringify(v))).join(', ') : tipo(e, '')}${extra.length ? ` (${extra.join(', ')})` : ''}`,
                '',
            )
        }
        return partes.join('\n')
    })
    return pagina({
        orden,
        titulo: 'Esquemas',
        intro: `${nombres.length} esquemas con nombre de \`components.schemas\`. Solo el primer nivel de cada objeto; el detalle completo está en \`packages/contracts/openapi.json\`.\n`,
        cuerpo: bloques.join('\n'),
    })
}

// ---------------------------------------------------------------------------------------------
// Permisos (apps/api/app/core/permisos.ts, leído como texto)

/**
 * Catálogo y roles base. Con `module.stripTypeScriptTypes` (Node 22.13+) el archivo se evalúa tal
 * cual, así los roles que arman su lista con filtros (`contabilidad`, `lectura`) salen exactos. Sin
 * esa función se leen solo los permisos y sus descripciones del texto, sin roles.
 */
async function leerPermisos() {
    const fuente = readFileSync(rutaPermisos, 'utf8')
    if (typeof modulo.stripTypeScriptTypes === 'function' && !/^\s*import\s/m.test(fuente)) {
        // La función es experimental en Node 22: se calla solo ese aviso.
        const emitir = process.emitWarning
        process.emitWarning = (aviso, ...resto) =>
            String(aviso).includes('stripTypeScriptTypes') ? undefined : emitir.call(process, aviso, ...resto)
        try {
            const js = modulo.stripTypeScriptTypes(fuente)
            const m = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`)
            const roles = Object.fromEntries(
                Object.entries(m.ROLES_BASE).map(([rol, def]) => [rol, new Set(def.permisos)]),
            )
            return { catalogo: m.PERMISOS, roles }
        } catch (error) {
            console.warn(`generar-api: no se pudo evaluar permisos.ts (${error.message}); sin roles`)
        } finally {
            process.emitWarning = emitir
        }
    }
    const bloque = fuente.slice(
        fuente.indexOf('export const PERMISOS'),
        fuente.indexOf('\n}', fuente.indexOf('export const PERMISOS')),
    )
    const catalogo = {}
    for (const m of bloque.matchAll(
        /^\s+'([a-z0-9_]+\.[a-z0-9_.]+)':\s*((?:'(?:[^'\\]|\\.)*'\s*\+?\s*)+),?$/gm,
    )) {
        catalogo[m[1]] = [...m[2].matchAll(/'((?:[^'\\]|\\.)*)'/g)]
            .map((x) => x[1].replace(/\\'/g, "'"))
            .join('')
    }
    return { catalogo, roles: null }
}

function paginaPermisos({ catalogo, roles }, ops, orden) {
    const rutasPorPermiso = new Map()
    for (const { metodo, ruta, op, etiqueta } of ops) {
        const p = op['x-permiso']
        if (!p) continue
        if (!rutasPorPermiso.has(p)) rutasPorPermiso.set(p, [])
        rutasPorPermiso
            .get(p)
            .push(
                `[${codigo(`${metodo.toUpperCase()} ${ruta.replace('/api/v1', '')}`)}](./${slug(etiqueta)}#${slug(op.operationId)})`,
            )
    }
    const nombres = Object.keys(catalogo).sort()
    const modulos = new Map()
    for (const n of nombres) {
        const m = n.split('.')[0]
        if (!modulos.has(m)) modulos.set(m, [])
        modulos.get(m).push(n)
    }
    const resumenRoles = roles
        ? [
              '| Rol base | Permisos |',
              '| --- | --- |',
              ...ROLES_BASE.filter((r) => roles[r]).map((r) => `| ${codigo(r)} | ${roles[r].size} |`),
              '',
          ].join('\n')
        : 'No se pudieron calcular los roles base con esta versión de Node (hace falta `module.stripTypeScriptTypes`, Node 22.13 o posterior).\n'
    const bloques = [...modulos.entries()].map(([m, lista]) => {
        const filas = lista.map((n) => {
            const conRol = roles
                ? ROLES_BASE.filter((r) => roles[r]?.has(n))
                      .map(codigo)
                      .join(', ')
                : ''
            const rutas = rutasPorPermiso.get(n) ?? []
            return `| ${codigo(n)} | ${celda(catalogo[n])} | ${conRol || (roles ? '—' : '')} | ${rutas.join(', ') || '—'} |`
        })
        return [
            `## ${m} {#${slug(m)}}`,
            '',
            '| Permiso | Qué permite | Roles base | Rutas |',
            '| --- | --- | --- | --- |',
            ...filas,
            '',
        ].join('\n')
    })
    return pagina({
        orden,
        titulo: 'Tabla de permisos',
        intro: `${nombres.length} permisos del catálogo (\`apps/api/app/core/permisos.ts\`), agrupados por módulo. «Roles base» son los roles que crea el seed; \`admin\` los tiene todos. «Rutas» son los endpoints que exigen ese permiso; un permiso sin rutas se comprueba dentro de una acción o lo usa el panel.\n\n${resumenRoles}`,
        cuerpo: bloques.join('\n'),
    })
}

// ---------------------------------------------------------------------------------------------
// Eventos (apps/api/app/shared/eventos.ts, interfaz CatalogoEventos)

/** Quita comentarios de una línea; `estado.bloque` dice si se está dentro de un `/* … *\/`. */
function sinComentarios(linea, estado) {
    let codigoLimpio = ''
    let i = 0
    while (i < linea.length) {
        if (estado.bloque) {
            const fin = linea.indexOf('*/', i)
            if (fin === -1) return codigoLimpio
            estado.bloque = false
            i = fin + 2
        } else if (linea.startsWith('/*', i)) {
            estado.bloque = true
            i += 2
        } else if (linea.startsWith('//', i)) {
            return codigoLimpio
        } else {
            codigoLimpio += linea[i]
            i++
        }
    }
    return codigoLimpio
}

function balance(code) {
    let d = 0
    for (const c of code) {
        if (c === '{' || c === '(' || c === '[') d++
        else if (c === '}' || c === ')' || c === ']') d--
    }
    return d
}

function limpiarDoc(lineas) {
    return lineas
        .map((l) =>
            l
                .trim()
                .replace(/^\/\*\*?/, '')
                .replace(/\*\/$/, '')
                .replace(/^\*\s?/, '')
                .trim(),
        )
        .filter(Boolean)
        .join(' ')
}

/** Declaraciones `interface X` y `type X` del archivo: nombre → texto. */
function declaraciones(fuente) {
    const lineas = fuente.split('\n')
    const mapa = new Map()
    for (let i = 0; i < lineas.length; i++) {
        const m = /^(?:export\s+)?(interface|type)\s+(\w+)/.exec(lineas[i])
        if (!m || m[2] === 'CatalogoEventos') continue
        const estado = { bloque: false }
        const texto = []
        let depth = 0
        for (let j = i; j < lineas.length; j++) {
            const code = sinComentarios(lineas[j], estado)
            texto.push(lineas[j])
            depth += balance(code)
            if (depth <= 0 && !/[=&|,:(<]\s*$/.test(code.trim())) break
        }
        mapa.set(m[2], texto.join('\n'))
    }
    return mapa
}

function leerEventos() {
    const fuente = readFileSync(rutaEventos, 'utf8')
    const lineas = fuente.split('\n')
    const inicio = lineas.findIndex((l) => l.startsWith('export interface CatalogoEventos'))
    if (inicio === -1) throw new Error('generar-api: no se encontró CatalogoEventos en eventos.ts')
    const grupos = []
    let grupo = { titulo: 'Eventos', nota: '', eventos: [] }
    let comentarioGrupo = []
    let doc = null
    let enDoc = false
    let entrada = null
    let depth = 0
    const estado = { bloque: false }
    for (let i = inicio + 1; i < lineas.length; i++) {
        const linea = lineas[i]
        const t = linea.trim()
        if (!entrada && depth === 0) {
            if (t === '}') break
            if (enDoc || t.startsWith('/**') || t.startsWith('/*')) {
                if (!enDoc) doc = []
                doc.push(t)
                enDoc = !t.endsWith('*/')
                continue
            }
            if (t.startsWith('//')) {
                comentarioGrupo.push(t.replace(/^\/\/\s?/, ''))
                continue
            }
            const m = /^'([^']+)'\s*\??\s*:/.exec(t)
            if (m) {
                if (comentarioGrupo.length > 0) {
                    const completo = comentarioGrupo.join(' ')
                    comentarioGrupo = []
                    const corte = completo.search(/ \(|\. |\.$/)
                    const titulo = corte === -1 ? completo : completo.slice(0, corte)
                    if (grupo.eventos.length > 0) grupos.push(grupo)
                    grupo = { titulo, nota: completo, eventos: [] }
                }
                entrada = { nombre: m[1], doc: doc ? limpiarDoc(doc) : '', lineas: [] }
                doc = null
            } else if (t === '') {
                continue
            }
        }
        if (entrada) entrada.lineas.push(linea.replace(/^ {4}/, ''))
        const code = sinComentarios(linea, estado)
        depth += balance(code)
        if (entrada && depth === 0 && !/[=&|,:(<]\s*$/.test(code.trim())) {
            grupo.eventos.push(entrada)
            entrada = null
        }
    }
    if (grupo.eventos.length > 0) grupos.push(grupo)
    return { grupos, tipos: declaraciones(fuente) }
}

function paginaEventos(orden) {
    const { grupos: deArchivo, tipos } = leerEventos()
    // Agrupados por prefijo (`servicio.*`, `factura.*`) en el orden del archivo: los comentarios de
    // sección de eventos.ts no cubren todos los módulos.
    const porPrefijo = new Map()
    for (const e of deArchivo.flatMap((g) => g.eventos)) {
        const prefijo = e.nombre.split('.')[0]
        if (!porPrefijo.has(prefijo)) porPrefijo.set(prefijo, [])
        porPrefijo.get(prefijo).push(e)
    }
    const grupos = [...porPrefijo.entries()].map(([prefijo, eventos]) => ({
        titulo: `${prefijo}.*`,
        prefijo,
        eventos,
    }))
    const usados = new Set()
    const marcar = (textoTipo) => {
        for (const [nombre, decl] of tipos) {
            if (!usados.has(nombre) && new RegExp(`\\b${nombre}\\b`).test(textoTipo)) {
                usados.add(nombre)
                marcar(decl.replace(/^[^\n]*/, ''))
            }
        }
    }
    const indice = grupos
        .map((g) => `[${codigo(g.titulo)}](#${slug(`grupo-${g.prefijo}`)}) (${g.eventos.length})`)
        .join(' · ')
    const bloques = grupos.map((g) => {
        const partes = [`## ${codigo(g.titulo)} {#${slug(`grupo-${g.prefijo}`)}}`, '']
        for (const e of g.eventos) {
            const cuerpo = e.lineas.join('\n')
            marcar(cuerpo.replace(/^'[^']+'/, ''))
            partes.push(`### ${codigo(e.nombre)} {#${slug(e.nombre)}}`, '')
            if (e.doc) partes.push(texto(e.doc), '')
            partes.push('```ts', cuerpo, '```', '')
        }
        return partes.join('\n')
    })
    const compartidos = [...tipos.keys()].filter((n) => usados.has(n))
    if (compartidos.length > 0) {
        bloques.push(
            [
                '## Tipos compartidos {#tipos-compartidos}',
                '',
                'Tipos que usan varios payloads de arriba.',
                '',
                '```ts',
                compartidos.map((n) => tipos.get(n)).join('\n\n'),
                '```',
                '',
            ].join('\n'),
        )
    }
    return pagina({
        orden,
        titulo: 'Catálogo de eventos',
        intro: `${grupos.reduce((n, g) => n + g.eventos.length, 0)} eventos, generados de la interfaz \`CatalogoEventos\` de \`apps/api/app/shared/eventos.ts\`: es exactamente lo que el código acepta en \`t.emit(evento, payload)\`. Claves en snake_case, ids numéricos, dinero como string decimal (\`"150.00"\`) y fechas ISO 8601 (UTC para instantes, \`YYYY-MM-DD\` para fechas).\n\n${indice}\n`,
        cuerpo: bloques.join('\n'),
    })
}

// ---------------------------------------------------------------------------------------------
// Índice

function paginaIndice(etiquetas, ops) {
    const info = openapi.info ?? {}
    const lista = etiquetas
        .map(
            ([e, lista]) =>
                `| [${texto(TITULOS_ETIQUETA[e] ?? e)}](./${slug(e)}) | ${codigo(e)} | ${lista.length} |`,
        )
        .join('\n')
    const esquemasSeguridad = Object.entries(openapi.components?.securitySchemes ?? {})
        .map(
            ([n, s]) =>
                `| ${codigo(n)} | ${celda(s.type === 'http' ? `HTTP ${s.scheme}` : `${s.type} en ${s.in}: \`${s.name}\``)} | ${celda(s.description)} |`,
        )
        .join('\n')
    const sinImplementar = ops.filter(({ op }) => op['x-implementado'] === false).length
    return [
        '---',
        'orden: 90',
        'editLink: false',
        'lastUpdated: false',
        '---',
        '',
        '# Referencia de la API',
        '',
        '::: v-pre',
        '',
        `Generada de \`packages/contracts/openapi.json\` (OpenAPI ${texto(openapi.openapi)}, «${texto(info.title)}» versión ${texto(info.version)}) en cada compilación del sitio. No se edita a mano: si un endpoint cambia, se regenera el contrato con \`pnpm contracts:build\`.`,
        '',
        texto(info.description),
        '',
        `${ops.length} operaciones en ${etiquetas.length} etiquetas${sinImplementar ? `; ${sinImplementar} aún sin implementar (\`501\`)` : ''}.`,
        '',
        '| Recurso | Etiqueta | Operaciones |',
        '| --- | --- | --- |',
        lista,
        '',
        'Además: [Esquemas](./esquemas), [Tabla de permisos](./permisos) y [Catálogo de eventos](./eventos).',
        '',
        '## Credenciales',
        '',
        '| Esquema | Dónde va | Descripción |',
        '| --- | --- | --- |',
        esquemasSeguridad,
        '',
        '## Extensiones del OpenAPI',
        '',
        '- `x-permiso`: permiso del ACL que exige la operación (sin él basta estar autenticado).',
        '- `x-implementado`: `false` si la ruta existe en el contrato pero responde `501`.',
        '',
        ':::',
        '',
    ].join('\n')
}

// ---------------------------------------------------------------------------------------------

async function main() {
    const ops = operaciones()
    const porEtiqueta = new Map()
    for (const o of ops) {
        if (!porEtiqueta.has(o.etiqueta)) porEtiqueta.set(o.etiqueta, [])
        porEtiqueta.get(o.etiqueta).push(o)
    }
    const etiquetas = [...porEtiqueta.entries()].sort(([a], [b]) =>
        (TITULOS_ETIQUETA[a] ?? a).localeCompare(TITULOS_ETIQUETA[b] ?? b, 'es'),
    )

    rmSync(salida, { recursive: true, force: true })
    mkdirSync(salida, { recursive: true })
    writeFileSync(join(salida, 'index.md'), paginaIndice(etiquetas, ops))
    etiquetas.forEach(([e, lista], i) => {
        writeFileSync(join(salida, `${slug(e)}.md`), paginaEtiqueta(e, lista, 10 + i))
    })
    writeFileSync(join(salida, 'esquemas.md'), paginaEsquemas(1000))
    writeFileSync(join(salida, 'permisos.md'), paginaPermisos(await leerPermisos(), ops, 1))
    writeFileSync(join(salida, 'eventos.md'), paginaEventos(2))
    console.log(
        `generar-api: ${ops.length} operaciones, ${etiquetas.length} etiquetas → docs/desarrolladores/referencia/`,
    )
}

await main()
