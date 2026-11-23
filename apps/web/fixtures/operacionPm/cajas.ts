import type { RutasFixture } from '~/utils/fetchFixtures'
import { bd } from '../bd'
import { ahora, conIdempotencia, conPermiso, cuerpoObjeto, datosInvalidos, idDe, noEncontrado, registrarAccion, versionCambiada } from '../comun'

const FORMATOS = ['pos_80', 'carta']

/**
 * `PUT /cajas/:id/impresion` (A3, decisión 20): cada caja recuerda el formato del recibo (ticket de
 * 80 mm de fábrica) y de la factura (carta de fábrica). Solo cambia lo que viene; 409 con otra `version`.
 */
export const rutasImpresionCaja: RutasFixture = {
    'PUT /api/v1/cajas/:id/impresion': conPermiso('cajas.configurar_impresion', conIdempotencia((solicitud) => {
        const caja = bd.cajas.find(c => c.id === idDe(solicitud))
        if (!caja) {
            return noEncontrado('la caja')
        }
        const { version, formato_recibo: recibo, formato_factura: factura } = cuerpoObjeto(solicitud)
        const errores = [
            ...(recibo !== undefined && !FORMATOS.includes(String(recibo)) ? [{ field: 'formato_recibo', message: 'El valor de formato_recibo no es válido', rule: 'enum' }] : []),
            ...(factura !== undefined && !FORMATOS.includes(String(factura)) ? [{ field: 'formato_factura', message: 'El valor de formato_factura no es válido', rule: 'enum' }] : []),
        ]
        if (errores.length) {
            return datosInvalidos(errores)
        }
        if (version !== caja.version) {
            return versionCambiada()
        }
        Object.assign(caja, {
            formato_recibo: recibo === 'carta' || recibo === 'pos_80' ? recibo : caja.formato_recibo ?? 'pos_80',
            formato_factura: factura === 'carta' || factura === 'pos_80' ? factura : caja.formato_factura ?? 'carta',
            version: caja.version + 1,
            updated_at: ahora(),
        })
        registrarAccion(solicitud, 'cajas.configurar_impresion', { tipo: 'caja', id: caja.id }, { formato_recibo: recibo, formato_factura: factura })
        return { status: 200, cuerpo: caja }
    })),
}
