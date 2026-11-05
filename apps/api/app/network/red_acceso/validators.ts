import vine from '@vinejs/vine'
import { reglasPaginacion } from '#shared/paginacion'
import { empresasConsulta, idEntidad, versionEsperada } from '#shared/validadores'
import { AUTENTICACIONES_PPPOE } from '#network/actions/crear_servidor_pppoe'

/** Validadores de la red de acceso (`contratos/red-acceso.md` §4). */

const texto = (max: number) => vine.string().trim().minLength(1).maxLength(max)
const nota = () => vine.string().trim().maxLength(500).nullable().optional()
const empresa = () =>
    idEntidad().nullable().optional().meta({ description: 'Empresa dueña; null = compartida entre empresas' })
/** Nombre de interfaz de RouterOS (sin espacios). */
const interfaz = () =>
    vine
        .string()
        .trim()
        .regex(/^[A-Za-z0-9._-]{1,64}$/)

/*
| OLT y puertos PON
*/

const camposOlt = {
    marca: texto(100).nullable().optional(),
    modelo: texto(100).nullable().optional(),
    empresa_id: empresa(),
    descripcion: nota(),
}

export const listarOltsValidator = vine.compile(
    vine.object({ ...reglasPaginacion, activo: vine.boolean().optional(), empresas: empresasConsulta() }),
)

export const crearOltValidator = vine.compile(vine.object({ nombre: texto(100), ...camposOlt }))

export const editarOltValidator = vine.compile(
    vine.object({
        version: versionEsperada(),
        nombre: texto(100).optional(),
        ...camposOlt,
        activo: vine.boolean().optional(),
    }),
)

const identificadorPon = () =>
    vine
        .string()
        .trim()
        .regex(/^[0-9]{1,3}(\/[0-9]{1,3}){1,3}$/)
        .meta({ description: 'marco/slot/puerto como lo escribe la OLT, p. ej. 0/1/3' })

export const crearPuertoPonValidator = vine.compile(
    vine.object({ identificador: identificadorPon(), descripcion: nota() }),
)

export const editarPuertoPonValidator = vine.compile(
    vine.object({
        version: versionEsperada(),
        identificador: identificadorPon().optional(),
        descripcion: nota(),
    }),
)

/*
| VLAN
*/

export const listarVlansValidator = vine.compile(
    vine.object({
        olt_id: idEntidad().optional(),
        puerto_pon_id: idEntidad().optional(),
        empresas: empresasConsulta(),
    }),
)

const camposVlan = {
    nombre: interfaz()
        .optional()
        .meta({ description: 'name de la interfaz en RouterOS; por defecto vlan<vlan_id>' }),
    puerto_pon_id: idEntidad().nullable().optional().meta({ description: 'Máximo 2 VLAN por puerto PON' }),
    mtu: vine.number().withoutDecimals().min(576).max(9216).nullable().optional(),
    empresa_id: empresa(),
    descripcion: nota(),
}

export const crearVlanValidator = vine.compile(
    vine.object({
        interfaz_padre: interfaz(),
        vlan_id: vine.number().withoutDecimals().min(1).max(4094),
        ...camposVlan,
    }),
)

export const editarVlanValidator = vine.compile(
    vine.object({
        version: versionEsperada(),
        interfaz_padre: interfaz().optional(),
        vlan_id: vine.number().withoutDecimals().min(1).max(4094).optional(),
        ...camposVlan,
    }),
)

/*
| Servidores PPPoE
*/

const camposServidor = {
    vlan_id: idEntidad().nullable().optional().meta({ description: 'VLAN del router; un servidor por VLAN' }),
    interfaz: interfaz()
        .optional()
        .meta({ description: 'Sin VLAN: interfaz física o bridge. Con VLAN se deriva de ella' }),
    service_name: texto(64).optional().meta({ description: 'service-name; por defecto el nombre' }),
    red_ipv4_id: idEntidad()
        .nullable()
        .optional()
        .meta({ description: 'Red del router con gateway: su gateway es el local-address' }),
    ipv6_pool_enlace_id: idEntidad().nullable().optional(),
    ipv6_pool_delegacion_id: idEntidad().nullable().optional(),
    perfil_base: texto(64)
        .optional()
        .meta({ description: 'Perfil del que se copian las propiedades que no son direcciones (default)' }),
    max_mtu: vine.number().withoutDecimals().min(576).max(9000).optional(),
    max_mru: vine.number().withoutDecimals().min(576).max(9000).optional(),
    mrru: vine.number().withoutDecimals().min(1500).max(65535).nullable().optional(),
    autenticacion: vine.array(vine.enum(AUTENTICACIONES_PPPOE)).minLength(1).distinct().optional(),
    keepalive_timeout: vine.number().withoutDecimals().min(0).max(3600).optional(),
    una_sesion_por_host: vine.boolean().optional(),
    max_sesiones: vine.number().withoutDecimals().min(1).max(100000).nullable().optional(),
    empresa_id: empresa(),
    descripcion: nota(),
}

export const crearServidorPppoeValidator = vine.compile(vine.object({ nombre: texto(64), ...camposServidor }))

export const editarServidorPppoeValidator = vine.compile(
    vine.object({
        version: versionEsperada(),
        nombre: texto(64).optional(),
        ...camposServidor,
        activo: vine.boolean().optional(),
    }),
)

/*
| Adoptar
*/

const rosId = () => vine.string().trim().minLength(1).maxLength(32).meta({ description: '.id de RouterOS' })

export const adoptarRedAccesoValidator = vine.compile(
    vine.object({
        vlans: vine
            .array(
                vine.object({
                    ros_id: rosId(),
                    puerto_pon_id: idEntidad().nullable().optional(),
                    empresa_id: empresa(),
                    descripcion: nota(),
                }),
            )
            .maxLength(500)
            .optional(),
        servidores_pppoe: vine
            .array(
                vine.object({
                    ros_id: rosId(),
                    nombre: texto(64).optional(),
                    red_ipv4_id: idEntidad().nullable().optional(),
                    ipv6_pool_enlace_id: idEntidad().nullable().optional(),
                    ipv6_pool_delegacion_id: idEntidad().nullable().optional(),
                    empresa_id: empresa(),
                    descripcion: nota(),
                }),
            )
            .maxLength(500)
            .optional(),
    }),
)
