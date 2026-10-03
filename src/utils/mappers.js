/**
 * Map DB rows -> frontend API shapes (matches estatepal app types).
 */

/**
 * @param {object} row
 * @param {{ self?: boolean, admin?: boolean }} opts  self/admin see extra private fields (email, profile picture,
 *   verification status/reason). The ID photo URL itself is only ever returned to self or admin, never publicly.
 */
function mapUser(row, opts = {}) {
  if (!row) return null;
  const privileged = !!(opts.self || opts.admin);
  return {
    id: row.id,
    phone: row.phone,
    name: row.name || undefined,
    email: row.email || undefined,
    emailVerified: !!row.email_verified_at,
    profilePictureUrl: row.profile_picture_url || undefined,
    identityVerificationStatus: row.identity_verification_status,
    identityRejectionReason: privileged ? row.identity_rejection_reason || undefined : undefined,
    idPhotoUrl: privileged ? row.id_photo_url || undefined : undefined,
    idSubmittedAt: privileged ? row.id_submitted_at || undefined : undefined,
    acceptedTermsAt: row.accepted_terms_at || undefined,
    notificationsEnabled: privileged ? row.notifications_enabled !== false : undefined,
    role: row.role,
  };
}

/**
 * @param {object} row
 * @param {{ isUnlocked?: boolean, liked?: boolean, hideOwnership?: boolean }} opts
 */
function mapListing(row, opts = {}) {
  if (!row) return null;
  const isUnlocked = !!opts.isUnlocked;
  const hideOwnership = opts.hideOwnership !== false && !isUnlocked && !opts.isOwner;

  const listing = {
    id: row.id,
    sellerId: row.seller_id,
    title: row.title,
    category: row.category,
    transactionType: row.transaction_type,
    acreage: Number(row.acreage),
    advertisedValueUGX: Number(row.advertised_value_ugx),
    district: row.district,
    subcounty: row.subcounty,
    customLocation: row.custom_location || undefined,
    gps: row.gps_lat != null && row.gps_lng != null
      ? { latitude: row.gps_lat, longitude: row.gps_lng }
      : undefined,
    images: Array.isArray(row.images) ? row.images : [],
    status: row.status,
    isUnlocked,
    ownership: hideOwnership ? undefined : row.ownership,
    reference: row.reference || undefined,
    likes: row.likes_count ?? 0,
    liked: !!opts.liked,
    requestsCount: row.requests_count ?? 0,
  };

  if (isUnlocked && row.contact_phone) {
    listing.contact = {
      name: row.contact_name || 'Seller',
      phone: row.contact_phone,
      whatsapp: row.contact_whatsapp || row.contact_phone,
    };
  }

  return listing;
}

function mapConnection(row, direction, listingTitle) {
  return {
    id: row.id,
    listingId: row.listing_id,
    listingTitle: listingTitle || row.listing_title || '',
    reference: row.reference,
    status: row.status,
    feeUGX: row.fee_ugx,
    requesterName: direction === 'SENT' ? 'You' : (row.requester_name || 'Buyer'),
    requesterPhone: row.requester_phone || '',
    createdAt: row.created_at,
    direction,
  };
}

module.exports = { mapUser, mapListing, mapConnection };
