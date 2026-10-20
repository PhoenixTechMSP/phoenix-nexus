# Roadmap

Phoenix-Nexus is open-core: a complete **Community** edition (AGPL-3.0) and a paid **Pro** edition for organisations that need automation, compliance evidence and support. This page says what goes where and why. Nothing here is a delivery date.

## Our commitments

1. **We do not move features from Community to Pro.** What ships in Community stays in Community, including single sign-on with Entra ID, the CMDB and the software licence position (SAM).
2. **Community is not crippled.** No cap on assets or users, no nagging, no trial period. Security fixes are never Pro-only.
3. **Pro sells what a free tool cannot do for you:** collect data automatically, produce audit evidence, scale across entities, and take responsibility through support.

## Community (free, AGPL-3.0)

- Asset management (ITAM): inventory, check-out / check-in, consumables, repair tracking, QR labels, CSV import and export.
- CMDB: configuration items and relationships, fed from ITAM through a transactional outbox.
- SAM: entitlements minus consumption, per-user and per-device metrics, compliance status.
- Entra ID single sign-on, roles (admin, staff), audit log, English / French / Dutch.
- Self-hosting with Docker or Node, numbered database migrations with automatic backup, [upgrade guide](UPGRADING.md).

## Pro (paid, planned)

What we plan to build, in the order we expect to tackle it. The order will follow what real users ask for.

| Area | What Pro adds | Why it is worth paying for |
|---|---|---|
| **Automatic data collection** | Synchronisation with Microsoft Entra ID, Intune and Active Directory; Microsoft 365 licence consumption feeding SAM | Without it, an inventory goes stale within months |
| **Compliance evidence (NIS2 / DORA)** | Exportable, timestamped audit evidence; ICT third-party register; reports ready for an insurer or a customer audit | Regulation creates an obligation, and a budget |
| **Software cost control** | Renewal alerts by e-mail or Teams, unused-licence savings report | Pays for itself on the first unused licences |
| **Governance** | Approval workflows, signed and tamper-evident audit log, fine-grained roles | What auditors ask for |
| **Scale** | Multi-entity, built for MSPs that manage several customers | One platform, many customers |
| **Assurance** | Support with a response time, security fixes back-ported to older versions (LTS), signed updates | Someone is accountable |

A **commercial licence** (use without the AGPL obligations) is also available. See [COMMERCIAL.md](COMMERCIAL.md).

## Community roadmap

Open to contributions. See [CONTRIBUTING.md](CONTRIBUTING.md).

- Replace the file-import library that has a known vulnerability (see Known limitations in the README).
- SAM: CSV import of software installations.
- Published Docker image and tagged releases with release notes.
- Update notice in the admin interface (opt-out, no data sent).
- PWA install and offline scan queue.
- Barcode / NFC alternative to QR.
- Audit trail export signed with an HMAC key.
- Push notifications for devices not returned at the end of a shift.
- SCIM user provisioning from Entra ID.

## How we decide

We build Pro features after talking to the people who would use them, not before. If you manage IT for a small or mid-sized organisation and want to influence this list, open a discussion or write to ops@phoenix-tech.be.
