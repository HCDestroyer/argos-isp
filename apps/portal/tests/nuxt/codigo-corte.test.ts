import { afterEach, describe, expect, it } from 'vitest'
import { QUIEN_SOY_IP_DE_ROUTER, QUIEN_SOY_POR_CODIGO } from '~~/fixtures/corte'
import { codigoCorteDeLaRuta } from '~~/server/utils/portalCautivo'

/**
 * Código de corte (`contratos/corte-identificacion.md`): el proxy del router manda al suspendido a
 * `/corte?c=<código>` y la página lo envía en `X-Argos-Corte` en cada llamada a la API.
 */

const CODIGO = 'K7M2QX9TB4RZA'

describe('código de corte', () => {
    afterEach(() => {
        sessionStorage.clear()
        useCodigoCorte().codigo.value = null
    })

    it('solo acepta el formato (13 símbolos base32 Crockford), en mayúsculas', () => {
        expect(codigoCorteValido(CODIGO.toLowerCase())).toBe(CODIGO)
        expect(codigoCorteValido([CODIGO])).toBe(CODIGO)
        expect(codigoCorteValido('corto')).toBeNull()
        expect(codigoCorteValido('K7M2QX9TB4RZU')).toBeNull()
        expect(codigoCorteValido(undefined)).toBeNull()
    })

    it('lo toma de ?c= y lo guarda en la pestaña; sin ?c= usa el guardado', () => {
        const { codigo, tomarDeLaRuta } = useCodigoCorte()
        expect(tomarDeLaRuta(CODIGO)).toBe(CODIGO)
        expect(sessionStorage.getItem(CLAVE_CODIGO_CORTE)).toBe(CODIGO)
        codigo.value = null
        expect(tomarDeLaRuta(undefined)).toBe(CODIGO)
    })

    it('el cliente HTTP lo manda en X-Argos-Corte (y nada si no hay)', async () => {
        const vistas: Request[] = []
        const fetchEspia: typeof fetch = async (entrada, init) => {
            vistas.push(new Request(entrada, init))
            return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } })
        }
        let codigo: string | null = CODIGO
        const api = crearClientePortal({ baseUrl: ORIGEN_FIXTURES, fetch: fetchEspia, codigoCorte: () => codigo })
        await api.GET('/api/v1/portal/quien-soy')
        codigo = null
        await api.GET('/api/v1/portal/estado')
        expect(vistas[0]?.headers.get(CABECERA_CODIGO_CORTE)).toBe(CODIGO)
        expect(vistas[1]?.headers.get(CABECERA_CODIGO_CORTE)).toBeNull()
    })

    it('el servidor del portal solo lo lee en /corte', () => {
        expect(codigoCorteDeLaRuta('/corte', CODIGO.toLowerCase())).toBe(CODIGO)
        expect(codigoCorteDeLaRuta('/cuenta', CODIGO)).toBeNull()
        expect(codigoCorteDeLaRuta('/corte', 'x')).toBeNull()
    })

    it('mensaje sin identificar: según el motivo, sin detalles de la red', () => {
        const ipRouter = mensajeCorte(QUIEN_SOY_IP_DE_ROUTER)
        expect(ipRouter.titulo).toBe('No pudimos identificar tu servicio')
        expect(ipRouter.descripcion).toContain('NIT o usuario')
        expect(ipRouter.descripcion).not.toMatch(/router|NAT|proxy/i)
        expect(mensajeCorte({ ...QUIEN_SOY_IP_DE_ROUTER, motivo: 'codigo_vencido' }).descripcion).toContain('venció')
        expect(mensajeCorte(QUIEN_SOY_POR_CODIGO).titulo).toBe('Tu servicio está suspendido')
    })
})
