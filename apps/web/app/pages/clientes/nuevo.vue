<script setup lang="ts">
/**
 * Alta de cliente en 3 pasos (tablero NuevoAltaCliente y su versión móvil): Cliente → Servicio →
 * Cobro, con el progreso compacto arriba, el formulario centrado en una tarjeta que se desplaza por
 * dentro y el resumen en una línea junto a los botones.
 *
 * - Paso 1: los datos del cliente. «Siguiente: servicio» lo crea y sigue; «Crear cliente sin
 *   servicio» lo crea y va a su ficha (como antes).
 * - Pasos 2 y 3: el alta de servicio de siempre con el cliente ya elegido. «Servicio» = router,
 *   plan, red y PPPoE; «Cobro» = instalación, plantilla y resumen.
 * - Lo que el diseño muestra y la API aún no da (varios teléfonos, contactos del servicio,
 *   «Registrar prospecto» hacia Iris) queda anotado en `.claude/integration/a4.md`, sin inventarlo.
 */
definePageMeta({ permiso: 'clientes.crear' })

useHead({ title: 'Nuevo cliente · ArgosIsp' })

const toast = useToast()
const { puede, destinoPermitido } = usePermisos()

type PasoAlta = 'cliente' | 'servicio' | 'cobro'

const PASOS: { id: PasoAlta, nombre: string, detalle: string }[] = [
    { id: 'cliente', nombre: 'Cliente', detalle: 'Datos y ubicación' },
    { id: 'servicio', nombre: 'Servicio', detalle: 'Router, plan e IP' },
    { id: 'cobro', nombre: 'Cobro', detalle: 'Facturas e instalación' },
]

const cliente = shallowRef<Cliente | null>(null)
const pasoServicio = ref<string>('conexion')
const resumenServicio = shallowRef<ResumenAltaServicio | null>(null)
const conServicio = computed(() => puede('servicios.crear'))

const pasoAlta = computed<PasoAlta>(() => {
    if (!cliente.value) {
        return 'cliente'
    }
    return pasoServicio.value === 'instalacion' || pasoServicio.value === 'resumen' ? 'cobro' : 'servicio'
})
const indice = computed(() => PASOS.findIndex(p => p.id === pasoAlta.value))

async function alGuardar(creado: Cliente, seguir: boolean) {
    if (seguir) {
        cliente.value = creado
        toast.add({ title: 'Cliente creado', description: `${creado.nombre}: ahora su servicio`, color: 'success', icon: 'i-lucide-circle-check' })
        return
    }
    toast.add({
        title: 'Cliente creado',
        description: creado.nombre,
        color: 'success',
        icon: 'i-lucide-circle-check',
        actions: puede('servicios.crear') && puede('clientes.ver')
            ? [{ label: 'Agregar servicio', to: `/clientes/${creado.id}?tab=servicios&nuevo_servicio=1`, color: 'neutral', variant: 'outline' }]
            : undefined,
    })
    await navigateTo(destinoPermitido(`/clientes/${creado.id}`))
}

async function alCrearServicio() {
    if (cliente.value) {
        await navigateTo(destinoPermitido(`/clientes/${cliente.value.id}?tab=servicios`))
    }
}

/** Cerrar: sin cliente vuelve a la lista; con el cliente ya creado, a su ficha. */
async function cerrar() {
    await navigateTo(destinoPermitido(cliente.value ? `/clientes/${cliente.value.id}` : '/clientes'))
}
</script>

