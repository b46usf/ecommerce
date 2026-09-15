import sanitizeHtml from 'sanitize-html'

export const productDescriptionTags = ['p', 'br', 'strong', 'em', 'u', 's', 'ul', 'ol', 'li', 'blockquote', 'h2', 'h3', 'h4', 'a']

export function sanitizeProductDescription(value: string | null | undefined): string {
  return sanitizeHtml(value ?? '', {
    allowedTags: productDescriptionTags,
    allowedAttributes: { a: ['href', 'title', 'rel'] },
    allowedSchemes: ['https', 'http'],
    allowProtocolRelative: false,
    enforceHtmlBoundary: true,
    transformTags: { a: sanitizeHtml.simpleTransform('a', { rel: 'nofollow noopener noreferrer' }) },
  })
}

export function productDescriptionText(value: string | null | undefined): string {
  return sanitizeHtml(value ?? '', { allowedTags: [], allowedAttributes: {} }).replace(/\s+/g, ' ').trim()
}
