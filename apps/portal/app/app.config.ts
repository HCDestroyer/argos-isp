/**
 * Tema del portal: el sistema visual propio (`assets/css/main.css`, tokens `--ax-*`) aplicado a los
 * componentes de Nuxt UI. Marca **índigo eléctrico** (decisión del PM): primario índigo (600 en
 * claro, 400 en oscuro) y cian como acento del degradado de marca, nunca de fondo de un texto.
 *
 * Propio del portal: todo control mide al menos 44 × 44 px (la mayoría llega desde el teléfono).
 * Criterio de superficies (modal, drawer o página propia): `README.md`, «Sistema visual».
 */
export default defineAppConfig({
    ui: {
        colors: {
            primary: 'indigo',
            secondary: 'cyan',
            success: 'green',
            info: 'blue',
            warning: 'amber',
            error: 'red',
            neutral: 'zinc',
        },
        button: {
            slots: {
                // Microinteracción: se hunde apenas al tocarlo (quieto con movimiento reducido).
                base: 'min-h-11 min-w-11 justify-center cursor-pointer transition-[background-color,color,box-shadow,transform] duration-150 active:not-disabled:not-aria-disabled:scale-[0.98] motion-reduce:active:scale-100 disabled:cursor-not-allowed aria-disabled:cursor-not-allowed',
            },
            compoundVariants: [
                {
                    // Acción primaria: pastilla índigo. hover/active un tono más oscuro en claro
                    // (indigo-700) y al 90 % en oscuro (Nuxt UI aclara al 75 %: el texto oscuro sobre
                    // indigo-400 bajaba de AA).
                    color: 'primary',
                    variant: 'solid',
                    class: 'rounded-full shadow-[0_0_18px_var(--hf-glow-brand)] hover:bg-(--ui-color-primary-700) active:bg-(--ui-color-primary-700) dark:hover:bg-primary/90 dark:active:bg-primary/90',
                },
                {
                    // La acción secundaria junto a la primaria (Cancelar, Ver datos de depósito): la
                    // misma forma de pastilla. Las tarjetas-botón (`ax-tarjeta`) conservan su radio.
                    color: 'neutral',
                    variant: 'outline',
                    class: 'rounded-full',
                },
            ],
        },
        badge: {
            // Pastilla en todos los badges: estados (color + icono + texto) y etiquetas con la misma forma.
            slots: {
                base: 'rounded-full font-medium',
            },
            // Sutil primaria en claro: indigo-800 sobre su tinte al 10 % (con margen sobre AA aunque
            // el tinte se mezcle con la tarjeta, «Incluido en tu plan»); el de siempre en oscuro.
            compoundVariants: [
                {
                    color: 'primary',
                    variant: 'subtle',
                    class: 'text-(--ui-color-primary-800) dark:text-primary',
                },
            ],
        },
        // Selector de dos o tres opciones (formas de entrar, filtros de las listas): segmento claro
        // sobre el riel, nunca un bloque negro; el activo en `text-highlighted` (AA en claro y oscuro).
        tabs: {
            compoundVariants: [
                {
                    color: 'neutral',
                    variant: 'pill',
                    class: {
                        list: 'bg-elevated ring ring-default rounded-full',
                        indicator: 'bg-(--ax-tarjeta) ring ring-default shadow-sm rounded-full dark:bg-accented',
                        trigger: 'rounded-full data-[state=active]:text-highlighted',
                    },
                },
            ],
        },
        formField: {
            slots: {
                label: 'font-medium text-highlighted',
                help: 'text-muted',
                error: 'flex items-start gap-1 font-medium before:content-["!"] before:inline-flex before:size-4 before:shrink-0 before:items-center before:justify-center before:rounded-full before:bg-error before:text-[10px] before:font-bold before:text-inverted',
            },
        },
        input: {
            slots: {
                base: 'min-h-11 rounded-[0.625rem]',
            },
        },
        textarea: {
            slots: {
                base: 'rounded-[0.625rem]',
            },
        },
        select: {
            slots: {
                base: 'min-h-11 rounded-[0.625rem]',
                content: 'bg-(--hf-glass-strong) backdrop-blur-2xl backdrop-saturate-150 rounded-(--ax-radio) shadow-(--ax-sombra-flotante)',
            },
        },
        selectMenu: {
            slots: {
                base: 'min-h-11 rounded-[0.625rem]',
                content: 'bg-(--hf-glass-strong) backdrop-blur-2xl backdrop-saturate-150 rounded-(--ax-radio) shadow-(--ax-sombra-flotante)',
            },
        },
        // Tarjeta: blanca, radio 12 px, borde de 1 px, casi sin sombra; cabecera con título y descripción.
        card: {
            slots: {
                root: 'rounded-(--ax-radio)',
                header: 'p-4 sm:px-5',
                body: 'p-4 sm:p-5',
                footer: 'p-4 sm:px-5',
            },
            variants: {
                variant: {
                    outline: {
                        root: 'bg-(--ax-tarjeta) ring ring-(--ax-borde) shadow-(--ax-sombra) divide-y divide-(--ax-borde)',
                    },
                },
            },
        },
        pageCard: {
            slots: {
                root: 'rounded-(--ax-radio)',
                leading: 'ax-pastilla size-10',
                leadingIcon: 'size-5 text-primary',
            },
            variants: {
                variant: {
                    outline: {
                        root: 'bg-(--ax-tarjeta) ring ring-(--ax-borde) shadow-(--ax-sombra)',
                    },
                },
            },
        },
        // Tabla: cabecera en mayúsculas pequeñas sobre gris claro, filas altas y hover suave.
        table: {
            slots: {
                root: 'rounded-(--ax-radio) ring ring-(--ax-borde) bg-(--ax-tarjeta)',
                thead: 'bg-(--ax-cabecera-tabla)',
                th: 'text-[11px] font-semibold uppercase tracking-wider text-muted',
                tr: 'hover:bg-(--ax-fila-hover) transition-colors',
                td: 'py-3.5 text-default',
            },
        },
        /*
         * Modal: confirmaciones y acciones cortas, nunca uno sobre otro. Radio 16 px, botones a la
         * derecha; en el teléfono (< 640 px) es una hoja inferior que sube desde abajo.
         */
        modal: {
            slots: {
                content: 'bg-(--hf-glass-strong) backdrop-blur-2xl backdrop-saturate-150 divide-(--ax-borde)',
                // El botón de cerrar mide 44 px (`absolute end-4`): sin este margen, a 390 px el
                // título y la descripción del modal pasaban por debajo de la X.
                wrapper: 'min-w-0 pe-12',
                footer: 'justify-end gap-2',
                overlay: 'bg-[rgb(15_23_42/0.45)] backdrop-blur-[2px]',
            },
            compoundVariants: [
                {
                    scrollable: false,
                    fullscreen: false,
                    class: {
                        content: 'rounded-(--ax-radio-modal) shadow-(--ax-sombra-flotante) ring-(--ax-borde) max-sm:inset-x-0 max-sm:top-auto max-sm:bottom-0 max-sm:left-0 max-sm:w-full max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:max-h-[92dvh] max-sm:rounded-b-none max-sm:pb-[env(safe-area-inset-bottom)] max-sm:data-[state=open]:animate-[slide-in-from-bottom_240ms_var(--ease-out)] max-sm:data-[state=closed]:animate-[slide-out-to-bottom_200ms_var(--ease-out)]',
                    },
                },
            ],
        },
        // Drawer: detalle de una factura, un pago o un comprobante sin salir de la lista.
        slideover: {
            slots: {
                content: 'bg-(--ax-tarjeta) divide-(--ax-borde) shadow-(--ax-sombra-flotante)',
                overlay: 'bg-[rgb(15_23_42/0.45)] backdrop-blur-[2px]',
                body: 'p-4 sm:p-6',
            },
        },
        dropdownMenu: {
            slots: {
                content: 'bg-(--hf-glass-strong) backdrop-blur-2xl backdrop-saturate-150 rounded-(--ax-radio) shadow-(--ax-sombra-flotante) ring-(--ax-borde) min-w-52',
                item: 'min-h-11 rounded-lg cursor-pointer data-disabled:cursor-not-allowed',
            },
        },
        popover: {
            slots: {
                content: 'bg-(--hf-glass-strong) backdrop-blur-2xl backdrop-saturate-150 rounded-(--ax-radio) shadow-(--ax-sombra-flotante)',
            },
        },
        tooltip: {
            slots: {
                content: 'rounded-lg bg-inverted text-inverted ring-0 shadow-(--ax-sombra-flotante)',
                text: 'text-inverted',
            },
        },
        toast: {
            slots: {
                root: 'rounded-(--ax-radio) ring-(--ax-borde) shadow-(--ax-sombra-flotante) bg-(--ax-tarjeta)',
            },
        },
        alert: {
            slots: {
                root: 'rounded-(--ax-radio)',
            },
        },
        skeleton: {
            base: 'rounded-(--ax-radio) bg-elevated',
        },
        empty: {
            slots: {
                avatar: 'ax-pastilla',
            },
        },
        pinInput: {
            variants: {
                size: {
                    xl: {
                        base: 'size-11 text-lg rounded-[0.625rem]',
                    },
                },
            },
        },
    },
})
