// Pruebas de las plantillas de conexión y de su render (CI, job infra):
//   node --test infra/mikrotik/
// El /import real se probó en CHR (infra/mikrotik/README.md, "Conectar un router"); aquí se
// comprueba lo que no necesita un router: armado, variables, escape y que las llaves cierren.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SALIDAS, armar } from './armar.mjs'
import { VARIABLES, escapar, renderizar, variablesDe } from './render.mjs'

const DIR = dirname(fileURLToPath(import.meta.url))
const leer = (r) => readFileSync(join(DIR, r), 'utf8')
const PLANTILLAS = ['plantillas/conexion.rsc.tpl', 'plantillas/conexion-servicio.rsc.tpl']

const VALORES = {
    router_id: '12',
    generado_en: '2026-10-28T22:30:00Z',
    argos_url: 'https://api.miisp.example',
    token: 'tokenDePrueba0123456789abcdefghijklmnop',
    wg_ip: '10.255.0.12',
    wg_servidor_ip: '10.255.0.1',
    wg_red: '10.255.0.0/16',
    wg_servidor_public_key: '4wRU35+Ojozg+fIrx/BA31AGmNDWUc8XYfAHQzH1w1A=',
    wg_servidor_endpoint: 'vpn.miisp.example',
    wg_servidor_puerto: '51820',
    radius_secret: 'secretoRadius$de?prueba"0123\\x',
    api_password: 'ClaveApi$0123456789abcdefghijklmnopq',
    api_nombre: 'router-12.argosisp',
    admin_ips: '203.0.113.7,198.51.100.0/24',
    pppoe_interfaz: 'ether2',
    wan_interfaz: 'ether1',
    ppp_local_v4: '10.10.0.1',
    pool_v4_rangos: '10.10.0.10-10.10.0.250',
    clientes_v4: '10.10.0.0/16',
    clientes_v6: '2001:db8:100::/48,2001:db8:200::/40',
    susp_rate_limit: '256k/256k',
    pool_v6_enlace_prefijo: '2001:db8:100::/48',
    pool_v6_pd_prefijo: '2001:db8:200::/40',
    portal_v4: '192.0.2.20',
    portal_v6: '2001:db8:ffff::20',
    portal_fqdn: 'portal.miisp.example',
    walled_garden: 'app.recurrente.com',
    dns_v4: '192.0.2.53,198.51.100.53',
    dns_v6: '2001:db8:ffff::53',
}

/** Llaves, corchetes y paréntesis balanceados fuera de cadenas y comentarios (sintaxis de RouterOS). */
function balance(texto) {
    const pila = []
    const pares = { '}': '{', ']': '[', ')': '(' }
    let enCadena = false
    for (const [n, linea] of texto.split('\n').entries()) {
        if (!enCadena && /^\s*#/.test(linea)) continue
        for (let i = 0; i < linea.length; i++) {
            const c = linea[i]
            if (enCadena) {
                if (c === '\\') i++
                else if (c === '"') enCadena = false
                continue
            }
            if (c === '"') enCadena = true
            else if ('{[('.includes(c)) pila.push([c, n + 1])
            else if (c in pares) {
                const abierto = pila.pop()
                if (!abierto || abierto[0] !== pares[c]) return `línea ${n + 1}: '${c}' sin abrir`
            }
        }
        if (enCadena && !linea.endsWith('\\')) return `línea ${n + 1}: cadena sin cerrar`
    }
    return pila.length ? `'${pila.at(-1)[0]}' de la línea ${pila.at(-1)[1]} sin cerrar` : null
}

test('los archivos armados coinciden con sus piezas (node infra/mikrotik/armar.mjs)', () => {
    for (const salida of Object.keys(SALIDAS)) {
        assert.equal(leer(salida), armar(salida), `${salida} desactualizado`)
    }
})

test('las plantillas se pueden pegar en New Terminal: ASCII y sin comentarios dentro del bloque', () => {
    for (const p of PLANTILLAS) {
        const texto = leer(p)
        assert.doesNotMatch(texto, /[^\x09\x0a\x0d\x20-\x7e]/, p)
        const cuerpo = texto.slice(texto.indexOf('\n{\n'))
        assert.doesNotMatch(cuerpo, /^\s*#/m, `${p}: comentario dentro del bloque`)
    }
})

test('llaves, corchetes y paréntesis balanceados', () => {
    for (const salida of Object.keys(SALIDAS)) {
        assert.equal(balance(leer(salida)), null, salida)
    }
    assert.equal(balance(renderizar(leer(PLANTILLAS[1]), VALORES)), null)
})

test('cada variable está en variables.json, va entre comillas y se usa', () => {
    const usadas = new Set()
    for (const p of PLANTILLAS) {
        for (const linea of leer(p)
            .split('\n')
            .filter((l) => l.includes('{{'))) {
            assert.match(
                linea,
                /^:local [A-Za-z0-9]+ (\[:t(oarray|onum) )?"[^"]*\{\{[a-z0-9_]+\}\}[^"]*"\]?$/,
                linea,
            )
        }
        for (const v of variablesDe(leer(p))) {
            assert.ok(VARIABLES[v], `${v} no está en variables.json`)
            usadas.add(v)
        }
    }
    assert.deepEqual([...usadas].sort(), Object.keys(VARIABLES).sort())
})

test('render: sin variables pendientes y secretos escapados', () => {
    const r = renderizar(leer(PLANTILLAS[0]), VALORES)
    assert.doesNotMatch(r, /\{\{/)
    assert.ok(r.includes(':local radiusSecret "secretoRadius\\$de\\?prueba\\"0123\\\\x"'))
    assert.ok(r.includes(':local apiPassword "ClaveApi\\$0123456789abcdefghijklmnopq"'))
    assert.ok(r.includes(':local adminIps [:toarray "203.0.113.7,198.51.100.0/24"]'))
    // El script de conexión solo no trae la configuración de servicio
    assert.doesNotMatch(r, /pppoe-server/)
    assert.match(renderizar(leer(PLANTILLAS[1]), VALORES), /pppoe-server/)
})

test('render: falta una variable, no cumple su patrón o trae un salto de línea → error', () => {
    const plantilla = leer(PLANTILLAS[0])
    const { token, ...sinToken } = VALORES
    assert.ok(token)
    assert.throws(() => renderizar(plantilla, sinToken), /token: falta/)
    assert.throws(
        () => renderizar(plantilla, { ...VALORES, wg_ip: '10.255.0.12"; /system reset' }),
        /wg_ip: no cumple/,
    )
    assert.throws(
        () => renderizar(plantilla, { ...VALORES, admin_ips: '1.2.3.4 ,5.6.7.8' }),
        /admin_ips: no cumple/,
    )
    assert.throws(
        () => renderizar(plantilla, { ...VALORES, api_password: 'a'.repeat(31) }),
        /api_password: no cumple/,
    )
    assert.throws(() => escapar('linea\nsiguiente'), /control/)
    // Con ?admin= vacío la gestión queda solo por el túnel
    assert.match(renderizar(plantilla, { ...VALORES, admin_ips: '' }), /:local adminIps \[:toarray ""\]/)
})

test('el registro carga :serialize/:deserialize con :parse (RouterOS sin ellos sigue con la clave a mano)', () => {
    const t = leer(PLANTILLAS[0])
    assert.match(t, /:parse ":return \[:serialize to=json value=\\\$1\]"/)
    assert.match(t, /:parse ":return \[:deserialize from=json value=\\\$1\]"/)
    assert.match(t, /\/api\/v1\/routers\/conexion\/registrar/)
    assert.match(t, /policy=read,write,api,rest-api/)
})
