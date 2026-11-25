import { describe, expect, it } from 'vitest'
import { avisoDocumentoFiscal, AVISO_NIT_SIN_VERIFICADOR, errorDocumentoFiscal, revisarNit } from '~/utils/documentoFiscal'
import { entradaEmpresaGrupo, esquemaEmpresaGrupo } from '~/utils/esquemasEmpresa'
import { bd } from '~~/fixtures/bd'

/** NIT tolerante (`contratos/fel-establecimientos.md` R1), espejo de `revisarNit` de la API. */
describe('NIT tolerante · espejo de la API', () => {
    it('revisarNit normaliza y avisa; null sin forma de NIT', () => {
        expect(revisarNit('12521337')).toEqual({ nit: '12521337', valido: true })
        expect(revisarNit('1252133-7')).toEqual({ nit: '12521337', valido: true })
        expect(revisarNit('5769373K')).toEqual({ nit: '5769373K', valido: false })
        expect(revisarNit('ABC-123')).toEqual({ nit: 'ABC123', valido: false })
        expect(revisarNit('1000000000K')).toEqual({ nit: '1000000000K', valido: false })
        for (const malo of ['-', 'A', '12#45', 'X'.repeat(21)]) {
            expect(revisarNit(malo), malo).toBeNull()
        }
    })

    it('el módulo 11 es aviso, no error', () => {
        expect(errorDocumentoFiscal('nit', 'ABC-123', 'GT')).toBeNull()
        expect(avisoDocumentoFiscal('nit', 'ABC-123')).toBe(AVISO_NIT_SIN_VERIFICADOR)
        expect(avisoDocumentoFiscal('nit', '1252133-7')).toBeNull()
        expect(avisoDocumentoFiscal('cui', '1234567890101')).toBeNull()
        expect(errorDocumentoFiscal('nit', '12#45', 'GT')?.campo).toBe('nit_cui')
    })

    it('el esquema de la empresa acepta letras y guiones; rechaza CF y símbolos', () => {
        const base = entradaEmpresaGrupo(bd.empresas[0]!)
        expect(esquemaEmpresaGrupo.safeParse({ ...base, nit: 'DEMO-123' }).success).toBe(true)
        expect(esquemaEmpresaGrupo.safeParse({ ...base, nit: '1170142K' }).success).toBe(true)
        expect(esquemaEmpresaGrupo.safeParse({ ...base, nit: 'cf' }).success).toBe(false)
        expect(esquemaEmpresaGrupo.safeParse({ ...base, nit: '12#45' }).success).toBe(false)
    })
})
