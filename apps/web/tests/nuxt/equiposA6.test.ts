import { describe, expect, it } from 'vitest'

/**
 * A6 · equipos del cliente con SmartOLT y GenieACS (contrato Iris 0.9.0 §12): la bitácora nombra
 * las acciones nuevas en vez de mostrar su nombre técnico.
 */
describe('A6 · equipos (SmartOLT y GenieACS) en la bitácora', () => {
    it('nombra la configuración, la prueba y los pasos del aprovisionamiento y del Wi-Fi', () => {
        expect(etiquetaAccion('equipos.configurar')).toBe('Configuración de SmartOLT y GenieACS guardada')
        expect(etiquetaAccion('equipos.probar')).toBe('Prueba de conexión con SmartOLT y GenieACS')
        expect(etiquetaAccion('equipos.preparar_aprovisionamiento')).toBe(
            'Equipo configurado en SmartOLT o el ACS (aprovisionamiento)',
        )
        expect(etiquetaAccion('equipos.activar_aprovisionamiento')).toBe('Servicio activado por aprovisionamiento')
        expect(etiquetaAccion('equipos.fallar_aprovisionamiento')).toBe('Aprovisionamiento fallido')
        expect(etiquetaAccion('equipos.aplicar_wifi')).toBe('Wi-Fi del equipo cambiado por el ACS')
        expect(etiquetaAccion('servicios.aprovisionar')).toBe('Aprovisionamiento del equipo pedido')
        expect(etiquetaAccion('servicios.cambiar_wifi')).toBe('Cambio de Wi-Fi pedido')
    })
})
