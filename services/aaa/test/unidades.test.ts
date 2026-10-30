import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'node:test'
import { cifrar, claveDesdeEntorno, descifrar, ErrorCifrado } from '../src/cifrado.ts'
import { FuenteFixtures } from '../src/fuentes.ts'
import { construirReply } from '../src/perfil.ts'
import { leerAtributos } from '../src/radius.ts'
import { ErrorContrato, esLapida, parsearRegistro, type ServicioAaa } from '../src/servicio.ts'
import { CLAVE, PERFIL, servicio } from './ayudas.ts'

describe('cifrado v1', () => {
    it('cifra y descifra; cada cifrado usa un IV distinto', () => {
        const a = cifrar('contraseña ñ', CLAVE)
        const b = cifrar('contraseña ñ', CLAVE)
        assert.notEqual(a, b)
        assert.match(a, /^v1\.[\w-]+\.[\w-]+\.[\w-]+$/)
        assert.equal(descifrar(a, CLAVE), 'contraseña ñ')
    })

    it('rechaza otra clave, datos alterados y formatos desconocidos', () => {
        const c = cifrar('x', CLAVE)
        assert.throws(() => descifrar(c, Buffer.alloc(32)), ErrorCifrado)
        const partes = c.split('.')
        // Se invierte un bit del dato cifrado: escribir un byte fijo no lo altera cuando ya
        // vale eso (1 de cada 256 corridas, el IV es aleatorio).
        const datos = Buffer.from(partes[3] ?? '', 'base64url')
        datos.writeUInt8((datos.readUInt8(0) ^ 0x01) & 0xff, 0)
        partes[3] = datos.toString('base64url')
        assert.throws(() => descifrar(partes.join('.'), CLAVE), ErrorCifrado)
        assert.throws(() => descifrar('texto-en-claro', CLAVE), ErrorCifrado)
    })

    it('la clave del entorno debe tener 32 bytes', () => {
        assert.throws(() => claveDesdeEntorno(undefined), ErrorCifrado)
        assert.throws(() => claveDesdeEntorno(Buffer.alloc(16).toString('base64')), ErrorCifrado)
        assert.equal(claveDesdeEntorno(CLAVE.toString('base64')).length, 32)
    })
})

describe('perfil RADIUS por estado', () => {
    it('activo con rate_limit_override (burst) y profile_ppp → Mikrotik-Group', () => {
        const s = servicio({ user_ppp: 'b' })
        s.plan.rate_limit_override = '5M/20M 10M/40M 4M/16M 16/16 8 1M/4M'
        s.plan.profile_ppp = 'plan-20m'
        const { reply } = construirReply(s, PERFIL)
        assert.equal(reply['Mikrotik-Rate-Limit'], '5M/20M 10M/40M 4M/16M 16/16 8 1M/4M')
        assert.equal(reply['Mikrotik-Group'], 'plan-20m')
    })

    it('limitado ignora el override (el burst es del plan completo)', () => {
        const s = servicio({ user_ppp: 'l', estado: 'limitado' })
        s.plan.rate_limit_override = '5M/20M 10M/40M 4M/16M 16/16'
        assert.equal(construirReply(s, PERFIL).reply['Mikrotik-Rate-Limit'], '1024k/2048k')
    })

    it('limitado sin velocidad limitada en el plan: usa la del plan y avisa', () => {
        const s = servicio({ user_ppp: 'l', estado: 'limitado' })
        s.plan.subida_limitada_kbps = 0
        const { reply, avisos } = construirReply(s, PERFIL)
        assert.equal(reply['Mikrotik-Rate-Limit'], '5120k/20480k')
        assert.equal(avisos.length, 1)
    })

    it('suspendido: el grupo de corte gana sobre profile_ppp', () => {
        const s = servicio({ user_ppp: 's', estado: 'suspendido' })
        s.plan.profile_ppp = 'plan-20m'
        const { reply } = construirReply(s, PERFIL)
        assert.equal(reply['Mikrotik-Group'], 'suspendido')
        assert.equal(reply['Filter-Id'], 'argos-corte.in')
    })

    it('IPv6 duid / estatico / ninguno no envía atributos IPv6', () => {
        for (const modo of ['duid', 'estatico', 'ninguno'] as const) {
            const { reply } = construirReply(servicio({ user_ppp: 'x', ipv6: { modo } }), PERFIL)
            assert.deepEqual(
                Object.keys(reply).filter((k) => k.includes('IPv6')),
                [],
                modo,
            )
        }
    })

    it('radius_servicio con solo /64 envía solo Framed-IPv6-Prefix', () => {
        const s = servicio({
            user_ppp: 'x',
            ipv6: { modo: 'radius_servicio', prefijo_enlace: '2001:db8:1::/64', prefijo_delegado: null },
        })
        const { reply } = construirReply(s, PERFIL)
        assert.equal(reply['Framed-IPv6-Prefix'], '2001:db8:1::/64')
        assert.equal(reply['Delegated-IPv6-Prefix'], undefined)
    })
})

