import type { Schema } from '@argosisp/contracts'

type Cliente = Schema<'Cliente'>

interface Semilla {
    nombre: string
    tipo?: Cliente['tipo']
    nit?: string
    fiscal?: string
    zona: number | null
    canal?: Cliente['canal_preferido']
}

/**
 * Responsable de pago (A1, día 4): Carlos Enrique Monterroso (10) paga por Andrea Paola Gómez
 * (12, suspendida) y Silvia Patricia Orellana (17, limitada). Un solo nivel.
 */
const RESPONSABLES: Record<number, number> = { 12: 10, 17: 10 }

/** Clientes de ejemplo; el id es la posición + 1. Los ids 1 a 6 tienen la historia más completa. */
const semillas: Semilla[] = [
    { nombre: 'María José Pérez López', nit: '1234567-8', zona: 1 },
    { nombre: 'Juan Carlos Ramírez', nit: 'CF', zona: 1, canal: 'telegram' },
    { nombre: 'Comercial El Progreso, S.A.', tipo: 'empresa', nit: '4567890-1', fiscal: 'COMERCIAL EL PROGRESO, SOCIEDAD ANONIMA', zona: 2 },
    { nombre: 'Ana Lucía Morales', nit: '2984561320101', zona: 3 },
    { nombre: 'Pedro Antonio Xicará', nit: '7788990-K', zona: 2, canal: 'whatsapp' },
    { nombre: 'Farmacia La Bendición', tipo: 'empresa', nit: '9081726-3', fiscal: 'FARMACIA LA BENDICION', zona: 4 },
    { nombre: 'Rosa Elena Cifuentes', zona: 1 },
    { nombre: 'Luis Fernando Ajú', nit: '5566778-2', zona: 3 },
    { nombre: 'Gabriela Sofía Herrera', zona: 4 },
    { nombre: 'Carlos Enrique Monterroso', nit: 'CF', zona: 2 },
    { nombre: 'Hotel Posada del Valle', tipo: 'empresa', nit: '3344556-7', fiscal: 'INVERSIONES POSADA DEL VALLE, S.A.', zona: 1 },
    { nombre: 'Andrea Paola Gómez', zona: 3 },
    { nombre: 'José Manuel Tzul', nit: '6677889-0', zona: 4 },
    { nombre: 'Claudia Marisol Barrios', zona: null },
    { nombre: 'Ferretería San José', tipo: 'empresa', nit: '1122334-5', fiscal: 'FERRETERIA SAN JOSE', zona: 2 },
    { nombre: 'Mario Alberto Cojtí', zona: 1 },
    { nombre: 'Silvia Patricia Orellana', nit: 'CF', zona: 3 },
    { nombre: 'Kevin Alexander Choc', zona: 4 },
    { nombre: 'Lucía Fernanda Quemé', zona: 2 },
    { nombre: 'Colegio Mixto Esperanza', tipo: 'empresa', nit: '8899001-6', fiscal: 'ASOCIACION EDUCATIVA ESPERANZA', zona: 3 },
    { nombre: 'Byron Estuardo Sical', zona: 1 },
    { nombre: 'Karla Beatriz Fuentes', zona: 4 },
    { nombre: 'Óscar Rolando Pineda', nit: '2233445-9', zona: 2 },
    { nombre: 'Dulce María Toj', zona: 3 },
    { nombre: 'Taller Mecánico Hermanos Ruiz', tipo: 'empresa', nit: '5544332-1', fiscal: 'TALLER HERMANOS RUIZ', zona: 4 },
    { nombre: 'Walter Isaías Coc', zona: 1 },
    { nombre: 'Heidy Johana Velásquez', zona: 2 },
    { nombre: 'Edgar Leonel Batz', zona: null },
]

function telefono(indice: number): string {
    return `5${String(5012000 + indice * 731).padStart(7, '0')}`
}

function correo(nombre: string): string {
    const base = nombre
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^a-z ]/g, '')
        .split(' ')
        .filter(Boolean)
        .slice(0, 2)
        .join('.')
    return `${base}@correo.gt`
}

export const clientes: Cliente[] = semillas.map((semilla, indice) => {
    const id = indice + 1
    const creado = new Date(Date.UTC(2026, 8, 1 + indice, 16, 30)).toISOString()
    return {
        id,
        nombre: semilla.nombre,
        tipo: semilla.tipo ?? 'persona',
        nit_cui: semilla.nit ?? null,
        nombre_fiscal: semilla.fiscal ?? (semilla.nit && semilla.nit !== 'CF' ? semilla.nombre.toUpperCase() : null),
        direccion_fiscal: semilla.nit && semilla.nit !== 'CF' ? `${3 + indice} calle ${indice + 1}-${20 + indice}, zona ${(indice % 18) + 1}` : null,
        email: indice % 5 === 3 ? null : correo(semilla.nombre),
        telefono: telefono(indice),
        movil: indice % 3 === 0 ? telefono(indice + 100) : null,
        direccion: `Lote ${indice + 4}, sector ${String.fromCharCode(65 + (indice % 6))}`,
        coordenadas: indice % 4 === 0 ? `14.${6300 + indice * 7},-90.${5000 + indice * 11}` : null,
        zona_id: semilla.zona,
        campos_personalizados: {},
        canal_preferido: semilla.canal ?? 'correo',
        telegram_chat_id: semilla.canal === 'telegram' ? `70012${indice}` : null,
        // Como la API: siempre vienen; null si paga él mismo.
        responsable_pago_id: RESPONSABLES[id] ?? null,
        responsable_pago_nombre: RESPONSABLES[id] ? (semillas[(RESPONSABLES[id] ?? 0) - 1]?.nombre ?? null) : null,
        version: 1,
        created_at: creado,
        updated_at: creado,
    }
})
