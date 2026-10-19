import { DomainAction, type Transaccion } from '#shared/domain_action'
import { Conflicto, ValidacionFallida, type ErrorCampo } from '#shared/errores'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { usuarioDelActor } from '#shared/contexto'
import { resolverEmpresaActiva } from '#core/empresas'
import {
    normalizarDocumentoProveedor,
    verProveedor,
    type ProveedorVista,
    type RegimenProveedor,
    type TipoDocumentoProveedor,
    type TipoProveedor,
} from '#ledger/proveedores'

/**
 * `proveedores.crear` (`POST /proveedores`, permiso `proveedores.editar`): alta de un proveedor de
 * la empresa activa (o de `empresa_id`), con el documento validado como en el núcleo.
 *
 * - `nit` por defecto: dígito verificador módulo 11 (`#core/nit_cui`); `cui`: estructura del
 *   RENAP; `id_extranjero` solo para `no_residente` (y al revés).
 * - Pequeño contribuyente: `regimen_isr = pequeno_contribuyente` (por defecto).
 * - 409 `proveedor_duplicado` si la empresa ya tiene un proveedor activo con ese documento.
 */

export interface EntradaCrearProveedor {
    empresa_id?: number | null
    tipo_documento?: TipoDocumentoProveedor | null
    nit: string
    nombre: string
    tipo?: TipoProveedor | null
    regimen_isr?: RegimenProveedor | null
    agente_retencion_iva?: boolean | null
    pais?: string | null
    direccion?: string | null
    correo?: string | null
    telefono?: string | null
    dias_credito?: number | null
}

/** Reglas comunes de alta y edición: tipo, documento y régimen coherentes. */
export function validarDatosProveedor(datos: {
    tipo: TipoProveedor
    tipo_documento: TipoDocumentoProveedor
    regimen_isr: RegimenProveedor | null
}): ErrorCampo[] {
    const errores: ErrorCampo[] = []
    if ((datos.tipo === 'no_residente') !== (datos.tipo_documento === 'id_extranjero')) {
        errores.push({
            field: 'tipo_documento',
            message: 'Un no residente se identifica con id_extranjero, y solo él',
            rule: 'tipo_documento',
        })
    }
    if (datos.tipo === 'pequeno_contribuyente' && datos.regimen_isr !== 'pequeno_contribuyente') {
        errores.push({
            field: 'regimen_isr',
            message: 'Un pequeño contribuyente tiene el régimen pequeno_contribuyente',
            rule: 'regimen_isr',
        })
    }
    if (datos.tipo !== 'pequeno_contribuyente' && datos.regimen_isr === 'pequeno_contribuyente') {
        errores.push({
            field: 'tipo',
            message: 'El régimen pequeno_contribuyente corresponde al tipo pequeno_contribuyente',
            rule: 'tipo',
        })
    }
    if (datos.tipo === 'no_residente' && datos.regimen_isr !== null) {
        errores.push({
            field: 'regimen_isr',
            message: 'Un no residente no tiene régimen de ISR en Guatemala',
            rule: 'regimen_isr',
        })
    }
    return errores
}

/** 409 `proveedor_duplicado` si otro proveedor activo de la empresa tiene ese documento. */
export async function exigirDocumentoLibre(
    t: Transaccion,
    empresaId: number,
    nit: string,
    excepto?: number,
): Promise<void> {
    // dos altas simultáneas del mismo documento: el índice único parcial deja pasar una sola
    await t.trx.rawQuery('SELECT pg_advisory_xact_lock(?, hashtext(?))', [3010, `${empresaId}:${nit}`])
    const repetido = await t.trx
        .from('ledger.proveedores')
        .where({ empresa_id: empresaId, nit, activo: true })
        .if(excepto !== undefined, (q) => q.whereNot('id', excepto!))
        .select('id')
        .first()
    if (repetido) {
        throw new Conflicto(
            `La empresa ya tiene el proveedor ${repetido.id} con el documento ${nit}`,
            'proveedor_duplicado',
            'Proveedor duplicado',
        )
    }
}

export default class CrearProveedor extends DomainAction<EntradaCrearProveedor, ProveedorVista> {
    readonly nombre = 'proveedores.crear'

    protected async handle(input: EntradaCrearProveedor, t: Transaccion): Promise<ProveedorVista> {
        const empresaId = input.empresa_id ?? (await resolverEmpresaActiva(t.ctx, t.trx))
        exigirAccesoEmpresa(t.ctx, empresaId)
        t.fijarEmpresa(empresaId)

        const tipo = input.tipo ?? 'general'
        const tipoDocumento = input.tipo_documento ?? (tipo === 'no_residente' ? 'id_extranjero' : 'nit')
        const regimen =
            input.regimen_isr ?? (tipo === 'pequeno_contribuyente' ? 'pequeno_contribuyente' : null)
        const pais = (input.pais ?? 'GT').trim().toUpperCase()
        const errores = validarDatosProveedor({ tipo, tipo_documento: tipoDocumento, regimen_isr: regimen })
        const nombre = input.nombre?.trim() ?? ''
        if (nombre.length < 2) {
            errores.push({ field: 'nombre', message: 'El nombre es obligatorio', rule: 'required' })
        }
        if (errores.length > 0) throw new ValidacionFallida(errores)
        const nit = normalizarDocumentoProveedor(tipoDocumento, input.nit, pais)
        await exigirDocumentoLibre(t, empresaId, nit)

        const [fila] = (await t.trx
            .insertQuery()
            .table('ledger.proveedores')
            .insert({
                empresa_id: empresaId,
                tipo_documento: tipoDocumento,
                nit,
                nombre,
                tipo,
                regimen_isr: regimen,
                agente_retencion_iva: input.agente_retencion_iva ?? false,
                pais,
                direccion: input.direccion?.trim() || null,
                correo: input.correo?.trim() || null,
                telefono: input.telefono?.trim() || null,
                dias_credito: input.dias_credito ?? 0,
                created_by: usuarioDelActor(t.ctx.actor),
            })
            .returning('id')) as Array<{ id: number }>
        const id = Number(fila!.id)
        t.fijarEntidad('proveedor', id)
        return verProveedor(id, t.trx)
    }
}
