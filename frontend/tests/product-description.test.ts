import { describe, expect, it } from 'vitest'
import { productDescriptionText, sanitizeProductDescription } from '../app/utils/product-description'

describe('product description HTML', () => {
  it('preserves the formatting supported by the backend policy', () => {
    const html = '<h2>Detail</h2><p>Produk <strong>berkualitas</strong>.</p><ul><li>Aman</li></ul>'
    expect(sanitizeProductDescription(html)).toBe(html)
  })

  it('removes scripts, event handlers, unsafe protocols, and unsupported media', () => {
    const html = '<p onclick="alert(1)">Aman<script>alert(1)</script><img src=x onerror=alert(1)><a href="javascript:alert(1)">tautan</a></p>'
    const clean = sanitizeProductDescription(html)
    expect(clean).toBe('<p>Aman<a rel="nofollow noopener noreferrer">tautan</a></p>')
  })

  it('extracts meaningful text for required-field validation', () => {
    expect(productDescriptionText('<p><strong>  Teh hijau </strong></p>')).toBe('Teh hijau')
    expect(productDescriptionText('<p><br></p>')).toBe('')
  })
})
