const { supabase } = require('../../db/supabase');
const config = require('../../config');
const { listingFee } = require('../../utils/money');
const { reference } = require('../../utils/crypto');
const { mapListing } = require('../../utils/mappers');
const { notFound, forbidden, validation } = require('../../utils/errors');
const { emit, EVENTS } = require('../../events/bus');
const { uploadImage } = require('../../services/cloudinary');

async function nextSeq() {
  // Simple sequential-ish id from count
  const { count } = await supabase.from('listings').select('*', { count: 'exact', head: true });
  return (count || 0) + 100;
}

async function unlockSetFor(userId) {
  if (!userId) return new Set();
  const { data } = await supabase
    .from('connections')
    .select('listing_id')
    .eq('requester_id', userId)
    .eq('status', 'UNLOCKED');
  return new Set((data || []).map((r) => r.listing_id));
}

async function likedSetFor(userId) {
  if (!userId) return new Set();
  const { data } = await supabase.from('listing_likes').select('listing_id').eq('user_id', userId);
  return new Set((data || []).map((r) => r.listing_id));
}

function publicFilter(q) {
  let query = supabase.from('listings').select('*', { count: 'exact' }).eq('status', 'PUBLISHED');

  if (q.district) query = query.eq('district', q.district);
  if (q.category) query = query.eq('category', q.category);
  if (q.transactionType) query = query.eq('transaction_type', q.transactionType);

  if (q.q) {
    const tokens = String(q.q).toLowerCase().trim().split(/\s+/).filter(Boolean);
    // PostgREST: or ilike on combined fields — approximate with or filter
    for (const t of tokens) {
      const pattern = `%${t}%`;
      query = query.or(
        `title.ilike.${pattern},district.ilike.${pattern},subcounty.ilike.${pattern},custom_location.ilike.${pattern}`
      );
    }
  }

  switch (q.sort) {
    case 'price_asc':
      query = query.order('advertised_value_ugx', { ascending: true });
      break;
    case 'price_desc':
      query = query.order('advertised_value_ugx', { ascending: false });
      break;
    case 'popular':
      query = query.order('likes_count', { ascending: false });
      break;
    default:
      query = query.order('published_at', { ascending: false, nullsFirst: false });
  }

  return query;
}

async function list(filters, cursor, userId) {
  const page = config.pageSize;
  const offset = Number(cursor || 0) || 0;

  let query = publicFilter(filters);
  query = query.range(offset, offset + page - 1);

  const { data, error, count } = await query;
  if (error) throw error;

  const unlocked = await unlockSetFor(userId);
  const liked = await likedSetFor(userId);

  // Client-side token AND filter for multi-word (Supabase or is loose)
  let rows = data || [];
  if (filters.q) {
    const tokens = String(filters.q).toLowerCase().trim().split(/\s+/).filter(Boolean);
    rows = rows.filter((l) => {
      const hay = [
        l.title,
        l.district,
        l.subcounty,
        l.custom_location || '',
        l.category === 'LAND' ? 'land' : 'sugarcane plantation cane',
        l.transaction_type === 'SALE' ? 'sale sell' : 'lease rent',
      ]
        .join(' ')
        .toLowerCase();
      return tokens.every((t) => hay.includes(t));
    });
  }

  const items = rows.map((r) =>
    mapListing(r, {
      isUnlocked: unlocked.has(r.id) || r.seller_id === userId,
      liked: liked.has(r.id),
      isOwner: r.seller_id === userId,
    })
  );

  const next = offset + page < (count || 0) ? String(offset + page) : undefined;
  return { items, next };
}

async function getById(id, userId) {
  const { data: row, error } = await supabase.from('listings').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  if (!row) throw notFound('Listing not found');

  // Increment views (fire-and-forget)
  supabase
    .from('listings')
    .update({ views_count: (row.views_count || 0) + 1 })
    .eq('id', id)
    .then(() => {})
    .catch(() => {});

  emit(EVENTS.LISTING_VIEWED, { listingId: id, userId });

  const unlocked = await unlockSetFor(userId);
  const liked = await likedSetFor(userId);
  const isOwner = row.seller_id === userId;

  return mapListing(row, {
    isUnlocked: unlocked.has(id) || isOwner,
    liked: liked.has(id),
    isOwner,
  });
}

async function mine(userId) {
  const { data, error } = await supabase
    .from('listings')
    .select('*')
    .eq('seller_id', userId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []).map((r) => mapListing(r, { isUnlocked: true, isOwner: true }));
}

async function saved(userId) {
  const { data: likes } = await supabase.from('listing_likes').select('listing_id').eq('user_id', userId);
  const ids = (likes || []).map((l) => l.listing_id);
  if (!ids.length) return [];

  const { data, error } = await supabase.from('listings').select('*').in('id', ids).eq('status', 'PUBLISHED');
  if (error) throw error;
  const unlocked = await unlockSetFor(userId);
  return (data || []).map((r) =>
    mapListing(r, { isUnlocked: unlocked.has(r.id), liked: true, isOwner: r.seller_id === userId })
  );
}

