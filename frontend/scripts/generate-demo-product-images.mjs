import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const outputDirectory = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'demo-products');
const products = [
  ['01-buku-tulis.svg', 'Buku Tulis', 'SEKOLAH', '#075ba8', '#39a8ff', 'BT'],
  ['02-alat-tulis.svg', 'Set Alat Tulis', 'SEKOLAH', '#d66b00', '#ffc857', 'AT'],
  ['03-tas-sekolah.svg', 'Tas Sekolah', 'SEKOLAH', '#203b78', '#7698e8', 'TS'],
  ['04-headset.svg', 'Headset Stereo', 'ELEKTRONIK', '#4527a0', '#a77cff', 'HS'],
  ['05-keyboard.svg', 'Keyboard', 'ELEKTRONIK', '#216575', '#64cbd4', 'KB'],
  ['06-power-bank.svg', 'Power Bank', 'ELEKTRONIK', '#054f8a', '#35b3ed', 'PB'],
  ['07-botol-minum.svg', 'Botol Minum', 'RUMAH', '#08725d', '#49d5ad', 'BM'],
  ['08-lampu-meja.svg', 'Lampu Meja', 'RUMAH', '#aa5700', '#ffd05b', 'LM'],
  ['09-kotak-penyimpanan.svg', 'Kotak Simpan', 'RUMAH', '#8b5b3e', '#e9b98d', 'KS'],
  ['10-tote-bag.svg', 'Tote Bag', 'FASHION', '#8a405d', '#ef91b7', 'TB'],
  ['11-hoodie.svg', 'Hoodie Unisex', 'FASHION', '#3d4659', '#aab6ca', 'HU'],
  ['12-sneakers.svg', 'Sneakers', 'FASHION', '#235da0', '#77baff', 'SN'],
  ['13-sabun-cair.svg', 'Sabun Natural', 'KESEHATAN', '#237141', '#80d89e', 'SC'],
  ['14-sunscreen.svg', 'Sunscreen', 'KESEHATAN', '#b64b19', '#ff9b61', 'SP'],
  ['15-masker-medis.svg', 'Masker Medis', 'KESEHATAN', '#087286', '#75d5e4', 'MM'],
  ['16-kopi-arabika.svg', 'Kopi Arabika', 'KULINER', '#643719', '#c98a55', 'KA'],
  ['17-granola.svg', 'Granola Madu', 'KULINER', '#8b6510', '#edc553', 'GM'],
  ['18-teh-hijau.svg', 'Teh Hijau', 'KULINER', '#316a30', '#91ce74', 'TH'],
];

const escapeXml = (value) => value.replace(/[<>&'\"]/g, (character) => ({
  '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;',
})[character]);

await mkdir(outputDirectory, { recursive: true });
await Promise.all(products.map(async ([file, title, category, dark, light, initials], index) => {
  const safeTitle = escapeXml(title);
  const safeCategory = escapeXml(category);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 800" role="img" aria-labelledby="title desc">
  <title id="title">${safeTitle}</title>
  <desc id="desc">Ilustrasi produk demo ${safeTitle} untuk Niaga</desc>
  <defs>
    <linearGradient id="background" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${dark}"/><stop offset="1" stop-color="${light}"/></linearGradient>
    <linearGradient id="glass" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#fff" stop-opacity=".34"/><stop offset="1" stop-color="#fff" stop-opacity=".1"/></linearGradient>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="18" stdDeviation="18" flood-color="#001a33" flood-opacity=".2"/></filter>
  </defs>
  <rect width="800" height="800" rx="54" fill="url(#background)"/>
  <circle cx="692" cy="100" r="165" fill="#fff" opacity=".09"/><circle cx="70" cy="710" r="210" fill="#fff" opacity=".07"/>
  <path d="M70 162h146" stroke="#fff" stroke-opacity=".45" stroke-width="4" stroke-linecap="round"/>
  <text x="70" y="132" fill="#fff" opacity=".86" font-family="Arial, sans-serif" font-size="26" font-weight="700" letter-spacing="5">${safeCategory}</text>
  <g filter="url(#shadow)">
    <rect x="154" y="218" width="492" height="342" rx="72" fill="url(#glass)" stroke="#fff" stroke-opacity=".38" stroke-width="3"/>
    <circle cx="400" cy="389" r="126" fill="#fff" opacity=".94"/>
    <circle cx="400" cy="389" r="105" fill="${dark}" opacity=".1"/>
    <text x="400" y="431" text-anchor="middle" fill="${dark}" font-family="Arial, sans-serif" font-size="112" font-weight="900" letter-spacing="-5">${initials}</text>
  </g>
  <text x="400" y="649" text-anchor="middle" fill="#fff" font-family="Arial, sans-serif" font-size="45" font-weight="800">${safeTitle}</text>
  <text x="400" y="701" text-anchor="middle" fill="#fff" opacity=".78" font-family="Arial, sans-serif" font-size="23" font-weight="600" letter-spacing="3">NIAGA PILIHAN · ${String(index + 1).padStart(2, '0')}</text>
</svg>`;
  await writeFile(join(outputDirectory, file), svg, 'utf8');
}));

console.info(`Generated ${products.length} demo product images in ${outputDirectory}`);
