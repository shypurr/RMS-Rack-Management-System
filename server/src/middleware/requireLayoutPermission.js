// Gate for layout mutations.
//
// Today every authenticated organization may reconfigure its own layout,
// because Vastra gives us no per-person identity: the login profile carries
// organization_Id, organization_name, org_url and access_token, and nothing
// that says WHO logged in. There is no role to check.
//
// This middleware exists anyway so that the day roles arrive — warehouse staff
// who may put stock away but not delete 1,500 bins — the check lands here and
// nowhere else. Keep every layout mutation behind it.
export function requireLayoutPermission(req, res, next) {
  next();
}
