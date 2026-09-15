import { MarketplaceApiError } from '~/api/client';

export interface DisplayError { message: string; requestId?: string; code?: string }

export function displayError(error: unknown, fallback = 'Terjadi gangguan. Silakan coba lagi.'): DisplayError {
  if (error instanceof MarketplaceApiError) {
    if (error.status === 401) return { message: 'Sesi Anda berakhir. Silakan masuk kembali.', requestId: error.requestId, code: error.code };
    if (error.status === 403) return { message: 'Anda tidak memiliki akses untuk tindakan ini.', requestId: error.requestId, code: error.code };
    if (error.status === 412) return { message: 'Data telah berubah. Muat ulang lalu coba kembali.', requestId: error.requestId, code: error.code };
    if (error.status === 429) return { message: 'Terlalu banyak permintaan. Tunggu sebentar lalu coba lagi.', requestId: error.requestId, code: error.code };
    if (error.status === 503) return { message: 'Layanan sedang tidak tersedia. Silakan coba kembali.', requestId: error.requestId, code: error.code };
    return { message: error.message, requestId: error.requestId, code: error.code };
  }
  return { message: fallback };
}