describe('perfil RADIUS por estrategia (control-velocidad.md §7)', () => {
    const conRate = (s: ServicioAaa) => {
        s.plan.rate_limit = '5M/20M 0/0 0/0 0/0 8 5M/20M'
        s.plan.rate_limit_limitado = '1M/2M 0/0 0/0 0/0 8 1M/2M'
        return s
    }

    it('perfil_ppp activo: solo Mikrotik-Group (el rate-limit vive en el perfil)', () => {
        const s = conRate(servicio({ user_ppp: 'p' }))
        s.velocidad = { aplicacion: 'perfil_ppp', grupo: 'plan-1', rate_limit: false, rate_limit_limitado: true }
        const { reply } = construirReply(s, PERFIL)
        assert.equal(reply['Mikrotik-Group'], 'plan-1')
        assert.equal(reply['Mikrotik-Rate-Limit'], undefined)
    })

    it('perfil_ppp limitado: Mikrotik-Group y el rate-limit limitado (RADIUS gana sobre el perfil)', () => {
        const s = conRate(servicio({ user_ppp: 'p', estado: 'limitado' }))
        s.velocidad = { aplicacion: 'perfil_ppp', grupo: 'plan-1', rate_limit: false, rate_limit_limitado: true }
        const { reply } = construirReply(s, PERFIL)
        assert.equal(reply['Mikrotik-Group'], 'plan-1')
        assert.equal(reply['Mikrotik-Rate-Limit'], '1M/2M 0/0 0/0 0/0 8 1M/2M')
    })

    it('pcq_plan: sin cola por sesión; el suspendido conserva su rate-limit mínimo', () => {
        const s = conRate(servicio({ user_ppp: 'q' }))
        s.velocidad = { aplicacion: 'pcq_plan', grupo: null, rate_limit: false, rate_limit_limitado: false }
        assert.equal(construirReply(s, PERFIL).reply['Mikrotik-Rate-Limit'], undefined)
        s.estado = 'suspendido'
        assert.equal(construirReply(s, PERFIL).reply['Mikrotik-Rate-Limit'], PERFIL.suspendido.rateLimit)
    })

    it('radius_rate_limit con padre por router: grupo plan-<id> aunque el reuso sea 1', () => {
        const s = conRate(servicio({ user_ppp: 'r' }))
        s.velocidad = { aplicacion: 'radius_rate_limit', grupo: 'plan-1', rate_limit: true, rate_limit_limitado: true }
        const { reply } = construirReply(s, PERFIL)
        assert.equal(reply['Mikrotik-Group'], 'plan-1')
        assert.equal(reply['Mikrotik-Rate-Limit'], '5M/20M 0/0 0/0 0/0 8 5M/20M')
    })

    it('el contrato acepta velocidad y rechaza una aplicación desconocida', () => {
        const base = JSON.parse(JSON.stringify(servicio({ user_ppp: 'x' }))) as Record<string, unknown>
        const v = { aplicacion: 'pcq_plan', grupo: null, rate_limit: false, rate_limit_limitado: false }
        assert.deepEqual((parsearRegistro({ ...base, velocidad: v }) as ServicioAaa).velocidad, v)
        assert.throws(() => parsearRegistro({ ...base, velocidad: { ...v, aplicacion: 'magia' } }), ErrorContrato)
    })
})

