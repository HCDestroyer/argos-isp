<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import * as z from 'zod'

definePageMeta({ permiso: 'apariencia.ver' })

useHead({ title: 'Apariencia · ArgosIsp' })

/**
 * Apariencia de la instalación (A6, `contratos/apariencia.md`): tema de color (presets validados
 * AA por la API), modo predeterminado, marca, eslogan y logo y fondo del inicio de sesión. Al
 * guardar se aplica al momento en este navegador (`useTemaApariencia`) y en los demás al recargar.
 */
const { puede } = usePermisos()
const toast = useToast()
const tema = useTemaApariencia()

const apariencia = shallowRef<Apariencia | null>(null)
const problema = ref<Problem | null>(null)
const cargando = ref(false)
const guardando = ref(false)
const errorGuardar = ref<Problem | null>(null)
let clave = nuevaClaveIdempotencia()

const estado = reactive<{ tema: Apariencia['tema'], modo_predeterminado: Apariencia['modo_predeterminado'], nombre_marca: string, eslogan: string }>({
    tema: 'indigo',
    modo_predeterminado: 'sistema',
    nombre_marca: '',
    eslogan: '',
})

// Espejo de `validators_apariencia.ts`: nombre 1–60, eslogan hasta 120.
const esquema = z.object({
    tema: z.enum(['indigo', 'azul', 'violeta', 'esmeralda', 'naranja', 'rosa', 'pizarra']),
    modo_predeterminado: z.enum(['sistema', 'claro', 'oscuro']),
    nombre_marca: z.string().trim().min(1, 'Escribe el nombre de la marca').max(60, 'Hasta 60 caracteres'),
    eslogan: z.string().trim().max(120, 'Hasta 120 caracteres'),
})

function llenar(datos: Apariencia) {
    apariencia.value = datos
    estado.tema = datos.tema
    estado.modo_predeterminado = datos.modo_predeterminado
    estado.nombre_marca = datos.nombre_marca
    estado.eslogan = datos.eslogan ?? ''
}

async function cargar() {
    cargando.value = true
    const resultado = await useApariencia().ver()
    cargando.value = false
    problema.value = resultado.ok ? null : resultado.problema
    if (resultado.ok) {
        llenar(resultado.data)
    }
}

onMounted(cargar)

const puedeEditar = computed(() => puede('apariencia.editar'))
/** Permiso exacto de cada archivo (subir y quitar), por tipo. */
const permisosArchivo = computed(() => ({
    logo: { subir: puede('apariencia.subir_logo_login'), quitar: puede('apariencia.quitar_logo_login') },
    fondo: { subir: puede('apariencia.subir_fondo_login'), quitar: puede('apariencia.quitar_fondo_login') },
}))
const temaElegido = computed(() => apariencia.value?.temas.find(t => t.id === estado.tema) ?? null)

function aplicarYAvisar(datos: Apariencia, titulo: string) {
    llenar(datos)
    tema.aplicar({ tema: datos.tema, paleta: datos.paleta, modo_predeterminado: datos.modo_predeterminado, nombre_marca: datos.nombre_marca, eslogan: datos.eslogan, logo_login_url: datos.logo_login_url, fondo_login_url: datos.fondo_login_url, version: datos.version })
    toast.add({ title: titulo, icon: 'i-lucide-palette', color: 'success' })
}

async function guardar() {
    if (!apariencia.value) {
        return
    }
    guardando.value = true
    errorGuardar.value = null
    const resultado = await useApariencia().editar({
        version: apariencia.value.version,
        tema: estado.tema,
        modo_predeterminado: estado.modo_predeterminado,
        nombre_marca: estado.nombre_marca.trim(),
        eslogan: estado.eslogan.trim() || null,
    }, clave)
    guardando.value = false
    if (resultado.ok) {
        clave = nuevaClaveIdempotencia()
        aplicarYAvisar(resultado.data, 'Apariencia guardada')
        return
    }
    errorGuardar.value = resultado.problema
}

const subiendo = ref<'logo' | 'fondo' | null>(null)
async function subir(tipo: 'logo' | 'fondo', archivo: File | null | undefined) {
    if (!archivo || !apariencia.value) {
        return
    }
    subiendo.value = tipo
    const resultado = await useApariencia().subirArchivo(tipo, apariencia.value.version, archivo)
    subiendo.value = null
    if (resultado.ok) {
        aplicarYAvisar(resultado.data, tipo === 'logo' ? 'Logo del inicio de sesión guardado' : 'Fondo del inicio de sesión guardado')
        return
    }
    toast.add({ title: 'No se pudo subir la imagen', description: resultado.problema.detail ?? resultado.problema.title, icon: 'i-lucide-circle-alert', color: 'error' })
}

