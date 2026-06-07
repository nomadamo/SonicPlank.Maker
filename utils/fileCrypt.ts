import * as crypto from 'crypto';

const algorithm = 'aes-256-cbc';
const key = Buffer.from('12345678901234567890123456789012', 'utf-8'); // Example 32-byte key (for AES-256)
const iv = Buffer.from('1234567890123456', 'utf-8'); // Example 16-byte IV (for AES-256)

export function encrypt(text:any) {
    const cipher = crypto.createCipheriv(algorithm, key, iv);
    let encrypted = cipher.update(text, 'utf-8', 'hex');
    encrypted += cipher.final('hex');
    return { iv: iv.toString('hex'), encryptedData: encrypted };
  }

  // Decrypt function
  export function decrypt(encrypted:any) {
    const decipher = crypto.createDecipheriv(algorithm, key, Buffer.from(encrypted.iv, 'hex'));
    let decrypted = decipher.update(encrypted.encryptedData, 'hex', 'utf-8');
    decrypted += decipher.final('utf-8');
    return decrypted;
  }
