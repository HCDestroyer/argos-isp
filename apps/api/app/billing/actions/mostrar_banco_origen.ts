import OcultarBancoOrigen from '#billing/actions/ocultar_banco_origen'

/**
 * `bancos_origen.mostrar` (`POST /bancos-origen/:id/mostrar`, decisión del PM 23): la empresa vuelve a
 * mostrar un banco que había ocultado. Ver `OcultarBancoOrigen`.
 */
export default class MostrarBancoOrigen extends OcultarBancoOrigen {
    override readonly nombre: string = 'bancos_origen.mostrar'
    protected override readonly ocultar: boolean = false
}
