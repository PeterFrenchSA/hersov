import { hashPassword, verifyPassword } from './password.util';

describe('password util', () => {
  it('hashes and verifies a password', async () => {
    const plain = 'StrongPassword123!';
    const hash = await hashPassword(plain);

    expect(hash).not.toEqual(plain);
    await expect(verifyPassword(plain, hash)).resolves.toBe(true);
    await expect(verifyPassword('wrong-password', hash)).resolves.toBe(false);
  });
});
