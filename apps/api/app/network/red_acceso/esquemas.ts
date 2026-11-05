import {
    auditable,
    booleano,
    definirEsquema,
    entero,
    enumerado,
    id,
    instante,
    lista,
    nulable,
    objeto,
    texto,
} from '#shared/openapi/esquemas'

/** Esquemas de respuesta de la red de acceso (`contratos/red-acceso.md` §4). */

const estado = {
    ...enumerado(['administrado', 'adoptado']),
    description:
        'administrado: Argos lo escribe en el router (comment argosisp:…); adoptado: existía, Argos no lo toca',
}
const empresa = { ...nulable(id), description: 'Empresa dueña; null = compartida' }

export const PuertoPon = definirEsquema(
    'PuertoPon',
    objeto({
        id,
        olt_id: id,
        identificador: { ...texto, description: 'marco/slot/puerto, p. ej. 0/1/3' },
        descripcion: nulable(texto),
        vlans: { ...entero, description: 'VLAN asignadas (máximo 2)' },
        ...auditable,
    }),
)

export const Olt = definirEsquema(
    'Olt',
    objeto({
        id,
        nombre: texto,
        marca: nulable(texto),
        modelo: nulable(texto),
        empresa_id: empresa,
        descripcion: nulable(texto),
        activo: booleano,
        puertos: lista(PuertoPon),
        ...auditable,
    }),
)

export const Vlan = definirEsquema(
    'Vlan',
    objeto({
        id,
        router_id: id,
        empresa_id: empresa,
        interfaz_padre: texto,
        vlan_id: { ...entero, minimum: 1, maximum: 4094 },
        nombre: { ...texto, description: 'name de la interfaz VLAN en RouterOS' },
        puerto_pon_id: nulable(id),
        puerto_pon: nulable(objeto({ id, identificador: texto, olt_id: id, olt_nombre: texto })),
        mtu: nulable(entero),
        estado,
        ros_id: { ...nulable(texto), description: '.id en RouterOS' },
        comment: { ...nulable(texto), description: 'argosisp:vlan:<id> si es administrada' },
        descripcion: nulable(texto),
        ...auditable,
    }),
)

export const ServidorPppoe = definirEsquema(
    'ServidorPppoe',
    objeto({
        id,
        router_id: id,
        empresa_id: empresa,
        nombre: texto,
        vlan_id: nulable(id),
        vlan: nulable(objeto({ id, nombre: texto, vlan_id: entero })),
        interfaz: texto,
        service_name: texto,
        red_ipv4_id: nulable(id),
        ipv6_pool_enlace_id: nulable(id),
        ipv6_pool_delegacion_id: nulable(id),
        perfil_base: {
            ...texto,
            description: 'Perfil del que se copian las propiedades que no son direcciones',
        },
        perfil: {
            ...nulable(texto),
            description:
                'Perfil PPP del servidor: argosisp-pppoe-<id> si es administrado; el leído si es adoptado',
        },
        local_address: {
            ...nulable(texto),
            description: 'Gateway de su red IPv4 (calculado; nunca se teclea ni se copia del perfil default)',
        },
        max_mtu: entero,
        max_mru: entero,
        mrru: nulable(entero),
        autenticacion: lista(enumerado(['pap', 'chap', 'mschap1', 'mschap2'])),
        keepalive_timeout: entero,
        una_sesion_por_host: booleano,
        max_sesiones: nulable(entero),
        estado,
        ros_id: nulable(texto),
        comment: { ...nulable(texto), description: 'argosisp:pppoe:<id> si es administrado' },
        activo: booleano,
        servicios: { ...entero, description: 'Servicios no retirados en este servidor' },
        descripcion: nulable(texto),
        ...auditable,
    }),
)

export const RedAccesoRouter = definirEsquema(
    'RedAccesoRouter',
    objeto({
        router_id: id,
        vlans: lista(Vlan),
        servidores_pppoe: lista(ServidorPppoe),
        olts: lista(objeto({ id, nombre: texto, puertos: lista(objeto({ id, identificador: texto })) })),
        servicios_sin_servidor: {
            ...entero,
            description: 'Servicios PPPoE del router sin servidor asignado',
        },
    }),
)

const marca = objeto({
    estado: enumerado(['nuevo', 'adoptado', 'administrado']),
    id: nulable(id),
    diferencias: lista(objeto({ campo: texto, argos: {}, router: {} })),
})

export const DescubrimientoRedAcceso = definirEsquema(
    'DescubrimientoRedAcceso',
    objeto({
        router_id: id,
        leido_en: instante,
        interfaces: lista(objeto({ nombre: texto, tipo: texto, deshabilitada: booleano })),
        vlans: lista(
            objeto({
                ros_id: texto,
                nombre: texto,
                interfaz_padre: texto,
                vlan_id: entero,
                mtu: nulable(entero),
                deshabilitada: booleano,
                comment: nulable(texto),
                argos: marca,
            }),
        ),
        servidores_pppoe: lista(
            objeto({
                ros_id: texto,
                service_name: texto,
                interfaz: texto,
                perfil: texto,
                max_mtu: nulable(entero),
                max_mru: nulable(entero),
                mrru: nulable(entero),
                autenticacion: lista(texto),
                keepalive_timeout: nulable(entero),
                una_sesion_por_host: booleano,
                max_sesiones: nulable(entero),
                deshabilitado: booleano,
                comment: nulable(texto),
                red_ipv4_sugerida_id: {
                    ...nulable(id),
                    description: 'Red del router cuyo gateway es el local-address de su perfil',
                },
                argos: marca,
            }),
        ),
        perfiles: lista(
            objeto({
                ros_id: texto,
                nombre: texto,
                local_address: nulable(texto),
                remote_address: nulable(texto),
                comment: nulable(texto),
            }),
        ),
        pools_ipv4: lista(objeto({ ros_id: texto, nombre: texto, rangos: texto })),
        pools_ipv6: lista(objeto({ ros_id: texto, nombre: texto, prefijo: texto, tamano_prefijo: entero })),
        sin_router: {
            ...lista(objeto({ entidad: enumerado(['vlan', 'servidor_pppoe']), id, nombre: texto })),
            description: 'Registrados en Argos que el router ya no tiene (deriva)',
        },
    }),
)

export const ResultadoAdopcion = definirEsquema(
    'ResultadoAdopcion',
    objeto({ vlans: lista(Vlan), servidores_pppoe: lista(ServidorPppoe) }),
)
