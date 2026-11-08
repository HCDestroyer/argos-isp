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
const PLANTILLAS = [
    'plantillas/conexion.rsc.tpl',
    'plantillas/conexion-servicio.rsc.tpl',
    'plantillas/conexion-sin-radius.rsc.tpl',
    'plantillas/conexion-servicio-sin-radius.rsc.tpl',
]
const SIN_RADIUS = [
    'plantillas/conexion-sin-radius.rsc.tpl',
    'plantillas/conexion-servicio-sin-radius.rsc.tpl',
]

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
    portal_puerto: '8088',
    portal_fqdn: 'portal.miisp.example',
    walled_garden: 'app.recurrente.com',
    dns_v4: '192.0.2.53,198.51.100.53',
    dns_v6: '2001:db8:ffff::53',
    corte_identificacion: 'ip',
    corte_url: 'http://portal.miisp.example/corte',
    corte_tunel_ip: '',
    corte_tunel_puerto: '',
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
    assert.equal(balance(renderizar(leer(PLANTILLAS[3]), VALORES)), null)
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
    // el puerto del dst-nat de corte sale de Configuración → Portal de corte (portal_puerto), no fijo en 80
    assert.match(renderizar(leer(PLANTILLAS[1]), VALORES), /:local portalCortePuerto \[:tonum "8088"\]/)
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
        assert.ok(
            t.indexOf('/api/v1/routers/conexion/registrar') <
                t.indexOf('/ip service set www-ssl certificate='),
            p,
        )
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

