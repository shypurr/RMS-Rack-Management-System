// Pulling the OTP out of Vastra's own confirmation message.
//
// Vastra's staging environment echoes the code back in the text it returns from
// /user/loyalty-signup — see the comment on sendLoginOtp in vastraClient.js. The
// browser therefore already has the OTP the moment the toast appears, and
// making a tester read six digits off a notification and retype them is busywork
// during a login they will perform hundreds of times.
//
// The real message looks like this:
//
//   One Time Password (OTP) has been sent to your mobile ******5051, please
//   enter the same here to verify. OTP 63065
//
// Note the two traps in it. "(OTP)" appears early, nowhere near the code. And
// the masked mobile "******5051" is a four-digit run that is NOT equal to the
// number the user typed — so excluding the mobile by equality leaves it behind
// as a second candidate and the whole thing gives up.
//
// This never guesses. If it cannot identify exactly one code it returns null and
// the box stays empty, which is the behaviour before this existed. So the day
// Vastra stops echoing the OTP — production, presumably — this quietly does
// nothing rather than filling the field with the wrong digits.
export function extractOtp(message, mobile = '') {
  const text = String(message || '');
  const mobileDigits = String(mobile || '').replace(/[^0-9]/g, '');

  // Preferred: the code is labelled. Requiring digits directly after the label
  // is what makes "(OTP) has been sent" fail to match — there is a ")" where a
  // digit would have to be, so the scan moves on to "OTP 63065".
  const labelled = [...text.matchAll(/OTP\s*(?:is|:|-)?\s*([0-9]{4,8})(?![0-9])/gi)]
    .map((m) => m[1]);
  // Two labelled codes in one message is not something to pick a winner from.
  if (labelled.length) return labelled.length === 1 ? labelled[0] : null;

  // Fallback for a differently-worded message: any standalone run of 4-8 digits
  // that is not part of the mobile number just typed. `includes`, not equality —
  // that is exactly what catches the masked "******5051", whose visible tail is
  // a substring of the real number.
  //
  // Match WHOLE runs and filter by length, rather than asking the regex for
  // 4-8 digits directly: `/[0-9]{4,8}/` is happy to bite the first eight digits
  // out of a ten-digit number and call that a code. Length has to be a property
  // of the whole run, not of the slice the regex chose to stop at.
  const candidates = [...new Set(text.match(/[0-9]+/g) || [])]
    .filter((d) => d.length >= 4 && d.length <= 8)
    .filter((d) => !(mobileDigits && mobileDigits.includes(d)));

  return candidates.length === 1 ? candidates[0] : null;
}
