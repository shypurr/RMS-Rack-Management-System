// Self-check for the OTP extractor. `node client/src/lib/otp.check.mjs`.
import assert from 'node:assert/strict';
import { extractOtp } from './otp.js';
const ok = (l) => console.log(`  ✓ ${l}`);

// The message Vastra staging actually returns, verbatim from the login screen.
const REAL = 'One Time Password (OTP) has been sent to your mobile ******5051, '
  + 'please enter the same here to verify. OTP 63065';
assert.equal(extractOtp(REAL, '9909155051'), '63065');
ok('the real staging message yields the code, not the masked mobile');

// The trap: without the label rule, "5051" from the mask is a rival candidate.
assert.equal(extractOtp('sent to ******5051. OTP 63065', '9909155051'), '63065');
assert.equal(extractOtp('sent to ******5051 code 63065', '9909155051'), '63065',
  'unlabelled: the mask is dropped as part of the typed mobile');
ok('a masked mobile is never mistaken for the code');

// Common shapes.
assert.equal(extractOtp('Your OTP is 4821', '9909155051'), '4821');
assert.equal(extractOtp('OTP: 928374', '9909155051'), '928374');
assert.equal(extractOtp('OTP-1234', '9909155051'), '1234');
ok('labelled codes are read in their usual shapes');

// Refuses rather than guesses.
assert.equal(extractOtp('OTP sent', '9909155051'), null);
assert.equal(extractOtp('Your one time password has been sent.', '9909155051'), null);
assert.equal(extractOtp('', '9909155051'), null);
assert.equal(extractOtp(undefined, '9909155051'), null);
ok('a message with no code fills nothing');

assert.equal(extractOtp('OTP 1111 or OTP 2222', '9909155051'), null);
assert.equal(extractOtp('ref 8811 batch 9922', '9909155051'), null);
ok('two rival candidates fill nothing rather than guessing');

// A production-shaped message that names only the mobile must stay empty.
assert.equal(extractOtp('OTP sent to 9909155051', '9909155051'), null);
assert.equal(extractOtp('An OTP has been sent to ******5051.', '9909155051'), null);
ok('a message quoting only the mobile number fills nothing');

// Guard the boundaries: too short, too long, and digits glued to the code.
assert.equal(extractOtp('OTP 123', '9909155051'), null, '3 digits is below the floor');
assert.equal(extractOtp('OTP 1234567890', '9909155051'), null, '10 digits is above the ceiling');
ok('runs outside 4-8 digits are ignored');

// No mobile supplied (resend before the field is read) still works via the label.
assert.equal(extractOtp(REAL, ''), '63065');
ok('the label path works even without the mobile to compare against');

console.log('\notp extraction checks passed\n');
