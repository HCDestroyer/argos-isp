import type { Schema } from '@argosisp/contracts'

type Gestion = Schema<'GestionCobroRegistrada'>

/** Cómo se hizo la gestión (`tipo` de `POST /clientes/:id/gestiones-cobro`); `carta` solo desde el panel. */
export const TIPOS_GESTION: Record<Gestion['tipo'], { etiqueta: string, icono: string }> = {
    llamada: { etiqueta: 'Llamada', icono: 'i-lucide-phone' },
    mensaje: { etiqueta: 'Mensaje', icono: 'i-lucide-message-circle' },
    visita: { etiqueta: 'Visita', icono: 'i-lucide-map-pin' },
    promesa: { etiqueta: 'Promesa', icono: 'i-lucide-hand-coins' },
    carta: { etiqueta: 'Carta', icono: 'i-lucide-mail' },
}

/** Qué pasó (`resultado`). */
export const RESULTADOS_GESTION: Record<Gestion['resultado'], string> = {
    contesto: 'Contestó',
    no_contesto: 'No contestó',
    numero_equivocado: 'Número equivocado',
    promete_pagar: 'Promete pagar',
    rechaza: 'Rechaza pagar',
    pago_informado: 'Informa que ya pagó',
    visita_sin_contacto: 'Visita sin encontrar a nadie',
}

/** La API acepta lo ocurrido desde hace 7 días hasta 5 minutos adelante (`fuera_de_ventana`). */
export const DIAS_VENTANA_GESTION = 7

/** Hora actual de Guatemala como `HH:mm`. */
export function horaGuatemala(ahora: Date = new Date()): string {
    return new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Guatemala', hour: '2-digit', minute: '2-digit', hour12: false }).format(ahora)
}