async function quitar(tipo: 'logo' | 'fondo') {
    if (!apariencia.value) {
        return
    }
    subiendo.value = tipo
    const resultado = await useApariencia().quitarArchivo(tipo, apariencia.value.version)
    subiendo.value = null
    if (resultado.ok) {
        aplicarYAvisar(resultado.data, tipo === 'logo' ? 'Logo quitado: se usa el de fábrica' : 'Fondo quitado: se usa el de fábrica')
        return
    }
    toast.add({ title: 'No se pudo quitar la imagen', description: resultado.problema.detail ?? resultado.problema.title, icon: 'i-lucide-circle-alert', color: 'error' })
}

const modos = [
    { label: 'Como el equipo', value: 'sistema', icon: 'i-lucide-monitor' },
    { label: 'Claro', value: 'claro', icon: 'i-lucide-sun' },
    { label: 'Oscuro', value: 'oscuro', icon: 'i-lucide-moon' },
]

const idFormulario = useId()
</script>

<template>
    <ConfiguracionMarco
        id="apariencia"
        titulo="Apariencia"
        descripcion="Cómo se ve Argos para todos: panel y portal del cliente"
        sin-tarjeta
    >
        <template #accion-principal>
            <UButton
                v-if="puedeEditar && apariencia"
                type="submit"
                :form="idFormulario"
                label="Guardar apariencia"
                :icon="ICONOS.guardar"
                :loading="guardando"
                class="glow-brand"
                data-prueba="guardar-apariencia"
            />
        </template>

        <ProblemaAlerta
            v-if="problema"
            :problema="problema"
            :reintentar="cargar"
            :reintentando="cargando"
        />
        <USkeleton
            v-else-if="!apariencia"
            class="h-96 w-full"
        />
        <div
            v-else
            class="grid min-w-0 gap-4 lg:min-h-0 lg:flex-1 lg:overflow-y-auto xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"
        >
            <UForm
                :id="idFormulario"
                :schema="esquema"
                :state="estado"
                :disabled="!puedeEditar"
                class="flex min-w-0 flex-col gap-4"
                @submit="guardar"
            >
                <section class="surface-card flex flex-col gap-3 rounded-2xl p-5">
                    <div>
                        <h2 class="text-sm font-semibold text-highlighted">
                            Color de la interfaz
                        </h2>
                        <p class="text-xs text-muted">
                            Todos se leen bien en modo claro y oscuro.
                        </p>
                    </div>
                    <div
                        class="flex flex-wrap gap-2"
                        role="radiogroup"
                        aria-label="Tema de color"
                        data-prueba="temas"
                    >
                        <UButton
                            v-for="opcion in apariencia.temas"
                            :key="opcion.id"
                            role="radio"
                            :aria-checked="estado.tema === opcion.id"
                            color="neutral"
                            variant="ghost"
                            class="flex w-18 flex-col items-center gap-1.5 rounded-xl p-2 text-xs"
                            :class="estado.tema === opcion.id ? 'ring-2 ring-primary' : ''"
                            :disabled="!puedeEditar"
                            :data-tema="opcion.id"
                            @click="estado.tema = opcion.id"
                        >
                            <span
                                class="flex size-11 shrink-0 overflow-hidden rounded-full ring ring-(--ax-borde)"
                                aria-hidden="true"
                            >
                                <span
                                    class="h-full w-1/2"
                                    :style="{ backgroundColor: opcion.claro }"
                                />
                                <span
                                    class="h-full w-1/2"
                                    :style="{ backgroundColor: opcion.oscuro }"
                                />
                            </span>
                            <span class="truncate">{{ opcion.nombre }}</span>
                        </UButton>
                    </div>
                </section>

                <section class="surface-card flex flex-col gap-3 rounded-2xl p-5">
                    <div>
                        <h2 class="text-sm font-semibold text-highlighted">
                            Modo predeterminado
                        </h2>
                        <p class="text-xs text-muted">
                            Cada persona puede cambiarlo después con la luna de la barra.
                        </p>
                    </div>
                    <UFormField name="modo_predeterminado">
                        <UTabs
                            v-model="estado.modo_predeterminado"
                            :items="modos"
                            variant="pill"
                            color="neutral"
                            :content="false"
                            :disabled="!puedeEditar"
                            :ui="{
                                list: 'w-auto max-w-full justify-start self-start overflow-x-auto rounded-xl bg-(--ax-panel) p-1',
                                indicator: 'rounded-lg bg-(--ax-tarjeta) shadow-sm ring ring-(--ax-borde)',
                                trigger: 'shrink-0 grow-0 rounded-lg px-3 text-muted data-[state=active]:text-primary',
                                leadingIcon: 'size-4',
                            }"
                            aria-label="Modo predeterminado"
                            data-prueba="modo-predeterminado"
                        />
                    </UFormField>
                </section>

                <section class="surface-card flex flex-col gap-4 rounded-2xl p-5">
                    <h2 class="text-sm font-semibold text-highlighted">
                        Inicio de sesión
                    </h2>
                    <div class="grid gap-4 sm:grid-cols-2">
                        <UFormField
                            name="nombre_marca"
                            label="Nombre de la marca"
                            required
                        >
                            <UInput
                                v-model="estado.nombre_marca"
                                class="w-full"
                                maxlength="60"
                            />
                        </UFormField>
                        <UFormField
                            name="eslogan"
                            label="Eslogan"
                            hint="Opcional"
                        >
                            <UInput
                                v-model="estado.eslogan"
                                class="w-full"
                                maxlength="120"
                            />
                        </UFormField>
                    </div>
                    <div
                        v-for="tipo in (['logo', 'fondo'] as const)"
                        :key="tipo"
                        class="flex flex-col gap-2"
                        :data-archivo="tipo"
                    >
                        <span class="text-sm font-medium text-highlighted">{{ tipo === 'logo' ? 'Logo' : 'Imagen de fondo (opcional)' }}</span>
                        <div class="flex flex-wrap items-center gap-3 rounded-xl border border-dashed border-(--ax-borde) p-3">
                            <span class="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-(--ax-panel)">
                                <img
                                    v-if="tema.urlArchivo(tipo === 'logo' ? apariencia.logo_login_url : apariencia.fondo_login_url)"
                                    :src="tema.urlArchivo(tipo === 'logo' ? apariencia.logo_login_url : apariencia.fondo_login_url) ?? undefined"
                                    :alt="tipo === 'logo' ? 'Logo actual del inicio de sesión' : 'Fondo actual del inicio de sesión'"
                                    class="max-h-full max-w-full object-contain"
                                    data-ampliar
                                >
                                <UIcon
                                    v-else
                                    :name="tipo === 'logo' ? 'i-lucide-image' : 'i-lucide-image-plus'"
                                    class="size-5 text-muted"
                                />
                            </span>
                            <div class="flex min-w-0 flex-1 flex-col gap-1">
                                <span class="text-xs text-muted">{{ tipo === 'logo' ? 'PNG o SVG. Sin logo se usa el de fábrica.' : 'JPG, PNG o WebP. Sin imagen se usa el degradado del color elegido.' }}</span>
                                <div class="flex flex-wrap gap-2">
                                    <UInput
                                        v-if="permisosArchivo[tipo].subir"
                                        type="file"
                                        accept="image/png,image/svg+xml,image/jpeg,image/webp"
                                        size="sm"
                                        :aria-label="tipo === 'logo' ? 'Subir logo' : 'Subir fondo'"
                                        :loading="subiendo === tipo"
                                        class="min-w-0 flex-1"
                                        @change="(evento: Event) => subir(tipo, (evento.target as HTMLInputElement).files?.[0])"
                                    />
                                    <UButton
                                        v-if="(tipo === 'logo' ? apariencia.logo_login : apariencia.fondo_login) && permisosArchivo[tipo].quitar"
                                        :label="tipo === 'logo' ? 'Quitar logo' : 'Quitar fondo'"
                                        :icon="ICONOS.eliminar"
                                        color="error"
                                        variant="outline"
                                        size="sm"
                                        :loading="subiendo === tipo"
                                        @click="quitar(tipo)"
                                    />
                                </div>
                            </div>
                        </div>
                    </div>
                </section>
                <ProblemaAlerta
                    v-if="errorGuardar"
                    :problema="errorGuardar"
                    :reintentar="errorGuardar.status === 409 ? cargar : undefined"
                />
            </UForm>

            <section
                class="surface-card flex h-fit flex-col gap-3 rounded-2xl p-5"
                aria-label="Vista previa"
            >
                <h2 class="text-sm font-semibold text-highlighted">
                    Vista previa del inicio de sesión
                </h2>
                <div
                    class="grid min-h-72 overflow-hidden rounded-xl ring ring-(--ax-borde) sm:grid-cols-[3fr_2fr]"
                    data-prueba="vista-previa-apariencia"
                >
                    <div
                        class="flex flex-col justify-between gap-6 p-5 text-white"
                        :style="{ backgroundImage: temaElegido ? `linear-gradient(160deg, ${temaElegido.claro} 0%, color-mix(in oklab, ${temaElegido.claro} 70%, #0e7490) 100%)` : undefined }"
                    >
                        <span class="flex items-center gap-2 text-base font-bold">
                            <span class="size-7 rounded-lg bg-white/25" />
                            {{ estado.nombre_marca || 'ArgosIsp' }}
                        </span>
                        <span class="text-lg font-bold">{{ estado.eslogan || 'Panel de administración' }}</span>
                        <span class="text-xs text-white/85">Con ArgosIsp</span>
                    </div>
                    <div class="flex flex-col justify-center gap-3 bg-(--ax-tarjeta) p-5">
                        <span class="text-base font-bold text-highlighted">Iniciar sesión</span>
                        <span class="h-8 rounded-lg ring ring-(--ax-borde)" />
                        <span class="h-8 rounded-lg ring ring-(--ax-borde)" />
                        <span
                            class="flex h-9 items-center justify-center rounded-full text-sm font-semibold text-white"
                            :style="{ backgroundColor: temaElegido?.claro }"
                        >Entrar</span>
                    </div>
                </div>
                <p class="text-xs text-muted">
                    Haz clic en otro color para ver cómo queda.
                </p>
            </section>
        </div>
    </ConfiguracionMarco>
</template>
