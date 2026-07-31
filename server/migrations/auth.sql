-- Auth tables — Vastra mobile+OTP login.
--
-- Deliberately NOT in schema.sql: that file drops and recreates its four tables
-- on every `npm run seed`, which would delete every login. These use
-- CREATE TABLE IF NOT EXISTS and are applied at boot from src/index.js, so
-- they're idempotent and survive a demo reseed.

-- One row per Vastra organization that has successfully logged in. Created only
-- as a side effect of a verified loyalty-verifyotp — never from a signup form.
-- `vastra_org_id` is the identity key: match on it, never on mobile or name
-- (both change on Vastra's side).
CREATE TABLE IF NOT EXISTS organization (
  id                  INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  vastra_org_id       VARCHAR(64)  NOT NULL UNIQUE,   -- Vastra's organization_Id
  name                VARCHAR(255) NOT NULL,          -- organization_name
  mobile              VARCHAR(20)  NULL,              -- last mobile used to log in
  vastra_access_token TEXT         NULL,              -- SERVER-SIDE ONLY, never sent to the browser
  blocked             TINYINT      NOT NULL DEFAULT 0,
  created_at          TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- Opaque bearer tokens. One active row per org (login deletes the previous),
-- which is what makes single-active-session and `blocked` actually revocable —
-- a JWT could not be.
CREATE TABLE IF NOT EXISTS session (
  token      CHAR(64) NOT NULL PRIMARY KEY,           -- crypto.randomBytes(32).toString('hex')
  org_id     INT      NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_session_org FOREIGN KEY (org_id)
    REFERENCES organization(id) ON DELETE CASCADE
) ENGINE=InnoDB;
