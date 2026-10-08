const { supabase } = require('../../db/supabase');
const config = require('../../config');
const { notFound, conflict, validation } = require('../../utils/errors');
const { emit, EVENTS } = require('../../events/bus');
const { mapListing, mapUser } = require('../../utils/mappers');
const { verifyProof } = require('../payments/service');
const { uploadImage, destroyByUrl } = require('../../services/cloudinary');

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
  // Explicit FK aliases: payment_proofs has two FKs to users (user_id + reviewed_by),
  // so bare `users(...)` fails with "more than one relationship was found".
  const { data, error } = await supabase
    .from('payment_proofs')
    .select('*, users:user_id(phone, name), listings:listing_id(title, reference)')
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

/**
 * Admin hard-delete a listing in any status (including PUBLISHED).
 * Related likes/connections cascade in DB; payment_proofs.listing_id is SET NULL.
 */
async function deleteListing(listingId, adminId) {
  const { data: listing } = await supabase.from('listings').select('*').eq('id', listingId).maybeSingle();
  if (!listing) throw notFound('Listing not found');

  // Best-effort cleanup of Cloudinary images (ignore failures)
  const imgs = Array.isArray(listing.images) ? listing.images : [];
  for (const url of imgs) {
    if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
      try {
        await destroyByUrl(url);
      } catch {
        /* ignore */
      }
    }
  }

  const { error } = await supabase.from('listings').delete().eq('id', listingId);
  if (error) throw error;

  await logAction(adminId, 'LISTING_DELETE', 'listing', listingId, {
    title: listing.title,
    status: listing.status,
    reference: listing.reference,
  });
  emit(EVENTS.LISTING_UPDATED, { listingId, deleted: true, sellerId: listing.seller_id });
  return { ok: true, id: listingId };
}

/**
 * Resolve image list for admin update: keep https URLs, upload data: URLs, drop local paths.
 */
async function resolveImages(rawImages, publicIdPrefix) {
  const images = [];
  for (const img of rawImages || []) {
    if (typeof img !== 'string' || !img) continue;
    if (img.startsWith('data:')) {
      const b64 = img.replace(/^data:image\/\w+;base64,/, '');
      const url = await uploadImage(Buffer.from(b64, 'base64'), {
        folder: 'estatepal/listings',
        publicId: `${publicIdPrefix}-${images.length}-${Date.now()}`,
      });
      images.push(url);
    } else if (/^https?:\/\//i.test(img)) {
      images.push(img);
    }
  }
  return images;
}

/**
 * Admin update listing fields and/or replace images.
 * Any status is allowed. Body fields are optional; only provided keys are patched.
 */