async function toggleLike(listingId, userId) {
  const { data: listing } = await supabase.from('listings').select('*').eq('id', listingId).maybeSingle();
  if (!listing) throw notFound('Listing not found');

  const { data: existing } = await supabase
    .from('listing_likes')
    .select('*')
    .eq('user_id', userId)
    .eq('listing_id', listingId)
    .maybeSingle();

  if (existing) {
    await supabase.from('listing_likes').delete().eq('user_id', userId).eq('listing_id', listingId);
    await supabase
      .from('listings')
      .update({ likes_count: Math.max(0, (listing.likes_count || 1) - 1) })
      .eq('id', listingId);
  } else {
    await supabase.from('listing_likes').insert({ user_id: userId, listing_id: listingId });
    await supabase
      .from('listings')
      .update({ likes_count: (listing.likes_count || 0) + 1 })
      .eq('id', listingId);
    emit(EVENTS.LISTING_LIKED, {
      listingId,
      userId,
      sellerId: listing.seller_id,
      title: listing.title,
    });
  }

  return getById(listingId, userId);
}

async function create(draft, userId) {
  const acreage = Number(draft.acreage);
  const unitPrice = Number(draft.unitPrice);
  if (!(acreage > 0) || !(unitPrice > 0)) throw validation('Invalid acreage or price');

  // LEASE multiplier: sugarcane uses harvests/cuttings; land uses leaseYears
  const harvests =
    draft.harvests != null && Number(draft.harvests) > 0
      ? Number(draft.harvests)
      : draft.leaseYears != null && Number(draft.leaseYears) > 0
        ? Number(draft.leaseYears)
        : null;
  const leaseYears = draft.transactionType === 'LEASE' ? harvests || 1 : null;
  const multiplier = draft.transactionType === 'LEASE' ? leaseYears || 1 : 1;
  const value = Math.round(acreage * unitPrice * multiplier);
  const fee = listingFee(value, draft.package || 'STANDARD');
  const seq = await nextSeq();
  const ref = reference('LST', seq);

  const caneAgeMonths =
    draft.caneAgeMonths != null && Number(draft.caneAgeMonths) > 0
      ? Number(draft.caneAgeMonths)
      : null;

  // Upload images if base64 data URLs; otherwise keep URLs
  const images = [];
  for (const img of draft.images || []) {
    if (typeof img === 'string' && img.startsWith('data:')) {
      const b64 = img.replace(/^data:image\/\w+;base64,/, '');
      const url = await uploadImage(Buffer.from(b64, 'base64'), { publicId: `${ref}-${images.length}` });
      images.push(url);
    } else if (img) {
      images.push(img);
    }
  }

  const row = {
    seller_id: userId,
    title: draft.title,
    description: draft.description ? String(draft.description).trim() || null : null,
    category: draft.category,
    transaction_type: draft.transactionType,
    acreage,
    advertised_value_ugx: value,
    unit_price: unitPrice,
    lease_years: leaseYears,
    cane_age_months: draft.category === 'SUGARCANE_PLANTATION' ? caneAgeMonths : null,
    harvests: draft.category === 'SUGARCANE_PLANTATION' && draft.transactionType === 'LEASE' ? harvests : null,
    district: draft.district,
    subcounty: draft.subcounty,
    custom_location: draft.customLocation || null,
    gps_lat: draft.gps?.latitude ?? null,
    gps_lng: draft.gps?.longitude ?? null,
    images,
    status: 'AWAITING_PAYMENT',
    ownership: draft.ownership || 'OWNER',
    package: draft.package || 'STANDARD',
    fee_ugx: fee,
    reference: ref,
    contact_name: null,
    contact_phone: draft.phone,
    contact_whatsapp: draft.whatsapp || draft.phone,
  };

  // Fetch seller name for contact
  const { data: seller } = await supabase.from('users').select('name, phone').eq('id', userId).single();
  row.contact_name = seller?.name || 'Seller';

  const { data, error } = await supabase.from('listings').insert(row).select('*').single();
  if (error) throw error;

  const mapped = mapListing(data, { isUnlocked: true, isOwner: true });
  emit(EVENTS.LISTING_CREATED, { listing: mapped, sellerId: userId });

  return { ...mapped, reference: ref, feeUGX: fee };
}

async function similar(id, userId) {
  const { data: base } = await supabase.from('listings').select('*').eq('id', id).maybeSingle();
  if (!base) return [];

  const { data } = await supabase
    .from('listings')
    .select('*')
    .eq('status', 'PUBLISHED')
    .neq('id', id)
    .or(`district.eq.${base.district},category.eq.${base.category}`)
    .limit(4);

  const unlocked = await unlockSetFor(userId);
  const liked = await likedSetFor(userId);
  return (data || []).map((r) =>
    mapListing(r, {
      isUnlocked: unlocked.has(r.id) || r.seller_id === userId,
      liked: liked.has(r.id),
      isOwner: r.seller_id === userId,
    })
  );
}

module.exports = {
  list,
  getById,
  mine,
  saved,
  toggleLike,
  create,
  similar,
};
