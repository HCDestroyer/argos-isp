<script setup lang="ts">
/**
 * Panel de la cuenta en el teléfono (tablero PerfilDrawer; respuestas del PM del 26 nov 2026): sube
 * desde abajo (`UDrawer`) con todo a la altura del pulgar, en filas de 48 px o más:
 *
 * 1. quién eres (iniciales, nombre, rol y correo) y cerrar;
 * 2. la empresa activa, solo con más de una (lista de opción única con su NIT; «Todas las empresas»
 *    solo con alcance global). Al elegir se cierra y avisa «Empresa activa: …»;
 * 3. el tema: Claro, Oscuro y Sistema a la vista, sin submenú;
 * 4. Mi cuenta, Ayuda de esta pantalla y Qué cambió (con la versión);
 * 5. Cerrar sesión, aparte y en rojo.
 *
 * Se abre desde el círculo de la cuenta (`MenuUsuario`, bajo 1024 px) y desde la fila de la cuenta
 * arriba de «Más». Con muchas empresas se desplaza por dentro. Sale de la misma lista que el menú
 * de la computadora (`useMenuCuenta`).
 */
const cuenta = useMenuCuenta()
const { abierto, usuario, iniciales, rol, version, opcionesEmpresa, eleccion, tema } = cuenta

const route = useRoute()
const config = useRuntimeConfig()
/**
 * «Ayuda de esta pantalla»: con resumen en el manual, el panel de ayuda (`AyudaPanel`, en el layout);
 * sin él, el manual en otra pestaña; sin ninguno de los dos, la fila no aparece.
 */
const claveAyuda = computed(() => claveAyudaDeRuta(route.matched))
const conResumen = computed(() => claveAyuda.value !== null && INDICE_AYUDA[claveAyuda.value] !== undefined)
const urlManual = computed(() => (claveAyuda.value ? urlAyuda(String(config.public.docsUrl), claveAyuda.value) : null))

const empresa = computed({
    get: () => eleccion.value ?? undefined,
    set: (valor: number | 'todas' | undefined) => {
        if (valor !== undefined && valor !== eleccion.value) {
            cuenta.elegirEmpresa(valor, true)
        }
    },
})

const itemsEmpresa = computed(() => opcionesEmpresa.value.map(opcion => ({
    label: opcion.etiqueta,
    description: opcion.nit ?? undefined,
    value: opcion.valor,
})))

/** Fila de acción del panel: botón a lo ancho, con icono, texto, detalle y flecha. */
const FILA = {
    base: 'w-full min-h-12 justify-start gap-3 rounded-none px-3.5 py-2.5 text-[0.90625rem] font-normal text-highlighted',
    leadingIcon: 'size-[1.1875rem] text-muted',
    trailingIcon: 'ms-auto size-4 text-muted',
}
</script>

