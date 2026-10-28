import type { BadgeProps } from '@nuxt/ui'
import type { Schema } from '@argosisp/contracts'

type Premio = Schema<'PortalPremio'>
type Movimiento = Schema<'PortalPuntosEmpresa'>['movimientos'][number]
type EstadoCanje = Schema<'PortalCanje'>['estado']

/** `1250` → `1,250`; los puntos son enteros (no dinero). */
export function formatearPuntos(puntos: number): string {
    const signo = puntos < 0 ? '-' : ''
    return `${signo}${String(Math.abs(Math.trunc(puntos))).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`
}

/** «1 punto», «140 puntos». */
export function puntosEnTexto(puntos: number): string {
    return `${formatearPuntos(puntos)} ${Math.abs(puntos) === 1 ? 'punto' : 'puntos'}`
}

export const ICONOS_PREMIO: Record<Premio['tipo'], string> = {
    descuento_factura: 'i-lucide-badge-percent',
    mes_gratis: 'i-lucide-calendar-heart',
    mejora_plan: 'i-lucide-rocket',
    bien: 'i-lucide-gift',
    boletos: 'i-lucide-ticket',
}

/** Qué recibe el cliente, en una línea. */
export function descripcionPremio(premio: Premio): string {
    switch (premio.tipo) {
        case 'descuento_factura': {
            if (premio.descuento_tipo === 'porcentaje' && premio.descuento_valor) {
                const tope = premio.tope ? ` (hasta ${formatearQuetzales(premio.tope)})` : ''
                return `${Number(premio.descuento_valor)} % de descuento en tu próxima factura${tope}`
            }
            return premio.descuento_valor
                ? `${formatearQuetzales(premio.descuento_valor)} de descuento en tu próxima factura`
                : 'Descuento en tu próxima factura'
        }
        case 'mes_gratis':
            return 'Tu próxima mensualidad del plan sin costo'
        case 'mejora_plan': {
            const plan = premio.plan_destino ? `a ${premio.plan_destino}` : 'de plan'
            return premio.dias ? `Mejora ${plan} por ${premio.dias} días` : `Mejora ${plan}`
        }
        case 'bien':
            return 'Se entrega en nuestras oficinas'
        case 'boletos':
            return 'Boletos para el próximo sorteo'
    }
}

/** El texto del botón apagado: por qué todavía no se puede. */
export function textoNoCanjeable(premio: Premio): string {
    switch (premio.motivo_no_canjeable) {
        case 'puntos_insuficientes':
            return `Te faltan ${puntosEnTexto(premio.faltan)}`
        case 'agotado':
            return 'Agotado'
        case 'no_disponible_en_portal':
            return 'Canjéalo en nuestras oficinas'
        case 'canje_desactivado':
            return 'Canjéalo en nuestras oficinas'
        default:
            return ''
    }
}

/** Qué fue cada movimiento, en palabras del cliente (sin motivos internos: la API no los manda). */
export function conceptoMovimiento(movimiento: Pick<Movimiento, 'tipo' | 'origen_tipo'>): string {
    switch (movimiento.tipo) {
        case 'acumulacion':
            return {
                pago: 'Pago a tiempo',
                factura: 'Pago a tiempo',
                servicio: 'Antigüedad de tu servicio',
                referido: 'Recomendaste a un amigo',
                sorteo: 'Premio de sorteo',
            }[movimiento.origen_tipo as string] ?? 'Puntos ganados'
        case 'canje':
            return 'Canje de un premio'
        case 'vencimiento':
            return 'Puntos vencidos'
        case 'reverso':
            return movimiento.origen_tipo === 'canje' ? 'Devolución de un canje' : 'Corrección de puntos'
        case 'ajuste':
            return 'Ajuste de puntos'
    }
}

export const ESTADOS_CANJE: Record<EstadoCanje, { etiqueta: string, color: NonNullable<BadgeProps['color']>, icono: string }> = {
    reservado: { etiqueta: 'En tu próxima factura', color: 'info', icono: 'i-lucide-clock' },
    aplicado: { etiqueta: 'Aplicado', color: 'success', icono: 'i-lucide-circle-check' },
    revertido: { etiqueta: 'Devuelto', color: 'neutral', icono: 'i-lucide-undo-2' },
    rechazado: { etiqueta: 'Rechazado', color: 'error', icono: 'i-lucide-circle-x' },
}

/** Avance hacia un premio, de 0 a 100 (para la barra de la tarjeta). */
export function avanceHacia(premio: Pick<Premio, 'costo_puntos' | 'faltan'>): number {
    if (premio.costo_puntos <= 0) {
        return 100
    }
    const tiene = Math.max(0, premio.costo_puntos - premio.faltan)
    return Math.min(100, Math.round((tiene / premio.costo_puntos) * 100))
}
