// Tema de Nuxt UI de la identidad "vidrio y luz" (skill horus-identity, `assets/nuxt-ui/app.config.ts`),
// el mismo del portal. Los tonos concretos por modo (contraste AA en claro y oscuro) se fijan en
// assets/css/main.css.
export default defineAppConfig({
    ui: {
        colors: {
            // Un único color de marca: teal (azul petróleo).
            primary: 'teal',
            secondary: 'indigo',
            success: 'green',
            info: 'blue',
            warning: 'amber',
            error: 'red',
            neutral: 'zinc',
        },
        button: {
            slots: {
                base: 'cursor-pointer',
            },
            compoundVariants: [
                {
                    color: 'primary',
                    variant: 'solid',
                    // hover/active más oscuro en claro y al 90 % en oscuro (Nuxt UI aclara al 75 %: el
                    // texto quedaba en 3,4:1, por debajo de AA). El halo NO va aquí, a diferencia de la
                    // skill: el panel tiene varias acciones sólidas por vista y solo una lleva luz, con
                    // la clase `glow-brand` (ver apps/web/docs/identidad.md).
                    class:
                        'hover:bg-(--ui-color-primary-800) active:bg-(--ui-color-primary-800) dark:hover:bg-primary/90 dark:active:bg-primary/90',
                },
            ],
        },
        // Vidrio fuerte en la capa funcional flotante (menús, modales, paneles laterales); las
        // tarjetas del contenido, material casi sólido.
        card: {
            slots: { root: 'rounded-(--hf-radius-card)' },
            variants: {
                variant: {
                    outline: { root: 'bg-(--hf-card) ring ring-default divide-y divide-default' },
                },
            },
        },
        pageCard: {
            slots: { root: 'rounded-(--hf-radius-card)' },
            variants: {
                variant: {
                    subtle: { root: 'bg-(--hf-card) ring ring-default' },
                },
            },
        },
        // Las tablas son contenido: material tarjeta (el mismo de `.surface-card`, en utilidades
        // para que `:ui="{ root }"` pueda quitarlo cuando la tabla ya va dentro de una tarjeta).
        table: {
            slots: {
                root: 'bg-(--hf-card) rounded-(--hf-radius-card) ring ring-default dark:shadow-[0_12px_32px_rgb(0_0_0/0.22)]',
            },
        },
        modal: {
            slots: { content: 'bg-(--hf-glass-strong) backdrop-blur-2xl backdrop-saturate-150' },
        },
        slideover: {
            slots: { content: 'bg-(--hf-glass-strong) backdrop-blur-2xl backdrop-saturate-150' },
        },
        popover: {
            slots: { content: 'bg-(--hf-glass-strong) backdrop-blur-2xl backdrop-saturate-150' },
        },
        dropdownMenu: {
            slots: { content: 'bg-(--hf-glass-strong) backdrop-blur-2xl backdrop-saturate-150' },
        },
    },
})
