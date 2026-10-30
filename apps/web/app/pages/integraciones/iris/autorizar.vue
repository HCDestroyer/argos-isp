<script setup lang="ts">
import { z } from 'zod'

/**
 * «Conectar con un botón» (`contratos/iris.md` §1.4): Iris abre
 * `/integraciones/iris/autorizar?iris=&state=&code_challenge=&code_challenge_method=S256` y el admin
 * aprueba o rechaza, como en una pantalla de autorización OAuth.
 * - Sin sesión, `01.auth.global` lleva al login con `redirect` = la URL completa (query incluida).
 * - Sin `iris.configurar` se dice aquí, sin menú ni redirección a Iris (por eso la página no declara
 *   `permiso` en `definePageMeta`: `/sin-permiso` va dentro del layout del panel).
 * - Origen desconocido: aviso fuerte y el admin escribe el dominio (`confirmar_origen`).
 * - «Aprobar» llama a la API y sale del panel con `window.location.assign(redirigir_a)`; «Rechazar»
 *   no llama a la API y solo existe con el origen ya validado por la vista previa.
 */
definePageMeta({
    layout: false,
})

useHead({ title: 'Conectar Iris · ArgosIsp' })

const route = useRoute()
const { puede } = usePermisos()
const usuario = useUsuarioActual()
const { vistaPreviaAutorizacion, autorizar } = useIris()

const lectura = computed(() => leerParametrosAutorizacion(route.query))
const permitido = computed(() => puede('iris.configurar'))

const cargando = ref(false)
const vista = shallowRef<VistaPreviaAutorizacionIris | null>(null)
const errorCarga = ref<MensajeAutorizacionIris | null>(null)
const errorAprobar = ref<MensajeAutorizacionIris | null>(null)
const aprobando = ref(false)
/** Ya se pidió salir del panel (aprobada o rechazada): todo queda bloqueado. */
const saliendo = ref(false)

const estado = reactive({ confirmar_origen: '' })

const host = computed(() => (vista.value ? hostDeOrigen(vista.value.origen_normalizado) : ''))
const confirmado = computed(() => !vista.value || vista.value.origen_conocido || dominioCoincide(vista.value.origen_normalizado, estado.confirmar_origen))

/** Espejo de `origenConfirmado` de la API: solo pide el dominio con un origen desconocido. */
const esquema = computed(() => {
    const origen = vista.value?.origen_normalizado ?? ''
    if (!vista.value || vista.value.origen_conocido) {
        return z.object({ confirmar_origen: z.string() })
    }
    return z.object({
        confirmar_origen: z.string().trim().refine(valor => dominioCoincide(origen, valor), 'Escribe el dominio de Iris tal como aparece arriba'),
    })
})

async function cargar() {
    const datos = lectura.value
    if (!datos.ok || !permitido.value) {
        return
    }
    cargando.value = true
    errorCarga.value = null
    const resultado = await vistaPreviaAutorizacion(datos.parametros.iris)
    cargando.value = false
    if (resultado.ok) {
        vista.value = resultado.data
        return
    }
    vista.value = null
    errorCarga.value = mensajeErrorAutorizacion(resultado.problema)
}

onMounted(cargar)

async function aprobar() {
    const actual = vista.value
    if (!lectura.value.ok || !actual || !confirmado.value || aprobando.value || saliendo.value) {
        return
    }
    aprobando.value = true
    errorAprobar.value = null
    const resultado = await autorizar({
        ...lectura.value.parametros,
        ...(actual.origen_conocido ? {} : { confirmar_origen: estado.confirmar_origen.trim() }),
    })
    aprobando.value = false
    if (!resultado.ok) {
        errorAprobar.value = mensajeErrorAutorizacion(resultado.problema)
        return
    }
    if (!destinoDentroDeIris(resultado.data.redirigir_a, actual.origen_normalizado)) {
        errorAprobar.value = {
            titulo: 'No se pudo volver a Iris',
            detalle: 'La dirección de vuelta no es la del Iris que aprobaste. Vuelve a pulsar «Conectar con Argos» en Iris.',
            reintentable: false,
        }
        return
    }
    saliendo.value = true
    window.location.assign(resultado.data.redirigir_a)
}

