import { DomainAction, type Transaccion } from '#shared/domain_action'
import { usuarioDelActor } from '#shared/contexto'
import { ValidacionFallida } from '#shared/errores'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { exigirEmpresaActiva } from '#core/empresas'
import { hoyFiscal } from '#fiscal/comun'
import { invalidarParametros } from '#fiscal/cache_parametros'
import { instalacionVigente, instalarPaquete, paqueteDePais, PAQUETES } from '#fiscal/instalador'
import { verLocalizacionEmpresa, type LocalizacionEmpresa } from '#fiscal/consultas'
import type { ResumenInstalacion } from '#fiscal/localizacion'

/**
 * `fiscal.instalar` (`POST /fiscal/empresas/:id/actualizar-localizacion`, contrato §4): instala en
 * la empresa la versión `codigo` del paquete de su país (por defecto la más reciente). Solo
 * inserta lo que falta: instalar dos veces no agrega nada. Una versión anterior a la instalada
 * responde 422.
 *
 * Emite `fiscal.localizacion_instalada` si cambió la versión de la empresa y
 * `fiscal.parametros_cambiados` si se agregaron valores (invalida la caché).
 *
 * El núcleo la llama en la transacción de `empresas.crear` y `empresas.cambiar_pais` por su punto de
 * extensión (`#core/localizacion`; lo registra `#fiscal/instalador_localizacion`) con `desde_nucleo`.
 */

export interface EntradaActualizarLocalizacion {
    empresa_id: number
    /** versión a instalar; por defecto la más reciente del país */
    codigo?: string | null
    /** país a instalar; por defecto `core.empresas.pais` */
    pais?: string | null
    /** la llama el núcleo: el acceso a la empresa ya lo autorizó su acción */
    desde_nucleo?: boolean
}

export interface SalidaActualizarLocalizacion extends LocalizacionEmpresa {
    resumen: ResumenInstalacion
}

function compararVersion(a: string, b: string): number {
    const pa = a.split('.').map(Number)
    const pb = b.split('.').map(Number)
    for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return (pa[i] ?? 0) - (pb[i] ?? 0)
    return 0
}

export default class ActualizarLocalizacion extends DomainAction<
    EntradaActualizarLocalizacion,
    SalidaActualizarLocalizacion
> {
    readonly nombre = 'fiscal.instalar'

    protected async handle(
        input: EntradaActualizarLocalizacion,
        t: Transaccion,
    ): Promise<SalidaActualizarLocalizacion> {
        await exigirEmpresaActiva(t.trx, input.empresa_id, 'id')
        // desde el núcleo (empresas.crear / cambiar_pais) la acción que la llama ya autorizó
        if (!input.desde_nucleo) exigirAccesoEmpresa(t.ctx, input.empresa_id)
        t.fijarEmpresa(input.empresa_id)
        t.fijarEntidad('empresa', input.empresa_id)

        const vigente = await instalacionVigente(t.trx, input.empresa_id)
        const empresa = (await t.trx
            .from('core.empresas')
            .where('id', input.empresa_id)
            .select('pais')
            .firstOrFail()) as { pais: string }
        const pais = (input.pais ?? empresa.pais).trim().toUpperCase()
        const codigo = input.codigo ?? paqueteDePais(pais).codigo
        const paquete = PAQUETES[codigo]
        if (!paquete || paquete.pais !== pais) {
            throw new ValidacionFallida([
                { field: 'codigo', message: `No hay un paquete ${codigo} para ${pais}`, rule: 'exists' },
            ])
        }
        if (vigente && vigente.pais === pais && vigente.localizacion_codigo !== codigo) {
            const anterior = PAQUETES[vigente.localizacion_codigo]
            if (anterior && compararVersion(paquete.version, anterior.version) < 0) {
                throw new ValidacionFallida([
                    {
                        field: 'codigo',
                        message: `La empresa ya tiene ${vigente.localizacion_codigo}, posterior a ${codigo}`,
                        rule: 'version_anterior',
                    },
                ])
            }
        }

        const resumen = await instalarPaquete(t.trx, paquete, input.empresa_id, {
            instaladaPor: usuarioDelActor(t.ctx.actor),
            hoy: hoyFiscal(),
        })

        if (resumen.instalacion_id !== null) {
            await t.registrarCambios(
                { tipo: 'empresa', id: input.empresa_id },
                { localizacion: resumen.de_codigo },
                { localizacion: resumen.codigo },
            )
            await t.emit('fiscal.localizacion_instalada', {
                empresa_id: input.empresa_id,
                pais,
                codigo: resumen.codigo,
                de_codigo: resumen.de_codigo,
            })
        }
        const claves = [
            ...resumen.valores.map((v) => v.clave),
            ...resumen.impuestos.map((i) => `impuesto:${i.split('@')[0]}`),
        ]
        if (claves.length > 0) {
            const globales =
                resumen.valores.some((v) => v.empresa_id === null) || resumen.impuestos.length > 0
            const fechas = [
                ...resumen.valores.map((v) => v.vigente_desde),
                ...resumen.impuestos.map((i) => i.split('@')[1]!),
            ].sort()
            const empresaEvento = globales ? null : input.empresa_id
            await t.emit('fiscal.parametros_cambiados', {
                empresa_id: empresaEvento,
                claves: [...new Set(claves)],
                vigente_desde: fechas[0]!,
            })
            t.alConfirmar(() => invalidarParametros(empresaEvento))
        }

        return { ...(await verLocalizacionEmpresa(input.empresa_id, t.trx)), resumen }
    }
}
