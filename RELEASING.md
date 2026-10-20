# Releasing

1. Work lands on `develop`, is verified on UAT, then merged into `main` (see `deploy/CICD.md`).
2. Update `version` in `package.json` and add a section to `CHANGELOG.md` whose heading starts with that exact version, for example `## 2.0.0 - 2026-11-05`.
3. Commit on `main`, then tag and push the tag:

   ```bash
   git tag v2.0.0 && git push origin v2.0.0
   ```

4. The `Release` workflow checks that the tag matches `package.json` and that the CHANGELOG section exists, runs the tests, publishes `ghcr.io/phoenixtechmsp/phoenix-nexus:2.0.0` (and `:2.0`), and creates the GitHub release with the CHANGELOG notes. A tag containing a dash (`v2.0.0-alpha.1`) is marked as a pre-release.
5. Security fix: bump the patch version, add a CHANGELOG entry, tag. Publish a GitHub Security Advisory for the affected versions.

Do not move or delete a published tag. If a release is wrong, publish the next patch version.
