import { describe, expect, it } from 'vitest'

describe('cliente HTTP del portal', () => {
    it('envía la cookie de sesión (credentials: include) y nunca un Bearer', async () => {
        let vista: Request | undefined
        const fetchEspia: typeof fetch = async (entrada, init) => {
            vista = new Request(entrada, init)
            return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } })
        }
        const api = crearClientePortal({ baseUrl: ORIGEN_FIXTURES, fetch: fetchEspia })
        await api.GET('/api/v1/me')
        expect(vista?.credentials).toBe('include')
        expect(vista?.headers.get('Authorization')).toBeNull()
    })

    it('useApi responde desde fixtures cuando NUXT_PUBLIC_USE_FIXTURES=true', async () => {
        expect(useRuntimeConfig().public.useFixtures).toBe(true)
        // /me no tiene fixture en el portal: el fetch falso responde 501 con Problem.
        const { error, response } = await useApi().GET('/api/v1/me')
        expect(response.status).toBe(501)
        expect(error?.title).toBe('Sin fixture')
    })
})

describe('useCorte', () => {
    it('consulta quien-soy del contrato y devuelve montos como string decimal', async () => {
        const { data } = await useCorte()
        expect(data.value?.identificado).toBe(true)
        expect(data.value?.estado).toBe('suspendido')
        expect(data.value?.monto_adeudado).toBe('525.00')
        expect(data.value?.facturas_vencidas).toEqual({ cantidad: 2, total: '350.00' })
        expect(formatearQuetzales(data.value?.monto_adeudado)).toBe('Q 525.00')
    })
})
