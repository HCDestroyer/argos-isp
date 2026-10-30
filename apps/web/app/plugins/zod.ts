/** Mensajes de validación en español y con qué hacer (`utils/mensajesValidacion.ts`). */
export default defineNuxtPlugin({
    name: 'zod',
    setup() {
        configurarMensajesValidacion()
    },
})
