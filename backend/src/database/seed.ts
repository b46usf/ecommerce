import 'dotenv/config';
import { argon2id, hash } from 'argon2';
import { eq, sql } from 'drizzle-orm';
import { createDatabase } from './index.js';
import {
  adminGrants, buyerAccounts, categories, inventoryBalances, inventoryMovements,
  legalEntities, productMedia, products, skus, storeMembers, storeOrigins, stores,
  taxClasses, users,
} from './schema.js';

if (process.env.NODE_ENV !== 'development') {
  throw new Error('Development seed requires NODE_ENV=development.');
}
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required.');

const profiles = [
  { role: 'ADMIN', id: '10000000-0000-4000-8000-000000000001', name: 'Administrator Demo', email: 'admin@example.test' },
  { role: 'BUYER', id: '10000000-0000-4000-8000-000000000002', name: 'Pembeli Demo', email: 'buyer@example.test' },
  { role: 'VENDOR', id: '10000000-0000-4000-8000-000000000003', name: 'Vendor Demo', email: 'vendor@example.test' },
] as const;

const accounts = await Promise.all(profiles.map(async (profile) => {
  const password = process.env[`SEED_${profile.role}_PASSWORD`];
  if (!password || password.length < 12 || password.length > 128) {
    throw new Error(`Set SEED_${profile.role}_PASSWORD to a password of 12-128 characters.`);
  }
  return {
    ...profile,
    email: (process.env[`SEED_${profile.role}_EMAIL`] ?? profile.email).trim().toLowerCase(),
    passwordHash: await hash(password, { type: argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 }),
  };
}));

const ids = {
  admin: profiles[0].id,
  buyer: profiles[1].id,
  vendor: profiles[2].id,
  legalEntity: '20000000-0000-4000-8000-000000000001',
  store: '20000000-0000-4000-8000-000000000002',
  taxClass: '30000000-0000-4000-8000-000000000002',
};

const categorySeeds = [
  { id: '30000000-0000-4000-8000-000000000001', slug: 'perlengkapan-sekolah', name: 'Perlengkapan Sekolah' },
  { id: '30000000-0000-4000-8000-000000000003', slug: 'elektronik', name: 'Elektronik' },
  { id: '30000000-0000-4000-8000-000000000004', slug: 'rumah-tangga', name: 'Rumah Tangga' },
  { id: '30000000-0000-4000-8000-000000000005', slug: 'fashion', name: 'Fashion' },
  { id: '30000000-0000-4000-8000-000000000006', slug: 'kesehatan', name: 'Kesehatan' },
  { id: '30000000-0000-4000-8000-000000000007', slug: 'makanan-minuman', name: 'Makanan & Minuman' },
] as const;