describe('contrato del registro', () => {
    it('acepta el servicio completo y la lápida', () => {
        const s = servicio({ user_ppp: 'ok' })
        assert.deepEqual(parsearRegistro(JSON.parse(JSON.stringify(s))), s)
        assert.ok(esLapida(parsearRegistro({ eliminado: true, user_ppp: 'x' })))
    })

    it('rechaza estado desconocido, plan ausente o modos inválidos', () => {
        const base = JSON.parse(JSON.stringify(servicio({ user_ppp: 'x' }))) as Record<string, unknown>
        assert.throws(() => parsearRegistro({ ...base, estado: 'cortado' }), ErrorContrato)
        assert.throws(() => parsearRegistro({ ...base, plan: undefined }), ErrorContrato)
        assert.throws(() => parsearRegistro({ ...base, ipv4: { modo: 'dhcp' } }), ErrorContrato)
        assert.throws(() => parsearRegistro({ ...base, ipv6: { modo: 'slaac' } }), ErrorContrato)
        assert.throws(() => parsearRegistro({ ...base, pass_ppp: '' }), ErrorContrato)
    })

    it('acepta pendiente_instalacion como registro completo (no lápida) y construirReply no le da perfil', () => {
        const base = JSON.parse(JSON.stringify(servicio({ user_ppp: 'x' }))) as Record<string, unknown>
        const r = parsearRegistro({ ...base, estado: 'pendiente_instalacion' }) as ServicioAaa
        assert.equal(r.estado, 'pendiente_instalacion')
        assert.throws(() => construirReply(r, PERFIL), /pendiente_instalacion no tiene perfil/)
    })

    it('ipv6 null equivale a ninguno', () => {
        const base = JSON.parse(JSON.stringify(servicio({ user_ppp: 'x' }))) as Record<string, unknown>
        assert.deepEqual((parsearRegistro({ ...base, ipv6: null }) as ServicioAaa).ipv6, { modo: 'ninguno' })
    })
})

describe('fixtures', () => {
    it('cargan, cifran pass_ppp_claro y cubren los cinco estados', async () => {
        const ruta = fileURLToPath(new URL('../fixtures/servicios.json', import.meta.url))
        const f = await FuenteFixtures.desdeArchivo(ruta, CLAVE)
        const estados = new Set<string>()
        for (const u of [
            'prueba-activo',
            'prueba-limitado',
            'prueba-suspendido',
            'prueba-retirado',
            'prueba-burst',
            'prueba-pendiente',
        ]) {
            const r = await f.obtener(u)
            assert.ok(r && !esLapida(r), u)
            assert.equal(descifrar(r.pass_ppp, CLAVE), u.replace('prueba-', 'clave-'))
            estados.add(r.estado)
        }
        assert.deepEqual([...estados].sort(), [
            'activo',
            'limitado',
            'pendiente_instalacion',
            'retirado',
            'suspendido',
        ])
        assert.equal(await f.obtener('prueba-inexistente'), null)
    })
})

describe('atributos de rlm_rest', () => {
    it('toma el primer valor de cada atributo', () => {
        const a = leerAtributos({
            'User-Name': { type: 'string', value: ['juan'] },
            'NAS-Port': { type: 'integer', value: [15] },
            Vacio: { type: 'string', value: [] },
            Raro: 'x',
        })
        assert.equal(a.get('User-Name'), 'juan')
        assert.equal(a.get('NAS-Port'), '15')
        assert.equal(a.has('Vacio'), false)
        assert.equal(a.has('Raro'), false)
        assert.equal(leerAtributos(null).size, 0)
    })
})

describe('FuenteApi: URL del endpoint interno', () => {
    it('conserva el prefijo /api/v1 de la base, con o sin barra final', async () => {
        const { ApiFalsa } = await import('./ayudas.ts')
        const { FuenteApi } = await import('../src/fuentes.ts')
        const api = new ApiFalsa()
        await api.iniciar()
        try {
            for (const base of [`${api.url}/api/v1`, `${api.url}/api/v1/`]) {
                await new FuenteApi({ url: base, token: 't', timeoutMs: 500 }).obtener('nadie')
            }
            assert.deepEqual(
                api.llamadas.map((l) => l.url),
                [
                    '/api/v1/internal/aaa/servicio?user_ppp=nadie',
                    '/api/v1/internal/aaa/servicio?user_ppp=nadie',
                ],
            )
        } finally {
            await api.cerrar()
        }
    })
})
