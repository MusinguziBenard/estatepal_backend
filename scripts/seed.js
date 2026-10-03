/**
 * Optional seed listings for demo (requires migrate + env).
 */
require('dotenv').config();
const { supabase } = require('../src/db/supabase');
const { generateOtp } = require('../src/utils/crypto');

const SEED = [
  ['Fertile farmland near Hoima town', 'LAND', 'SALE', 12, 8_000_000, 'Hoima', 'Kigorobya'],
  ['Mature sugarcane, ready to harvest', 'SUGARCANE_PLANTATION', 'SALE', 40, 6_500_000, 'Masindi', 'Kinyara'],
  ['Lakeview plot with road access', 'LAND', 'SALE', 3, 15_000_000, 'Kikuube', 'Buhimba'],
  ['Cane estate, 5-year lease', 'SUGARCANE_PLANTATION', 'LEASE', 25, 900_000, 'Kiryandongo', 'Bweyale'],
  ['Riverside farm, irrigated', 'LAND', 'SALE', 9, 11_000_000, 'Hoima', 'Buseruka'],
];

async function main() {
  const phone = process.env.SEED_SELLER_PHONE || '+256700000099';
  let { data: user } = await supabase.from('users').select('*').eq('phone', phone).maybeSingle();
  if (!user) {
    const { data } = await supabase
      .from('users')
      .insert({ phone, name: 'Demo Seller', role: 'user', accepted_terms_at: new Date().toISOString() })
      .select('*')
      .single();
    user = data;
  }

  for (let i = 0; i < SEED.length; i++) {
    const [title, category, transaction_type, acreage, unit, district, subcounty] = SEED[i];
    const value = acreage * unit * (transaction_type === 'LEASE' ? 5 : 1);
    await supabase.from('listings').insert({
      seller_id: user.id,
      title,
      category,
      transaction_type,
      acreage,
      advertised_value_ugx: value,
      unit_price: unit,
      lease_years: transaction_type === 'LEASE' ? 5 : null,
      district,
      subcounty,
      images: [`https://picsum.photos/seed/seed${i}/900/600`],
      status: 'PUBLISHED',
      ownership: i % 3 === 0 ? 'BROKER' : 'OWNER',
      package: 'STANDARD',
      fee_ugx: 20000,
      reference: `LST-SEED-${1000 + i}`,
      contact_name: 'Demo Seller',
      contact_phone: phone,
      contact_whatsapp: phone,
      published_at: new Date().toISOString(),
      likes_count: 3 + i * 2,
    });
  }
  console.log(`Seeded ${SEED.length} listings for ${phone}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
