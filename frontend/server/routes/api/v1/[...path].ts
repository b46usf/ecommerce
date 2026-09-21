export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig(event);
  const upstreamBase = config.apiServerBase.replace(/\/+$/, '');
  const path = (getRouterParam(event, 'path') ?? '').replace(/^\/+/, '');
  const search = getRequestURL(event).search;

  return proxyRequest(event, `${upstreamBase}/${path}${search}`, {
    streamRequest: true,
  });
});
