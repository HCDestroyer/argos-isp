import { DomainAction, type Transaccion } from '#shared/domain_action'
import { ReglaNegocio } from '#shared/errores'
import RegistrarConsentimientoWhatsapp from '#notify/actions/registrar_consentimiento_whatsapp'
import type { VistaConsentimiento } from '#notify/consentimientos'
import { vistasVisibles, type EstadoContactoWhatsapp } from '#portal/whatsapp'

export interface EntradaWhatsappPortal {
    clienteId: number
    /** `acepta`: marcó «Acepta avisos por WhatsApp»; `baja`: la quitó */
    estado: EstadoContactoWhatsapp
}

/**
 * El cliente marca o quita «Acepta avisos por WhatsApp» en el portal (`POST /portal/whatsapp`,
 * contrato Iris 0.6.0 §6.4).
 *
 * Delega en `RegistrarConsentimientoWhatsapp` de A6 (`origen: 'argos_portal'`, misma transacción)
 * una vez por cada empresa con servicios vigentes del cliente que tiene WhatsApp encendido en notify:
 * en Iris el permiso lleva empresa, en Argos el estado de contacto es uno por cliente. Como la
 * `Idempotency-Key` hacia Iris es `cliente + canal + ocurrido_en`, cada empresa usa un milisegundo
 * distinto. 422 `whatsapp_no_disponible` si ninguna empresa lo tiene encendido. Con el conector Iris
 * apagado la marca queda en la cola hacia Iris y sale al activarse (lo decide A6).
 */
export default class RegistrarWhatsappPortal extends DomainAction<
    EntradaWhatsappPortal,
    VistaConsentimiento[]
> {
    readonly nombre = 'portal.registrar_whatsapp'

    protected async handle(input: EntradaWhatsappPortal, t: Transaccion): Promise<VistaConsentimiento[]> {
        t.fijarEntidad('cliente', input.clienteId)
        const visibles = await vistasVisibles(input.clienteId, t.trx)
        if (visibles.length === 0) {
            throw new ReglaNegocio(
                'Los avisos por WhatsApp no están activos para tu servicio',
                'whatsapp_no_disponible',
            )
        }
        const base = Date.now()
        const salida: VistaConsentimiento[] = []
        for (const [indice, { empresaId }] of visibles.entries()) {
            salida.push(
                await new RegistrarConsentimientoWhatsapp().execute(
                    {
                        cliente_id: input.clienteId,
                        estado: input.estado,
                        origen: 'argos_portal',
                        empresa_id: empresaId,
                        ocurrido_en: new Date(base + indice),
                    },
                    { ...t.ctx, empresaId },
                    { trx: t.trx },
                ),
            )
        }
        return salida
    }
}
