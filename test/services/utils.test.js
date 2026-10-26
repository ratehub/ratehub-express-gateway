const should = require('should');
const config = require('../../lib/config');
const { encrypt, decrypt } = require('../../lib/services/utils');

// Ciphertext produced by crypto.createCipher on Node 18, before it was removed
const legacyVectors = [
  { algorithm: 'aes256', text: '4f1c2a|access-token-value', ciphertext: 'b82524c92ed0dc96a311d1b14f03a4a29d6e3534cf04c73f0e72c927bf6f8b48' },
  { algorithm: 'aes-128-ecb', text: '4f1c2a|access-token-value', ciphertext: '7feadbe15f4bf17a015e4001ab24e90949506a3940954863324416fbee510b68' }
];

describe('encrypt and decrypt', () => {
  const originalCrypto = Object.assign({}, config.systemConfig.crypto);

  afterEach(() => Object.assign(config.systemConfig.crypto, originalCrypto));

  legacyVectors.forEach(({ algorithm, text, ciphertext }) => {
    describe(algorithm, () => {
      beforeEach(() => Object.assign(config.systemConfig.crypto, { algorithm, cipherKey: 'sensitiveKey' }));

      it('should encrypt to the same ciphertext as crypto.createCipher', () => {
        should(encrypt(text)).equal(ciphertext);
      });

      it('should decrypt ciphertext from crypto.createCipher', () => {
        should(decrypt(ciphertext)).equal(text);
      });
    });
  });

  it('should reject an unknown cipher', () => {
    config.systemConfig.crypto.algorithm = 'not-a-cipher';
    should(() => encrypt('text')).throw(/Unknown cipher/);
  });
});
