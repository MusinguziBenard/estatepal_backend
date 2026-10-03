const { supabase } = require('../../db/supabase');
const config = require('../../config');
const { notFound, validation, conflict } = require('../../utils/errors');
const { emit, EVENTS } = require('../../events/bus');
const { mapListing } = require('../../utils/mappers');

async function submitProof({ referenceCode, transactionId, payerPhone }, userId) {
  if (!referenceCode || !transactionId || String(transactionId).trim().length < 4) {
    throw validation('Reference and transaction ID required');
  }
  const ref = String(referenceCode).trim().toUpperCase();
  const txn = String(transactionId).trim();

  // Listing fee
  if (ref.startsWith('LST')) {
    const { data: listing } = await supabase
      .from('listings')
      .select('*')
      .eq('reference', ref)
      .maybeSingle();
    if (!listing) throw notFound('Unknown reference');
    if (listing.seller_id !== userId) throw validation('Not your listing');
    if (!['AWAITING_PAYMENT', 'PROOF_SUBMITTED'].includes(listing.status)) {
      throw conflict('Listing is not awaiting payment');
    }

    await supabase.from('payment_proofs').insert({
      reference_code: ref,
      kind: 'LISTING',
      listing_id: listing.id,
      user_id: userId,
      transaction_id: txn,
      payer_phone: payerPhone || null,
      status: 'PENDING',
    });

    await supabase.from('listings').update({ status: 'PROOF_SUBMITTED' }).eq('id', listing.id);

    emit(EVENTS.LISTING_PROOF_SUBMITTED, {
      listingId: listing.id,
      reference: ref,
      userId,
    });
    emit(EVENTS.PAYMENT_PROOF_SUBMITTED, {
      kind: 'LISTING',
      reference: ref,
      listingId: listing.id,
      userId,
    });

    return { ok: true };
  }

  // Connection fee
  if (ref.startsWith('CON')) {
    const { data: conn } = await supabase
      .from('connections')
      .select('*')
      .eq('reference', ref)
      .maybeSingle();
    if (!conn) throw notFound('Unknown reference');
    if (conn.requester_id !== userId) throw validation('Not your request');
    if (!['AWAITING_PAYMENT', 'PROOF_SUBMITTED'].includes(conn.status)) {
      throw conflict('Request is not awaiting payment');
    }

    await supabase.from('payment_proofs').insert({
      reference_code: ref,
      kind: 'CONNECTION',
      connection_id: conn.id,
      listing_id: conn.listing_id,
      user_id: userId,
      transaction_id: txn,
      payer_phone: payerPhone || null,
      status: 'PENDING',
    });

    await supabase.from('connections').update({ status: 'PROOF_SUBMITTED' }).eq('id', conn.id);

    emit(EVENTS.CONNECTION_PROOF_SUBMITTED, {
      connectionId: conn.id,
      listingId: conn.listing_id,
      reference: ref,
      userId,
    });
    emit(EVENTS.PAYMENT_PROOF_SUBMITTED, {
      kind: 'CONNECTION',
      reference: ref,
      listingId: conn.listing_id,
      userId,
    });

    return { ok: true };
  }

  throw notFound('Unknown reference');
}

/**
 * Admin: verify a payment proof → publish listing or unlock connection.
 */
async function verifyProof(proofId, adminId, { approve = true, note } = {}) {
  const { data: proof } = await supabase.from('payment_proofs').select('*').eq('id', proofId).maybeSingle();
  if (!proof) throw notFound('Proof not found');
  if (proof.status !== 'PENDING') throw conflict('Already reviewed');

  if (!approve) {
    await supabase
      .from('payment_proofs')
      .update({
        status: 'REJECTED',
        reviewed_by: adminId,
        reviewed_at: new Date().toISOString(),
        note: note || null,
      })
      .eq('id', proofId);

    emit(EVENTS.PAYMENT_REJECTED, {
      userId: proof.user_id,
      listingId: proof.listing_id,
      reference: proof.reference_code,
      note,
    });
    return { ok: true, status: 'REJECTED' };
  }

  await supabase
    .from('payment_proofs')
    .update({
      status: 'VERIFIED',
      reviewed_by: adminId,
      reviewed_at: new Date().toISOString(),
      note: note || null,
    })
    .eq('id', proofId);

  if (proof.kind === 'LISTING' && proof.listing_id) {
    const expires = new Date();
    expires.setDate(expires.getDate() + config.listingExpiryDays);

    const { data: listing } = await supabase
      .from('listings')
      .update({
        status: 'PUBLISHED',
        published_at: new Date().toISOString(),
        expires_at: expires.toISOString(),
      })
      .eq('id', proof.listing_id)
      .select('*')
      .single();

    const mapped = mapListing(listing, { isUnlocked: true, isOwner: true, hideOwnership: false });
    emit(EVENTS.LISTING_APPROVED, {
      listing: mapped,
      sellerId: listing.seller_id,
      listingId: listing.id,
    });
    emit(EVENTS.PAYMENT_VERIFIED, {
      kind: 'LISTING',
      reference: proof.reference_code,
      listingId: listing.id,
      userId: proof.user_id,
    });
  }

  if (proof.kind === 'CONNECTION' && proof.connection_id) {
    const { data: conn } = await supabase
      .from('connections')
      .update({ status: 'UNLOCKED' })
      .eq('id', proof.connection_id)
      .select('*, listings(seller_id, title)')
      .single();

    emit(EVENTS.CONNECTION_UNLOCKED, {
      connectionId: conn.id,
      listingId: conn.listing_id,
      requesterId: conn.requester_id,
      sellerId: conn.listings?.seller_id,
    });
    emit(EVENTS.PAYMENT_VERIFIED, {
      kind: 'CONNECTION',
      reference: proof.reference_code,
      listingId: conn.listing_id,
      userId: proof.user_id,
    });
  }

  return { ok: true, status: 'VERIFIED' };
}

module.exports = { submitProof, verifyProof };
