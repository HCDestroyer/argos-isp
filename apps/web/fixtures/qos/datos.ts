import type { Schema } from '@argosisp/contracts'

/**
 * QoS por clases (`contratos/qos.md`, A2): el perfil común «Predeterminado» con las semillas de la
 * migración (§5) y un perfil de la empresa 2 copiado de él. Las filas de perfil se guardan sin
 * `clases` ni `advertencias`: la API las arma al leer (`conClases`), igual que aquí `rutas.ts`.
 */

export type ReglaQosFixture = Schema<'ReglaQos'>
export type ClaseQosFixture = Schema<'ClaseQos'>
export type PerfilQosFila = Omit<Schema<'PerfilQos'>, 'clases' | 'advertencias'>

const CREADO = '2026-10-30T15:00:00.000Z'
const meta = { version: 1, created_at: CREADO, updated_at: CREADO }

/** `regla()` de A2: lo que no se dice es null. */
export function regla(r: Partial<ReglaQosFixture>): ReglaQosFixture {
    return { protocolo: null, puertos_destino: null, puertos_origen: null, dscp: null, lista_destino: null, ...r }
}

export const perfilesQos: PerfilQosFila[] = [
    {
        id: 1,
        empresa_id: null,
        nombre: 'Predeterminado',
        descripcion: 'Clases sugeridas: interactivo (DNS, NTP, VoIP, juegos), streaming, web, descargas pesadas y resto',
        predeterminado: true,
        ...meta,
    },
    {
        id: 2,
        empresa_id: 2,
        nombre: 'Norte sin streaming',
        descripcion: 'Copia del predeterminado para los routers de la empresa 2, sin la clase de streaming',
        predeterminado: false,
        ...meta,
    },
]

/** `SEMILLAS_QOS` de A2 en el perfil 1 (ids 1–5) y su copia en el perfil 2 (ids 6–10, streaming inactiva). */
function semillas(perfilId: number, base: number, streamingActiva: boolean): ClaseQosFixture[] {
    const id = (n: number) => base + n
    return [
        {
            id: id(1),
            perfil_id: perfilId,
            nombre: 'Interactivo',
            orden: 1,
            prioridad: 1,
            garantizado_pct: 10,
            tope_pct: 30,
            es_resto: false,
            reglas: [
                regla({ protocolo: 'udp', puertos_destino: '53,123' }),
                regla({ protocolo: 'tcp', puertos_destino: '53' }),
                regla({ protocolo: 'udp', puertos_destino: '5060-5061,10000-20000' }),
                regla({ protocolo: 'udp', puertos_destino: '3074,3478-3480,27000-27050' }),
                regla({ protocolo: 'icmp' }),
                regla({ dscp: 46 }),
            ],
            bytes_minimo: null,
            reclasifica_de: [],
            activa: true,
            ...meta,
        },
        {
            id: id(2),
            perfil_id: perfilId,
            nombre: 'Streaming',
            orden: 2,
            prioridad: 4,
            garantizado_pct: 20,
            tope_pct: null,
            es_resto: false,
            reglas: [
                regla({ protocolo: 'tcp', puertos_destino: '443', lista_destino: 'argosisp-qos-streaming' }),
                regla({ protocolo: 'udp', puertos_destino: '443', lista_destino: 'argosisp-qos-streaming' }),
            ],
            bytes_minimo: null,
            reclasifica_de: [],
            activa: streamingActiva,
            ...meta,
        },
        {
            id: id(3),
            perfil_id: perfilId,
            nombre: 'Web',
            orden: 3,
            prioridad: 3,
            garantizado_pct: 30,
            tope_pct: null,
            es_resto: false,
            reglas: [regla({ protocolo: 'tcp', puertos_destino: '80,443' }), regla({ protocolo: 'udp', puertos_destino: '443' })],
            bytes_minimo: null,
            reclasifica_de: [],
            activa: true,
            ...meta,
        },
        {
            id: id(4),
            perfil_id: perfilId,
            nombre: 'Descargas',
            orden: 90,
            prioridad: 7,
            garantizado_pct: 0,
            tope_pct: null,
            es_resto: false,
            reglas: [],
            bytes_minimo: 10_000_000,
            reclasifica_de: [id(3), id(5)],
            activa: true,
            ...meta,
        },
        {
            id: id(5),
            perfil_id: perfilId,
            nombre: 'Resto',
            orden: 99,
            prioridad: 6,
            garantizado_pct: 10,
            tope_pct: null,
            es_resto: true,
            reglas: [],
            bytes_minimo: null,
            reclasifica_de: [],
            activa: true,
            ...meta,
        },
    ]
}

export const clasesQos: ClaseQosFixture[] = [...semillas(1, 0, true), ...semillas(2, 5, false)]