<template>
    <UDrawer
        v-model:open="abierto"
        direction="bottom"
        title="Tu cuenta"
        description="Empresa activa, tema y opciones de tu cuenta"
        :ui="{
            content: 'glass-material max-h-[88dvh] rounded-t-3xl bg-transparent ring-(--ax-borde) lg:hidden',
            handle: 'mt-2 h-[5px] w-10',
            overlay: 'bg-(--ax-velo,rgba(15,23,42,0.42)) lg:hidden',
        }"
        data-prueba="cuenta-drawer"
    >
        <template #content>
            <div class="flex min-h-0 flex-col gap-3 overflow-y-auto px-3.5 pt-2 pb-[max(1.375rem,env(safe-area-inset-bottom))]">
                <div class="flex items-center gap-3 px-1 py-0.5">
                    <span
                        class="flex size-[2.875rem] shrink-0 items-center justify-center rounded-full bg-primary/10 text-[0.9375rem] font-bold text-primary"
                        aria-hidden="true"
                    >{{ iniciales }}</span>
                    <span class="flex min-w-0 flex-1 flex-col">
                        <span class="truncate text-base font-bold text-highlighted">{{ usuario?.nombre }}</span>
                        <span class="truncate text-[0.8125rem] text-muted">{{ [rol, usuario?.email].filter(Boolean).join(' · ') }}</span>
                    </span>
                    <UButton
                        icon="i-lucide-x"
                        color="neutral"
                        variant="ghost"
                        class="boton-flotante boton-circulo shrink-0"
                        aria-label="Cerrar"
                        data-prueba="cerrar-cuenta"
                        @click="abierto = false"
                    />
                </div>

                <section
                    v-if="itemsEmpresa.length"
                    class="flex flex-col gap-1.5"
                    aria-labelledby="cuenta-empresa"
                >
                    <h2
                        id="cuenta-empresa"
                        class="px-1.5 text-[0.6875rem] font-bold tracking-[0.06em] text-muted uppercase"
                    >
                        Empresa activa
                    </h2>
                    <URadioGroup
                        v-model="empresa"
                        :items="itemsEmpresa"
                        variant="table"
                        indicator="end"
                        size="lg"
                        aria-labelledby="cuenta-empresa"
                        :ui="{
                            fieldset: 'surface-card gap-0 overflow-hidden rounded-2xl',
                            item: 'min-h-[3.25rem] items-center rounded-none border-0 border-t border-(--ax-borde) bg-transparent px-3.5 py-2 first-of-type:border-t-0 has-data-[state=checked]:bg-transparent',
                            label: 'font-medium text-highlighted',
                            description: 'text-xs text-muted',
                        }"
                        data-prueba="cuenta-empresas"
                    />
                </section>

                <section
                    class="flex flex-col gap-1.5"
                    aria-labelledby="cuenta-tema"
                >
                    <h2
                        id="cuenta-tema"
                        class="px-1.5 text-[0.6875rem] font-bold tracking-[0.06em] text-muted uppercase"
                    >
                        Tema
                    </h2>
                    <div
                        class="grid grid-cols-3 gap-1 rounded-[0.875rem] bg-(--ax-panel) p-1"
                        role="group"
                        aria-labelledby="cuenta-tema"
                        data-prueba="cuenta-tema"
                    >
                        <UButton
                            v-for="opcion in TEMAS_CUENTA"
                            :key="opcion.valor"
                            :label="opcion.etiqueta"
                            :icon="opcion.icono"
                            color="neutral"
                            variant="ghost"
                            :aria-pressed="tema === opcion.valor"
                            class="min-h-11 justify-center rounded-[0.625rem] text-[0.84375rem] font-semibold"
                            :class="tema === opcion.valor ? 'bg-(--ax-tarjeta) text-primary shadow-sm ring ring-(--ax-borde) hover:bg-(--ax-tarjeta)' : 'text-muted'"
                            :data-tema="opcion.valor"
                            @click="tema = opcion.valor"
                        />
                    </div>
                </section>

                <section class="surface-card flex flex-col overflow-hidden rounded-2xl">
                    <UButton
                        icon="i-lucide-user"
                        trailing-icon="i-lucide-chevron-right"
                        color="neutral"
                        variant="ghost"
                        :ui="FILA"
                        data-prueba="cuenta-mi-cuenta"
                        @click="cuenta.irAMiCuenta()"
                    >
                        <span class="flex flex-col items-start">
                            <span>Mi cuenta</span>
                            <span class="text-xs text-muted">Contraseña y verificación en dos pasos</span>
                        </span>
                    </UButton>
                    <UButton
                        v-if="conResumen || urlManual"
                        icon="i-lucide-circle-help"
                        trailing-icon="i-lucide-chevron-right"
                        color="neutral"
                        variant="ghost"
                        class="border-t border-(--ax-borde)"
                        :ui="FILA"
                        :to="conResumen ? undefined : urlManual ?? undefined"
                        :target="conResumen ? undefined : '_blank'"
                        data-prueba="cuenta-ayuda"
                        @click="conResumen ? cuenta.abrirAyuda() : abierto = false"
                    >
                        Ayuda de esta pantalla
                    </UButton>
                    <UButton
                        icon="i-lucide-file-check"
                        trailing-icon="i-lucide-chevron-right"
                        color="neutral"
                        variant="ghost"
                        class="border-t border-(--ax-borde)"
                        :ui="FILA"
                        data-prueba="cuenta-que-cambio"
                        @click="cuenta.abrirQueCambio()"
                    >
                        <span class="flex flex-col items-start">
                            <span>Qué cambió</span>
                            <span
                                v-if="version"
                                class="text-xs text-muted"
                            >Versión {{ version.version }}</span>
                        </span>
                    </UButton>
                </section>

                <section class="surface-card flex flex-col overflow-hidden rounded-2xl">
                    <UButton
                        label="Cerrar sesión"
                        icon="i-lucide-log-out"
                        color="error"
                        variant="ghost"
                        :ui="{ ...FILA, base: `${FILA.base} text-error`, leadingIcon: 'size-[1.1875rem] text-error' }"
                        data-prueba="cuenta-cerrar-sesion"
                        @click="cuenta.cerrarSesion()"
                    />
                </section>
            </div>
        </template>
    </UDrawer>
</template>
