# Roadmap

Phoenix-Nexus Community is free software (AGPL-3.0-only) and complete for self-hosted use. This page says what it does today and what we plan next. Nothing here is a delivery date.

## Our commitments

1. **Community is not crippled.** No cap on assets or users, no nagging, no trial period.
2. **Security fixes are never withheld.** They ship in Community, in the open.
3. **No telemetry.** An instance never sends data anywhere unless the administrator configures it.
4. **We decide with users.** The order below follows what people who run the tool ask for.

## Today

- Asset management (ITAM): inventory, check-out / check-in, consumables, repair tracking, QR labels, CSV import and export.
- CMDB: configuration items and relationships, fed from ITAM through a transactional outbox.
- SAM: entitlements minus consumption, per-user and per-device metrics, compliance status.
- Roles (admin, staff), audit log, English / French / Dutch.
- Self-hosting with Docker or Node, numbered database migrations with automatic backup, [upgrade guide](UPGRADING.md).

## Next

Open to contributions. See [CONTRIBUTING.md](CONTRIBUTING.md).

- Replace the file-import library that has a known vulnerability (see Known limitations in the README).
- SAM: CSV import of software installations.
- Update notice in the admin interface (opt-out, no data sent).
- PWA install and offline scan queue.
- Barcode / NFC alternative to QR.
- Audit trail export signed with an HMAC key.
- Push notifications for devices not returned at the end of a shift.

## How to influence it

If you manage IT for a small or mid-sized organisation and want to shape this list, open a discussion or write to ops@phoenix-tech.be.

A commercial licence (use without the AGPL obligations) is available. See [COMMERCIAL.md](COMMERCIAL.md).
