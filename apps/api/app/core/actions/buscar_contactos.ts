import { DomainAction, type Transaccion } from '#shared/domain_action'
import { ValidacionFallida } from '#shared/errores'
import { claveTelefono, sqlClaveTelefono } from '#core/consultas/clientes'
import {
    aE164,
    enmascararNumero,
    PERMISOS_POR_DEFECTO,
    type PermisosContacto,
    type RelacionContacto,
} from '#core/contactos'

export interface EntradaBuscarContactos {
    /** E.164 (o 8 dígitos de Guatemala); se audita como `***` */
    telefono: string
    /** empresas del alcance (null = todas) */
    empresas: number[] | null
}

/** Una fila de `GET /contactos/buscar` (§3.5): nunca números ni documentos. */
export interface ContactoEncontrado {
    cliente_id: number
    empresa_id: number | null
    contacto_id: number
    nombre: string
    relacion: RelacionContacto
    es_titular: boolean
    /** el número es uno de los `telefonos_adicionales` del titular: contacto no verificado */
    adicional: boolean
    /** 0.10.1 (§3.8): el número no es del titular (es un contacto a cargo de servicios del cliente) */
    a_cargo: boolean
    servicios: number[] | null
    permisos: PermisosContacto
}

interface Fila {
    cliente_id: number
    contacto_id: number
    nombre: string
    relacion: RelacionContacto
    es_titular: boolean
    adicional: boolean
    servicios: Array<number | string> | null
    permisos: Partial<PermisosContacto>
    empresa_id: number | null
}

/**
 * `contactos.buscar` (`GET /contactos/buscar?telefono=`, contrato Iris 0.10.0 §3.5, A42 y A46): de
 * quién es un número. Una fila por cliente y contacto:
 *
 * - el número es `telefono` o `movil` del cliente → su contacto titular (`es_titular`, `adicional:
 *   false`);
 * - es un adicional del titular (`telefonos_adicionales[]` del alta) → titular con `adicional: true`;
 * - es de otro contacto vigente → ese contacto, con `a_cargo: true`.
 *
 * Solo clientes dentro del alcance de empresas (con algún servicio en ellas, o sin servicios) y
 * contactos cuya empresa esté en el alcance. No devuelve otros números ni documentos. Auditada: el
 * número como `***` y su versión enmascarada, con los clientes que devolvió.
 */
export default class BuscarContactos extends DomainAction<EntradaBuscarContactos, ContactoEncontrado[]> {
    readonly nombre = 'contactos.buscar'
    protected readonly camposEntradaOcultos = ['telefono']

    protected async handle(input: EntradaBuscarContactos, t: Transaccion): Promise<ContactoEncontrado[]> {
        const numero = aE164(input.telefono)
        if (numero === null) {
            throw new ValidacionFallida([
                {
                    field: 'telefono',
                    rule: 'telefono',
                    message: 'Número inválido: E.164 (+ y 8 a 15 dígitos)',
                },
            ])
        }
        const clave = claveTelefono(numero)
        const empresas = input.empresas
        const filtroEmpresas =
            empresas === null
                ? ''
                : `AND (EXISTS (SELECT 1 FROM core.servicios s_al WHERE s_al.cliente_id = c.id AND s_al.empresa_id = ANY(CAST(:empresas AS bigint[])))
                        OR NOT EXISTS (SELECT 1 FROM core.servicios s_sin WHERE s_sin.cliente_id = c.id))`
        const empresaContacto = `coalesce(
            (SELECT s_e.empresa_id FROM core.servicios s_e WHERE k.servicios IS NOT NULL AND s_e.id = ANY(k.servicios) ORDER BY s_e.id LIMIT 1),
            (SELECT s_c.empresa_id FROM core.servicios s_c WHERE k.servicios IS NULL AND s_c.cliente_id = k.cliente_id AND s_c.estado <> 'retirado'
                ${empresas === null ? '' : 'AND s_c.empresa_id = ANY(CAST(:empresas AS bigint[]))'} ORDER BY s_c.id LIMIT 1)
        )`
        const sql = `
            SELECT * FROM (
                SELECT c.id AS cliente_id, k.id AS contacto_id, c.nombre, k.relacion, true AS es_titular,
                       false AS adicional, k.servicios, k.permisos, ${empresaContacto} AS empresa_id
                  FROM core.clientes c
                  JOIN core.contactos_cliente k ON k.cliente_id = c.id AND k.es_titular
                 WHERE (${sqlClaveTelefono('c.telefono')} = :clave OR ${sqlClaveTelefono('c.movil')} = :clave)
                   ${filtroEmpresas}
                UNION ALL
                SELECT c.id, k.id, CASE WHEN k.es_titular THEN c.nombre ELSE k.nombre END, k.relacion, k.es_titular,
                       tel.adicional, k.servicios, k.permisos, ${empresaContacto}
                  FROM core.contactos_cliente_telefonos tel
                  JOIN core.contactos_cliente k ON k.id = tel.contacto_id AND k.quitado_en IS NULL
                  JOIN core.clientes c ON c.id = k.cliente_id
                 WHERE tel.numero = :numero
                   ${filtroEmpresas}
            ) filas
            ORDER BY cliente_id, es_titular DESC, contacto_id, adicional`
        const resultado = await t.trx.rawQuery(sql, {
            clave,
            numero,
            // literal de arreglo de Postgres: knex expandiría un arreglo JS en varios parámetros
            empresas: `{${(empresas ?? []).join(',')}}`,
        })
        const filas = resultado.rows as Fila[]

        const vistas = new Set<string>()
        const salida: ContactoEncontrado[] = []
        for (const fila of filas) {
            const empresaId = fila.empresa_id === null ? null : Number(fila.empresa_id)
            // un contacto acotado a servicios de otra empresa no sale
            if (empresas !== null && empresaId !== null && !empresas.includes(empresaId)) continue
            const llave = `${fila.cliente_id}:${fila.contacto_id}`
            if (vistas.has(llave)) continue
            vistas.add(llave)
            salida.push({
                cliente_id: Number(fila.cliente_id),
                empresa_id: empresaId,
                contacto_id: Number(fila.contacto_id),
                nombre: fila.nombre,
                relacion: fila.relacion,
                es_titular: fila.es_titular,
                adicional: fila.es_titular && fila.adicional,
                a_cargo: !fila.es_titular,
                servicios: fila.servicios === null ? null : fila.servicios.map(Number),
                permisos: { ...PERMISOS_POR_DEFECTO, ...fila.permisos },
            })
        }
        t.anotarAuditoria({
            telefono: enmascararNumero(numero),
            clientes: [...new Set(salida.map((f) => f.cliente_id))],
        })
        return salida
    }
}
