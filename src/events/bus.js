/**
 * Lightweight in-process event bus (signals).
 * Modules emit domain events; listeners handle push, websockets, side-effects.
 * Keeps controllers thin and behaviour easy to extend.
 */
const { EventEmitter } = require('events');

const bus = new EventEmitter();
bus.setMaxListeners(50);

const EVENTS = {
  // Auth
  USER_SIGNED_UP: 'user.signed_up',
  USER_SIGNED_IN: 'user.signed_in',
  EMAIL_VERIFIED: 'user.email_verified',
  PHONE_VERIFIED: 'user.phone_verified',
  IDENTITY_SUBMITTED: 'user.identity_submitted',
  IDENTITY_VERIFIED: 'user.identity_verified',
  IDENTITY_REJECTED: 'user.identity_rejected',

  // Listings
  LISTING_CREATED: 'listing.created',
  LISTING_PROOF_SUBMITTED: 'listing.proof_submitted',
  LISTING_APPROVED: 'listing.approved',
  LISTING_REJECTED: 'listing.rejected',
  LISTING_UPDATED: 'listing.updated',
  LISTING_LIKED: 'listing.liked',
  LISTING_VIEWED: 'listing.viewed',

  // Connections
  CONNECTION_REQUESTED: 'connection.requested',
  CONNECTION_PROOF_SUBMITTED: 'connection.proof_submitted',
  CONNECTION_UNLOCKED: 'connection.unlocked',
  CONNECTION_REJECTED: 'connection.rejected',

  // Payments
  PAYMENT_PROOF_SUBMITTED: 'payment.proof_submitted',
  PAYMENT_VERIFIED: 'payment.verified',
  PAYMENT_REJECTED: 'payment.rejected',

  // Admin
  ADMIN_ACTION: 'admin.action',
};

function emit(event, payload = {}) {
  const envelope = { event, at: new Date().toISOString(), ...payload };
  bus.emit(event, envelope);
  bus.emit('*', envelope); // wildcard for logging / metrics
  return envelope;
}

function on(event, handler) {
  bus.on(event, handler);
  return () => bus.off(event, handler);
}

function once(event, handler) {
  bus.once(event, handler);
}

module.exports = { bus, EVENTS, emit, on, once };