test('router sin RADIUS (modo_seguridad = api): sin /radius ni secreto, use-radius=no y "sensitive"', () => {
    const { radius_secret, ...sinSecreto } = VALORES
    assert.ok(radius_secret)
    for (const p of [...SIN_RADIUS, 'lab-sin-radius.rsc']) {
        const t = leer(p)
        assert.doesNotMatch(t, /\{\{radius_secret\}\}/, p)
        assert.doesNotMatch(t, /^\s*\/radius add/m, p)
        assert.doesNotMatch(t, /use-radius=yes/, p)
        assert.match(t, /^\/ppp aaa set use-radius=no accounting=no$/m, p)
        assert.match(t, /^\/radius remove \[find where comment~"\^argosisp: aaa nodo"\]$/m, p)
        assert.match(t, /policy=read,write,api,rest-api,sensitive/, p)
        // el grupo con sensitive va después de crearlo con el mínimo
        assert.ok(
            t.indexOf('policy=read,write,api,rest-api,sensitive') >
                t.indexOf('/user group add name=argosisp-api'),
            p,
        )
        // la regla que acepta CoA solo se crea con RADIUS
        for (const linea of t.split('\n').filter((l) => /dst-port=3799[^\n]*action=accept/.test(l))) {
            assert.match(linea, /^\s{4,}/, `${p}: ${linea.trim()} sin :if ($radiusAddr != "")`)
        }
    }
    for (const p of SIN_RADIUS) {
        // la API no necesita radius_secret para un router api
        const r = renderizar(leer(p), sinSecreto)
        assert.doesNotMatch(r, /\{\{/)
        assert.match(r, /:local radiusAddr ""/)
    }
    // con ?incluir=servicio: perfil default con PD, perfil de corte, NAT de /corte y FastTrack, como con RADIUS
    const servicio = leer(SIN_RADIUS[1])
    for (const patron of [
        /\/ppp profile set \[find where name="default"\][^\n]*\\\n[^\n]*dhcpv6-pd-pool=\$poolV6Pd/,
        /address-list=suspendidos interface-list=suspendidos/,
        /default-profile=default/,
        /action=dst-nat to-addresses=\$portalV4 to-ports=\$portalCortePuerto/,
        /\/system script run argosisp-verificar-fasttrack/,
    ]) {
        assert.match(servicio, patron)
        assert.match(leer(PLANTILLAS[1]), patron)
    }
    // las de RADIUS siguen sin "sensitive"
    for (const p of ['lab.rsc', PLANTILLAS[0], PLANTILLAS[1]]) {
        assert.doesNotMatch(leer(p), /,sensitive/, p)
        assert.match(leer(p), /\/ppp aaa set use-radius=yes/, p)
    }
})

test('DNS: sin dns_v4 no se tocan los servers del router; allow-remote-requests siempre y cerrado a la WAN', () => {
    const CON_SERVICIO = ['lab.rsc', 'lab-sin-radius.rsc', PLANTILLAS[1], SIN_RADIUS[1]]
    for (const p of CON_SERVICIO) {
        const t = leer(p)
        // servers= solo dentro de :if ([:len $dnsV4] > 0); el else deja solo allow-remote-requests
        const inicio = t.indexOf(':if ([:len $dnsV4] > 0) do={')
        assert.ok(inicio >= 0, `${p}: sin :if ([:len $dnsV4] > 0)`)
        const elseDns = t.indexOf('\n} else={', inicio)
        const finDns = t.indexOf('\n}', elseDns + 1)
        const conServers = t.split('\n').filter((l) => /^\s*\/ip dns set[^\n]*servers=/.test(l))
        assert.equal(conServers.length, 1, `${p}: un solo /ip dns set servers=`)
        const pos = t.indexOf(conServers[0])
        assert.ok(pos > inicio && pos < elseDns, `${p}: servers= fuera del :if de dnsV4`)
        assert.match(
            t.slice(elseDns, finDns + 2),
            /else=\{\n\s*\/ip dns set allow-remote-requests=yes\n\}$/,
            p,
        )
        // argos-dns: los resolutores que el router ya tiene (servers + dynamic-servers), sin fallar si se repiten
        assert.match(t, /\[\/ip dns get servers\], \[\/ip dns get dynamic-servers\]/, p)
        assert.match(t, /\$dnsRouterV4 do=\{ :do \{ \/ip firewall address-list add list=argos-dns/, p)
        assert.match(t, /\$dnsRouterV6 do=\{ :do \{ \/ipv6 firewall address-list add list=argos-dns/, p)
        assert.match(t, /add list=argos-dns address=\$pppLocalV4/, p)
        // aviso si el router se queda sin DNS
        assert.match(t, /AVISO el router no tiene DNS/, p)
        // el puerto 53 del router: drop desde la WAN y accept desde clientes/LAN, en IPv4 e IPv6, todo argosisp:top
        for (const fam of ['/ip', '/ipv6']) {
            const reglas = t
                .split('\n')
                .filter((l) => /chain=input[^\n]*dst-port=53/.test(l) && !/argos-corte/.test(l))
                .filter((l) => (fam === '/ip' ? !/\/ipv6/.test(l) : true))
            assert.ok(reglas.length >= 4, `${p} ${fam}: reglas de DNS del router`)
            for (const l of reglas) assert.match(l, /comment="argosisp:top /, `${p}: ${l.trim()}`)
        }
        assert.match(
            t,
            /\/ipv6 firewall filter\nadd chain=input in-interface=\$wanIf protocol=udp dst-port=53 action=drop/,
            p,
        )
        assert.match(
            t,
            /\/ipv6 firewall filter add chain=input src-address-list=argos-clientes protocol=udp dst-port=53 action=accept/,
            p,
        )
        // las listas WAN/LAN solo si existen (si no, la regla no se puede crear)
        assert.match(t, /:if \(\[:len \[\/interface list find where name="WAN"\]\] > 0\)/, p)
        assert.match(t, /:if \(\[:len \[\/interface list find where name="LAN"\]\] > 0\)/, p)
        // drop desde la WAN antes que los accept (el orden de :top se conserva al moverlas)
        assert.ok(
            t.indexOf('DNS del router solo interno (udp)') < t.indexOf('DNS del router desde clientes (udp)'),
            p,
        )
    }
    // sin dns_v4 ni dns_v6 el render sale con arreglos vacíos
    for (const p of [PLANTILLAS[1], SIN_RADIUS[1]]) {
        const r = renderizar(leer(p), { ...VALORES, dns_v4: '', dns_v6: '' })
        assert.match(r, /:local dnsV4 \[:toarray ""\]/)
        assert.match(r, /:local dnsV6 \[:toarray ""\]/)
    }
})

test('DNS: ningún script del laboratorio ni plantilla trae resolutores de documentación', () => {
    const doc = /(192\.0\.2\.53|198\.51\.100\.53|2001:db8:[0-9a-f:]*::53)\b/i
    for (const salida of Object.keys(SALIDAS)) {
        assert.doesNotMatch(leer(salida), doc, salida)
    }
    const lab = leer('lab.rsc')
    assert.match(lab, /^:local dnsV4 \[:toarray ""\]$/m)
    assert.match(lab, /^:local dnsV6 \[:toarray ""\]$/m)
})

test('identificación por código (contratos/corte-identificacion.md §5 bis): mismas piezas que corte_router.ts', () => {
    const CON_SERVICIO = ['lab.rsc', 'lab-sin-radius.rsc', PLANTILLAS[1], SIN_RADIUS[1]]
    const linea = (t, re) => t.split('\n').filter((l) => re.test(l))
    for (const p of CON_SERVICIO) {
        const t = leer(p)
        // NAT: redirect al 3346 en modo código, dst-nat al portal en modo ip (IPv4 e IPv6)
        for (const fam of ['/ip', '/ipv6']) {
            const proxy = linea(
                t,
                new RegExp(`^\\s*${fam} firewall nat add[^\\n]*corte-nat HTTP al proxy de corte`),
            )
            assert.equal(proxy.length, 1, `${p} ${fam}: NAT al proxy`)
            assert.match(
                proxy[0],
                /chain=argos-corte-nat protocol=tcp dst-port=80 action=redirect to-ports=\$proxyCortePuerto comment="argosisp: corte-nat HTTP al proxy de corte"$/,
            )
            // drop del 3346 en input si no llegó por el dst-nat, argosisp:top
            const drop = linea(
                t,
                new RegExp(`^\\s*${fam} firewall filter add[^\\n]*proxy de corte solo redirigido`),
            )
            assert.equal(drop.length, 1, `${p} ${fam}: drop del 3346`)
            assert.match(
                drop[0],
                /chain=input protocol=tcp dst-port=\$proxyCortePuerto connection-nat-state=!dstnat action=drop comment="argosisp:top proxy de corte solo redirigido"$/,
            )
            // accept en argos-corte-in, antes del tcp-reset
            const acc = linea(
                t,
                new RegExp(`^\\s*${fam} firewall filter add chain=argos-corte-in[^\\n]*proxy de corte`),
            )
            assert.equal(acc.length, 1, `${p} ${fam}: accept en argos-corte-in`)
            assert.match(
                acc[0],
                /protocol=tcp dst-port=\$proxyCortePuerto action=accept comment="argosisp: corte-in proxy de corte"$/,
            )
        }
        assert.ok(
            t.indexOf('argosisp: corte-in proxy de corte') <
                t.indexOf('comment="argosisp: corte-in TCP reset"'),
            p,
        )
        // todo lo del modo código va dentro de :if ($corteIdentificacion = "codigo")
        for (const l of linea(t, /\$proxyCortePuerto/).filter((l) => !/^\s*#/.test(l))) {
            assert.match(l, /^\s{4,}/, `${p}: ${l.trim()} fuera de un :if`)
        }
        // /ip proxy: apagado -> solo del corte sin caché; encendido -> solo se agrega el puerto; ip -> se quita
        assert.match(t, /\/ip proxy set enabled=yes port=\$proxyCortePuerto max-cache-size=none/, p)
        assert.match(t, /\/ip proxy set port=\(\$proxyResto \. "," \. \$proxyCortePuerto\)/, p)
        assert.match(t, /\/ip proxy set enabled=no port=8080/, p)
        // regla final de /ip proxy access y su limpieza
        assert.match(
            t,
            /\/ip proxy access add local-port=\$proxyCortePuerto action=redirect action-data=\$urlCorte comment="argosisp: corte proxy sin codigo"/,
            p,
        )
        // sin URL ni IPv4 del portal, la final niega: nunca un 3346 sin regla final
        assert.match(
            t,
            /\/ip proxy access add local-port=\$proxyCortePuerto action=deny comment="argosisp: corte proxy sin codigo"/,
            p,
        )
        // las del corte (servicio y final) antes de la primera del operador
        assert.match(t, /\/ip proxy access move \$id destination=\$destinoProxy/, p)
        assert.match(t, /\/ip proxy access move \$finalProxy destination=\$destinoProxy/, p)
        // el proxy se enciende después de la regla final y del drop de input
        const encender = t.indexOf('/ip proxy set enabled=yes')
        assert.ok(encender > t.lastIndexOf('comment="argosisp: corte proxy sin codigo"'), p)
        assert.ok(encender > t.lastIndexOf('comment="argosisp:top proxy de corte solo redirigido"'), p)
        assert.match(
            t,
            /\/ip proxy access remove \[find where comment~\$propio and comment!=\$reglaProxyFinal\]/,
            p,
        )
        // el NAT IPv6 en modo código no depende de la IPv6 del portal
        assert.match(t, /:if \(\$portalV6 != "" \|\| \$corteIdentificacion = "codigo"\) do=\{/, p)
    }
    // el laboratorio arranca en modo ip con el 3346
    for (const p of ['lab.rsc', 'lab-sin-radius.rsc']) {
        assert.match(leer(p), /^:local corteIdentificacion "ip"$/m, p)
        assert.match(leer(p), /^:local proxyCortePuerto "3346"$/m, p)
    }
    // render: modo y URL validados por patrón
    for (const p of [PLANTILLAS[1], SIN_RADIUS[1]]) {
        const r = renderizar(leer(p), { ...VALORES, corte_identificacion: 'codigo' })
        assert.match(r, /:local corteIdentificacion "codigo"/)
        assert.match(r, /:local corteUrl "http:\/\/portal.miisp.example\/corte"/)
        assert.match(renderizar(leer(p), { ...VALORES, corte_url: '' }), /:local corteUrl ""/)
        assert.throws(
            () => renderizar(leer(p), { ...VALORES, corte_identificacion: 'hotspot' }),
            /corte_identificacion: no cumple/,
        )
        assert.throws(
            () => renderizar(leer(p), { ...VALORES, corte_url: 'http://x/corte" ; /system reset' }),
            /corte_url: no cumple/,
        )
    }
})

test('reimportar en modo código: el 3346 nunca queda abierto sin regla final ni drop', () => {
    const CON_SERVICIO = ['lab.rsc', 'lab-sin-radius.rsc', PLANTILLAS[1], SIN_RADIUS[1]]
    for (const p of CON_SERVICIO) {
        const t = leer(p)
        const lineas = t.split('\n').map((l) => l.trim())
        // la limpieza inicial no borra el drop del 3346 ni la regla final del proxy
        for (const l of lineas.filter((l) => / remove \[find where comment~\$propio/.test(l))) {
            if (/firewall filter /.test(l)) assert.match(l, /and comment!=\$reglaProxyDrop\]$/, `${p}: ${l}`)
            if (/proxy access /.test(l)) assert.match(l, /and comment!=\$reglaProxyFinal\]$/, `${p}: ${l}`)
        }
        assert.ok(lineas.includes(':local reglaProxyDrop "argosisp:top proxy de corte solo redirigido"'), p)
        assert.ok(lineas.includes(':local reglaProxyFinal "argosisp: corte proxy sin codigo"'), p)
        const limpieza = t.indexOf(':local reglaProxyDrop')
        // ningún remove de esas reglas antes de cerrar el 3346 del proxy (modo ip)
        const cierre = t.indexOf('/ip proxy set enabled=no port=8080')
        assert.ok(cierre > limpieza, p)
        for (const quitar of [
            '/ip firewall filter remove [find where comment=$reglaProxyDrop]',
            '/ipv6 firewall filter remove [find where comment=$reglaProxyDrop]',
            '/ip proxy access remove [find where comment=$reglaProxyFinal]',
        ]) {
            const i = t.indexOf(quitar)
            assert.ok(i > cierre, `${p}: ${quitar} antes de quitar el 3346 del proxy`)
            assert.equal(t.indexOf(quitar, i + 1), -1, `${p}: ${quitar} repetido`)
        }
        // en modo código se actualizan en su lugar: add solo si no existen, si no set
        for (const fam of ['/ip', '/ipv6']) {
            assert.ok(
                t.includes(`:local dropProxy [${fam} firewall filter find where comment=$reglaProxyDrop]`),
                p,
            )
            assert.ok(
                t.includes(
                    `${fam} firewall filter set $dropProxy chain=input protocol=tcp dst-port=$proxyCortePuerto connection-nat-state=!dstnat action=drop disabled=no`,
                ),
                p,
            )
        }
        assert.ok(t.includes(':local finales [/ip proxy access find where comment=$reglaProxyFinal]'), p)
        assert.ok(
            t.includes(
                '/ip proxy access set $finalProxy local-port=$proxyCortePuerto action=deny disabled=no',
            ),
            p,
        )
        assert.ok(
            t.includes(
                '/ip proxy access set $finalProxy local-port=$proxyCortePuerto action=redirect action-data=$urlCorte disabled=no',
            ),
            p,
        )
        // cada add de la final o del drop va dentro de su :if de "no existe"
        for (const l of t
            .split('\n')
            .filter(
                (l) =>
                    /(proxy de corte solo redirigido|corte proxy sin codigo)"\]?$/.test(l) && / add /.test(l),
            )) {
            assert.match(l, /^\s{8,}/, `${p}: ${l.trim()} fuera de su :if`)
        }
        // y el proxy se enciende después de la final y del drop
        const encender = t.indexOf('/ip proxy set enabled=yes')
        assert.ok(encender > t.lastIndexOf('/ip proxy access set $finalProxy'), p)
        assert.ok(encender > t.lastIndexOf('firewall filter set $dropProxy'), p)
    }
})

test('corte por el túnel WireGuard (contratos/corte-identificacion.md §5 ter.6): mismas piezas que corte_router.ts', () => {
    const CON_SERVICIO = ['lab.rsc', 'lab-sin-radius.rsc', PLANTILLAS[1], SIN_RADIUS[1]]
    for (const p of CON_SERVICIO) {
        const t = leer(p)
        // dst-nat al túnel, srcnat accept arriba (sección 13 lo mueve) y masquerade de respaldo
        assert.ok(
            t.includes(
                '/ip firewall nat add chain=argos-corte-nat protocol=tcp dst-port=80 action=dst-nat to-addresses=$corteTunelIp to-ports=$corteTunelPuerto comment="argosisp: corte-nat HTTP a /corte"',
            ),
            p,
        )
        assert.ok(
            t.includes(
                '/ip firewall nat add chain=srcnat src-address-list=argos-clientes dst-address=$corteTunelIp action=accept comment="argosisp:top corte por tunel sin NAT"',
            ),
            p,
        )
        assert.ok(
            t.includes(
                '/ip firewall nat add chain=srcnat connection-nat-state=dstnat dst-address=$corteTunelIp action=masquerade comment="argosisp: corte por tunel NAT de lo demas"',
            ),
            p,
        )
        assert.ok(
            t.includes(
                '/ip firewall address-list add list=argos-portal address=$corteTunelIp comment="argosisp: portal tunel"',
            ),
            p,
        )
        // el túnel solo en modo ip: en código manda el proxy del router
        const codigo = t.indexOf(':if ($corteIdentificacion = "codigo") do={\n    /ip firewall nat add chain=argos-corte-nat')
        assert.ok(codigo >= 0 && codigo < t.indexOf('to-addresses=$corteTunelIp'), p)
        // el accept de clientes queda antes de cualquier masquerade (argosisp:top al inicio de la tabla NAT)
        assert.match(t, /:foreach id in=\[\/ip firewall nat find where comment~"\^argosisp:top"\]/, p)
    }
    // el laboratorio arranca sin túnel de corte
    for (const p of ['lab.rsc', 'lab-sin-radius.rsc']) assert.match(leer(p), /^:local corteTunelIp ""$/m, p)
    // render: IP y puerto validados por patrón; vacíos = dst-nat a portal_v4
    for (const p of [PLANTILLAS[1], SIN_RADIUS[1]]) {
        const r = renderizar(leer(p), { ...VALORES, corte_tunel_ip: '10.255.0.1', corte_tunel_puerto: '8088' })
        assert.match(r, /:local corteTunelIp "10.255.0.1"/)
        assert.match(r, /:local corteTunelPuerto \[:tonum "8088"\]/)
        assert.match(renderizar(leer(p), VALORES), /:local corteTunelIp ""/)
        assert.throws(
            () => renderizar(leer(p), { ...VALORES, corte_tunel_ip: '10.255.0.1" ; /system reset' }),
            /corte_tunel_ip: no cumple/,
        )
    }
})
