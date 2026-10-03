/**
 * Socket.IO realtime layer.
 * Clients connect with auth token → join user:{id} room (and admin if role=admin).
 * Frontend can subscribe for live listing/connection/payment updates.
 */
let io = null;

function initIo(httpServer, { corsOrigin }) {
  const { Server } = require('socket.io');
  io = new Server(httpServer, {
    cors: {
      origin: corsOrigin.includes('*') ? true : corsOrigin,
      methods: ['GET', 'POST'],
    },
    path: '/socket.io',
    transports: ['websocket', 'polling'],
  });

  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token || socket.handshake.query?.token;
      if (!token) return next(new Error('Unauthorized'));
      const { resolveSession } = require('../modules/auth/service');
      const user = await resolveSession(token);
      if (!user) return next(new Error('Unauthorized'));
      socket.user = user;
      next();
    } catch (e) {
      next(new Error('Unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    const user = socket.user;
    socket.join(`user:${user.id}`);
    if (user.role === 'admin') socket.join('admin');

    socket.emit('connected', { userId: user.id, role: user.role });

    socket.on('subscribe:listing', (listingId) => {
      if (listingId) socket.join(`listing:${listingId}`);
    });

    socket.on('unsubscribe:listing', (listingId) => {
      if (listingId) socket.leave(`listing:${listingId}`);
    });

    socket.on('disconnect', () => {});
  });

  console.log('[ws] Socket.IO ready');
  return io;
}

function getIo() {
  return io;
}

module.exports = { initIo, getIo };
