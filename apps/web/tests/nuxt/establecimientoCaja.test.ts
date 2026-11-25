import { describe, expect, it } from 'vitest'
import { cuerpoEstablecimiento, esquemaEstablecimiento } from '~/utils/esquemasFiscal'

/** Lote 4 con la decisión P1 del PM: código postal y cajas de la sucursal (espejo del validador). */
describe('establecimiento · código postal y cajas', () => {
    const base = { codigo: '2', nombre: 'Sucursal Xela', direccion: '', municipio: 'Quetzaltenango', departamento: 'Quetzaltenango', codigo_postal: '', cajas: [], por_defecto: false, activo: true }

    it('código postal opcional de 5 dígitos; vacío se manda como null', () => {
        expect(esquemaEstablecimiento.safeParse({ ...base, codigo_postal: '0900' }).success).toBe(false)
        const bueno = esquemaEstablecimiento.parse({ ...base, codigo_postal: '09001', cajas: [3] })
        expect(cuerpoEstablecimiento(bueno)).toMatchObject({ codigo_postal: '09001', cajas: [3] })
        expect(esquemaEstablecimiento.parse(base).codigo_postal).toBeNull()
    })
})
