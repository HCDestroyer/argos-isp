/**
 * Ayudas `?` del portal: conceptos que el cliente no siempre entiende, en sus palabras. El texto
 * sale del manual (`docs/manual/portal/portal-del-cliente.md`, «Pedir una promesa de pago»;
 * `docs/manual/portal/pagina-de-corte.md`; `docs/manual/lealtad/`): si el manual cambia, cambia aquí.
 *
 * La reconexión temporal no tiene ayuda aquí: el portal no la muestra (la pide Iris, y la API del
 * portal no distingue el tipo de promesa).
 */
export const AYUDAS = {
    promesa: {
        titulo: '¿Qué es una promesa de pago?',
        texto: 'Es tu compromiso de pagar lo vencido a más tardar el día que elijas. Si se aprueba, tu servicio vuelve en segundos; si no pagas a tiempo, se vuelve a suspender. Algunas las revisa un asesor antes de aprobarlas.',
    },
    vencimiento: {
        titulo: '¿Qué es el vencimiento?',
        texto: 'Es el último día para pagar una factura. Después cuenta como vencida, y con facturas vencidas tu servicio se puede limitar o suspender.',
    },
    puntos: {
        titulo: '¿Cómo funcionan los puntos?',
        texto: 'Ganas puntos con tus pagos y los cambias por premios, como descuentos en tu factura. Los puntos vencen: en «Puntos» ves cuántos y cuándo.',
    },
    comprobante: {
        titulo: '¿Qué pasa con mi comprobante?',
        texto: 'Lo revisamos con el estado de cuenta del banco. Al aprobarlo, el pago se abona a tus facturas y, si tu servicio está suspendido, se reactiva en ese momento.',
    },
} as const

export type ClaveAyuda = keyof typeof AYUDAS
