/**
 * Tema del portal. Accesibilidad (semana 2): todo control mide al menos 44 × 44 px (la mayoría
 * llega desde el teléfono) y los colores de texto sobre fondo cumplen 4.5:1 (ver `main.css`).
 */
export default defineAppConfig({
    ui: {
        colors: {
            primary: 'sky',
            neutral: 'slate',
        },
        button: {
            slots: {
                base: 'min-h-11 min-w-11 justify-center',
            },
        },
        input: {
            slots: {
                base: 'min-h-11',
            },
        },
        select: {
            slots: {
                base: 'min-h-11',
            },
        },
        selectMenu: {
            slots: {
                base: 'min-h-11',
            },
        },
        pinInput: {
            variants: {
                size: {
                    xl: {
                        base: 'size-11 text-lg',
                    },
                },
            },
        },
    },
})
