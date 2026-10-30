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
    api_ip_anterior: '192.168.88.1',
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

/** Texto del bloque `do={ ... }` que abre en `inicio` (llaves contadas fuera de cadenas). */
function bloque(texto, inicio) {
    const abre = texto.indexOf('{', inicio)
    let nivel = 0
    let enCadena = false
    for (let i = abre; i < texto.length; i++) {
        const c = texto[i]
        if (enCadena) {
            if (c === '\\') i++
            else if (c === '"') enCadena = false
        } else if (c === '"') enCadena = true
        else if (c === '{') nivel++
        else if (c === '}' && --nivel === 0) return texto.slice(abre, i + 1)
    }
    throw new Error('bloque sin cerrar')
}

test('gestión: se restringe solo con registro OK y handshake; si no, no hay drop ni address= (#181)', () => {
    for (const p of PLANTILLAS) {
        const t = leer(p)
        // C1 ya no borra la gestión anterior: solo C4 la rehace, y solo dentro de :if ($restringir)
        assert.ok(t.includes(':local restringir ($registrado && $tunelOk)'), p)
        const inicio = t.indexOf(':if ($restringir) do={')
        assert.ok(inicio > t.indexOf(':local restringir'), p)
        const dentro = bloque(t, inicio)
        const fuera = t.replace(dentro, '')
        for (const patron of [
            /action=drop[^\n]*argosisp:gestion/,
            /address=\$gestionDesde/,
            /\/ip firewall filter remove \[find where comment~"\^argosisp:gestion"\]/,
            /\/ip firewall address-list remove[^\n]*argosisp:gestion/,
            /\/ip service set \$s disabled=yes/,
            /\/tool mac-server set/,
        ]) {
            assert.match(dentro, patron, `${p}: ${patron} dentro de :if ($restringir)`)
            assert.doesNotMatch(fuera, patron, `${p}: ${patron} fuera de :if ($restringir)`)
        }
        // el handshake se espera antes de decidir y la IP de las sesiones abiertas entra en argosisp-admin
        assert.ok(t.indexOf('last-handshake') < inicio, p)
        assert.match(dentro, /\/user active|sesionV4/, p)
        assert.match(t, /\/user active find where name!=\$apiUsuario/, p)
        // el certificado de www-ssl se decide después del registro
        assert.ok(t.indexOf(':set apiCertificar ($registrado') < t.indexOf(':if ($apiCertificar) do={'), p)
        assert.ok(t.indexOf('/api/v1/routers/conexion/registrar') < t.indexOf('/ip service set www-ssl certificate='), p)
    }
})

test('/ip service por nombre: las conexiones abiertas (dinámicas) también se llaman ssh, winbox… (RouterOS 7.2x)', () => {
    for (const salida of Object.keys(SALIDAS)) {
        assert.doesNotMatch(leer(salida), /\/ip service (set|get) \[find/, salida)
    }
})

test('certificado: SAN con la IP del túnel y la anterior; solo se borran los argosisp-www', () => {
    const r = renderizar(leer(PLANTILLAS[0]), VALORES)
    assert.ok(r.includes(':local apiIpAnterior "192.168.88.1"'))
    assert.ok(r.includes(':set san ($san . ",IP:" . $apiIpAnterior)'))
    for (const salida of Object.keys(SALIDAS)) {
        for (const linea of leer(salida)
            .split('\n')
            .filter((l) => /\/certificate remove/.test(l))) {
            assert.match(linea, /name="argosisp-www(-nuevo)?"/, `${salida}: ${linea.trim()}`)
        }
    }
    // registro fallido: se imprime la CA con el paso para pegarla en el panel
    assert.match(leer(PLANTILLAS[0]), /:put \$caPem/)
    assert.match(leer(PLANTILLAS[0]), /Conexion de la API -> CA propia \(PEM\)/)
})

test('rescate-gestion.rsc: ASCII, una orden por línea y solo lo argosisp:gestion', () => {
    const t = leer('rescate-gestion.rsc')
    assert.doesNotMatch(t, /[^\x09\x0a\x0d\x20-\x7e]/)
    const ordenes = t.split('\n').filter((l) => l.trim() && !l.startsWith('#'))
    assert.deepEqual(ordenes, [
        '/ip firewall filter remove [find where comment~"^argosisp:gestion"]',
        '/ip firewall address-list remove [find where list="argosisp-admin"]',
        '/ip service set www-ssl address=""',
        '/ip service set winbox address=""',
        '/ip service set ssh address=""',
        ':put "argosisp: rescate aplicado: sin reglas argosisp:gestion y www-ssl, winbox y ssh aceptan desde cualquier IP"',
    ])
})
