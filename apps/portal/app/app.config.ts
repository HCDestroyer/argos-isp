/**
 * Tema del portal: identidad "vidrio y luz" (skill horus-identity, `assets/nuxt-ui/app.config.ts`),
 * el mismo que el panel. Los tonos por modo (contraste AA en claro y oscuro) están en `main.css`.
 *
 * Propio del portal: todo control mide al menos 44 × 44 px (la mayoría llega desde el teléfono).
 */
export default defineAppConfig({
    ui: {
        colors: {
            // Marca: azul petróleo sobrio, un único color primario para todo el ecosistema.
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
                base: 'min-h-11 min-w-11 justify-center cursor-pointer',
            },
            // Luz de la acción primaria (una por vista); transparente en claro y con "más contraste".
            compoundVariants: [
                {
                    color: 'primary',
                    variant: 'solid',
                    // hover/active más oscuro en claro y al 90 % en oscuro (Nuxt UI aclara al 75 %: el
                    // texto quedaba en 3,4:1, por debajo de AA).
                    class: 'shadow-[0_0_18px_var(--hf-glow-brand)] hover:shadow-[0_0_26px_var(--hf-glow-brand)] hover:bg-(--ui-color-primary-800) active:bg-(--ui-color-primary-800) dark:hover:bg-primary/90 dark:active:bg-primary/90',
                },
            ],
        },
        input: {
            slots: {
                base: 'min-h-11',
            },
        },
        select: {
            slots: {
                base: 'min-h-11',
                content: 'bg-(--hf-glass-strong) backdrop-blur-2xl backdrop-saturate-150',
            },
        },
        selectMenu: {
            slots: {
                base: 'min-h-11',
                content: 'bg-(--hf-glass-strong) backdrop-blur-2xl backdrop-saturate-150',
            },
        },
        // Tarjeta: el material del contenido (estado de cuenta, facturas, formularios).
        card: {
            slots: {
                root: 'rounded-(--hf-radius-card)',
            },
            variants: {
                variant: {
                    outline: {
                        root: 'bg-(--hf-card) ring ring-default divide-y divide-default',
                    },
                },
            },
        },
        pageCard: {
            slots: {
                root: 'rounded-(--hf-radius-card)',
            },
            variants: {
                variant: {
                    outline: {
                        root: 'bg-(--hf-card) ring ring-default',
                    },
                },
            },
        },
        // Vidrio fuerte en la capa funcional flotante: modales, menús y popovers.
        modal: {
            slots: {
                content: 'bg-(--hf-glass-strong) backdrop-blur-2xl backdrop-saturate-150',
                // El botón de cerrar mide 44 px (`absolute end-4`): sin este margen, a 390 px el
                // título y la descripción del modal pasaban por debajo de la X.
                wrapper: 'min-w-0 pe-12',
            },
        },
        popover: {
            slots: {
                content: 'bg-(--hf-glass-strong) backdrop-blur-2xl backdrop-saturate-150',
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
