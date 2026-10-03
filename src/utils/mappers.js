/**
 * Map DB rows -> frontend API shapes. Field names here are deliberately matched
 * 1:1 to the mobile app's src/api/types.ts — do not rename without updating both.
 */

/**
 * @param {object} row
 * @param {{ admin?: boolean }} opts  admin sees extra fields never sent to a normal user
 *   (ID photo URL, rejection reason, submission timestamp). Never included otherwise.
 */
function mapUser(row, opts = {}) {
  if (!row) return null;
  const base = {
    id: row.id,
    phone: row.phone,
    email: row.email || undefined,
    name: row.name || undefined,
    avatarUrl: row.profile_picture_url || undefined,
    role: row.role,
    emailVerified: !!row.email_verified_at,
    phoneVerified: !!row.phone_verified_at,
    identityVerificationStatus: row.identity_verification_status,
    pushEnabled: row.notifications_enabled !== false,
    acceptedTermsAt: row.accepted_terms_at || undefined,
  };
  if (opts.admin) {
    return {
      ...base,
      idPhotoUrl: row.id_photo_url || undefined,
      idFullName: row.id_full_name || undefined,
      idSubmittedAt: row.id_submitted_at || undefined,
      identityRejectionReason: row.identity_rejection_reason || undefined,
    };
  }
  return base;
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
    views: row.views_count ?? undefined,
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
