const { supabase } = require('../../db/supabase');
const config = require('../../config');
const { reference } = require('../../utils/crypto');
const { mapConnection } = require('../../utils/mappers');
const { notFound, conflict, forbidden } = require('../../utils/errors');
const { emit, EVENTS } = require('../../events/bus');

async function nextSeq() {
  const { count } = await supabase.from('connections').select('*', { count: 'exact', head: true });
  return (count || 0) + 100;
}

async function request(listingId, userId) {
  const { data: listing } = await supabase.from('listings').select('*').eq('id', listingId).maybeSingle();
  if (!listing || listing.status !== 'PUBLISHED') throw notFound('Listing not found');
  if (listing.seller_id === userId) throw forbidden('Cannot request your own listing');

  const { data: existing } = await supabase
    .from('connections')
    .select('*')
    .eq('listing_id', listingId)
    .eq('requester_id', userId)
    .neq('status', 'REJECTED')
    .maybeSingle();

  if (existing) {
    return mapConnection(existing, 'SENT', listing.title);
  }

  const seq = await nextSeq();
  const ref = reference('CON', seq);

  const { data, error } = await supabase
    .from('connections')
    .insert({
      listing_id: listingId,
      requester_id: userId,
      status: 'AWAITING_PAYMENT',
      fee_ugx: config.fees.connection,
      reference: ref,
    })
    .select('*')
    .single();
  if (error) {
    if (error.code === '23505') throw conflict('Request already exists');
    throw error;
  }

  await supabase
    .from('listings')
    .update({ requests_count: (listing.requests_count || 0) + 1 })
    .eq('id', listingId);

  emit(EVENTS.CONNECTION_REQUESTED, {
    connectionId: data.id,
    listingId,
    listingTitle: listing.title,
    sellerId: listing.seller_id,
    requesterId: userId,
  });

  return mapConnection(data, 'SENT', listing.title);
}

async function mine(userId) {
  const { data, error } = await supabase
    .from('connections')
    .select('*, listings(title)')
    .eq('requester_id', userId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []).map((r) =>
    mapConnection(r, 'SENT', r.listings?.title)
  );
}

async function received(sellerId, listingId) {
  // Connections on listings owned by seller
  let listingIds;
  if (listingId) {
    const { data: l } = await supabase.from('listings').select('id, seller_id').eq('id', listingId).maybeSingle();
    if (!l || l.seller_id !== sellerId) return [];
    listingIds = [listingId];
  } else {
    const { data: mine } = await supabase.from('listings').select('id').eq('seller_id', sellerId);
    listingIds = (mine || []).map((x) => x.id);
  }
  if (!listingIds.length) return [];

  const { data, error } = await supabase
    .from('connections')
    .select('*, listings(title), users:requester_id(name, phone)')
    .in('listing_id', listingIds)
    .order('created_at', { ascending: false });
  if (error) throw error;

  return (data || []).map((r) => {
    const mapped = mapConnection(
      {
        ...r,
        requester_name: r.users?.name || 'Buyer',
        requester_phone: r.users?.phone || '',
      },
      'RECEIVED',
      r.listings?.title
    );
    return mapped;
  });
}

module.exports = { request, mine, received };