<template>
    <PanelPagina
        id="cliente-nuevo"
        titulo="Nuevo cliente"
        icono="i-lucide-user-plus"
        encabezado-propio
        sin-migas
    >
        <section
            class="surface-card mx-auto flex w-full max-w-5xl min-w-0 flex-col rounded-[1.375rem]"
            aria-labelledby="titulo-alta"
            data-prueba="alta-cliente"
        >
            <!-- Encabezado con el progreso compacto (escritorio) o «Paso n de 3» con la barra (teléfono). -->
            <header class="flex flex-col gap-3 border-b border-(--ax-borde) px-4 py-3 sm:flex-row sm:items-center sm:gap-6 sm:px-5">
                <div class="flex items-center justify-between gap-3 sm:block">
                    <div class="flex min-w-0 flex-col">
                        <span class="hidden text-xs text-muted sm:block">Clientes › Nuevo</span>
                        <h1
                            id="titulo-alta"
                            class="text-lg font-bold tracking-[-0.02em] text-highlighted sm:text-xl"
                        >
                            Nuevo cliente
                        </h1>
                        <span class="text-xs text-muted sm:hidden">Paso {{ indice + 1 }} de 3 · {{ PASOS[indice]?.nombre }}</span>
                    </div>
                    <div class="flex items-center gap-1 sm:hidden">
                        <AyudaBoton solo-icono />
                        <UButton
                            icon="i-lucide-x"
                            color="neutral"
                            variant="ghost"
                            aria-label="Cerrar el alta"
                            @click="cerrar"
                        />
                    </div>
                </div>
                <div
                    class="flex gap-1.5 sm:hidden"
                    aria-hidden="true"
                >
                    <span
                        v-for="(p, i) in PASOS"
                        :key="p.id"
                        class="h-1 flex-1 rounded-full"
                        :class="i <= indice ? 'bg-primary' : 'bg-(--ax-borde)'"
                    />
                </div>
                <ol
                    class="hidden min-w-0 flex-1 items-center gap-3 sm:flex"
                    aria-label="Progreso del alta"
                    data-prueba="progreso-alta"
                >
                    <template
                        v-for="(p, i) in PASOS"
                        :key="p.id"
                    >
                        <li
                            class="flex shrink-0 items-center gap-2 text-sm font-semibold"
                            :class="i === indice ? 'text-primary' : i < indice ? 'text-highlighted' : 'text-muted'"
                            :aria-current="i === indice ? 'step' : undefined"
                        >
                            <span
                                class="inline-flex size-6 items-center justify-center rounded-full text-xs"
                                :class="i === indice ? 'bg-primary text-inverted ring-4 ring-primary/15' : i < indice ? 'bg-success/15 text-success' : 'bg-(--ax-panel) text-muted'"
                            >
                                <UIcon
                                    v-if="i < indice"
                                    name="i-lucide-check"
                                    class="size-3.5"
                                />
                                <template v-else>{{ i + 1 }}</template>
                            </span>
                            {{ p.nombre }}
                        </li>
                        <li
                            v-if="i < PASOS.length - 1"
                            class="h-0.5 min-w-6 flex-1 rounded-full"
                            :class="i < indice ? 'bg-success/60' : 'bg-(--ax-borde)'"
                            aria-hidden="true"
                        />
                    </template>
                </ol>
                <div class="hidden items-center gap-1 sm:flex">
                    <AyudaBoton solo-icono />
                    <UButton
                        icon="i-lucide-x"
                        color="neutral"
                        variant="ghost"
                        aria-label="Cerrar el alta"
                        @click="cerrar"
                    />
                </div>
            </header>

            <div class="flex min-w-0 flex-col gap-5 px-4 py-5 sm:px-7">
                <template v-if="pasoAlta === 'cliente'">
                    <div class="flex flex-col gap-0.5">
                        <h2 class="text-lg font-bold text-highlighted">
                            ¿Quién es el cliente?
                        </h2>
                        <p class="text-sm text-muted">
                            Busca primero para no duplicarlo. Solo el nombre y un teléfono son obligatorios.
                        </p>
                    </div>
                    <UAlert
                        color="primary"
                        variant="subtle"
                        icon="i-lucide-circle-help"
                        title="¿Solo está interesado o falta revisar cobertura?"
                        description="Regístralo como prospecto: lo atiende ventas en Iris y aquí se crea cuando lo instalen. «Registrar prospecto» se activa cuando la API lo publique."
                        :actions="[{ label: 'Registrar prospecto', color: 'neutral', variant: 'outline', disabled: true }]"
                        data-prueba="aviso-prospecto"
                    />
                    <ClienteFormulario
                        :con-servicio="conServicio"
                        @guardado="alGuardar"
                        @cancelar="cerrar"
                    />
                </template>

                <template v-else-if="cliente">
                    <div class="flex flex-col gap-0.5">
                        <h2 class="text-lg font-bold text-highlighted">
                            {{ pasoAlta === 'servicio' ? '¿Qué servicio va a tener?' : '¿Cómo se le cobra?' }}
                        </h2>
                        <p class="text-sm text-muted">
                            {{ pasoAlta === 'servicio' ? 'Elige el router y el plan. La IP es automática salvo que elijas la red o la escribas.' : 'Instalación, plantilla de facturación y el resumen antes de crear.' }}
                        </p>
                    </div>
                    <ServicioAltaFormulario
                        :cliente="cliente"
                        pasos-externos
                        @paso="pasoServicio = $event"
                        @resumen="resumenServicio = $event"
                        @creado="alCrearServicio"
                        @cancelar="cerrar"
                    />
                </template>
            </div>

            <!-- Resumen en una línea junto a los botones del formulario. -->
            <footer
                v-if="cliente"
                class="flex items-center gap-3 border-t border-(--ax-borde) px-4 py-3 text-sm sm:px-5"
                data-prueba="linea-resumen-alta"
            >
                <AvatarIniciales
                    :nombre="cliente.nombre"
                    size="sm"
                />
                <span class="truncate font-semibold text-highlighted">{{ cliente.nombre }}</span>
                <span class="hidden font-mono text-xs text-muted sm:inline">{{ cliente.codigo }}</span>
                <template v-if="resumenServicio?.plan">
                    <span
                        class="text-dimmed"
                        aria-hidden="true"
                    >·</span>
                    <span class="truncate text-muted">{{ resumenServicio.plan }}<template v-if="resumenServicio.precio"> <span class="font-semibold text-highlighted tabular-nums">{{ formatearQuetzales(resumenServicio.precio) }}/mes</span></template></span>
                </template>
                <template v-if="resumenServicio?.router">
                    <span
                        class="text-dimmed"
                        aria-hidden="true"
                    >·</span>
                    <span
                        class="truncate text-muted"
                        data-prueba="linea-resumen-ip"
                    >IP <span class="font-semibold text-highlighted">{{ resumenServicio.ip }}</span></span>
                </template>
            </footer>
        </section>
    </PanelPagina>
</template>
