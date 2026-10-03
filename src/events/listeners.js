/**
 * Wire domain events → push notifications + websocket broadcasts.
 * Register once at boot via registerListeners().
 */
const { on, EVENTS } = require('./bus');
const { notify } = require('../services/push');
const { tokensForUsers, allTokens, adminUserIds } = require('../services/tokens');
const { getIo } = require('../websocket/io');

function broadcast(room, event, data) {
  try {
    const io = getIo();
    if (!io) return;
    if (room) io.to(room).emit(event, data);
    else io.emit(event, data);
  } catch (e) {
    console.warn('[ws] broadcast failed', e.message);
  }
}

function registerListeners() {
  // ── Auth / profile lifecycle ──
  on(EVENTS.USER_SIGNED_UP, async (e) => {
    if (!e.userId) return;
    const tokens = await tokensForUsers([e.userId]);
    await notify(tokens, {
      title: `Welcome to EstatePal${e.name ? ', ' + e.name.split(' ')[0] : ''} 👋`,
      body: 'Browse land and sugarcane listings, or list your own in minutes.',
      data: { type: 'WELCOME' },
    });
  });

  on(EVENTS.EMAIL_VERIFIED, async (e) => {
    if (!e.userId) return;
    const tokens = await tokensForUsers([e.userId]);
    await notify(tokens, {
      title: 'Email verified ✅',
      body: 'Your email address is now confirmed.',
      data: { type: 'EMAIL_VERIFIED' },
    });
  });

  on(EVENTS.PHONE_VERIFIED, async (e) => {
    if (!e.userId) return;
    const tokens = await tokensForUsers([e.userId]);
    await notify(tokens, {
      title: 'Phone number verified ✅',
      body: 'Your phone number is now confirmed.',
      data: { type: 'PHONE_VERIFIED' },
    });
  });

  on(EVENTS.IDENTITY_SUBMITTED, async (e) => {
    const admins = await adminUserIds();
    const tokens = await tokensForUsers(admins);
    await notify(tokens, {
      title: 'New ID verification pending',
      body: 'A user submitted an ID photo for review.',
      data: { type: 'IDENTITY_PENDING', userId: e.userId },
    });
    broadcast('admin', 'identity:pending', { userId: e.userId });
  });

  on(EVENTS.IDENTITY_VERIFIED, async (e) => {
    if (!e.userId) return;
    const tokens = await tokensForUsers([e.userId]);
    await notify(tokens, {
      title: 'You\'re verified ✅',
      body: 'Your identity has been confirmed by our team.',
      data: { type: 'IDENTITY_UPDATED' },
    });
    broadcast(`user:${e.userId}`, 'identity:status', { status: 'VERIFIED' });
  });

  on(EVENTS.IDENTITY_REJECTED, async (e) => {
    if (!e.userId) return;
    const tokens = await tokensForUsers([e.userId]);
    await notify(tokens, {
      title: 'Identity verification not approved',
      body: e.reason || 'Please check your ID photo and resubmit.',
      data: { type: 'IDENTITY_UPDATED' },
    });
    broadcast(`user:${e.userId}`, 'identity:status', { status: 'REJECTED', reason: e.reason });
  });

  // ── Listing approved → notify ALL users with public card data ──
  on(EVENTS.LISTING_APPROVED, async (e) => {
    const listing = e.listing;
    if (!listing) return;

    const publicPayload = {
      type: 'LISTING_UPDATED',
      listingId: listing.id,
      title: listing.title,
      district: listing.district,
      category: listing.category,
      transactionType: listing.transactionType,
      advertisedValueUGX: listing.advertisedValueUGX,
      acreage: listing.acreage,
      images: (listing.images || []).slice(0, 1),
    };

    broadcast(null, 'listing:published', publicPayload);

    const tokens = await allTokens();
    await notify(tokens, {
      title: 'New listing on EstatePal',
      body: `${listing.title} · ${listing.district}`,
      data: publicPayload,
    });

    // Seller confirmation
    if (e.sellerId) {
      const sellerTokens = await tokensForUsers([e.sellerId]);
      await notify(sellerTokens, {
        title: 'Your listing is live 🎉',
        body: `"${listing.title}" is now published.`,
        data: { type: 'PAYMENT_VERIFIED', listingId: listing.id },
      });
      broadcast(`user:${e.sellerId}`, 'listing:status', {
        listingId: listing.id,
        status: 'PUBLISHED',
      });
    }
  });

  on(EVENTS.LISTING_REJECTED, async (e) => {
    if (!e.sellerId) return;
    const tokens = await tokensForUsers([e.sellerId]);
    await notify(tokens, {
      title: 'Listing not approved',
      body: e.reason || 'Please update and resubmit.',
      data: { type: 'LISTING_UPDATED', listingId: e.listingId },
    });
    broadcast(`user:${e.sellerId}`, 'listing:status', {
      listingId: e.listingId,
      status: 'REJECTED',
      reason: e.reason,
    });
  });

  on(EVENTS.LISTING_CREATED, async (e) => {
    const admins = await adminUserIds();
    const tokens = await tokensForUsers(admins);
    await notify(tokens, {
      title: 'New listing pending payment',
      body: e.listing?.title || 'A seller created a listing',
      data: { type: 'LISTING_UPDATED', listingId: e.listing?.id },
    });
    broadcast('admin', 'listing:created', { listingId: e.listing?.id });
  });

  on(EVENTS.LISTING_PROOF_SUBMITTED, async (e) => {
    const admins = await adminUserIds();
    const tokens = await tokensForUsers(admins);
    await notify(tokens, {
      title: 'Listing payment proof',
      body: `Ref ${e.reference}`,
      data: { type: 'PAYMENT_VERIFIED', listingId: e.listingId },
    });
    broadcast('admin', 'payment:proof', { kind: 'LISTING', reference: e.reference });
  });

  on(EVENTS.LISTING_LIKED, async (e) => {
    if (!e.sellerId || e.sellerId === e.userId) return;
    const tokens = await tokensForUsers([e.sellerId]);
    await notify(tokens, {
      title: 'Someone saved your listing',
      body: e.title || 'A buyer liked your property',
      data: { type: 'LISTING_UPDATED', listingId: e.listingId },
    });
  });

  // ── Connections ──
  on(EVENTS.CONNECTION_REQUESTED, async (e) => {
    if (e.sellerId) {
      const tokens = await tokensForUsers([e.sellerId]);
      await notify(tokens, {
        title: 'New contact request',
        body: `Someone wants to unlock "${e.listingTitle || 'your listing'}"`,
        data: { type: 'CONNECTION_UPDATED', listingId: e.listingId },
      });
      broadcast(`user:${e.sellerId}`, 'connection:new', {
        listingId: e.listingId,
        connectionId: e.connectionId,
      });
    }
  });

  on(EVENTS.CONNECTION_PROOF_SUBMITTED, async (e) => {
    const admins = await adminUserIds();
    const tokens = await tokensForUsers(admins);
    await notify(tokens, {
      title: 'Connection payment proof',
      body: `Ref ${e.reference}`,
      data: { type: 'CONNECTION_UPDATED', listingId: e.listingId },
    });
    broadcast('admin', 'payment:proof', { kind: 'CONNECTION', reference: e.reference });
  });

  on(EVENTS.CONNECTION_UNLOCKED, async (e) => {
    if (e.requesterId) {
      const tokens = await tokensForUsers([e.requesterId]);
      await notify(tokens, {
        title: 'Contact unlocked',
        body: 'You can now reach the seller.',
        data: { type: 'PAYMENT_VERIFIED', listingId: e.listingId },
      });
      broadcast(`user:${e.requesterId}`, 'connection:unlocked', {
        listingId: e.listingId,
        connectionId: e.connectionId,
      });
    }
    if (e.sellerId) {
      broadcast(`user:${e.sellerId}`, 'connection:unlocked', {
        listingId: e.listingId,
        connectionId: e.connectionId,
      });
    }
  });

  on(EVENTS.PAYMENT_VERIFIED, async (e) => {
    broadcast(e.userId ? `user:${e.userId}` : null, 'payment:verified', {
      reference: e.reference,
      kind: e.kind,
      listingId: e.listingId,
    });
  });

  on(EVENTS.PAYMENT_REJECTED, async (e) => {
    if (!e.userId) return;
    const tokens = await tokensForUsers([e.userId]);
    await notify(tokens, {
      title: 'Payment not verified',
      body: e.note || 'Please check your transaction ID and resubmit.',
      data: { type: 'PAYMENT_VERIFIED', listingId: e.listingId },
    });
  });

  // Wildcard debug in development
  if (process.env.NODE_ENV !== 'production') {
    on('*', (e) => console.log(`[event] ${e.event}`, e.listingId || e.reference || ''));
  }

  console.log('[events] listeners registered');
}

module.exports = { registerListeners };
