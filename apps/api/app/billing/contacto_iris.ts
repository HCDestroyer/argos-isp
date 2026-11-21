import type { HttpContext } from '@adonisjs/core/http'
import { Problema, ValidacionFallida } from '#shared/errores'
import { esTokenIris } from '#integraciones/iris/atencion'
import { FORMATO_IRIS_CONTACTO, exigirPermisoDeContacto, type PermisoContacto } from '#core/contactos'

/**
 * `X-Iris-Contacto` (contrato Iris 0.10.1 §7.1 y §3.5) en lo que pide un contacto del cliente desde Iris:
 * promesas (`pagar`), comprobantes (`pagar`) y el estado de cuenta por servicio (`consultar`).
 *
 * - Solo con el token de Iris; otro actor la ignora.
 * - Sin la cabecera o con `titular`: lo de siempre (el titular). Mal formada: 422 `validacion`
 *   (`field: X-Iris-Contacto`).
 * - Con `<contacto_id>`: el contacto debe ser del cliente y el servicio uno de los suyos (403
 *   `servicio_fuera_del_contacto`), con su permiso encendido (403 `permiso_de_contacto`). Un contacto
 *   acotado a algunos servicios siempre indica el servicio: sin él, 403 `servicio_fuera_del_contacto`.
 *
 * Devuelve el `contacto_id` validado (o null).
 */
export async function exigirContactoIris(
    ctx: HttpContext,
    entrada: { cliente_id: number; servicio_id: number | null; permiso: PermisoContacto },
): Promise<number | null> {
    if (!esTokenIris(ctx)) return null
    const valor = ctx.request.header('X-Iris-Contacto')?.trim()
    if (valor === undefined || valor === '') return null
    if (!FORMATO_IRIS_CONTACTO.test(valor)) {
        throw new ValidacionFallida([
            {
                field: 'X-Iris-Contacto',
                message: 'Un contacto_id (entero positivo) o `titular`',
                rule: 'formato',
            },
        ])
    }
    if (valor === 'titular') return null
    const contacto = await exigirPermisoDeContacto(Number(valor), entrada)
    if (entrada.servicio_id === null && contacto.servicios !== null) {
        throw new Problema(
            403,
            'servicio_fuera_del_contacto',
            'Servicio fuera del contacto',
            'Este contacto solo ve algunos servicios del cliente: indica servicio_id',
        )
    }
    return contacto.contacto_id
}
