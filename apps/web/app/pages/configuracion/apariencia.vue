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
    { label: 'Como el equipo (sistema)', value: 'sistema', description: 'Sigue el modo del teléfono o la computadora.' },
    { label: 'Claro', value: 'claro' },
    { label: 'Oscuro', value: 'oscuro' },
]
</script>

<template>
    <PanelPagina
        id="apariencia"
        titulo="Apariencia"
        icono="i-lucide-palette"
    >
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
            class="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]"
        >
            <UForm
                :schema="esquema"
                :state="estado"
                :disabled="!puedeEditar"
                class="surface-card overflow-hidden"
                @submit="guardar"
            >
                <FormularioSeccion
                    titulo="Color"
                    descripcion="El color principal del panel y del portal. Todos pasan el contraste AA en claro y en oscuro."
                >
                    <div
                        class="grid grid-cols-2 gap-2 sm:grid-cols-4"
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
                            :variant="estado.tema === opcion.id ? 'soft' : 'outline'"
                            class="justify-start gap-2 rounded-lg"
                            :class="estado.tema === opcion.id ? 'ring-2 ring-primary' : ''"
                            :disabled="!puedeEditar"
                            :data-tema="opcion.id"
                            @click="estado.tema = opcion.id"
                        >
                            <span
                                class="flex size-6 shrink-0 overflow-hidden rounded-full ring ring-(--ax-borde)"
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
                            <UIcon
                                v-if="estado.tema === opcion.id"
                                name="i-lucide-check"
                                class="ms-auto size-4 text-primary"
                            />
                        </UButton>
                    </div>
                </FormularioSeccion>
                <FormularioSeccion
                    titulo="Modo predeterminado"
                    descripcion="El que ve quien todavía no eligió uno (cada persona lo cambia con el sol o la luna)."
                >
                    <UFormField name="modo_predeterminado">
                        <URadioGroup
                            v-model="estado.modo_predeterminado"
                            :items="modos"
                            orientation="vertical"
                        />
                    </UFormField>
                </FormularioSeccion>
                <FormularioSeccion
                    titulo="Marca"
                    descripcion="Se muestra en el inicio de sesión del panel y del portal."
                >
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
                            help="Una frase corta bajo el nombre."
                        >
                            <UInput
                                v-model="estado.eslogan"
                                class="w-full"
                                maxlength="120"
                            />
                        </UFormField>
                    </div>
                </FormularioSeccion>
                <FormularioSeccion
                    titulo="Inicio de sesión"
                    descripcion="Logo y fondo propios (PNG, SVG, JPG o WebP). Sin ellos se usan los de fábrica."
                >
                    <div class="grid gap-4 sm:grid-cols-2">
                        <div
                            v-for="tipo in (['logo', 'fondo'] as const)"
                            :key="tipo"
                            class="flex flex-col gap-2"
                            :data-archivo="tipo"
                        >
                            <span class="text-sm font-medium">{{ tipo === 'logo' ? 'Logo' : 'Fondo' }}</span>
                            <div class="flex h-28 items-center justify-center overflow-hidden rounded-lg bg-(--ax-panel) ring ring-(--ax-borde)">
                                <img
                                    v-if="tema.urlArchivo(tipo === 'logo' ? apariencia.logo_login_url : apariencia.fondo_login_url)"
                                    :src="tema.urlArchivo(tipo === 'logo' ? apariencia.logo_login_url : apariencia.fondo_login_url) ?? undefined"
                                    :alt="tipo === 'logo' ? 'Logo actual del inicio de sesión' : 'Fondo actual del inicio de sesión'"
                                    class="max-h-full max-w-full object-contain"
                                    data-ampliar
                                >
                                <span
                                    v-else
                                    class="text-xs text-muted"
                                >El de fábrica</span>
                            </div>
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
                </FormularioSeccion>
                <ProblemaAlerta
                    v-if="errorGuardar"
                    :problema="errorGuardar"
                    :reintentar="errorGuardar.status === 409 ? cargar : undefined"
                    class="m-4"
                />
                <FormularioAcciones v-if="puedeEditar">
                    <UButton
                        type="submit"
                        label="Guardar apariencia"
                        :icon="ICONOS.guardar"
                        :loading="guardando"
                        data-prueba="guardar-apariencia"
                    />
                </FormularioAcciones>
            </UForm>

            <aside
                class="flex flex-col gap-3"
                aria-label="Vista previa"
            >
                <h2 class="text-xs font-semibold tracking-[0.04em] text-muted uppercase">
                    Vista previa
                </h2>
                <div
                    class="overflow-hidden rounded-(--ax-radio) ring ring-(--ax-borde)"
                    data-prueba="vista-previa-apariencia"
                >
                    <div
                        class="flex flex-col gap-1 p-5 text-white"
                        :style="{ backgroundImage: temaElegido ? `linear-gradient(120deg, ${temaElegido.claro} 0%, color-mix(in oklab, ${temaElegido.claro} 75%, #000) 100%)` : undefined }"
                    >
                        <span class="text-lg font-bold">{{ estado.nombre_marca || 'ArgosIsp' }}</span>
                        <span class="text-sm text-white/90">{{ estado.eslogan || 'Panel de administración' }}</span>
                    </div>
                    <div class="flex flex-col gap-3 bg-(--ax-tarjeta) p-5">
                        <span class="h-8 rounded-lg ring ring-(--ax-borde)" />
                        <span
                            class="flex h-9 items-center justify-center rounded-full text-sm font-semibold text-white"
                            :style="{ backgroundColor: temaElegido?.claro }"
                        >Entrar</span>
                    </div>
                </div>
            </aside>
        </div>
    </PanelPagina>
</template>
