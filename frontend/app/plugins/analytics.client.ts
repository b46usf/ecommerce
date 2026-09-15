type AnalyticsWindow = Window & { dataLayer?: Array<Record<string, unknown>> }

export default defineNuxtPlugin(() => {
  const router = useRouter()
  const onEvent = (raw: Event) => {
    const event = raw as CustomEvent<{ event: string; status: number }>
    const target = window as AnalyticsWindow
    target.dataLayer ||= []
    target.dataLayer.push({ event: event.detail.event, http_status: event.detail.status })
  }
  window.addEventListener('niaga:analytics', onEvent)
  router.afterEach(to => {
    const target = window as AnalyticsWindow
    target.dataLayer ||= []
    target.dataLayer.push({ event: 'page_view', page_path: to.path })
  })
})
