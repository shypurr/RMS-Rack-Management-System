// Typed error so routes can map a failure to an HTTP status code.
//
// Lives in a leaf module rather than in rackService.js because layoutService
// throws it while rackService imports getOrgWidths from layoutService — keeping
// the class here means neither service has to import the other just to raise an
// error. rackService re-exports it, so existing import sites are unaffected.
export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
