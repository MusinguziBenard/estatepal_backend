const { supabase } = require('../../db/supabase');
const config = require('../../config');
const { notFound, conflict } = require('../../utils/errors');
const { emit, EVENTS } = require('../../events/bus');
const { mapListing, mapUser } = require('../../utils/mappers');
const { verifyProof } = require('../payments/service');

async function logAction(adminId, action, entityType, entityId, meta = {}) {
  await supabase.from('admin_actions').insert({
    admin_id: adminId,
    action,
    entity_type: entityType,
    entity_id: entityId,
    meta,
  });
  emit(EVENTS.ADMIN_ACTION, { adminId, action, entityType, entityId, meta });
}

async function dashboard() {
  const [users, listings, pendingProofs, published, connections] = await Promise.all([
    supabase.from('users').select('*', { count: 'exact', head: true }),
    supabase.from('listings').select('*', { count: 'exact', head: true }),
    supabase.from('payment_proofs').select('*', { count: 'exact', head: true }).eq('status', 'PENDING'),
    supabase.from('listings').select('*', { count: 'exact', head: true }).eq('status', 'PUBLISHED'),
    supabase.from('connections').select('*', { count: 'exact', head: true }),
  ]);

  return {
    users: users.count || 0,
    listings: listings.count || 0,
    published: published.count || 0,
    pendingProofs: pendingProofs.count || 0,
    connections: connections.count || 0,
  };
}

async function listPendingProofs() {
  const { data, error } = await supabase
    .from('payment_proofs')
    .select('*, users(phone, name), listings(title, reference)')
    .eq('status', 'PENDING')
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data || [];
}

async function listListings({ status, q, limit = 50 }) {
  let query = supabase.from('listings').select('*, users:seller_id(phone, name)').order('created_at', { ascending: false }).limit(limit);
  if (status) query = query.eq('status', status);
  if (q) query = query.ilike('title', `%${q}%`);
  const { data, error } = await query;
  if (error) throw error;
  return (data || []).map((r) => ({
    ...mapListing(r, { isUnlocked: true, isOwner: true, hideOwnership: false }),
    sellerPhone: r.users?.phone,
    sellerName: r.users?.name,
    feeUGX: r.fee_ugx,
  }));
}

async function approveListing(listingId, adminId, { note } = {}) {
  const { data: listing } = await supabase.from('listings').select('*').eq('id', listingId).maybeSingle();
  if (!listing) throw notFound('Listing not found');

  // Prefer verifying via proof if one exists
  const { data: proof } = await supabase
    .from('payment_proofs')
    .select('*')
    .eq('listing_id', listingId)
    .eq('kind', 'LISTING')
    .eq('status', 'PENDING')
    .maybeSingle();

  if (proof) {
    return verifyProof(proof.id, adminId, { approve: true, note });
  }

  // Direct approve (e.g. under review)
  if (!['PROOF_SUBMITTED', 'UNDER_REVIEW', 'AWAITING_PAYMENT'].includes(listing.status)) {
    throw conflict(`Cannot approve from status ${listing.status}`);
  }

  const expires = new Date();
  expires.setDate(expires.getDate() + config.listingExpiryDays);

  const { data: updated } = await supabase
    .from('listings')
    .update({
      status: 'PUBLISHED',
      published_at: new Date().toISOString(),
      expires_at: expires.toISOString(),
    })
    .eq('id', listingId)
    .select('*')
    .single();

  const mapped = mapListing(updated, { isUnlocked: true, isOwner: true, hideOwnership: false });
  emit(EVENTS.LISTING_APPROVED, {
    listing: mapped,
    sellerId: updated.seller_id,
    listingId: updated.id,
  });
  await logAction(adminId, 'LISTING_APPROVE', 'listing', listingId, { note });
  return { ok: true, listing: mapped };
}

async function rejectListing(listingId, adminId, { reason } = {}) {
  const { data: listing } = await supabase.from('listings').select('*').eq('id', listingId).maybeSingle();
  if (!listing) throw notFound('Listing not found');

  await supabase
    .from('listings')
    .update({ status: 'REJECTED', rejection_reason: reason || null })
    .eq('id', listingId);

  // Reject pending proof if any
  await supabase
    .from('payment_proofs')
    .update({
      status: 'REJECTED',
      reviewed_by: adminId,
      reviewed_at: new Date().toISOString(),
      note: reason || null,
    })
    .eq('listing_id', listingId)
    .eq('status', 'PENDING');

  emit(EVENTS.LISTING_REJECTED, {
    listingId,
    sellerId: listing.seller_id,
    reason,
  });
  await logAction(adminId, 'LISTING_REJECT', 'listing', listingId, { reason });
  return { ok: true };
}

async function reviewProof(proofId, adminId, body) {
  const result = await verifyProof(proofId, adminId, body);
  await logAction(adminId, body.approve === false ? 'PROOF_REJECT' : 'PROOF_VERIFY', 'payment_proof', proofId, body);
  return result;
}

async function listUsers({ limit = 50, q } = {}) {
  let query = supabase.from('users').select('*').order('created_at', { ascending: false }).limit(limit);
  if (q) query = query.ilike('phone', `%${q}%`);
  const { data, error } = await query;
  if (error) throw error;
  return (data || []).map((u) => mapUser(u, { admin: true }));
}

async function setUserRole(userId, role, adminId) {
  if (!['user', 'admin'].includes(role)) throw conflict('Invalid role');
  const { data, error } = await supabase.from('users').update({ role }).eq('id', userId).select('*').single();
  if (error) throw error;
  await logAction(adminId, 'USER_ROLE', 'user', userId, { role });
  return mapUser(data);
}

async function listVerifications() {
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('identity_verification_status', 'PENDING')
    .order('id_submitted_at', { ascending: true });
  if (error) throw error;
  return (data || []).map((u) => mapUser(u, { admin: true }));
}

async function setIdentityStatus(userId, status, adminId, { reason } = {}) {
  const allowed = ['NONE', 'PENDING', 'VERIFIED', 'REJECTED'];
  if (!allowed.includes(status)) throw conflict('Invalid status');
  const { data, error } = await supabase
    .from('users')
    .update({ identity_verification_status: status, identity_rejection_reason: status === 'REJECTED' ? reason || null : null })
    .eq('id', userId)
    .select('*')
    .single();
  if (error) throw error;
  await logAction(adminId, 'IDENTITY_STATUS', 'user', userId, { status, reason });

  if (status === 'VERIFIED') emit(EVENTS.IDENTITY_VERIFIED, { userId });
  if (status === 'REJECTED') emit(EVENTS.IDENTITY_REJECTED, { userId, reason });

  return mapUser(data, { admin: true });
}

module.exports = {
  dashboard,
  listPendingProofs,
  listListings,
  approveListing,
  rejectListing,
  reviewProof,
  listUsers,
  listVerifications,
  setUserRole,
  setIdentityStatus,
  logAction,
};
