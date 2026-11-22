import RegistrarReconexionTemporal from '#billing/actions/registrar_reconexion_temporal'

/**
 * `comprobantes.reconectar` (`POST /comprobantes/:id/reconectar`, decisión del PM 15): el cajero (o
 * soporte) da desde el panel la reconexión temporal de un servicio cortado mientras caja revisa su
 * comprobante. **Mismas reglas y mismo cupo que Iris** (`RegistrarReconexionTemporal`): la política
 * `reglas_promesa.reconexion_temporal` de la plantilla, una sola promesa abierta, `max_por_periodo`
 * reconexiones por periodo (las de Iris y las del panel cuentan juntas), el comprobante debe cubrir lo
 * vencido y nunca sobre una suspensión manual. Crea la promesa `reconexion_temporal` (canal
 * `operador`, sin `sistema_origen`) y `evaluarEstadoServicio` reactiva en la misma transacción.
 * Permiso propio (de fábrica para cajero y soporte). Eventos `promesa.creada` y, si cambió,
 * `servicio.estado_cambiado`.
 */
export default class ReconectarTemporal extends RegistrarReconexionTemporal {
    override readonly nombre: string = 'comprobantes.reconectar'
}