const productSeeds = [
  { name: 'Buku Tulis Premium 10 Pack', slug: 'buku-tulis-premium-10-pack', category: 0, sku: 'SCH-BOOK-001', unit: 'pak', price: 45_000, stock: 120, weight: 900, size: ['22.00', '16.00', '6.00'], image: '01-buku-tulis.svg', color: 'Biru', description: 'Buku tulis premium dengan kertas halus untuk kebutuhan sekolah dan kantor.' },
  { name: 'Set Alat Tulis Lengkap 12 Pcs', slug: 'set-alat-tulis-lengkap', category: 0, sku: 'SCH-STAT-002', unit: 'set', price: 32_500, stock: 85, weight: 350, size: ['24.00', '12.00', '4.00'], image: '02-alat-tulis.svg', color: 'Kuning', description: 'Satu set alat tulis praktis berisi perlengkapan belajar harian.' },
  { name: 'Tas Ransel Sekolah Ergonomis', slug: 'tas-ransel-sekolah-ergonomis', category: 0, sku: 'SCH-BAG-003', unit: 'buah', price: 189_000, stock: 42, weight: 700, size: ['42.00', '30.00', '16.00'], image: '03-tas-sekolah.svg', color: 'Navy', description: 'Ransel ringan dengan bantalan punggung dan kompartemen laptop.' },
  { name: 'Headset Bluetooth Stereo', slug: 'headset-bluetooth-stereo', category: 1, sku: 'ELC-HDST-004', unit: 'unit', price: 249_000, stock: 64, weight: 280, size: ['20.00', '18.00', '8.00'], image: '04-headset.svg', color: 'Hitam', description: 'Headset nirkabel dengan suara jernih dan baterai tahan lama.' },
  { name: 'Keyboard Wireless Ringkas', slug: 'keyboard-wireless-ringkas', category: 1, sku: 'ELC-KEY-005', unit: 'unit', price: 279_000, stock: 37, weight: 620, size: ['36.00', '15.00', '4.00'], image: '05-keyboard.svg', color: 'Putih', description: 'Keyboard ringkas untuk bekerja nyaman di meja rumah maupun kantor.' },
  { name: 'Power Bank 10000 mAh', slug: 'power-bank-10000-mah', category: 1, sku: 'ELC-PWR-006', unit: 'unit', price: 199_000, stock: 76, weight: 240, size: ['14.00', '7.00', '3.00'], image: '06-power-bank.svg', color: 'Biru', description: 'Pengisi daya portabel dua port dengan indikator kapasitas baterai.' },
  { name: 'Botol Minum Stainless 750 ml', slug: 'botol-minum-stainless-750ml', category: 2, sku: 'HOM-BTL-007', unit: 'buah', price: 115_000, stock: 98, weight: 390, size: ['28.00', '8.00', '8.00'], image: '07-botol-minum.svg', color: 'Hijau', description: 'Botol stainless tahan lama untuk minuman dingin dan hangat.' },
  { name: 'Lampu Meja LED Fleksibel', slug: 'lampu-meja-led-fleksibel', category: 2, sku: 'HOM-LMP-008', unit: 'unit', price: 149_000, stock: 53, weight: 550, size: ['32.00', '16.00', '12.00'], image: '08-lampu-meja.svg', color: 'Putih', description: 'Lampu meja hemat energi dengan tiga tingkat kecerahan.' },
  { name: 'Kotak Penyimpanan Serbaguna', slug: 'kotak-penyimpanan-serbaguna', category: 2, sku: 'HOM-BOX-009', unit: 'set', price: 89_000, stock: 71, weight: 1100, size: ['38.00', '28.00', '22.00'], image: '09-kotak-penyimpanan.svg', color: 'Krem', description: 'Kotak penyimpanan bertutup untuk menjaga rumah tetap rapi.' },
  { name: 'Tote Bag Kanvas Premium', slug: 'tote-bag-kanvas-premium', category: 3, sku: 'FSH-TOTE-010', unit: 'buah', price: 79_000, stock: 110, weight: 210, size: ['38.00', '34.00', '4.00'], image: '10-tote-bag.svg', color: 'Natural', description: 'Tas kanvas tebal dengan ruang luas untuk aktivitas sehari-hari.' },
  { name: 'Jaket Hoodie Unisex', slug: 'jaket-hoodie-unisex', category: 3, sku: 'FSH-HOOD-011', unit: 'buah', price: 229_000, stock: 48, weight: 650, size: ['35.00', '28.00', '8.00'], image: '11-hoodie.svg', color: 'Abu-abu', description: 'Hoodie unisex berbahan lembut dengan potongan modern.' },
  { name: 'Sepatu Sneakers Harian', slug: 'sepatu-sneakers-harian', category: 3, sku: 'FSH-SHOE-012', unit: 'pasang', price: 329_000, stock: 34, weight: 950, size: ['34.00', '22.00', '13.00'], image: '12-sneakers.svg', color: 'Putih', description: 'Sneakers ringan dengan sol empuk untuk kegiatan sehari-hari.' },
  { name: 'Sabun Cair Natural 500 ml', slug: 'sabun-cair-natural-500ml', category: 4, sku: 'HLT-SOAP-013', unit: 'botol', price: 58_000, stock: 140, weight: 560, size: ['20.00', '8.00', '8.00'], image: '13-sabun-cair.svg', color: 'Hijau', description: 'Sabun cair beraroma segar untuk membersihkan tangan sehari-hari.' },
  { name: 'Sunscreen SPF 50 PA++++', slug: 'sunscreen-spf-50', category: 4, sku: 'HLT-SUN-014', unit: 'tube', price: 98_000, stock: 92, weight: 90, size: ['14.00', '5.00', '4.00'], image: '14-sunscreen.svg', color: 'Oranye', description: 'Tabir surya ringan untuk membantu melindungi kulit saat beraktivitas.' },
  { name: 'Masker Medis 3 Ply 50 Pcs', slug: 'masker-medis-3-ply-50-pcs', category: 4, sku: 'HLT-MASK-015', unit: 'kotak', price: 42_000, stock: 160, weight: 260, size: ['20.00', '11.00', '9.00'], image: '15-masker-medis.svg', color: 'Biru', description: 'Masker medis tiga lapis dengan earloop lembut dalam kemasan higienis.' },
  { name: 'Kopi Arabika Nusantara 250 g', slug: 'kopi-arabika-nusantara-250g', category: 5, sku: 'FNB-COF-016', unit: 'pak', price: 85_000, stock: 66, weight: 280, size: ['22.00', '13.00', '7.00'], image: '16-kopi-arabika.svg', color: 'Cokelat', description: 'Biji kopi arabika pilihan dengan karakter rasa seimbang.' },
  { name: 'Granola Madu Kacang 300 g', slug: 'granola-madu-kacang-300g', category: 5, sku: 'FNB-GRA-017', unit: 'pak', price: 72_000, stock: 83, weight: 330, size: ['24.00', '16.00', '7.00'], image: '17-granola.svg', color: 'Emas', description: 'Granola renyah dengan madu dan kacang untuk sarapan praktis.' },
  { name: 'Teh Hijau Melati 25 Kantong', slug: 'teh-hijau-melati-25-kantong', category: 5, sku: 'FNB-TEA-018', unit: 'kotak', price: 38_000, stock: 125, weight: 160, size: ['16.00', '9.00', '8.00'], image: '18-teh-hijau.svg', color: 'Hijau', description: 'Teh hijau beraroma melati dalam kantong seduh praktis.' },
] as const;

