import type { Schema } from '@argosisp/contracts'

/**
 * Anuncios de los fixtures (`GET /portal/anuncios`). Mismos campos que devuelve la API
 * (`PortalAnuncio`). La imagen es un archivo del propio portal (en la API sale de
 * `/api/v1/portal/anuncios/:id/imagen`), con su tamaño real.
 */
export const ANUNCIOS_FIXTURE: Schema<'PortalAnuncio'>[] = [
    {
        id: 101,
        empresa_id: 1,
        titulo: 'Paga hoy y gana 50 puntos',
        texto: 'Ponte al día antes del viernes y te regalamos 50 puntos para canjear por un mes de mejora de velocidad.',
        imagen: { url: '/iconos/icono-512.png', ancho: 512, alto: 512, alt: 'Logo de ArgosIsp sobre fondo oscuro' },
        boton: { texto: 'Ver mi cuenta', url: '/cuenta' },
    },
    {
        id: 102,
        empresa_id: 1,
        titulo: 'Refiere a un vecino',
        texto: 'Por cada vecino que se conecte con tu código, los dos reciben un mes con el doble de velocidad.',
        imagen: null,
        boton: { texto: 'Cómo funciona', url: 'https://argosisp.example/referidos' },
    },
    {
        id: 103,
        empresa_id: 1,
        titulo: 'Nuevo horario de atención',
        texto: 'Desde noviembre atendemos de lunes a sábado, de 7:00 a 20:00.',
        imagen: null,
        boton: null,
    },
]