async function updateListing(listingId, adminId, body = {}) {
  const { data: listing } = await supabase.from('listings').select('*').eq('id', listingId).maybeSingle();
  if (!listing) throw notFound('Listing not found');

  const patch = {};

  if (body.title != null) patch.title = String(body.title).trim();
  if (body.description !== undefined) {
    patch.description = body.description ? String(body.description).trim() : null;
  }
  if (body.category != null) {
    if (!['LAND', 'SUGARCANE_PLANTATION'].includes(body.category)) throw validation('Invalid category');
    patch.category = body.category;
  }
  if (body.transactionType != null) {
    if (!['SALE', 'LEASE'].includes(body.transactionType)) throw validation('Invalid transactionType');
    patch.transaction_type = body.transactionType;
  }
  if (body.acreage != null) patch.acreage = Number(body.acreage);
  if (body.unitPrice != null) patch.unit_price = Number(body.unitPrice);
  if (body.advertisedValueUGX != null) patch.advertised_value_ugx = Number(body.advertisedValueUGX);
  if (body.leaseYears !== undefined) {
    patch.lease_years = body.leaseYears != null ? Number(body.leaseYears) : null;
  }
  if (body.caneAgeMonths !== undefined) {
    patch.cane_age_months = body.caneAgeMonths != null ? Number(body.caneAgeMonths) : null;
  }
  if (body.harvests !== undefined) {
    patch.harvests = body.harvests != null ? Number(body.harvests) : null;
  }
  if (body.district != null) patch.district = String(body.district).trim();
  if (body.subcounty != null) patch.subcounty = String(body.subcounty).trim();
  if (body.customLocation !== undefined) {
    patch.custom_location = body.customLocation ? String(body.customLocation).trim() : null;
  }
  if (body.gps && typeof body.gps === 'object') {
    if (body.gps.latitude != null) patch.gps_lat = Number(body.gps.latitude);
    if (body.gps.longitude != null) patch.gps_lng = Number(body.gps.longitude);
  }
  if (body.ownership != null) {
    if (!['OWNER', 'BROKER'].includes(body.ownership)) throw validation('Invalid ownership');
    patch.ownership = body.ownership;
  }
  if (body.package != null) {
    if (!['STANDARD', 'PREMIUM'].includes(body.package)) throw validation('Invalid package');
    patch.package = body.package;
  }
  if (body.status != null) {
    const allowed = [
      'DRAFT',
      'AWAITING_PAYMENT',
      'PROOF_SUBMITTED',
      'UNDER_REVIEW',
      'PUBLISHED',
      'EXPIRED',
      'SOLD',
      'LEASED',
      'REJECTED',
    ];
    if (!allowed.includes(body.status)) throw validation('Invalid status');
    patch.status = body.status;
    if (body.status === 'PUBLISHED' && !listing.published_at) {
      const expires = new Date();
      expires.setDate(expires.getDate() + config.listingExpiryDays);
      patch.published_at = new Date().toISOString();
      patch.expires_at = expires.toISOString();
    }
  }
  if (body.contactPhone != null) patch.contact_phone = String(body.contactPhone).trim();
  if (body.contactWhatsapp !== undefined) {
    patch.contact_whatsapp = body.contactWhatsapp ? String(body.contactWhatsapp).trim() : null;
  }
  if (body.contactName !== undefined) {
    patch.contact_name = body.contactName ? String(body.contactName).trim() : null;
  }
  if (body.rejectionReason !== undefined) {
    patch.rejection_reason = body.rejectionReason || null;
  }

  // Full image replace when `images` is provided (array of https URLs and/or data: URLs)
  if (Array.isArray(body.images)) {
    const prefix = listing.reference || listingId;
    const resolved = await resolveImages(body.images, prefix);
    if (resolved.length === 0) {
      throw validation('At least one valid image is required (https URL or base64 data URL)');
    }
    // Remove old Cloudinary assets that are no longer in the new set
    const oldImgs = Array.isArray(listing.images) ? listing.images : [];
    const keep = new Set(resolved);
    for (const url of oldImgs) {
      if (typeof url === 'string' && /^https?:\/\//i.test(url) && !keep.has(url)) {
        try {
          await destroyByUrl(url);
        } catch {
          /* ignore */
        }
      }
    }
    patch.images = resolved;
  }

  if (Object.keys(patch).length === 0) {
    throw validation('No fields to update');
  }

  const { data: updated, error } = await supabase
    .from('listings')
    .update(patch)
    .eq('id', listingId)
    .select('*')
    .single();
  if (error) throw error;

  const mapped = mapListing(updated, { isUnlocked: true, isOwner: true, hideOwnership: false });
  await logAction(adminId, 'LISTING_UPDATE', 'listing', listingId, {
    fields: Object.keys(patch),
  });
  emit(EVENTS.LISTING_UPDATED, {
    listing: mapped,
    listingId,
    sellerId: updated.seller_id,
  });

  return {
    ok: true,
    listing: {
      ...mapped,
      sellerPhone: undefined,
      sellerName: undefined,
      feeUGX: updated.fee_ugx,
    },
  };
}

module.exports = {
  dashboard,
  listPendingProofs,
  listListings,
  approveListing,
  rejectListing,
  deleteListing,
  updateListing,
  reviewProof,
  listUsers,
  listVerifications,
  setUserRole,
  setIdentityStatus,
  logAction,
};