function rechazar() {
    const actual = vista.value
    if (!lectura.value.ok || !actual || saliendo.value) {
        return
    }
    saliendo.value = true
    window.location.assign(urlRechazoIris(actual.origen_normalizado, lectura.value.parametros.state))
}
</script>

<template>
    <div class="min-h-dvh">
        <div
            class="app-aura"
            aria-hidden="true"
        />
        <main class="relative flex min-h-dvh flex-col items-center justify-center gap-6 px-4 py-10">
            <div class="flex flex-col items-center gap-3 text-highlighted">
                <LogoArgos
                    variante="linea"
                    class="size-14 text-primary"
                />
                <span class="text-2xl font-semibold tracking-[-0.015em]">ArgosIsp</span>
            </div>

            <div
                class="surface-card flex w-full max-w-lg flex-col gap-5 p-6"
                data-prueba="autorizar-iris"
            >
                <!-- Sin permiso: nunca se llama a la API ni se redirige a Iris. -->
                <template v-if="!permitido">
                    <h1 class="text-xl font-semibold text-highlighted">
                        Conectar Iris con Argos
                    </h1>
                    <UAlert
                        color="error"
                        variant="subtle"
                        icon="i-lucide-shield-x"
                        title="No puedes aprobar esta conexión"
                        :description="MENSAJE_SIN_PERMISO_IRIS"
                        data-prueba="autorizar-sin-permiso"
                    />
                </template>

                <template v-else-if="!lectura.ok">
                    <h1 class="text-xl font-semibold text-highlighted">
                        Conectar Iris con Argos
                    </h1>
                    <UAlert
                        color="warning"
                        variant="subtle"
                        icon="i-lucide-link-2-off"
                        :title="lectura.motivo === 'incompleto' ? 'Enlace incompleto' : 'Enlace no compatible'"
                        :description="lectura.motivo === 'incompleto'
                            ? `Al enlace le faltan datos (${lectura.faltan.join(', ')}). Vuelve a pulsar «Conectar con Argos» en Iris.`
                            : 'Iris pidió un método de verificación que Argos no acepta (solo S256). Actualiza Iris y vuelve a intentar.'"
                        data-prueba="autorizar-incompleto"
                    />
                </template>

                <template v-else-if="cargando">
                    <USkeleton class="h-7 w-4/5" />
                    <USkeleton class="h-4 w-1/2" />
                    <USkeleton class="h-20 w-full" />
                </template>

                <!-- La vista previa falló: sin origen validado no hay «Rechazar» ni «Aprobar». -->
                <template v-else-if="errorCarga || !vista">
                    <h1 class="text-xl font-semibold text-highlighted">
                        Conectar Iris con Argos
                    </h1>
                    <UAlert
                        color="error"
                        variant="subtle"
                        icon="i-lucide-circle-alert"
                        :title="errorCarga?.titulo ?? 'No se pudo leer la solicitud de Iris'"
                        :description="errorCarga?.detalle"
                        :actions="errorCarga?.reintentable !== false
                            ? [{ label: 'Reintentar', icon: 'i-lucide-rotate-cw', color: 'error', variant: 'outline', onClick: cargar }]
                            : undefined"
                        data-prueba="autorizar-error"
                    />
                </template>

                <UForm
                    v-else
                    :schema="esquema"
                    :state="estado"
                    class="flex flex-col gap-5"
                    @submit="aprobar"
                >
                    <div class="flex flex-col gap-1">
                        <h1
                            class="text-xl font-semibold text-highlighted"
                            data-prueba="autorizar-titulo"
                        >
                            Iris en <span class="break-all font-mono text-primary">{{ vista.origen_normalizado }}</span> pide conectarse con Argos
                        </h1>
                        <p
                            v-if="usuario"
                            class="text-sm text-muted"
                        >
                            Lo apruebas como {{ usuario.nombre }}.
                        </p>
                    </div>

                    <UAlert
                        v-if="!vista.origen_conocido"
                        color="error"
                        variant="soft"
                        icon="i-lucide-shield-alert"
                        title="Esta dirección de Iris no está registrada en Argos"
                        description="Solo aprueba si tú abriste esta conexión desde tu Iris."
                        data-prueba="autorizar-origen-desconocido"
                    />

                    <section class="flex flex-col gap-2">
                        <h2 class="text-sm font-medium text-highlighted">
                            Empresas que verá Iris
                        </h2>
                        <UBadge
                            v-if="vista.alcance_global"
                            color="warning"
                            variant="subtle"
                            icon="i-lucide-building-2"
                            label="Todas las empresas, también las futuras"
                            class="self-start"
                            data-prueba="autorizar-alcance-global"
                        />
                        <p
                            v-else-if="!vista.empresas.length"
                            class="text-sm text-muted"
                        >
                            Ninguna empresa activa.
                        </p>
                        <ul
                            v-else
                            class="flex flex-col divide-y divide-default rounded-md ring ring-default"
                            data-prueba="autorizar-empresas"
                        >
                            <li
                                v-for="empresa in vista.empresas"
                                :key="empresa.id"
                                class="flex flex-wrap items-baseline justify-between gap-x-3 px-3 py-2 text-sm"
                            >
                                <span class="font-medium text-highlighted">{{ empresa.nombre }}</span>
                                <span class="text-muted">{{ empresa.nit ? `NIT ${empresa.nit}` : 'Sin NIT' }}</span>
                            </li>
                        </ul>
                        <p class="text-xs text-muted">
                            Iris consultará clientes, servicios, planes y routers, y podrá registrar instalaciones y
                            retiros. La conexión queda apagada hasta que la actives en Iris.
                        </p>
                    </section>

                    <UFormField
                        v-if="!vista.origen_conocido"
                        name="confirmar_origen"
                        label="Escribe el dominio de Iris para confirmar"
                        help="Tal como aparece arriba, sin https://."
                        required
                    >
                        <UInput
                            v-model="estado.confirmar_origen"
                            :placeholder="host.includes(':') ? 'iris.tuempresa.gt:8443' : 'iris.tuempresa.gt'"
                            autocomplete="off"
                            autocapitalize="off"
                            spellcheck="false"
                            icon="i-lucide-globe"
                            class="w-full"
                            data-prueba="autorizar-dominio"
                        />
                    </UFormField>

                    <UAlert
                        v-if="errorAprobar"
                        color="error"
                        variant="subtle"
                        icon="i-lucide-circle-alert"
                        :title="errorAprobar.titulo"
                        :description="errorAprobar.detalle"
                        :actions="errorAprobar.reintentable
                            ? [{ label: 'Reintentar', icon: 'i-lucide-rotate-cw', color: 'error', variant: 'outline', onClick: aprobar }]
                            : undefined"
                        data-prueba="autorizar-error-aprobar"
                    />

                    <div class="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                        <UButton
                            label="Rechazar"
                            color="neutral"
                            variant="outline"
                            icon="i-lucide-x"
                            :disabled="aprobando || saliendo"
                            class="justify-center"
                            data-prueba="autorizar-rechazar"
                            @click="rechazar"
                        />
                        <UButton
                            type="submit"
                            label="Aprobar"
                            icon="i-lucide-check"
                            :loading="aprobando || saliendo"
                            :disabled="!confirmado || saliendo"
                            class="glow-brand justify-center"
                            data-prueba="autorizar-aprobar"
                        />
                    </div>
                </UForm>
            </div>

            <UColorModeButton />
        </main>
    </div>
</template>
