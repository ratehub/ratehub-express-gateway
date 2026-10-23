const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const config = require('../config');

function appendCreatedAt (obj) {
  Object.assign(obj, {
    createdAt: (new Date()).toString()
  });
}

function appendUpdatedAt (obj) {
  Object.assign(obj, {
    updatedAt: (new Date()).toString()
  });
}

function encrypt (text) {
  const { algorithm, cipherKey } = config.systemConfig.crypto;
  const { key, iv } = deriveKeyAndIv(algorithm, cipherKey);
  const cipher = crypto.createCipheriv(algorithm, key, iv);
  return cipher.update(text, 'utf8', 'hex') + cipher.final('hex');
}

function decrypt (password) {
  const { algorithm, cipherKey } = config.systemConfig.crypto;
  const { key, iv } = deriveKeyAndIv(algorithm, cipherKey);
  const decipher = crypto.createDecipheriv(algorithm, key, iv);
  return decipher.update(password, 'hex', 'utf8') + decipher.final('utf8');
}

// Same derivation as the removed crypto.createCipher, so stored ciphertext still decrypts.
function deriveKeyAndIv (algorithm, password) {
  const cipherInfo = crypto.getCipherInfo(algorithm);
  if (!cipherInfo) {
    throw new Error(`Unknown cipher: ${algorithm}`);
  }

  const { keyLength, ivLength = 0 } = cipherInfo;
  const digests = [];
  let digest = Buffer.alloc(0);
  let derivedLength = 0;

  // OpenSSL EVP_BytesToKey: MD5, no salt, one round
  while (derivedLength < keyLength + ivLength) {
    digest = crypto.createHash('md5').update(digest).update(password).digest();
    digests.push(digest);
    derivedLength += digest.length;
  }

  const derived = Buffer.concat(digests);
  return {
    key: derived.subarray(0, keyLength),
    iv: ivLength ? derived.subarray(keyLength, keyLength + ivLength) : null
  };
}

function compareSaltAndHashed (password, hash) {
  return (!password || !hash) ? null : bcrypt.compare(password, hash);
}

function saltAndHash (password) {
  if (!password || typeof password !== 'string') {
    return Promise.reject(new Error('invalid arguments'));
  }

  return bcrypt
    .genSalt(config.systemConfig.crypto.saltRounds)
    .then((salt) => bcrypt.hash(password, salt));
}

module.exports = {
  appendCreatedAt,
  appendUpdatedAt,
  encrypt,
  decrypt,
  compareSaltAndHashed,
  saltAndHash
};
