// Sistema visual Argos (docs/sistema-visual.md): tema de Nuxt UI sobre la identidad "vidrio y luz"
// con el color de marca índigo eléctrico (decisión del PM). Los tonos concretos por modo (contraste
// AA en claro y oscuro) y los tokens `--ax-*` se fijan en assets/css/main.css.
export default defineAppConfig({
    ui: {
        colors: {
            // Un único color de marca: índigo eléctrico; el cian acompaña como secundario.
            primary: 'indigo',
            secondary: 'cyan',
            success: 'green',
            info: 'blue',
            warning: 'amber',
            error: 'red',
            neutral: 'slate',
        },
        button: {
            slots: {
                // Pastilla (radio completo), como el resto del sistema; transición suave de color.
                base: 'cursor-pointer rounded-full transition-colors disabled:cursor-not-allowed aria-disabled:cursor-not-allowed',
            },
            compoundVariants: [
                {
                    color: 'primary',
                    variant: 'solid',
                    // hover/active más oscuro en claro y al 90 % en oscuro (Nuxt UI aclara al 75 %: el
                    // texto quedaba por debajo de AA). El halo NO va aquí: el panel tiene varias acciones
                    // sólidas por vista y solo una lleva luz, con la clase `glow-brand`.
                    class:
                        'hover:bg-(--ui-color-primary-700) active:bg-(--ui-color-primary-800) dark:hover:bg-primary/90 dark:active:bg-primary/90',
                },
            ],
        },
        badge: {
            slots: { base: 'rounded-full font-medium' },
        },
        // Tarjetas: fondo de tarjeta, borde fino y radio 12 px, casi sin sombra (`--ax-*`, igual que el portal).
        card: {
            slots: {
                root: 'rounded-(--ax-radio)',
                header: 'p-4 sm:px-5',
                body: 'p-4 sm:p-5',
                footer: 'p-4 sm:px-5',
            },
            variants: {
                variant: {
                    outline: { root: 'bg-(--hf-card) ring ring-(--ax-borde) divide-y divide-(--ax-borde)' },
                },
            },
        },
        pageCard: {
            slots: { root: 'rounded-(--ax-radio)' },
            variants: {
                variant: {
                    subtle: { root: 'bg-(--hf-card) ring ring-(--ax-borde)' },
                },
            },
        },
        // Tablas: contenido en tarjeta; cabecera en versalitas sobre gris suave, filas altas con
        // línea fina, sin cebra y con hover suave (el mismo de todas las listas del panel).
        table: {
            slots: {
                root: 'bg-(--hf-card) rounded-(--ax-radio) ring ring-(--ax-borde) dark:shadow-[0_12px_32px_rgb(0_0_0/0.22)]',
                thead: 'bg-(--ax-cabecera-tabla)',
                th: 'px-4 py-3 text-xs font-semibold uppercase tracking-[0.04em] text-muted',
                tbody: '[&>tr]:transition-colors [&>tr:hover]:bg-(--ax-fila-hover)',
                td: 'px-4 py-3.5 text-sm text-default',
                empty: 'py-10 text-center text-sm text-muted',
            },
        },
        navigationMenu: {
            compoundVariants: [
                {
                    color: 'primary',
                    variant: 'pill',
                    active: true,
                    // Ítem activo: fondo tintado del primario (≈10 %) y texto e icono primarios.
                    class: { link: 'before:bg-primary/10 font-semibold', childLink: 'before:bg-primary/10 text-primary' },
                },
            ],
        },
        tabs: {
            slots: { trigger: 'cursor-pointer' },
        },
        // Modales: vidrio fuerte, radio 16 px, fondo con desenfoque suave, pie con los botones a la
        // derecha. En el teléfono, hoja inferior a todo el ancho (formularios cortos con el teclado).
        modal: {
            slots: {
                overlay: 'backdrop-blur-[2px]',
                content: 'bg-(--hf-glass-strong) backdrop-blur-2xl backdrop-saturate-150 divide-(--ax-borde)',
                header: 'gap-3',
                footer: 'justify-end gap-2',
            },
            compoundVariants: [
                {
                    scrollable: false,
                    fullscreen: false,
                    class: {
                        content: 'rounded-(--ax-radio-modal) ring-(--ax-borde) shadow-(--ax-sombra-flotante) max-sm:top-auto max-sm:bottom-0 max-sm:left-0 max-sm:translate-x-0 max-sm:translate-y-0 max-sm:w-full max-sm:max-w-none max-sm:rounded-b-none max-sm:max-h-[92dvh]',
                    },
                },
            ],
        },
        slideover: {
            slots: {
                overlay: 'backdrop-blur-[2px]',
                content: 'bg-(--hf-glass-strong) backdrop-blur-2xl backdrop-saturate-150 divide-(--ax-borde)',
                footer: 'justify-end gap-2',
            },
        },
        // En el teléfono, los avisos emergentes salen encima de la isla de navegación (`PanelIslaMovil`)
        // y de la barra fija de la pantalla, si la hay (`PanelBarraAccion`, `--ax-barra-accion`).
        toaster: {
            slots: { viewport: 'mb-[calc(var(--ax-isla-reserva)+var(--ax-barra-accion,0px))]' },
        },
        toast: {
            slots: { root: 'rounded-(--ax-radio) ring-(--ax-borde)', icon: 'size-5' },
        },
        // Campos: etiqueta arriba en negrita suave, ayuda gris debajo, error en rojo con su texto.
        formField: {
            slots: {
                label: 'font-medium',
                help: 'text-muted',
                error: 'mt-1.5 flex items-center gap-1 before:content-["!"] before:inline-flex before:size-3.5 before:shrink-0 before:items-center before:justify-center before:rounded-full before:bg-error before:text-[0.625rem] before:font-bold before:text-inverted',
            },
        },
        input: {
            slots: { base: 'rounded-lg' },
        },
        select: {
            slots: { base: 'rounded-lg cursor-pointer' },
        },
        selectMenu: {
            slots: { base: 'rounded-lg cursor-pointer' },
        },
        textarea: {
            slots: { base: 'rounded-lg' },
        },
        switch: {
            slots: { base: 'cursor-pointer', label: 'cursor-pointer', description: 'text-muted' },
        },
        empty: {
            // Estado vacío: icono en pastilla del primario (sin ilustraciones pesadas).
            slots: { avatar: 'bg-primary/10 rounded-2xl [&_[data-slot=icon]]:text-primary' },
        },
        skeleton: {
            base: 'rounded-lg bg-(--ax-panel)',
        },
        popover: {
            slots: { content: 'bg-(--hf-glass-strong) backdrop-blur-2xl backdrop-saturate-150' },
        },
        dropdownMenu: {
            slots: {
                content: 'bg-(--hf-glass-strong) backdrop-blur-2xl backdrop-saturate-150',
                item: 'cursor-pointer data-disabled:cursor-not-allowed',
            },
        },
        contextMenu: {
            slots: {
                content: 'bg-(--hf-glass-strong) backdrop-blur-2xl backdrop-saturate-150',
                item: 'cursor-pointer data-disabled:cursor-not-allowed',
            },
        },
        tooltip: {
            slots: { content: 'max-w-72 h-auto whitespace-normal py-1.5' },
        },
    },
})
