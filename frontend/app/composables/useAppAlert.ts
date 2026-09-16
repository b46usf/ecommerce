import type { SweetAlertIcon, SweetAlertOptions } from 'sweetalert2'

type MessageOptions = {
  title: string
  text?: string
}

type ConfirmOptions = MessageOptions & {
  confirmText?: string
  cancelText?: string
  icon?: SweetAlertIcon
  danger?: boolean
}

type PromptOptions = ConfirmOptions & {
  inputLabel: string
  inputPlaceholder?: string
  initialValue?: string
  minimumLength?: number
  maximumLength?: number
}

const baseOptions: SweetAlertOptions = {
  buttonsStyling: false,
  reverseButtons: true,
  focusCancel: true,
  heightAuto: false,
  allowOutsideClick: false,
  customClass: {
    container: 'niaga-alert-container',
    popup: 'niaga-alert',
    icon: 'niaga-alert__icon',
    title: 'niaga-alert__title',
    htmlContainer: 'niaga-alert__content',
    actions: 'niaga-alert__actions',
    confirmButton: 'niaga-alert__confirm',
    cancelButton: 'niaga-alert__cancel',
    input: 'niaga-alert__input',
    validationMessage: 'niaga-alert__validation',
  },
}

async function fire(options: SweetAlertOptions) {
  if (import.meta.server) return undefined
  const { default: Swal } = await import('sweetalert2')
  return Swal.mixin(baseOptions).fire(options)
}

export function useAppAlert() {
  async function confirmAction(options: ConfirmOptions): Promise<boolean> {
    const result = await fire({
      title: options.title,
      text: options.text,
      icon: options.icon ?? 'warning',
      showCancelButton: true,
      confirmButtonText: options.confirmText ?? 'Ya, lanjutkan',
      cancelButtonText: options.cancelText ?? 'Batal',
      focusCancel: true,
      customClass: {
        ...baseOptions.customClass,
        confirmButton: options.danger ? 'niaga-alert__confirm niaga-alert__confirm--danger' : 'niaga-alert__confirm',
      },
    })
    return result?.isConfirmed === true
  }

  async function promptText(options: PromptOptions): Promise<string | null> {
    const minimumLength = options.minimumLength ?? 3
    const maximumLength = options.maximumLength ?? 500
    const result = await fire({
      title: options.title,
      text: options.text,
      icon: options.icon ?? 'question',
      input: 'textarea',
      inputLabel: options.inputLabel,
      inputPlaceholder: options.inputPlaceholder ?? 'Tuliskan alasan secara jelas…',
      inputValue: options.initialValue ?? '',
      inputAttributes: { maxlength: String(maximumLength), rows: '4' },
      showCancelButton: true,
      confirmButtonText: options.confirmText ?? 'Simpan dan lanjutkan',
      cancelButtonText: options.cancelText ?? 'Batal',
      focusCancel: false,
      inputValidator: (value) => {
        const normalized = String(value ?? '').trim()
        if (normalized.length < minimumLength) return `Isi minimal ${minimumLength} karakter.`
        if (normalized.length > maximumLength) return `Isi maksimal ${maximumLength} karakter.`
        return undefined
      },
      customClass: {
        ...baseOptions.customClass,
        confirmButton: options.danger ? 'niaga-alert__confirm niaga-alert__confirm--danger' : 'niaga-alert__confirm',
      },
    })
    return result?.isConfirmed ? String(result.value).trim() : null
  }

  async function success(options: MessageOptions) {
    return fire({
      title: options.title,
      text: options.text,
      icon: 'success',
      confirmButtonText: 'Selesai',
    })
  }

  async function error(options: MessageOptions) {
    return fire({
      title: options.title,
      text: options.text,
      icon: 'error',
      confirmButtonText: 'Mengerti',
    })
  }

  return { confirmAction, promptText, success, error }
}