const uuid = (prefix: string, number: number) => `${prefix}-0000-4000-8000-${String(number).padStart(12, '0')}`;

const database = createDatabase({ databaseUrl });
try {
  await database.db.transaction(async (tx) => {
    for (const account of accounts) {
      const [existing] = await tx.select({ id: users.id, email: users.emailNormalized }).from(users).where(eq(users.id, account.id));
      if (existing && existing.email !== account.email) {
        throw new Error('A seed account ID already belongs to a different email. Seed aborted.');
      }
      if (!existing) await tx.insert(users).values({
        id: account.id, name: account.name, emailNormalized: account.email,
        passwordHash: account.passwordHash, emailVerifiedAt: new Date(),
      });
    }
    // Re-running preserves credentials and transaction history, while refreshing the deterministic demo catalog.
    await tx.insert(adminGrants).values({ id: '10000000-0000-4000-8000-000000000004', userId: ids.admin, roleCode: 'SUPERADMIN' })
      .onDuplicateKeyUpdate({ set: { id: sql`id` } });
    await tx.insert(buyerAccounts).values({ id: '10000000-0000-4000-8000-000000000005', managerUserId: ids.buyer, kind: 'INDIVIDUAL' })
      .onDuplicateKeyUpdate({ set: { id: sql`id` } });
    await tx.insert(legalEntities).values({ id: ids.legalEntity, createdBy: ids.vendor, kind: 'INDIVIDUAL', legalName: 'Vendor Demo', status: 'VERIFIED' })
      .onDuplicateKeyUpdate({ set: { legalName: 'Vendor Demo', status: 'VERIFIED' } });
    await tx.insert(stores).values({ id: ids.store, legalEntityId: ids.legalEntity, slug: 'toko-demo', name: 'Toko Demo', contactPhone: '+628000000000', status: 'ACTIVE' })
      .onDuplicateKeyUpdate({ set: { name: 'Toko Demo', status: 'ACTIVE' } });
    await tx.insert(storeMembers).values({ id: '20000000-0000-4000-8000-000000000003', storeId: ids.store, userId: ids.vendor, roleCode: 'OWNER' })
      .onDuplicateKeyUpdate({ set: { roleCode: 'OWNER' } });
    await tx.insert(storeOrigins).values({ id: '20000000-0000-4000-8000-000000000004', storeId: ids.store, contactName: 'Vendor Demo', phone: '+628000000000', street: 'Alamat demo lokal', postalCode: '10110' })
      .onDuplicateKeyUpdate({ set: { contactName: 'Vendor Demo', phone: '+628000000000' } });

    for (const category of categorySeeds) {
      await tx.insert(categories).values({ ...category, attributeSchema: {}, status: 'ACTIVE' })
        .onDuplicateKeyUpdate({ set: { name: category.name, status: 'ACTIVE' } });
    }
    await tx.insert(taxClasses).values({ id: ids.taxClass, code: 'DEMO_GOODS', name: 'Klasifikasi demo; tarif belum dikonfigurasi', status: 'ACTIVE' })
      .onDuplicateKeyUpdate({ set: { name: 'Klasifikasi demo; tarif belum dikonfigurasi', status: 'ACTIVE' } });

    for (const [index, item] of productSeeds.entries()) {
      const sequence = index + 1;
      const productId = uuid('40000000', sequence);
      const skuId = sequence === 1 ? '40000000-0000-4000-8000-000000000002' : uuid('41000000', sequence);
      const inventoryId = sequence === 1 ? '40000000-0000-4000-8000-000000000003' : uuid('42000000', sequence);
      const categoryId = categorySeeds[item.category].id;
      const [lengthCm, widthCm, heightCm] = item.size;
      const description = `<p>${item.description}</p>`;
      const attributes = { brand: 'Niaga Pilihan', color: item.color, condition: 'Baru' };

      await tx.insert(products).values({
        id: productId, storeId: ids.store, categoryId, taxClassId: ids.taxClass,
        name: item.name, description, slug: item.slug, status: 'ACTIVE', attributes,
      }).onDuplicateKeyUpdate({ set: {
        categoryId, taxClassId: ids.taxClass, name: item.name, description,
        slug: item.slug, status: 'ACTIVE', attributes,
      } });

      await tx.insert(productMedia).values({
        id: uuid('43000000', sequence), productId, objectKey: item.image,
        altText: `Ilustrasi ${item.name}`, sortOrder: 0,
      }).onDuplicateKeyUpdate({ set: { objectKey: item.image, altText: `Ilustrasi ${item.name}` } });

      await tx.insert(skus).values({
        id: skuId, productId, storeId: ids.store, skuCode: item.sku, unitLabel: item.unit,
        unitPriceGross: item.price, weightG: item.weight, lengthCm, widthCm, heightCm,
        status: 'ACTIVE', variantAttributes: { color: item.color },
      }).onDuplicateKeyUpdate({ set: {
        skuCode: item.sku, unitLabel: item.unit, unitPriceGross: item.price,
        weightG: item.weight, lengthCm, widthCm, heightCm, status: 'ACTIVE',
        variantAttributes: { color: item.color },
      } });

      const [balance] = await tx.select({ id: inventoryBalances.id }).from(inventoryBalances).where(eq(inventoryBalances.id, inventoryId));
      if (!balance) {
        await tx.insert(inventoryBalances).values({ id: inventoryId, skuId, onHand: item.stock, reserved: 0 });
        await tx.insert(inventoryMovements).values({
          inventoryId, onHandDelta: item.stock, reservedDelta: 0, reason: 'RESTOCK',
          eventKey: `dev-seed-inventory-${String(sequence).padStart(3, '0')}`, actorId: ids.vendor,
        });
      }
    }
  });
  console.info(`Development seed completed with ${productSeeds.length} active products and ${categorySeeds.length} categories.`);
  console.info(JSON.stringify({ accounts: accounts.map(({ role, email }) => ({ role, email })), ids }, null, 2));
} finally {
  await database.close();
}
