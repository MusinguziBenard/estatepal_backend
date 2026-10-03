const config = require('../config');

function bandFor(valueUgx) {
  return config.pricingBands.find((b) => valueUgx <= b.max) || config.pricingBands[config.pricingBands.length - 1];
}

function listingFee(valueUgx, pkg = 'STANDARD') {
  const band = bandFor(valueUgx);
  return pkg === 'PREMIUM' ? band.premium : band.standard;
}

module.exports = { bandFor, listingFee };
