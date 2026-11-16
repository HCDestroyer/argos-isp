import { resolverEmpresaActiva } from '#core/empresas'
import { DomainAction, type Transaccion } from '#shared/domain_action'
import { ConflictoVersion } from '#shared/errores'
import { actualizarConVersion } from '#shared/version'
import {
    CAMPOS_EMPRESA,
    COLUMNA_EMPRESA,
    sinVersion,
    verEmpresa,
    type DatosEmpresa,
    type EmpresaVista,
} from '#portal/empresa'

export type EntradaEditarEmpresa = Partial<DatosEmpresa> & {
    /** versión leída; 0 si nadie la ha guardado */
    version: number
}

/**
 * Guarda la configuración de la empresa (`PUT /empresa`, permiso `empresa.editar`): nombre, NIT,
 * dirección, teléfonos, WhatsApp, correo, horario e instrucciones de pago.
 *
 * - Edita la empresa activa del contexto (`X-Empresa-Id`, o la única del usuario o de la
 *   instalación; `resolverEmpresaActiva`): 422 `empresa_requerida` si hay varias y no se eligió,
 *   403 `empresa_no_permitida` fuera del alcance del actor. Nunca cae en la empresa 1 en silencio.
 * - Versión 0 = valores por defecto: guarda los valores por defecto más lo enviado y queda con
 *   `version = 1`. Si no, control optimista por `version` (409).
 * - Solo cambia los campos enviados; `null` o texto vacío borra el dato (salvo `nombre`).
 * - Diff por campo en `audit.cambios` (entidad `empresa`, id de la empresa editada).
 */
export default class EditarEmpresa extends DomainAction<EntradaEditarEmpresa, EmpresaVista> {
    readonly nombre = 'empresa.editar'

    protected async handle(input: EntradaEditarEmpresa, t: Transaccion): Promise<EmpresaVista> {
        const empresaId = await resolverEmpresaActiva(t.ctx, t.trx)
        t.fijarEntidad('empresa', empresaId)
        t.fijarEmpresa(empresaId)
        await t.trx.from('core.empresas').where('id', empresaId).forUpdate().select('id')
        const antes = await verEmpresa(t.trx, empresaId)

        const cambios: Record<string, string | null> = {}
        for (const campo of CAMPOS_EMPRESA) {
            const valor = input[campo]
            if (valor === undefined) continue
            const limpio = typeof valor === 'string' ? valor.trim() : valor
            cambios[campo] = limpio === '' ? null : limpio
        }

        const columnas = (datos: Partial<Record<keyof DatosEmpresa, string | null>>) =>
            Object.fromEntries(
                Object.entries(datos).map(([campo, valor]) => [
                    COLUMNA_EMPRESA[campo as keyof DatosEmpresa],
                    valor,
                ]),
            )
        if (antes.version === 0) {
            if (input.version !== 0) throw new ConflictoVersion('empresa', empresaId)
            await actualizarConVersion(
                t.trx,
                'core.empresas',
                empresaId,
                0,
                columnas({ ...sinVersion(antes), ...cambios }),
            )
        } else {
            await actualizarConVersion(t.trx, 'core.empresas', empresaId, input.version, columnas(cambios))
        }

        const despues = await verEmpresa(t.trx, empresaId)
        await t.registrarCambios({ tipo: 'empresa', id: empresaId }, antes, despues)
        return despues
    }
}
