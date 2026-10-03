require('dotenv').config();
const { v2: cloudinary } = require('cloudinary');

(async () => {
  console.log('Cloudinary diagnostics\n');

  // 1. Show what's loaded
  console.log('[1] Env values:');
  console.log('    cloud_name:', JSON.stringify(process.env.CLOUDINARY_CLOUD_NAME));
  console.log('    api_key:   ', JSON.stringify(process.env.CLOUDINARY_API_KEY));
  console.log('    api_secret:', JSON.stringify(process.env.CLOUDINARY_API_SECRET)?.slice(0, 25) + '...');
  console.log('    secret length:', process.env.CLOUDINARY_API_SECRET?.length);

  // 2. Config
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true,
  });

  // 3. Ping
  console.log('\n[2] Attempting ping...');
  try {
    const result = await cloudinary.api.ping();
    console.log('    ✅ Success:', JSON.stringify(result));
  } catch (err) {
    console.log('    ❌ Thrown object keys:', Object.keys(err || {}));
    console.log('    ❌ message:', err?.message);
    console.log('    ❌ error:', err?.error);
    console.log('    ❌ http_code:', err?.http_code);
    console.log('    ❌ full:', JSON.stringify(err, null, 2));
  }

  // 4. Try an actual upload (the real test)
  console.log('\n[3] Attempting tiny test upload...');
  const sample = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8Xw8AAoMBgDTD2qgAAAAASUVORK5CYII=';
  try {
    const result = await cloudinary.uploader.upload(sample, {
      folder: 'estatepal/_healthcheck',
      public_id: `test-${Date.now()}`,
    });
    console.log('    ✅ Upload OK:', result.secure_url);
    await cloudinary.uploader.destroy(result.public_id);
    console.log('    ✅ Delete OK — Cloudinary fully working');
  } catch (err) {
    console.log('    ❌ Upload error message:', err?.message);
    console.log('    ❌ Upload http_code:', err?.http_code);
    console.log('    ❌ Full:', JSON.stringify(err, null, 2));
  }
})();