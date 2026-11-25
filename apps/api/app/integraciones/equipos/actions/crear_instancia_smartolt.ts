import { DomainAction, type Transaccion } from '#shared/domain_action'
import { ValidacionFallida, type ErrorCampo } from '#shared/errores'
import { cifrar } from '#shared/cifrado'
import { exigirEmpresaActivaDelContexto } from '#shared/empresa_activa'
import { normalizarUrl } from '#integraciones/equipos/configuracion'
import {
    CompartidaSinAlcance,
    TABLA_INSTANCIAS,
    alcanceGlobal,
    empresaQueMira,
    exigirNombreLibre,
    exigirUrlLibre,
    instanciaDesdeFila,
    instanciaSinSecretos,
    vistaInstancia,
    type FilaInstancia,
    type VistaInstancia,
} from '#integraciones/equipos/smartolt_instancias'

export interface EntradaCrearInstancia {
    nombre: string
    /** `https://<subdominio>.smartolt.com` */
    url: string
    token: string
    /** true = compartida con todas las empresas (solo con alcance global); si no, de la empresa activa */
    compartida?: boolean
    activo?: boolean
    nota?: string | null
}

/**
 * `smartolt.crear_instancia` (`POST /integraciones/smartolt/instancias`, `contratos/equipos-olt-acs.md`
 * §5.1): registra una cuenta (subdominio) de SmartOLT de la empresa activa o compartida.
 *
 * - URL única en la instalación (`409 subdominio_duplicado`); nombre único por empresa
 *   (`409 instancia_duplicada`). Compartida solo con alcance global (`403 empresa_no_permitida`).
 * - El token se guarda cifrado y nunca sale (respuesta, auditoría y evento sin su valor).
 * - Nace sin probar: no está operativa hasta `smartolt.probar_instancia`.
 * - Emite `equipos.config_cambiada` (`sistema: smartolt`, `accion: creada`).
 */
export default class CrearInstanciaSmartOlt extends DomainAction<EntradaCrearInstancia, VistaInstancia> {
    readonly nombre = 'smartolt.crear_instancia'
    protected override readonly camposEntradaOcultos = ['token']

    protected async handle(input: EntradaCrearInstancia, t: Transaccion): Promise<VistaInstancia> {
        const empresaActiva = exigirEmpresaActivaDelContexto(t.ctx)
        if (input.compartida && !alcanceGlobal(t.ctx)) throw new CompartidaSinAlcance()
        const empresaId = input.compartida ? null : empresaActiva
        t.fijarEmpresa(empresaId)

        const errores: ErrorCampo[] = []
        const nombre = input.nombre.trim()
        if (!nombre) errores.push({ field: 'nombre', rule: 'requerido', message: 'Ponle un nombre' })
        const url = normalizarUrl(input.url.trim(), 'smartolt')
        if (url.error) errores.push({ field: 'url', rule: 'url', message: url.error })
        const token = input.token.trim()
        if (token.length < 8) {
            errores.push({ field: 'token', rule: 'minLength', message: 'El token de SmartOLT es más largo' })
        }
        if (errores.length > 0) throw new ValidacionFallida(errores)
        await exigirUrlLibre(t.trx, url.url!)
        await exigirNombreLibre(t.trx, empresaId, nombre)

        const nota = input.nota?.trim() || null
        const [fila] = (await t.trx
            .insertQuery()
            .table(TABLA_INSTANCIAS)
            .insert({
                empresa_id: empresaId,
                nombre,
                nota,
                url: url.url,
                token_cifrado: cifrar(token),
                activo: input.activo ?? false,
            })
            .returning('*')) as FilaInstancia[]
        const id = Number(fila!.id)
        t.fijarEntidad('instancia_smartolt', id)
        await t.registrarCambios({ tipo: 'instancia_smartolt', id }, null, instanciaSinSecretos(fila!, true))
        await t.emit('equipos.config_cambiada', {
            sistema: 'smartolt',
            empresa_id: empresaId,
            instancia_id: id,
            accion: 'creada',
            campos: ['nombre', 'url', 'token', 'activo', ...(nota ? ['nota'] : []), 'empresa'],
            operativa: instanciaDesdeFila(fila!).operativa,
        })
        return vistaInstancia(fila!, t.trx, empresaQueMira(t.ctx))
    }
}
