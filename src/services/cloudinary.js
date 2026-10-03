const { v2: cloudinary } = require('cloudinary');
const config = require('../config');

let configured = false;

function ensure() {
  if (configured) return;
  if (config.cloudinary.cloudName && config.cloudinary.apiKey && config.cloudinary.apiSecret) {
    cloudinary.config({
      cloud_name: config.cloudinary.cloudName,
      api_key: config.cloudinary.apiKey,
      api_secret: config.cloudinary.apiSecret,
      secure: true,
    });
    configured = true;
  }
}

/**
 * Upload a buffer or remote URL. Returns secure HTTPS URL.
 * @param {Buffer|string} input
 * @param {{ folder?: string, publicId?: string }} opts
 */
async function uploadImage(input, opts = {}) {
  ensure();
  if (!configured) {
    // Dev fallback: return placeholder so local testing works without Cloudinary
    const seed = opts.publicId || Date.now();
    return `https://picsum.photos/seed/${seed}/900/600`;
  }

  const options = {
    folder: opts.folder || 'estatepal/listings',
    resource_type: 'image',
    overwrite: false,
    transformation: [{ quality: 'auto', fetch_format: 'auto' }],
  };
  if (opts.publicId) options.public_id = opts.publicId;

  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(options, (err, result) => {
      if (err) return reject(err);
      resolve(result.secure_url);
    });
    if (Buffer.isBuffer(input)) {
      stream.end(input);
    } else {
      // remote URL
      cloudinary.uploader
        .upload(input, options)
        .then((r) => resolve(r.secure_url))
        .catch(reject);
    }
  });
}

async function destroyByUrl(url) {
  ensure();
  if (!configured || !url) return;
  try {
    const parts = url.split('/');
    const last = parts[parts.length - 1];
    const publicId = `estatepal/listings/${last.replace(/\.[^.]+$/, '')}`;
    await cloudinary.uploader.destroy(publicId);
  } catch (e) {
    console.warn('[cloudinary] destroy failed', e.message);
  }
}

module.exports = { uploadImage, destroyByUrl };
