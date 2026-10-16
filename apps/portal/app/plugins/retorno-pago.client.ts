/**
 * Retorno del pago en línea con el "Atrás" del navegador. Antes de salir a la pasarela la URL pasa
 * a `/corte?pago=<id>` (`salirALaPasarela`); si el navegador restaura la página desde su caché
 * (bfcache), la app sigue en la ruta anterior: se recarga para que `/corte` lea `?pago=<id>`.
 */
export default defineNuxtPlugin(() => {
    const router = useRouter()
    window.addEventListener('pageshow', (evento) => {
        if (!evento.persisted) {
            return
        }
        const actual = `${window.location.pathname}${window.location.search}`
        if (actual !== router.currentRoute.value.fullPath) {
            window.location.reload()
        }
    })
})
